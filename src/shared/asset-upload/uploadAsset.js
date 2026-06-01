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
import { assetsService, ASSET_TYPES, ASSET_CATEGORIES } from '@shared/assets';
import useCurrentUploadStore from '@shared/assets/state/currentUploadStore.js';
import {
  extractGlbAttribution,
  buildStoredAttribution
} from './extractGlbAttribution.js';
import { optimizeGlb } from './optimizeGlb.js';

// Absolute client-side per-file ceiling = the top plan's per-file cap (MAX,
// 5 GB). Type-agnostic; this is only the fast synchronous "obviously too big"
// reject. The real per-plan gate (FREE 100 MB / PRO 1 GB / MAX 5 GB) is
// SOFT-enforced by getUploadQuota, which knows the user's plan. Keep in sync
// with MAX_FILE_BYTES_BY_PLAN in public/functions/asset-quota.js and the hard
// ceiling in public/storage.rules.
export const MAX_FILE_BYTES = 5 * 1000 * 1000 * 1000;

const GLB_EXTS = ['.glb', '.gltf'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
// Gaussian Splat formats supported by the `splat` A-Frame component (Spark).
const SPLAT_EXTS = ['.ply', '.splat', '.spz'];
const ACCEPTED_EXTS = [...GLB_EXTS, ...IMAGE_EXTS, ...SPLAT_EXTS];

export const FILE_PICKER_ACCEPT = ACCEPTED_EXTS.join(',');

export function getAssetKind(file) {
  const name = (file.name || '').toLowerCase();
  if (GLB_EXTS.some((ext) => name.endsWith(ext))) return 'glb';
  if (IMAGE_EXTS.some((ext) => name.endsWith(ext))) return 'image';
  if (SPLAT_EXTS.some((ext) => name.endsWith(ext))) return 'splat';
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
 * @returns {Promise<{ ok: boolean, assetId?: string, kind?: string, error?: string }>}
 */
export async function uploadAsset(file, { onStatus, onProgress } = {}) {
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

  // Fast, type-agnostic reject for files past the absolute ceiling (top plan).
  // The per-plan cap (smaller for FREE/PRO) is enforced by preflightQuota below,
  // which knows the user's plan.
  if (file.size > MAX_FILE_BYTES) {
    const limitGb = MAX_FILE_BYTES / 1000 / 1000 / 1000;
    return {
      ok: false,
      kind,
      error: `File too large. Maximum upload size is ${limitGb} GB.`
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
      const fileLimitMb = Math.round((quota.perFileLimit || 0) / 1000 / 1000);
      let error = 'Upload blocked.';
      if (quota.reason === 'file_too_large') {
        error = `File too large for your ${quota.planName || quota.tier || 'current'} plan (max ${fileLimitMb} MB per file). Upgrade to upload larger files.`;
      } else if (quota.reason === 'over_limit') {
        error = `Storage full — using ${usedMb} / ${limitMb} MB.`;
      }
      return { ok: false, kind, error };
    }

    let optimizedBlob = null;
    let optimizationMetadata = null;
    let attribution = null;
    let thumbnailCapture = null;
    if (kind === 'glb') {
      onStatus?.('optimizing');
      uploadStore.update({ status: 'optimizing', progress: 0 });
      attribution = await extractGlbAttribution(file);
      ({ blob: optimizedBlob, metadata: optimizationMetadata } =
        await optimizeGlb(file, { signal }));
      if (signal?.aborted) {
        throw new DOMException('Upload cancelled', 'AbortError');
      }
      // Don't pass optimizedBlob when optimization was skipped, in that case
      // the blob is identical to the original and we'd upload the same bytes twice.
      if (optimizationMetadata.optimizationSkipped) optimizedBlob = null;
      uploadStore.update({ sizeBytes: file.size, optimizationMetadata });

      // Serial: kick off thumbnail capture only after optimization is
      // done (or timed out). Runs in parallel with the upload itself.
      // See uploadAndPlaceAsset.js for the longer rationale.
      const blobToCapture = optimizedBlob || file;
      thumbnailCapture = import('./captureThumbnail.js')
        .then(({ captureGlbThumbnail }) => captureGlbThumbnail(blobToCapture))
        .catch((err) => {
          console.warn('[asset-upload] thumbnail capture failed', err);
          return null;
        });
      thumbnailCapture.then((jpegBlob) => {
        if (jpegBlob) uploadStore.setThumbnailBlob(jpegBlob);
      });
    }

    onStatus?.('uploading');
    uploadStore.update({ status: 'uploading', progress: 0 });
    const assetType =
      kind === 'glb'
        ? ASSET_TYPES.MESH
        : kind === 'splat'
          ? ASSET_TYPES.SPLAT
          : ASSET_TYPES.IMAGE;
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
    // Hide the new asset from the gallery grid until we clear() below —
    // pending card keeps showing progress, atomic swap on completion.
    uploadStore.markAwaiting(assetId);

    if (kind === 'glb' && thumbnailCapture) {
      onStatus?.('thumbnailing');
      uploadStore.update({ status: 'thumbnailing', progress: 100 });
      // Fire-and-forget: thumbnail errors are non-fatal (the asset doc is
      // already written; missing thumbnail just leaves a placeholder card).
      thumbnailCapture.then((jpegBlob) => {
        if (!jpegBlob) return;
        import('./captureThumbnail.js').then(({ uploadCapturedThumbnail }) =>
          uploadCapturedThumbnail(assetId, userId, jpegBlob)
        );
      });
    }

    return { ok: true, assetId, kind };
  } catch (err) {
    if (err.name === 'AbortError') {
      return { ok: false, kind, cancelled: true };
    }
    console.error('[asset-upload] failed', err);
    return { ok: false, kind, error: err.message || String(err) };
  } finally {
    assetsService.events.removeEventListener('uploadProgress', onProgressEvent);
    // Clear the pending card on every exit. This is both the success-path
    // dismiss (atomic swap to the real card) and the error/abort cleanup.
    uploadStore.clear();
  }
}
