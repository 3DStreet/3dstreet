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
 *   and a failed upload leaves the existing variant serving. The old object
 *   is left in place on purpose: saved scenes bake the served URL into
 *   `gltf-model` (uploadAndPlaceAsset), so it must keep resolving for as
 *   long as the asset exists. The monthly cleanupOrphanedStorage job knows
 *   this: it keeps any object tagged { assetRole: 'optimized', assetId }
 *   whose assetId is a live doc, and reclaims it only after the doc itself is
 *   purged (asset-gc.js). Clients cannot delete Storage objects themselves
 *   (storage.rules). The superseded variant costs storage but never quota,
 *   which counts `size` alone.
 */

import { deleteField } from 'firebase/firestore';
import { assetsService } from '@shared/assets';
import { optimizeGlb } from './optimizeGlb.js';

/**
 * Worker budget for a manual re-run. Upload-time optimization uses
 * optimizeGlb's 30s default because it sits inside an upload the user is
 * waiting on; here the user explicitly asked for it and watches a progress
 * line, so the pipeline gets three times as long before it is killed and the
 * run reports "no change (timeout)". A 167 MB photogrammetry GLB that blows
 * past 30s on a slow laptop is exactly the case this button exists for.
 */
export const REOPTIMIZE_TIMEOUT_MS = 90_000;

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
  const { blob, metadata } = await optimizeGlb(originalBlob, {
    signal,
    timeoutMs: REOPTIMIZE_TIMEOUT_MS
  });
  if (metadata.optimizationSkipped) {
    // optimizeGlb reports an abort as just another skip reason. Everything
    // else here is a legitimate "no win" outcome the caller shows to the
    // user; a cancellation is not, and must not render as
    // "No change (aborted)." Re-raise it as the abort it was.
    if (metadata.reason === 'aborted') {
      throw new DOMException('Reoptimize cancelled', 'AbortError');
    }
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
  // stays readable for scenes that reference it (see header).
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

/**
 * Undo an optimization: drop the optimized variant from the doc so every
 * consumer (getServedUrl, asset-fallback, scene load) falls back to the
 * untouched original. The simplify() step is lossy, and whether the result is
 * "good enough" is the owner's call to make after looking at it — this is the
 * reversal. Pressing Optimize again re-runs the pipeline from the original.
 *
 * Nothing is deleted from Storage: the optimized object stays readable for
 * scenes that baked its URL in, and is reclaimed by cleanupOrphanedStorage
 * once the asset doc is purged (same lifecycle as a reoptimize, see the
 * header). The fields are removed rather than nulled because firestore.rules
 * validates optimizedSourcePath only when present.
 *
 * @param {object} asset - The Firestore asset doc.
 * @param {object} [opts]
 * @param {string} [opts.ownerUid] - Defaults to the doc's own `userId`.
 * @returns {Promise<{previousPath: string|null}>}
 */
export async function removeOptimizedVariant(asset, { ownerUid } = {}) {
  const uid = ownerUid || asset?.userId;
  if (!asset?.assetId || !uid) {
    throw new Error(
      'removeOptimizedVariant: asset must carry assetId and userId'
    );
  }
  await assetsService.updateAsset(asset.assetId, uid, {
    optimizedSourceUrl: deleteField(),
    optimizedSourcePath: deleteField(),
    optimizedSourceSize: deleteField(),
    optimizationMetadata: deleteField()
  });
  return { previousPath: asset.optimizedSourcePath || null };
}
