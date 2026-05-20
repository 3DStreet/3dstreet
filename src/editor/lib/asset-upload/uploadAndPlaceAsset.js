/**
 * Inline drop / upload.
 *
 * Flow:
 *   1. Validate file type & per-file size cap (50MB GLB / 10MB image)
 *   2. Pre-flight quota check via callable Cloud Function
 *   3. Create entity at drop position with local blob URL
 *   4. (GLB only) optimize via gltf-transform
 *   5. Upload via assetsService.addAsset
 *   6. On success: write data-asset-id + data-asset-owner-uid (the only
 *      persistent identity attrs), swap blob URL for cloud URL, revoke blob.
 *   7. On failure: leave blob URL so the model still renders locally.
 *
 * In-flight transient state (status, progress, sizeBytes, originalFilename)
 * lives in the Zustand assetUploadStore keyed by entity.id, not on DOM
 * attributes. It does not survive scene save/reload — by design.
 */

import posthog from 'posthog-js';
import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@shared/services/firebase.js';
import { assetsService, ASSET_TYPES, ASSET_CATEGORIES } from '@shared/assets';
import { getServedUrl } from '@shared/assets/utils.js';
import useCurrentUploadStore from '@shared/assets/state/currentUploadStore.js';
import {
  GLB_MAX_BYTES,
  IMAGE_MAX_BYTES,
  FILE_PICKER_ACCEPT,
  getAssetKind,
  isAcceptedAssetFile
} from '@shared/asset-upload';
import useAssetUploadStore from '@/editor/state/assetUploadStore.js';

export { FILE_PICKER_ACCEPT, isAcceptedAssetFile };

