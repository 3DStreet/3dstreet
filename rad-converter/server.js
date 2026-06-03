'use strict';

// RAD converter — Cloud Run HTTP handler.
//
// Receives { uid, assetId, plyPath, jobId } and produces the splat "optimized"
// variant: downloads the source .ply from GCS, runs the bundled `build-lod`
// (Spark 2.1.0) to make a single LOD .rad, uploads it as an `assetRole:
// 'optimized'` artifact, then patches the asset doc's optimizedSource* fields.
// The renderer + client placement already prefer optimizedSourceUrl, so the
// instant the doc is patched, dragging the splat in streams the .rad.
//
// URL/metadata scheme mirrors saveSplatToGallery (public/functions/replicate.js)
// byte-for-byte so anonymous viewers can load via the download token, exactly
// like the original .ply.
//
// jobId is optional: when present we write terminal status to the
// generationJobs doc (queue integration); when absent (the manual one-shot)
// we just do the conversion + doc patch.

const { spawn } = require('child_process');
const { randomUUID } = require('crypto');
const { performance } = require('perf_hooks');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');

const express = require('express');
const admin = require('firebase-admin');

// On Cloud Run the runtime service account supplies credentials. The default
// Storage bucket isn't inferrable from ADC, so pass it explicitly via env
// (set STORAGE_BUCKET on the service; falls back to the GCP convention).
const STORAGE_BUCKET =
  process.env.STORAGE_BUCKET ||
  (process.env.GCLOUD_PROJECT
    ? `${process.env.GCLOUD_PROJECT}.appspot.com`
    : undefined);

admin.initializeApp({ storageBucket: STORAGE_BUCKET });

const SPARK_VERSION = process.env.SPARK_VERSION || '2.1.0';
// --quality = bhatt-lod base 1.75, single .rad — matches the Hetzner-validated
// output. --rad (single file) is build-lod's default.
const LOD_QUALITY = 'quality';

// A snapshot of *what executed this conversion* — captured per request so the
// timing numbers are interpretable later (a slow convert on a 2-vCPU revision
// reads very differently from one on 4). PATCHES_APPLIED is a build-time env the
// Dockerfile derives from patches/, so the running binary "knows" its fork (null
// until that's wired). region/revision come from Cloud Run's runtime env.
function runtimeInfo() {
  return {
    cpuCount: os.cpus().length,
    totalMemoryBytes: os.totalmem(),
    region: process.env.SERVICE_REGION || null,
    revision: process.env.K_REVISION || null,
    sparkVersion: SPARK_VERSION,
    patches: process.env.PATCHES_APPLIED || null,
    lod: LOD_QUALITY
  };
}

// Guard a uid before using it in a Storage/Firestore path. Mirrors the client's
// validateUserIdForPath / replicate.js validateSplatUserId.
function validateUserId(userId) {
  if (
    !userId ||
    typeof userId !== 'string' ||
    !/^[a-zA-Z0-9_-]+$/.test(userId)
  ) {
    throw new Error('Invalid user id for splat path');
  }
}

// Run build-lod, streaming its logs through to the container stdout/stderr so
// they show up in Cloud Run logs. Resolves on exit 0, rejects otherwise.
function runBuildLod(plyFile) {
  return new Promise((resolve, reject) => {
    const args = [plyFile, `--${LOD_QUALITY}`];
    console.log(`[rad-converter] build-lod ${args.join(' ')}`);
    const proc = spawn('build-lod', args, {
      stdio: ['ignore', 'inherit', 'inherit']
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`build-lod exited with code ${code}`));
    });
  });
}

