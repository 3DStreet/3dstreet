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
async function convert({ uid, assetId, plyPath }) {
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

  try {
    console.log(`[rad-converter] downloading gs://${bucket.name}/${plyPath}`);
    await bucket.file(plyPath).download({ destination: localPly });

    // 2. Convert.
    await runBuildLod(localPly);
    if (!fs.existsSync(localRad)) {
      throw new Error(`build-lod produced no output at ${localRad}`);
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
  try {
    // Mark in-flight so the reconciler can distinguish an active conversion
    // from a dropped task. Includes startedAt for stall detection.
    await writeJobStatus(uid, jobId, {
      status: 'running',
      startedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    const result = await convert({ uid, assetId, plyPath });
    await writeJobStatus(uid, jobId, { status: 'succeeded', ...result });
    res.status(200).json({ ok: true, ...result });
  } catch (err) {
    console.error('[rad-converter] conversion failed:', err);
    await writeJobStatus(uid, jobId, {
      status: 'failed',
      error: String(err && err.message ? err.message : err)
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
