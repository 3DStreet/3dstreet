/**
 * Cloud asset processing pipeline — phase 1: images (#1643).
 *
 * Post-upload, produce for every image asset:
 *   - a small WebP thumbnail ({assetId}-thumb.webp, ≤512px) that replaces the
 *     client's canvas JPEG on gallery cards, and
 *   - an optimized display variant ({assetId}-optimized.webp, ≤2048px,
 *     high-compression) written to the same optimizedSource* fields the GLB
 *     client optimization uses — getServedUrl() picks it up automatically.
 *
 * Server-side is required, not a nicety: job-queue results are saved to the
 * gallery server-side with no client attached, so a client-only pass can
 * never cover them. Later phases (video posters, mesh posters, splat posters)
 * add new "poster producers" that feed this same image pass — see
 * docs/asset-processing-pipeline.md for the rollout ordering.
 *
 * Flow: the Firestore trigger claims the doc via a transactional lease
 * (leaseExpiresAt) and processes inline — sharp on an image is seconds of
 * work, so no Cloud Tasks indirection. Crashed/timed-out runs auto-release
 * when the lease expires; the scheduled reaper
 * (scheduled/asset-processing-reaper.js) re-takes them. leaseExpiresAt
 * doubles as the not-before time on 'pending' retries so one composite index
 * (processingState, leaseExpiresAt) serves the whole reaper query.
 *
 * Idempotent by construction: variant filenames are keyed on assetId, so a
 * duplicate run (trigger racing the reaper) overwrites the same Storage
 * objects and re-patches the same doc. Only the transaction claim decides
 * who actually does the work.
 *
 * Quota: variants never count — onAssetWritten sums only `size`, and variant
 * sizes live in other fields. Storage objects carry assetRole metadata
 * ('thumbnail' / 'optimized') for byte-level audit scripts.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');

// Bump to make already-'done' assets eligible again on their next doc touch
// (or via a future backfill mode on the reaper's manual trigger).
const PROCESSING_VERSION = 1;

// Asset types the pipeline can currently produce variants for. Phase 2 adds
// 'video' (poster frame → this same image pass), then 'mesh'/'splat' posters.
// Types not listed are never enrolled — enrolling without a handler would
// just make the reaper churn on permanently-pending docs.
const HANDLED_TYPES = ['image'];

const MAX_ATTEMPTS = 3;
// Lease long enough to cover a slow download + sharp on a big image with the
// function's own timeout (120s) as the real ceiling.
const LEASE_MS = 4 * 60 * 1000;
// Retry backoff between failed attempts (attempt n waits n × this).
const RETRY_BACKOFF_MS = 5 * 60 * 1000;
// Don't buffer arbitrarily large originals into memory (per-file plan caps
// allow up to 1 GB+). Past this, skip variants — terminal, not an error.
const MAX_SOURCE_BYTES = 80 * 1000 * 1000;

const THUMB_MAX_PX = 512;
const THUMB_WEBP_QUALITY = 75;
const OPTIMIZED_MAX_PX = 2048;
const OPTIMIZED_WEBP_QUALITY = 80;
// Keep the optimized variant only when it meaningfully beats the original —
// mirrors the client GLB optimizer's "not_smaller" skip.
const OPTIMIZED_KEEP_RATIO = 0.9;

function nowMs() {
  return Date.now();
}

function tsMillis(ts) {
  return ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0;
}

/**
 * Whether this doc currently needs a processing run. Shared by the trigger,
 * the claim transaction (re-checked inside), and the reaper, so all three
 * agree on eligibility.
 */
function needsProcessing(data) {
  if (!data || data.deleted) return false;
  if (!HANDLED_TYPES.includes(data.type)) return false;
  if (!data.storagePath) return false;

  const state = data.processingState;
  if (state === 'failed') return false; // terminal — manual intervention only
  if (state === 'done') {
    // Reprocess only when the pipeline version moved on.
    return (Number(data.processingVersion) || 0) < PROCESSING_VERSION;
  }
  if (state === 'running' || state === 'pending') {
    // running: lease still held → someone else is on it.
    // pending: leaseExpiresAt is the earliest-retry time.
    return tsMillis(data.leaseExpiresAt) <= nowMs();
  }
  // No processingState at all: never enrolled (new upload, or a legacy doc
  // being lazily enrolled by any touch).
  return true;
}

/**
 * Transactionally claim the doc for processing. Returns the claimed doc data
 * or null when someone else won the race (or the doc stopped being eligible).
 */
async function claimAsset(docRef) {
  const db = admin.firestore();
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return null;
    const data = snap.data();
    if (!needsProcessing(data)) return null;
    tx.update(docRef, {
      processingState: 'running',
      processingAttempts: admin.firestore.FieldValue.increment(1),
      leaseExpiresAt: admin.firestore.Timestamp.fromMillis(nowMs() + LEASE_MS)
    });
    return data;
  });
}

/**
 * Release a claim after a failed run: back off for another attempt, or mark
 * terminally failed once attempts are exhausted.
 */
async function releaseFailed(docRef, err) {
  const db = admin.firestore();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return;
    const attempts = Number(snap.data().processingAttempts) || 1;
    const message = String((err && err.message) || err).slice(0, 500);
    if (attempts >= MAX_ATTEMPTS) {
      tx.update(docRef, {
        processingState: 'failed',
        processingError: message,
        leaseExpiresAt: admin.firestore.FieldValue.delete()
      });
    } else {
      tx.update(docRef, {
        processingState: 'pending',
        processingError: message,
        leaseExpiresAt: admin.firestore.Timestamp.fromMillis(
          nowMs() + attempts * RETRY_BACKOFF_MS
        )
      });
    }
  });
}