// Core conversion. Returns { optimizedSourceUrl, optimizedSourcePath,
// optimizedSourceSize } after the .rad is uploaded and the asset doc patched.
//
// `perf` is an accumulator the caller owns: we fill phaseMs/inputBytes/durationMs
// as each phase completes, so even if a later phase throws, the handler still has
// the timings for the phases that *did* run when it writes the failed status.
async function convert({ uid, assetId, plyPath }, perf = {}) {
  validateUserId(uid);
  if (!assetId || !/^[a-zA-Z0-9_-]+$/.test(assetId)) {
    throw new Error('Invalid assetId');
  }
  if (!plyPath || typeof plyPath !== 'string') {
    throw new Error('Missing plyPath');
  }

  const bucket = admin.storage().bucket();

  // 1. Download the source splat to local scratch. We name it {assetId}.ply
  //    only so build-lod's auto-suffix yields {assetId}-lod.rad — build-lod
  //    content-sniffs the bytes, so .splat/.spz/.ksplat/.sog inputs convert
  //    fine despite the nominal .ply name. (.rad uploads never reach here;
  //    onSplatAssetCreated skips them.)
  //    NOTE: /tmp on Cloud Run is tmpfs (counts against memory). For multi-GB
  //    splats, mount a GCS FUSE volume and point WORKDIR there instead.
  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rad-'));
  const localPly = path.join(workDir, `${assetId}.ply`);
  const localRad = path.join(workDir, `${assetId}-lod.rad`);

  perf.phaseMs = perf.phaseMs || {};
  const convertStart = performance.now();

  try {
    console.log(`[rad-converter] downloading gs://${bucket.name}/${plyPath}`);
    let mark = performance.now();
    await bucket.file(plyPath).download({ destination: localPly });
    perf.phaseMs.download = Math.round(performance.now() - mark);
    // Source size from local scratch (== the GCS object size we just pulled).
    perf.inputBytes = fs.statSync(localPly).size;

    // 2. Convert.
    mark = performance.now();
    await runBuildLod(localPly);
    if (!fs.existsSync(localRad)) {
      throw new Error(`build-lod produced no output at ${localRad}`);
    }
    perf.phaseMs.convert = Math.round(performance.now() - mark);

    // 3. Upload the .rad as the optimized artifact. Same path convention as the
    //    original splat (users/{uid}/assets/splats/), -lod.rad suffix.
    const optimizedSourcePath = `users/${uid}/assets/splats/${assetId}-lod.rad`;
    const downloadToken = randomUUID();
    mark = performance.now();
    await bucket.upload(localRad, {
      destination: optimizedSourcePath,
      // resumable upload keeps memory bounded for large files.
      metadata: {
        contentType: 'application/octet-stream',
        // Immutable content (keyed by assetId): cache for a year so the editor
        // and the preview-modal iframe reuse the browser HTTP cache instead of
        // re-downloading. Matches assetsService.uploadToStorage for uploads.
        cacheControl: 'public, max-age=31536000',
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          // Excludes this file from the user's quota (onAssetWritten reads only
          // `size`); it's a platform-derived artifact like the optimized GLB.
          assetRole: 'optimized',
          assetId
        }
      }
    });

    // 4. Read size back authoritatively from the stored object.
    const [meta] = await bucket.file(optimizedSourcePath).getMetadata();
    const optimizedSourceSize = Number(meta.size) || 0;
    perf.phaseMs.upload = Math.round(performance.now() - mark);
    perf.durationMs = Math.round(performance.now() - convertStart);

    const optimizedSourceUrl =
      `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/` +
      `${encodeURIComponent(optimizedSourcePath)}?alt=media&token=${downloadToken}`;

    // 5. Patch the asset doc. The renderer + placement already prefer
    //    optimizedSourceUrl ?? storageUrl, so this flips the splat to RAD.
    await admin
      .firestore()
      .collection('users')
      .doc(uid)
      .collection('assets')
      .doc(assetId)
      .set(
        {
          optimizedSourceUrl,
          optimizedSourcePath,
          optimizedSourceSize,
          optimizationMetadata: {
            format: 'rad',
            tool: 'build-lod',
            sparkVersion: SPARK_VERSION,
            lod: LOD_QUALITY,
            // Perf subset mirrored onto the asset doc so it survives the
            // generationJobs TTL (the job doc is the transient record; the asset
            // is permanent). Mirrors the fields the handler writes on the job.
            durationMs: perf.durationMs,
            phaseMs: perf.phaseMs,
            inputBytes: perf.inputBytes,
            optimizedSourceSize,
            runtime: perf.runtime || runtimeInfo(),
            completedAt: admin.firestore.Timestamp.now()
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

    console.log(
      `[rad-converter] done: ${optimizedSourcePath} (${optimizedSourceSize} bytes)`
    );
    return { optimizedSourceUrl, optimizedSourcePath, optimizedSourceSize };
  } finally {
    // Free scratch immediately — tmpfs is memory.
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Best-effort terminal writeback to the generationJobs doc (queue path only).
async function writeJobStatus(uid, jobId, fields) {
  if (!jobId) return;
  try {
    await admin
      .firestore()
      .collection('users')
      .doc(uid)
      .collection('generationJobs')
      .doc(jobId)
      .set(
        { ...fields, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
        { merge: true }
      );
  } catch (err) {
    console.error('[rad-converter] failed to write job status:', err);
  }
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.get('/', (_req, res) => res.status(200).send('rad-converter ok'));

app.post('/', async (req, res) => {
  const { uid, assetId, plyPath, jobId } = req.body || {};
  console.log(
    `[rad-converter] request uid=${uid} assetId=${assetId} jobId=${jobId || '(none)'}`
  );
  // Owned by the handler, filled by convert() as phases complete, so the failure
  // path can still report partial timings + which runtime ran the job.
  const perf = { runtime: runtimeInfo(), phaseMs: {}, inputBytes: null };
  const startWall = performance.now();
  // Common perf payload for the terminal writeback (both success and failure).
  const perfFields = () => ({
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    durationMs:
      typeof perf.durationMs === 'number'
        ? perf.durationMs
        : Math.round(performance.now() - startWall),
    phaseMs: perf.phaseMs,
    runtime: perf.runtime,
    inputBytes: perf.inputBytes
  });
  try {
    // Mark in-flight so the reconciler can distinguish an active conversion
    // from a dropped task. Includes startedAt for stall detection.
    await writeJobStatus(uid, jobId, {
      status: 'running',
      startedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    const result = await convert({ uid, assetId, plyPath }, perf);
    await writeJobStatus(uid, jobId, {
      status: 'succeeded',
      ...result,
      ...perfFields()
    });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[rad-converter] conversion failed:', err);
    await writeJobStatus(uid, jobId, {
      status: 'failed',
      error: String(err && err.message ? err.message : err),
      ...perfFields()
    });
    // 500 so Cloud Tasks retries (the reconciler also re-enqueues stalls).
    res.status(500).json({
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`[rad-converter] listening on ${port}, bucket=${STORAGE_BUCKET}`);
});
