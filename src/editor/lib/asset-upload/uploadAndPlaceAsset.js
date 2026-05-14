/**
 * Inline drop / upload.
 *
 * Flow:
 *   1. Validate file type & per-file size cap (50MB GLB / 10MB image)
 *   2. Pre-flight quota check via callable Cloud Function
 *   3. Create entity at drop position with local blob URL
 *   4. (GLB only) optimize via gltf-transform
 *   5. Upload via galleryServiceV2.addAsset
 *   6. On success: write data-asset-id + data-asset-owner-uid (the only
 *      persistent identity attrs), swap blob URL for cloud URL, revoke blob.
 *   7. On failure: leave blob URL so the model still renders locally.
 *
 * In-flight transient state (status, progress, sizeBytes, originalFilename)
 * lives in the Zustand assetUploadStore keyed by entity.id, not on DOM
 * attributes. It does not survive scene save/reload — by design.
 */

import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@shared/services/firebase.js';
import {
  galleryServiceV2,
  ASSET_TYPES,
  ASSET_CATEGORIES
} from '@shared/gallery';
import useAssetUploadStore from '@/editor/state/assetUploadStore.js';

const GLB_MAX_BYTES = 50 * 1000 * 1000;
const IMAGE_MAX_BYTES = 10 * 1000 * 1000;

const GLB_EXTS = ['.glb', '.gltf'];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
const ACCEPTED_EXTS = [...GLB_EXTS, ...IMAGE_EXTS];

export const FILE_PICKER_ACCEPT = ACCEPTED_EXTS.join(',');

function getAssetKind(file) {
  const name = (file.name || '').toLowerCase();
  if (GLB_EXTS.some((ext) => name.endsWith(ext))) return 'glb';
  if (IMAGE_EXTS.some((ext) => name.endsWith(ext))) return 'image';
  return null;
}

export function isAcceptedAssetFile(file) {
  return getAssetKind(file) !== null;
}

function notifyError(msg) {
  if (window.STREET?.notify?.errorMessage) {
    window.STREET.notify.errorMessage(msg);
  } else {
    console.error('[asset-upload]', msg);
  }
}

function notifySuccess(msg) {
  if (window.STREET?.notify?.successMessage) {
    window.STREET.notify.successMessage(msg);
  }
}

function createPlaceholderEntity(file, position, kind) {
  const blobUrl = URL.createObjectURL(file);
  const baseComponents = {
    position: position ?? '0 0 0',
    'data-layer-name': `${kind === 'glb' ? 'glTF Model' : 'Image'} • ${file.name}`,
    // Marks the entity as carrying a transient blob: URL so the scene
    // serializer skips it. Removed (via entityupdate) on upload success.
    'data-temporary-file': 'true'
  };

  const definition =
    kind === 'glb'
      ? {
          components: {
            ...baseComponents,
            'gltf-model': `url(${blobUrl})`,
            shadow: 'receive: true; cast: true;'
          }
        }
      : {
          element: 'a-image',
          components: {
            ...baseComponents,
            src: blobUrl,
            width: 4,
            height: 4
          }
        };

  return new Promise((resolve) => {
    AFRAME.INSPECTOR.execute('entitycreate', definition, undefined, (entity) =>
      resolve({ entity, blobUrl })
    );
  });
}

/**
 * Place an already-uploaded asset into the scene at the given position.
 * Used by drag-from-gallery-card. No upload, no temp marker — the entity
 * starts in its persistent state (data-asset-id + data-asset-owner-uid +
 * cloud URL in gltf-model / src).
 *
 * @param {object} asset
 * @param {string} asset.assetId
 * @param {string} asset.ownerUid
 * @param {string} asset.storageUrl
 * @param {string} asset.name
 * @param {string} asset.type     - 'mesh' | 'image'
 * @param {THREE.Vector3 | string} position
 */
export function placeCloudAsset(asset, position) {
  if (!asset?.assetId || !asset.storageUrl) return;
  const isMesh = asset.type === 'mesh';
  const baseComponents = {
    position: position ?? '0 0 0',
    'data-layer-name': asset.name || asset.assetId,
    'data-asset-id': asset.assetId,
    'data-asset-owner-uid': asset.ownerUid
  };
  const definition = isMesh
    ? {
        components: {
          ...baseComponents,
          'gltf-model': `url(${asset.storageUrl})`,
          shadow: 'receive: true; cast: true;'
        }
      }
    : {
        element: 'a-image',
        components: {
          ...baseComponents,
          src: asset.storageUrl,
          width: 4,
          height: 4
        }
      };
  AFRAME.INSPECTOR.execute('entitycreate', definition);
}

async function preflightQuota(proposedBytes) {
  if (!auth.currentUser) return { allowed: false, reason: 'not_signed_in' };
  try {
    const callable = httpsCallable(functions, 'getUploadQuota');
    const { data } = await callable({ proposedBytes });
    return data;
  } catch (err) {
    console.warn(
      '[asset-upload] quota check unavailable, skipping pre-flight',
      err
    );
    return { allowed: true, soft: true };
  }
}

/**
 * Upload a dropped/picked file and place it in the scene.
 *
 * @param {File} file - The dropped or picked file.
 * @param {THREE.Vector3 | string} [position] - Drop position in world space.
 * @param {Element} [existingEntity] - When retrying a failed upload, the
 *   existing placeholder entity. Skips creating a new placeholder.
 * @returns {Promise<{ entity: Element, assetId: string | null, kind: string }>}
 */