function tokenUrl(bucketName, storagePath, token) {
  return (
    `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/` +
    `${encodeURIComponent(storagePath)}?alt=media&token=${token}`
  );
}

async function uploadVariant(bucket, storagePath, buffer, assetId, assetRole) {
  const token = crypto.randomUUID();
  await bucket.file(storagePath).save(buffer, {
    resumable: false,
    metadata: {
      contentType: 'image/webp',
      // Immutable content (keyed by assetId) — matches the client uploader.
      cacheControl: 'public, max-age=31536000',
      metadata: {
        // Anonymous scene viewers load via this token, same as originals.
        firebaseStorageDownloadTokens: token,
        // Platform-derived artifact: audit scripts exclude from user quota.
        assetRole,
        assetId
      }
    }
  });
  return tokenUrl(bucket.name, storagePath, token);
}

/**
 * Produce and store variants for an IMAGE asset. Returns the doc update to
 * apply on success.
 */
async function processImage(docRef, data) {
  // Lazy require: sharp's native binding is only paid for by this pipeline's
  // invocations, not every function sharing this bundle's cold start.
  const sharp = require('sharp');
  const bucket = admin.storage().bucket();
  const assetId = data.assetId || docRef.id;

  const size = Number(data.size) || 0;
  if (size > MAX_SOURCE_BYTES) {
    return {
      processingSkipped: 'source_too_large'
    };
  }

  const [buffer] = await bucket.file(data.storagePath).download();

  // .rotate() bakes EXIF orientation so variants render upright everywhere.
  // failOn:'none' tolerates minor corruption instead of rejecting the file.
  const base = sharp(buffer, { failOn: 'none' }).rotate();
  const meta = await base.metadata();

  // Variants live next to the original (users/{uid}/assets/images/...).
  const folder = data.storagePath.slice(0, data.storagePath.lastIndexOf('/'));

  const thumbBuffer = await base
    .clone()
    .resize({
      width: THUMB_MAX_PX,
      height: THUMB_MAX_PX,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: THUMB_WEBP_QUALITY })
    .toBuffer();
  const thumbnailPath = `${folder}/${assetId}-thumb.webp`;
  const thumbnailUrl = await uploadVariant(
    bucket,
    thumbnailPath,
    thumbBuffer,
    assetId,
    'thumbnail'
  );

  const update = {
    thumbnailPath,
    thumbnailUrl,
    // Backfill dimensions when the doc doesn't have them (server-side saves
    // skip the client's <img> probe).
    ...(!data.dimensions && meta.width && meta.height
      ? { dimensions: { width: meta.width, height: meta.height } }
      : {})
  };

  // Replace the client's canvas JPEG thumb file when we just superseded it.
  // Best-effort — the monthly orphan cleanup is the backstop.
  if (data.thumbnailPath && data.thumbnailPath !== thumbnailPath) {
    await bucket
      .file(data.thumbnailPath)
      .delete()
      .catch(() => {});
  }

  const optimizedBuffer = await base
    .clone()
    .resize({
      width: OPTIMIZED_MAX_PX,
      height: OPTIMIZED_MAX_PX,
      fit: 'inside',
      withoutEnlargement: true
    })
    .webp({ quality: OPTIMIZED_WEBP_QUALITY })
    .toBuffer();

  if (optimizedBuffer.length < buffer.length * OPTIMIZED_KEEP_RATIO) {
    const optimizedSourcePath = `${folder}/${assetId}-optimized.webp`;
    update.optimizedSourceUrl = await uploadVariant(
      bucket,
      optimizedSourcePath,
      optimizedBuffer,
      assetId,
      'optimized'
    );
    update.optimizedSourcePath = optimizedSourcePath;
    update.optimizedSourceSize = optimizedBuffer.length;
  } else {
    update.processingSkipped = 'optimized_not_smaller';
  }

  return update;
}

/**
 * Claim + process + finalize one asset doc. Safe to call from both the
 * trigger and the reaper; the claim transaction dedupes racing callers.
 * Returns a short action string for logs/summaries.
 */
async function processAsset(docRef) {
  const claimed = await claimAsset(docRef);
  if (!claimed) return 'skipped';

  try {
    // Only 'image' today (HANDLED_TYPES gates enrollment); this becomes a
    // per-type dispatch when video/mesh/splat posters land.
    const update = await processImage(docRef, claimed);
    await docRef.update({
      ...update,
      processingState: 'done',
      processingVersion: PROCESSING_VERSION,
      processedAt: admin.firestore.FieldValue.serverTimestamp(),
      leaseExpiresAt: admin.firestore.FieldValue.delete(),
      processingError: admin.firestore.FieldValue.delete()
    });
    return 'processed';
  } catch (err) {
    console.error(
      `[asset-processing] failed for ${docRef.path}:`,
      (err && err.message) || err
    );
    await releaseFailed(docRef, err);
    return 'errored';
  }
}

/**
 * Firestore trigger: enroll + process eligible assets as they're written.
 * Fires on every asset write (uploads, renames, our own status writes) —
 * needsProcessing() makes the non-actionable ones cheap no-ops, including
 * the writes this pipeline itself makes ('running' with live lease, 'done').
 */
const processAssetOnWrite = functions
  .runWith({ memory: '1GB', timeoutSeconds: 120 })
  .firestore.document('users/{userId}/assets/{assetId}')
  .onWrite(async (change) => {
    if (!change.after.exists) return null;
    const after = change.after.data();
    if (!needsProcessing(after)) return null;
    await processAsset(change.after.ref);
    return null;
  });

module.exports = {
  processAssetOnWrite,
  processAsset,
  needsProcessing,
  HANDLED_TYPES,
  PROCESSING_VERSION
};