function captureUploadEvent(kind, status, durationMs, optimizationMetadata) {
  const props = {
    file_type: kind,
    status,
    duration_ms: durationMs
  };
  if (kind === 'glb' && optimizationMetadata) {
    const {
      inputBytes,
      outputBytes,
      optimizationSkipped,
      reason,
      hadDraco,
      hadWebP
    } = optimizationMetadata;
    props.file_size_input = inputBytes;
    props.file_size_optimized = outputBytes;
    props.compression_ratio =
      inputBytes > 0
        ? Math.round((outputBytes / inputBytes) * 1000) / 1000
        : null;
    props.optimization_skipped = optimizationSkipped;
    props.skip_reason = reason ?? null;
    props.optimization_made_bigger = reason === 'not_smaller';
    props.already_had_draco = hadDraco ?? false;
    props.already_had_webp = hadWebP ?? false;
  }
  posthog.capture('asset_uploaded', props);
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
  const servedUrl = getServedUrl(asset);
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
          'gltf-model': `url(${servedUrl})`,
          shadow: 'receive: true; cast: true;'
        }
      }
    : {
        element: 'a-image',
        components: {
          ...baseComponents,
          src: servedUrl,
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

  // Enforce one-at-a-time across all upload surfaces. The gallery's pending
  // card is the single source of truth for "an upload is happening" — drops
  // and Upload-button clicks are blocked until it clears.
  const currentUploadStore = useCurrentUploadStore.getState();
  if (currentUploadStore.isBusy()) {
    notifyError(
      'An upload is already in progress. Please wait for it to finish.'
    );
    return { entity: null, assetId: null, kind };
  }
  currentUploadStore.start({
    filename: file.name,
    sizeBytes: file.size,
    kind
  });
  const signal = currentUploadStore.getSignal();

  // Create the placeholder *before* enforcing the upload size cap so the
  // user can still preview oversize files locally (e.g. raw photogrammetry
  // GLBs that exceed our 50 MB cloud cap). The cap is enforced below by
  // skipping the upload and marking the entity local_error instead.
  let entity;
  let blobUrl = null;
  if (existingEntity) {
    // Retry path: reuse the existing failed placeholder. Its current
    // gltf-model/src blob URL (allocated on the first attempt) is still
    // valid. Pull it from the upload slot so we can revoke it on success.
    entity = existingEntity;
    blobUrl =
      useAssetUploadStore.getState().uploads[entity.id]?.blobUrl || null;
  } else {
    ({ entity, blobUrl } = await createPlaceholderEntity(file, position, kind));
  }
  const entityId = entity.id;
  const { setUpload, clearUpload } = useAssetUploadStore.getState();

  setUpload(entityId, {
    status: 'uploading',
    progress: 0,
    reason: null,
    sizeBytes: file.size,
    originalFilename: file.name,
    // Stashed so the Retry button on a failed upload can re-invoke this
    // function without the user having to re-drop the file.
    file,
    // Stashed so a successful retry can revoke the original blob URL —
    // the retry path doesn't allocate a new one.
    blobUrl
  });

  const sizeCap = kind === 'glb' ? GLB_MAX_BYTES : IMAGE_MAX_BYTES;
  if (file.size > sizeCap) {
    const limitMb = Math.round(sizeCap / 1000 / 1000);
    notifyError(
      `${file.name} is over the ${limitMb} MB cloud upload limit — kept local for preview only.`
    );
    setUpload(entityId, {
      status: 'local_error',
      reason: 'too_large',
      progress: 0
    });
    currentUploadStore.clear();
    return { entity, assetId: null, kind };
  }

  if (!auth.currentUser) {
    setUpload(entityId, {
      status: 'local',
      reason: 'not_signed_in',
      progress: 0
    });
    notifyError('Sign in to save assets to the cloud.');
    currentUploadStore.clear();
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
      setUpload(entityId, {
        status: 'local_error',
        reason: 'over_quota',
        progress: 0
      });
    } else {
      notifyError('Upload blocked.');
      setUpload(entityId, {
        status: 'local_error',
        reason: 'upload_blocked',
        progress: 0
      });
    }
    currentUploadStore.clear();
    return { entity, assetId: null, kind };
  }

  const uploadStartTime = Date.now();
  let pendingAssetId = null;
  let optimizationMetadata = null;
  const onProgress = (e) => {
    const detail = e.detail || {};
    if (pendingAssetId && detail.assetId !== pendingAssetId) return;
    const pct = Math.round(detail.progress || 0);
    setUpload(entityId, { progress: pct });
    currentUploadStore.update({ progress: pct });
  };
  assetsService.events.addEventListener('uploadProgress', onProgress);

  try {
    let optimizedBlob = null;
    if (kind === 'glb') {
      setUpload(entityId, { status: 'optimizing', progress: 0 });
      currentUploadStore.update({ status: 'optimizing', progress: 0 });
      const { optimizeGlb } =
        await import('@shared/asset-upload/optimizeGlb.js');
      ({ blob: optimizedBlob, metadata: optimizationMetadata } =
        await optimizeGlb(file));
      if (signal?.aborted) {
        throw new DOMException('Upload cancelled', 'AbortError');
      }
      // Don't pass optimizedBlob when optimization was skipped — in that case
      // the blob is identical to the original and we'd upload the same bytes twice.
      if (optimizationMetadata.optimizationSkipped) optimizedBlob = null;
      setUpload(entityId, { sizeBytes: file.size, optimizationMetadata });
      currentUploadStore.update({ sizeBytes: file.size, optimizationMetadata });
    }

    setUpload(entityId, { status: 'uploading', progress: 0 });
    currentUploadStore.update({ status: 'uploading', progress: 0 });
    const assetType = kind === 'glb' ? ASSET_TYPES.MESH : ASSET_TYPES.IMAGE;
    const assetId = await assetsService.addAsset(
      file,
      { originalFilename: file.name },
      assetType,
      ASSET_CATEGORIES.UPLOAD,
      userId,
      { signal, optimizedFile: optimizedBlob, optimizationMetadata }
    );
    pendingAssetId = assetId;

    const asset = await assetsService.getAsset(assetId, userId);
    // Prefer the optimized GLB when available; fall back to the original source.
    const cloudUrl = asset?.optimizedSourceUrl ?? asset?.storageUrl;
    if (!cloudUrl) {
      throw new Error('Upload succeeded but no cloud URL returned');
    }

    // On slow connections the GLB swap pops the model out (blob removed,
    // cloud still downloading). Warm A-Frame/THREE.Cache via a hidden probe
    // entity so the real entity's load is near-instant after the swap.
    // Best-effort: bounded by a short timeout so a flaky probe never blocks
    // the upload from finalizing. Images don't have this issue (they swap
    // through the browser image cache quickly).
    if (kind === 'glb') {
      await preloadGltfWithTimeout(cloudUrl, 12000);
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

    // Keep the gallery's pending card up until the new asset doc actually
    // appears in the items list. AssetsContent watches items and clears on
    // arrival; the timeout below is the safety net — if it never lands,
    // that's an error.
    currentUploadStore.awaitArrival(assetId);
    armArrivalTimeout(assetId, kind);

    // Client-side thumbnail capture for GLBs. Fire-and-forget: errors are
    // logged but never block the success toast. The 'assetUpdated' event
    // from updateAsset will replace the gallery card placeholder with the
    // generated JPEG when it lands.
    if (kind === 'glb') {
      import('@shared/asset-upload/captureThumbnail.js').then(
        ({ captureAndUploadThumbnail }) => {
          captureAndUploadThumbnail(assetId, userId, cloudUrl);
        }
      );
    }

    notifySuccess(`Uploaded ${file.name}`);
    captureUploadEvent(
      kind,
      'success',
      Date.now() - uploadStartTime,
      optimizationMetadata
    );
    return { entity, assetId, kind };
  } catch (err) {
    if (err.name === 'AbortError') {
      // User cancelled — remove the placeholder entity and clean up silently.
      if (entity?.parentNode) {
        AFRAME.INSPECTOR.execute('entityremove', entity);
      }
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      clearUpload(entityId);
      captureUploadEvent(
        kind,
        'cancelled',
        Date.now() - uploadStartTime,
        optimizationMetadata
      );
      // currentUploadStore already cleared by cancel()
      return { entity: null, assetId: null, kind };
    }
    console.error('[asset-upload] failed', err);
    notifyError(`Upload failed: ${err.message || err}`);
    setUpload(entityId, { status: 'failed' });
    captureUploadEvent(
      kind,
      'failed',
      Date.now() - uploadStartTime,
      optimizationMetadata
    );
    return { entity, assetId: null, kind };
  } finally {
    assetsService.events.removeEventListener('uploadProgress', onProgress);
    // Leaves the card up if we transitioned to 'finishing' (round-trip
    // pending); error/early-return paths get cleaned up here. Per-entity
    // sidebar/dot indicators retain their failed/local_error status.
    currentUploadStore.clearIfNotAwaiting();
  }
}

/**
 * Hidden probe entity that triggers A-Frame's gltf-model component, which
 * loads via THREE.GLTFLoader and populates THREE.Cache. When the real entity
 * subsequently sets its gltf-model to the same URL, parse is fast and the
 * blob → cloud swap doesn't briefly render an empty entity.
 *
 * Best-effort: any error or timeout falls through and the caller proceeds
 * with the swap anyway. The visible entity's own gltf-model error handling
 * surfaces a real load failure.
 */
function preloadGltfWithTimeout(url, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      probe.removeEventListener('model-loaded', onLoaded);
      probe.removeEventListener('model-error', onError);
      if (probe.parentNode) probe.parentNode.removeChild(probe);
      clearTimeout(timer);
      resolve();
    };
    const onLoaded = () => finish();
    const onError = (e) => {
      console.warn('[asset-upload] cloud GLB preload failed', e?.detail);
      finish();
    };

    const probe = document.createElement('a-entity');
    probe.setAttribute('visible', 'false');
    probe.setAttribute('position', '0 -1000000 0');
    probe.setAttribute('data-ignore-raycaster', '');
    probe.classList.add('hideFromSceneGraph');
    probe.addEventListener('model-loaded', onLoaded);
    probe.addEventListener('model-error', onError);

    const timer = setTimeout(() => {
      console.warn(
        `[asset-upload] cloud GLB preload timed out after ${timeoutMs}ms — swapping anyway`
      );
      finish();
    }, timeoutMs);

    AFRAME.scenes[0].appendChild(probe);
    probe.setAttribute('gltf-model', `url(${url})`);
  });
}

// Safety net: if the asset doc never appears in the gallery after the upload
// resolves, that's an error. Clear the stuck pending card.
function armArrivalTimeout(assetId, kind) {
  const ARRIVAL_TIMEOUT_MS = 15000;
  setTimeout(() => {
    const cur = useCurrentUploadStore.getState().upload;
    if (cur && cur.awaitingAssetId === assetId) {
      console.warn(
        `[asset-upload] ${kind} ${assetId} uploaded but never appeared in gallery within ${ARRIVAL_TIMEOUT_MS}ms`
      );
      notifyError(
        `Upload finished but the asset didn't appear in your gallery. Try refreshing.`
      );
      useCurrentUploadStore.getState().clear();
    }
  }, ARRIVAL_TIMEOUT_MS);
}
