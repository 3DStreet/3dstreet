/**
 * Scene-free asset upload.
 *
 * Used by hosts that don't have an A-Frame viewport (the generator app,
 * Storybook). For the editor's drop-and-place flow see
 * src/editor/lib/asset-upload/uploadAndPlaceAsset.js — it shares the same
 * validate/preflight/optimize/upload/thumbnail stages but also owns the
 * scene-graph side effects (placeholder entity, undo command, status store).
 */

import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@shared/services/firebase.js';
import {
  assetsService,
  ASSET_TYPES,
  ASSET_CATEGORIES,
  getServedUrl
} from '@shared/assets';
import useCurrentUploadStore from '@shared/assets/state/currentUploadStore.js';
import {
  extractGlbAttribution,
  buildStoredAttribution
} from './extractGlbAttribution.js';
import { optimizeGlb } from './optimizeGlb.js';

export const GLB_MAX_BYTES = 50 * 1000 * 1000;
export const IMAGE_MAX_BYTES = 10 * 1000 * 1000;

const GLB_EXTS = ['.glb', '.gltf'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
const ACCEPTED_EXTS = [...GLB_EXTS, ...IMAGE_EXTS];

export const FILE_PICKER_ACCEPT = ACCEPTED_EXTS.join(',');

export function getAssetKind(file) {
  const name = (file.name || '').toLowerCase();
  if (GLB_EXTS.some((ext) => name.endsWith(ext))) return 'glb';
  if (IMAGE_EXTS.some((ext) => name.endsWith(ext))) return 'image';
  return null;
}

export function isAcceptedAssetFile(file) {
  return getAssetKind(file) !== null;
}

async function preflightQuota(proposedBytes) {
  if (!auth.currentUser) return { allowed: false, reason: 'not_signed_in' };
  try {
    const callable = httpsCallable(functions, 'getUploadQuota');
    const { data } = await callable({ proposedBytes });
    return data;
  } catch (err) {
    console.warn('[asset-upload] quota check unavailable, skipping', err);
    return { allowed: true, soft: true };
  }
}

/**
 * Upload a file to the user's asset library. No scene side effects.
 *
 * @param {File} file
 * @param {object} [opts]
 * @param {(stage: 'validating'|'optimizing'|'uploading'|'thumbnailing', info?: object) => void} [opts.onStatus]
 * @param {(progress: number) => void} [opts.onProgress] - 0..100
 * @param {(message: string) => void} [opts.onTimeoutError] - called when the
 *   safety-net arrival timeout fires (upload completed but the doc never
 *   surfaced in the gallery). Hosts wire this to their toast system so the
 *   spinner doesn't silently disappear and leave the user wondering.
 * @returns {Promise<{ ok: boolean, assetId?: string, kind?: string, error?: string }>}
 */
export async function uploadAsset(
  file,
  { onStatus, onProgress, onTimeoutError } = {}
) {
  const kind = getAssetKind(file);
  if (!kind) return { ok: false, error: `Unsupported file type: ${file.name}` };

  // Enforce one-at-a-time across all upload surfaces (editor + generator).
  const uploadStore = useCurrentUploadStore.getState();
  if (uploadStore.isBusy()) {
    return {
      ok: false,
      kind,
      error: 'An upload is already in progress. Please wait for it to finish.'
    };
  }

  const sizeCap = kind === 'glb' ? GLB_MAX_BYTES : IMAGE_MAX_BYTES;
  if (file.size > sizeCap) {
    const limitMb = Math.round(sizeCap / 1000 / 1000);
    const kindLabel = kind === 'glb' ? 'GLB files' : 'Images';
    return {
      ok: false,
      kind,
      error: `File too large. ${kindLabel} must be under ${limitMb} MB.`
    };
  }

  if (!auth.currentUser) {
    return { ok: false, kind, error: 'Sign in to upload assets.' };
  }
  const userId = auth.currentUser.uid;

  uploadStore.start({ filename: file.name, sizeBytes: file.size, kind });
  const signal = uploadStore.getSignal();

  let pendingAssetId = null;
  const onProgressEvent = (e) => {
    const detail = e.detail || {};
    if (pendingAssetId && detail.assetId !== pendingAssetId) return;
    const pct = Math.round(detail.progress || 0);
    onProgress?.(pct);
    uploadStore.update({ progress: pct });
  };
  assetsService.events.addEventListener('uploadProgress', onProgressEvent);

  try {
    onStatus?.('validating');
    const quota = await preflightQuota(file.size);
    if (quota && quota.allowed === false && !quota.soft) {
      const usedMb = ((quota.bytesUsed || 0) / 1000 / 1000).toFixed(1);
      const limitMb = Math.round((quota.planLimit || 0) / 1000 / 1000);
      return {
        ok: false,
        kind,
        error:
          quota.reason === 'over_limit'
            ? `Storage full — using ${usedMb} / ${limitMb} MB.`
            : 'Upload blocked.'
      };
    }

    let optimizedBlob = null;
    let optimizationMetadata = null;
    let attribution = null;
    if (kind === 'glb') {
      onStatus?.('optimizing');
      uploadStore.update({ status: 'optimizing', progress: 0 });
      attribution = await extractGlbAttribution(file);
      ({ blob: optimizedBlob, metadata: optimizationMetadata } =
        await optimizeGlb(file));
      if (signal?.aborted) {
        throw new DOMException('Upload cancelled', 'AbortError');
      }
      // Don't pass optimizedBlob when optimization was skipped — in that case
      // the blob is identical to the original and we'd upload the same bytes twice.
      if (optimizationMetadata.optimizationSkipped) optimizedBlob = null;
      uploadStore.update({ sizeBytes: file.size, optimizationMetadata });
    }

    onStatus?.('uploading');
    uploadStore.update({ status: 'uploading', progress: 0 });
    const assetType = kind === 'glb' ? ASSET_TYPES.MESH : ASSET_TYPES.IMAGE;
    // Seed Display name from the extracted title when richer than the
    // filename; `title` itself is never persisted on the attribution object.
    const initialName = attribution?.title?.trim() || undefined;
    const storedAttribution = buildStoredAttribution(attribution);
    const assetId = await assetsService.addAsset(
      file,
      { originalFilename: file.name, name: initialName },
      assetType,
      ASSET_CATEGORIES.UPLOAD,
      userId,
      {
        signal,
        optimizedFile: optimizedBlob,
        optimizationMetadata,
        attribution: storedAttribution
      }
    );
    pendingAssetId = assetId;

    if (kind === 'glb') {
      onStatus?.('thumbnailing');
      uploadStore.update({ status: 'thumbnailing', progress: 100 });
      // Fire-and-forget: thumbnail errors are non-fatal (the asset doc is
      // already written; missing thumbnail just leaves a placeholder card).
      const asset = await assetsService.getAsset(assetId, userId);
      // Prefer the optimized GLB when available; the iframe re-downloads the
      // file in its own document, so saving 25 MB on a 30 → 5 MB optimization
      // is real bandwidth, not just cache reuse.
      const cloudUrl = getServedUrl(asset);
      if (cloudUrl) {
        import('./captureThumbnail.js').then(({ captureAndUploadThumbnail }) =>
          captureAndUploadThumbnail(assetId, userId, cloudUrl)
        );
      }
    }

    // Card stays up until the asset actually lands in the gallery items
    // list. AssetsContent clears it on arrival; the timeout below is the
    // safety net — if the round-trip never lands, that's an error.
    uploadStore.awaitArrival(assetId);
    armArrivalTimeout(assetId, kind, onTimeoutError);

    return { ok: true, assetId, kind };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, kind, cancelled: true };
    }
    console.error('[asset-upload] failed', err);
    return { ok: false, kind, error: err.message || String(err) };
  } finally {
    assetsService.events.removeEventListener('uploadProgress', onProgressEvent);
    // Leaves the card up if we transitioned to 'finishing' (round-trip
    // pending); error/early-return paths get cleaned up here.
    uploadStore.clearIfNotAwaiting();
  }
}

// Safety net: if the asset doc never appears in the gallery after the upload
// resolves, something is wrong (Firestore lag, missed event, foreign-user
// mismatch). Clear the stuck card and surface an error.
function armArrivalTimeout(assetId, kind, onTimeoutError) {
  const ARRIVAL_TIMEOUT_MS = 15000;
  setTimeout(() => {
    const cur = useCurrentUploadStore.getState().upload;
    if (cur && cur.awaitingAssetId === assetId) {
      console.warn(
        `[asset-upload] ${kind} ${assetId} uploaded but never appeared in gallery within ${ARRIVAL_TIMEOUT_MS}ms`
      );
      onTimeoutError?.(
        `Upload finished but the asset didn't appear in your gallery. Try refreshing.`
      );
      useCurrentUploadStore.getState().clear();
    }
  }, ARRIVAL_TIMEOUT_MS);
}
