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
 * @returns {Promise<{ ok: boolean, assetId?: string, kind?: string, error?: string }>}
 */
export async function uploadAsset(file, { onStatus, onProgress } = {}) {
  const kind = getAssetKind(file);
  if (!kind) return { ok: false, error: `Unsupported file type: ${file.name}` };

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

  let pendingAssetId = null;
  const onProgressEvent = (e) => {
    const detail = e.detail || {};
    if (pendingAssetId && detail.assetId !== pendingAssetId) return;
    onProgress?.(Math.round(detail.progress || 0));
  };
  assetsService.events.addEventListener('uploadProgress', onProgressEvent);

  try {
    let blobToUpload = file;
    if (kind === 'glb') {
      onStatus?.('optimizing');
      const { optimizeGlb } = await import('./optimizeGlb.js');
      blobToUpload = await optimizeGlb(file);
      if (blobToUpload.size > GLB_MAX_BYTES) {
        return {
          ok: false,
          kind,
          error: `Optimized GLB still exceeds ${Math.round(GLB_MAX_BYTES / 1000 / 1000)} MB.`
        };
      }
    }

    onStatus?.('uploading');
    const assetType = kind === 'glb' ? ASSET_TYPES.MESH : ASSET_TYPES.IMAGE;
    const assetId = await assetsService.addAsset(
      blobToUpload,
      { originalFilename: file.name },
      assetType,
      ASSET_CATEGORIES.UPLOAD,
      userId
    );
    pendingAssetId = assetId;

    if (kind === 'glb') {
      onStatus?.('thumbnailing');
      // Fire-and-forget: thumbnail errors are non-fatal (the asset doc is
      // already written; missing thumbnail just leaves a placeholder card).
      const asset = await assetsService.getAsset(assetId, userId);
      const cloudUrl = asset?.storageUrl;
      if (cloudUrl) {
        import('./captureThumbnail.js').then(({ captureAndUploadThumbnail }) =>
          captureAndUploadThumbnail(assetId, userId, cloudUrl)
        );
      }
    }

    return { ok: true, assetId, kind };
  } catch (err) {
    console.error('[asset-upload] failed', err);
    return { ok: false, kind, error: err.message || String(err) };
  } finally {
    assetsService.events.removeEventListener('uploadProgress', onProgressEvent);
  }
}
