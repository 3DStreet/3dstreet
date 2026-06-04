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
// `binary` selects which compiled binary to run — defaults to the patched
// `build-lod`; the staging perf A/B passes `build-lod-baseline` (the unpatched
// upstream binary) to measure the patch's effect on the same instance.
function runBuildLod(plyFile, binary = 'build-lod') {
  return new Promise((resolve, reject) => {
    const args = [plyFile, `--${LOD_QUALITY}`];
    console.log(`[rad-converter] ${binary} ${args.join(' ')}`);
    const proc = spawn(binary, args, {
      stdio: ['ignore', 'inherit', 'inherit']
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${binary} exited with code ${code}`));
    });
  });
}

// Core conversion. Returns { optimizedSourceUrl, optimizedSourcePath,
// optimizedSourceSize, buildLodMs } after the .rad is uploaded and the asset
// doc patched.
//
// Benchmark mode (`benchmark: true`, staging perf A/B only — see
// ../docs/rad-perf-staging-benchmark.md): run the selected `variant` binary,
// time it, and return { benchmark, variant, buildLodMs, optimizedSourceSize }
// WITHOUT uploading the .rad or touching Firestore. The source .ply is cached
// per-instance so repeated trials of a big file don't re-download it.
async function convert({ uid, assetId, plyPath, benchmark = false, variant = 'patched' }) {
  validateUserId(uid);
  if (!assetId || !/^[a-zA-Z0-9_-]+$/.test(assetId)) {
    throw new Error('Invalid assetId');
  }
  if (!plyPath || typeof plyPath !== 'string') {
    throw new Error('Missing plyPath');
  }

  const binary = variant === 'baseline' ? 'build-lod-baseline' : 'build-lod';
  const bucket = admin.storage().bucket();

  // 1. Stage the source splat in local scratch. It's named {assetId}.ply only
  //    so build-lod's auto-suffix yields {assetId}-lod.rad next to it —
  //    build-lod content-sniffs the bytes, so .splat/.spz/.ksplat/.sog inputs
  //    convert fine despite the nominal .ply name. (.rad uploads never reach
  //    here; onSplatAssetCreated skips them.)
  //    NOTE: /tmp on Cloud Run is tmpfs (counts against memory). For multi-GB
  //    splats, mount a GCS FUSE volume and point this dir there instead.
  let inputDir;
  let cleanupDir = null;
  if (benchmark) {
    // Reuse a per-instance cache so repeated A/B trials of the same big file
    // don't re-download it each run (with max-instances=1 the cache persists
    // across trials; only the build-lod CPU time — what we measure — varies).
    inputDir = path.join(os.tmpdir(), 'rad-bench-cache');
    await fsp.mkdir(inputDir, { recursive: true });
  } else {
    inputDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'rad-'));
    cleanupDir = inputDir;
  }
  const localPly = path.join(inputDir, `${assetId}.ply`);
  const localRad = path.join(inputDir, `${assetId}-lod.rad`);

  try {
    if (benchmark && fs.existsSync(localPly)) {
      console.log(`[rad-converter] (bench) reusing cached ${localPly}`);
    } else {
      console.log(`[rad-converter] downloading gs://${bucket.name}/${plyPath}`);
      await bucket.file(plyPath).download({ destination: localPly });
    }

    // 2. Convert (timed — buildLodMs isolates the CPU cost the patch targets).
    const t0 = Date.now();
    await runBuildLod(localPly, binary);
    const buildLodMs = Date.now() - t0;
    if (!fs.existsSync(localRad)) {
      throw new Error(`${binary} produced no output at ${localRad}`);
    }

    // Benchmark mode stops here: report timing + output size, skip upload +
    // Firestore so trials have zero side effects and stay fast.
    if (benchmark) {
      const radBytes = (await fsp.stat(localRad)).size;
      await fsp.rm(localRad, { force: true }).catch(() => {});
      console.log(
        `[rad-converter] benchmark variant=${variant} buildLodMs=${buildLodMs} radBytes=${radBytes}`
      );
      return { benchmark: true, variant, buildLodMs, optimizedSourceSize: radBytes };
    }

    // 3. Upload the .rad as the optimized artifact. Same path convention as the
    //    original splat (users/{uid}/assets/splats/), -lod.rad suffix.
    const optimizedSourcePath = `users/${uid}/assets/splats/${assetId}-lod.rad`;
    const downloadToken = randomUUID();
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
            lod: LOD_QUALITY
          },
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

    console.log(
      `[rad-converter] done: ${optimizedSourcePath} (${optimizedSourceSize} bytes, buildLodMs=${buildLodMs})`
    );
    return {
      optimizedSourceUrl,
      optimizedSourcePath,
      optimizedSourceSize,
      buildLodMs
    };
  } finally {
    // Free scratch immediately — tmpfs is memory. (Benchmark mode keeps its
    // per-instance .ply cache, so cleanupDir is null there.)
    if (cleanupDir) {
      await fsp.rm(cleanupDir, { recursive: true, force: true }).catch(() => {});
    }
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
  const { uid, assetId, plyPath, jobId, benchmark, variant } = req.body || {};
  const isBenchmark = !!benchmark;
  console.log(
    `[rad-converter] request uid=${uid} assetId=${assetId} jobId=${jobId || '(none)'}` +
      (isBenchmark ? ` benchmark variant=${variant || 'patched'}` : '')
  );
  try {
    // Mark in-flight so the reconciler can distinguish an active conversion
    // from a dropped task. Includes startedAt for stall detection. Benchmark
    // runs have no job doc and no side effects, so skip the writeback.
    if (!isBenchmark) {
      await writeJobStatus(uid, jobId, {
        status: 'running',
        startedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    const result = await convert({
      uid,
      assetId,
      plyPath,
      benchmark: isBenchmark,
      variant
    });
    if (!isBenchmark) {
      await writeJobStatus(uid, jobId, { status: 'succeeded', ...result });
    }
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[rad-converter] conversion failed:', err);
    if (!isBenchmark) {
      await writeJobStatus(uid, jobId, {
        status: 'failed',
        error: String(err && err.message ? err.message : err)
      });
    }
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