export async function uploadAndPlaceAsset(file, position, existingEntity) {
  const kind = getAssetKind(file);
  if (!kind) {
    notifyError(`Unsupported file type: ${file.name}`);
    return { entity: null, assetId: null, kind: null };
  }

  const sizeCap = kind === 'glb' ? GLB_MAX_BYTES : IMAGE_MAX_BYTES;
  if (file.size > sizeCap) {
    const limitMb = Math.round(sizeCap / 1000 / 1000);
    const kindLabel = kind === 'glb' ? 'GLB files' : 'Images';
    notifyError(`File too large. ${kindLabel} must be under ${limitMb} MB.`);
    return { entity: null, assetId: null, kind };
  }

  let entity;
  let blobUrl = null;
  if (existingEntity) {
    // Retry path: reuse the existing failed placeholder, keep its current
    // gltf-model/src blob URL (still valid since File outlives the failed
    // attempt). No new blob URL is allocated.
    entity = existingEntity;
  } else {
    ({ entity, blobUrl } = await createPlaceholderEntity(file, position, kind));
  }
  const entityId = entity.id;
  const { setUpload, clearUpload } = useAssetUploadStore.getState();

  setUpload(entityId, {
    status: 'uploading',
    progress: 0,
    sizeBytes: file.size,
    originalFilename: file.name,
    // Stashed so the Retry button on a failed upload can re-invoke this
    // function without the user having to re-drop the file.
    file
  });

  if (!auth.currentUser) {
    setUpload(entityId, { status: 'local', progress: 0 });
    notifyError('Sign in to save assets to the cloud.');
    return { entity, assetId: null, kind };
  }

  const userId = auth.currentUser.uid;

  const quota = await preflightQuota(file.size);
  if (quota && quota.allowed === false && !quota.soft) {
    if (quota.reason === 'over_limit' || quota.bytesUsed != null) {
      const usedMb = ((quota.bytesUsed || 0) / 1000 / 1000).toFixed(1);
      const limitMb = Math.round((quota.planLimit || 0) / 1000 / 1000);
      notifyError(
        `Storage full — using ${usedMb} / ${limitMb} MB. Delete assets or upgrade.`
      );
    } else {
      notifyError('Upload blocked.');
    }
    setUpload(entityId, { status: 'local', progress: 0 });
    return { entity, assetId: null, kind };
  }

  let pendingAssetId = null;
  const onProgress = (e) => {
    const detail = e.detail || {};
    if (pendingAssetId && detail.assetId !== pendingAssetId) return;
    setUpload(entityId, {
      progress: Math.round(detail.progress || 0)
    });
  };
  galleryServiceV2.events.addEventListener('uploadProgress', onProgress);

  try {
    let blobToUpload = file;
    if (kind === 'glb') {
      setUpload(entityId, { status: 'optimizing', progress: 0 });
      const { optimizeGlb } = await import('./optimizeGlb.js');
      blobToUpload = await optimizeGlb(file);
      if (blobToUpload.size > GLB_MAX_BYTES) {
        notifyError(
          `Optimized GLB still exceeds ${Math.round(
            GLB_MAX_BYTES / 1000 / 1000
          )} MB.`
        );
        setUpload(entityId, { status: 'local' });
        return { entity, assetId: null, kind };
      }
      setUpload(entityId, { sizeBytes: blobToUpload.size });
    }

    setUpload(entityId, { status: 'uploading', progress: 0 });
    const assetType = kind === 'glb' ? ASSET_TYPES.MESH : ASSET_TYPES.IMAGE;
    const assetId = await galleryServiceV2.addAsset(
      blobToUpload,
      { originalFilename: file.name },
      assetType,
      ASSET_CATEGORIES.UPLOAD,
      userId
    );
    pendingAssetId = assetId;

    const asset = await galleryServiceV2.getAsset(assetId, userId);
    const cloudUrl = asset?.storageUrl;
    if (!cloudUrl) {
      throw new Error('Upload succeeded but no cloud URL returned');
    }

    // Swap the temp blob URL for the cloud URL and write persistent identity
    // attrs (data-asset-id, data-asset-owner-uid). These go through
    // entityupdate commands wrapped in a single MultiCommand so:
    //   - the editor's dirty/save-state machinery fires,
    //   - the change is one history entry, undoable as a unit,
    //   - serializer picks them up on next save (data-asset-* are special-
    //     cased to persist; see src/json-utils_1.1.js).
    const modelComponent = kind === 'glb' ? 'gltf-model' : 'src';
    const modelValue = kind === 'glb' ? `url(${cloudUrl})` : cloudUrl;
    AFRAME.INSPECTOR.execute(
      'multi',
      [
        [
          'entityupdate',
          {
            entity,
            component: modelComponent,
            value: modelValue,
            noSelectEntity: true
          }
        ],
        [
          'entityupdate',
          {
            entity,
            component: 'data-asset-id',
            value: assetId,
            noSelectEntity: true
          }
        ],
        [
          'entityupdate',
          {
            entity,
            component: 'data-asset-owner-uid',
            value: userId,
            noSelectEntity: true
          }
        ],
        [
          // Remove the temporary-file marker so the serializer starts
          // including this entity in saved scenes.
          'entityupdate',
          {
            entity,
            component: 'data-temporary-file',
            value: null,
            noSelectEntity: true
          }
        ]
      ],
      'Upload asset to cloud'
    );
    if (blobUrl) URL.revokeObjectURL(blobUrl);

    // Drop the in-flight slot — the hook now reads from the Firestore cache.
    clearUpload(entityId);
    notifySuccess(`Uploaded ${file.name}`);
    return { entity, assetId, kind };
  } catch (err) {
    console.error('[asset-upload] failed', err);
    notifyError(`Upload failed: ${err.message || err}`);
    setUpload(entityId, { status: 'failed' });
    return { entity, assetId: null, kind };
  } finally {
    galleryServiceV2.events.removeEventListener('uploadProgress', onProgress);
  }
}
