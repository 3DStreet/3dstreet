/**
 * Re-run the client optimization pipeline over an asset that is already in
 * the gallery, and repoint its doc at the new optimized GLB.
 *
 * Why this exists: the pipeline in optimizeGlb.worker.js evolves (steps get
 * added, budgets get raised), and an asset optimized by an older version —
 * or one whose optimization was skipped entirely because the worker timed
 * out — is stuck with whatever it got at upload time. This lets the owner
 * pick up the current pipeline without re-uploading the source.
 *
 * The original (`storagePath` / `storageUrl`) is never touched: it is the
 * quota-counted file and the escape hatch if an optimization ever makes a
 * model worse. Only the optimized variant is replaced.
 *
 * Lifecycle of the previous optimized file:
 *   The new GLB goes to a NEW path and the doc is repointed, rather than
 *   overwriting in place — the doc never points at a half-written object,
 *   and a failed upload leaves the existing variant serving. That leaves the
 *   old object unreferenced, which is exactly what the monthly
 *   cleanupOrphanedStorage job collects: it builds the referenced set from
 *   storagePath + optimizedSourcePath + thumbnailPath across every asset doc
 *   and deletes anything under users/*\/assets/ that nothing references and
 *   that is older than its 24h grace window. Clients cannot delete Storage
 *   objects themselves (storage.rules), so this is the only disposal path.
 *   Worst case the stale object lingers until the next monthly run; it costs
 *   storage but never quota, which counts `size` alone.
 */

import { assetsService } from '@shared/assets';
import { optimizeGlb } from './optimizeGlb.js';

/**
 * Optimized output is always GLB — the worker's writeBinary() emits a GLB
 * container even when the upload was a self-contained .gltf.
 */
const OPTIMIZED_EXTENSION = 'glb';

/**
 * @param {object} asset - The Firestore asset doc.
 * @param {object} [opts]
 * @param {string} [opts.ownerUid] - Defaults to the doc's own `userId`.
 * @param {(stage: string) => void} [opts.onStatus] - 'downloading' |
 *   'optimizing' | 'uploading'.
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{ok: boolean, reason?: string, bytesBefore?: number,
 *   bytesAfter?: number, previousPath?: string|null, newPath?: string}>}
 *   `ok: false` is an expected outcome, not a failure — the pipeline either
 *   skipped (see optimizeGlb's reasons) or produced nothing smaller than
 *   what the asset already serves. Throws only on network/permission errors.
 */
export async function reoptimizeAsset(
  asset,
  { ownerUid, onStatus, signal } = {}
) {
  const uid = ownerUid || asset?.userId;
  if (!asset?.assetId || !uid) {
    throw new Error('reoptimizeAsset: asset must carry assetId and userId');
  }
  if (!asset.storageUrl) {
    throw new Error('reoptimizeAsset: asset has no original to re-read');
  }

  onStatus?.('downloading');
  let response;
  try {
    response = await fetch(asset.storageUrl, { signal });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    // fetch() rejects with an opaque "TypeError: Failed to fetch" when the
    // browser blocks reading the response, which for a Storage download URL
    // is nearly always the bucket's CORS config not listing this origin —
    // the request itself returns 200. Note the Download button keeps working
    // either way: window.open() is a navigation, and CORS doesn't apply to
    // navigations. Applying public/cors.json to the bucket is the fix
    // (`gsutil cors set public/cors.json gs://<bucket>`).
    //
    // The user gets the plain sentence; the real cause rides along as
    // `cause` so the console and Sentry still show what happened.
    throw new Error('Could not download the original.', { cause: err });
  }
  if (!response.ok) {
    throw new Error('Could not download the original.', {
      cause: new Error(`HTTP ${response.status} ${response.statusText}`)
    });
  }
  const originalBlob = await response.blob();

  onStatus?.('optimizing');
  const { blob, metadata } = await optimizeGlb(originalBlob, { signal });
  if (metadata.optimizationSkipped) {
    return { ok: false, reason: metadata.reason, metadata };
  }

  // optimizeGlb only guarantees the result beats the ORIGINAL. When the asset
  // already serves an optimized variant, the bar is that variant instead —
  // otherwise a pipeline change that regresses this particular model would
  // quietly make the served file bigger.
  const currentOptimizedSize = Number(asset.optimizedSourceSize) || 0;
  if (currentOptimizedSize > 0 && blob.size >= currentOptimizedSize) {
    return {
      ok: false,
      reason: 'not_smaller_than_current',
      bytesBefore: currentOptimizedSize,
      bytesAfter: blob.size,
      metadata
    };
  }

  onStatus?.('uploading');
  // A fresh path per run, so the doc swap is atomic and the previous object
  // stays readable until the GC collects it.
  const newPath = assetsService.getStoragePath(
    uid,
    asset.type,
    `${asset.assetId}-optimized-${Date.now()}.${OPTIMIZED_EXTENSION}`
  );
  const newUrl = await assetsService.uploadToStorage(
    blob,
    newPath,
    null,
    signal,
    // Matches addAsset: marks the file as a platform-derived artifact so
    // storage audits keep it out of the user's quota.
    { assetRole: 'optimized', assetId: asset.assetId }
  );

  await assetsService.updateAsset(asset.assetId, uid, {
    optimizedSourceUrl: newUrl,
    optimizedSourcePath: newPath,
    optimizedSourceSize: blob.size,
    optimizationMetadata: metadata
  });

  return {
    ok: true,
    bytesBefore: currentOptimizedSize || Number(asset.size) || 0,
    bytesAfter: blob.size,
    previousPath: asset.optimizedSourcePath || null,
    newPath,
    newUrl,
    metadata
  };
}
