import { useEffect, useState, useSyncExternalStore } from 'react';
import { auth } from '@shared/services/firebase.js';
import useAssetUploadStore from '@/editor/state/assetUploadStore.js';

export const STATUS_LABELS = {
  optimizing: { color: '#f4a01a', text: 'Optimizing GLB…' },
  uploading: { color: '#f4a01a', text: 'Uploading' },
  uploaded: { color: '#2bb673', text: 'Cloud asset' },
  failed: { color: '#e0473d', text: 'Upload failed' },
  local: { color: '#7f7f7f', text: 'Saved locally only' },
  local_error: { color: '#e0473d', text: "Local only — won't sync" },
  cloud_missing: { color: '#e0473d', text: 'Cloud asset unavailable' },
  waiting: { color: '#f4a01a', text: 'Waiting for connection…' }
};

// Human-readable explanation for each `reason` value the upload pipeline may
// stash in the upload slot. Kept here so both the dot tooltip and the sidebar
// row render the same copy.
export const REASON_TEXT = {
  too_large: 'Exceeds the cloud upload size limit. Preview only.',
  optimized_too_large:
    'Even after optimization the file is over the upload limit. Preview only.',
  over_quota: 'Storage full — delete assets or upgrade to sync this model.',
  not_signed_in: 'Sign in to save this model to your cloud.',
  upload_blocked: 'Cloud upload was blocked.',
  asset_deleted:
    'Marked for deletion — will be permanently purged on the next cleanup pass.',
  asset_not_found:
    'Not found on the server — it may never have existed, or it was already purged.'
};

const PERSISTENT_ATTRS = ['data-asset-id', 'data-asset-owner-uid'];

// Subscription glue for navigator.onLine. The SDK silently retries network
// errors mid-upload (we cap that at 30s), so while we wait we surface
// "Waiting for connection…" instead of a frozen "Uploading 42%".
function subscribeOnline(callback) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}
const getOnline = () =>
  typeof navigator === 'undefined' ? true : navigator.onLine;

function readPersistentAttrs(entity) {
  if (!entity) return { assetId: null, ownerUid: null };
  return {
    assetId: entity.getAttribute('data-asset-id') || null,
    ownerUid: entity.getAttribute('data-asset-owner-uid') || null
  };
}

/**
 * Returns the rendered upload state for an entity, merging:
 *   - in-flight upload slot from the asset-upload Zustand store (keyed by
 *     entity.id) — present during the upload session.
 *   - persistent identity attributes on the entity (data-asset-id,
 *     data-asset-owner-uid) — present after upload success and across
 *     scene save/reload.
 *   - Firestore asset doc fetched on demand and cached in the same store.
 *
 * Returns null when the entity has neither an in-flight slot nor an assetId.
 */
export default function useAssetUploadStatus(entity) {
  const entityId = entity?.id || null;

  // Watch only the persistent identity attrs — that's all we read off the DOM.
  const [identity, setIdentity] = useState(() => readPersistentAttrs(entity));
  useEffect(() => {
    setIdentity(readPersistentAttrs(entity));
    if (!entity) return undefined;
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (
          m.type === 'attributes' &&
          PERSISTENT_ATTRS.includes(m.attributeName)
        ) {
          setIdentity(readPersistentAttrs(entity));
          return;
        }
      }
    });
    observer.observe(entity, { attributes: true });
    return () => observer.disconnect();
  }, [entity]);

  const { assetId, ownerUid } = identity;
  const upload = useAssetUploadStore((s) =>
    entityId ? s.uploads[entityId] : null
  );
  const cacheKey = assetId && ownerUid ? `${assetId}:${ownerUid}` : null;
  const cachedAsset = useAssetUploadStore((s) =>
    cacheKey ? s.assets[cacheKey] : null
  );
  const ensureAsset = useAssetUploadStore((s) => s.ensureAsset);

  useEffect(() => {
    if (assetId && ownerUid) ensureAsset(assetId, ownerUid);
  }, [assetId, ownerUid, ensureAsset]);

  const isOnline = useSyncExternalStore(subscribeOnline, getOnline, () => true);

  if (!upload && !assetId) return null;

  // Status: in-flight slot wins; otherwise the entity is uploaded (assetId set).
  let status = upload?.status || 'uploaded';
  let reason = upload?.reason || null;
  const progress = upload?.progress || 0;

  // While offline mid-upload, the Firebase SDK silently retries. Surface that
  // so the user doesn't think a frozen "Uploading 42%" means we're stuck.
  if (!isOnline && (status === 'uploading' || status === 'optimizing')) {
    status = 'waiting';
  }

  const remoteData = cachedAsset?.data;

  // Promote cloud-side problems (soft-deleted doc, or fetched-but-null) over
  // the default 'uploaded' status. Only applies once the fetch has settled.
  if (
    status === 'uploaded' &&
    assetId &&
    cachedAsset &&
    !cachedAsset.fetching
  ) {
    if (remoteData?.deleted) {
      status = 'cloud_missing';
      reason = 'asset_deleted';
    } else if (cachedAsset.fetchedAt && !remoteData) {
      status = 'cloud_missing';
      reason = 'asset_not_found';
    }
  }
  const sizeBytes = remoteData?.size || upload?.sizeBytes || 0;
  const originalFilename =
    remoteData?.originalFilename || upload?.originalFilename || null;
  // Editable asset display name (defaults to originalFilename basename in
  // assetsService.addAsset). Older docs without the field fall back to
  // originalFilename. While the Firestore fetch is in flight we use the
  // in-flight slot's originalFilename so the layer panel renders something
  // reasonable immediately.
  const name = remoteData?.name || originalFilename;
  const type = remoteData?.type || null;

  const isOwned = !!ownerUid && ownerUid === auth.currentUser?.uid;

  return {
    status,
    reason,
    progress,
    assetId,
    ownerUid,
    sizeBytes,
    originalFilename,
    name,
    type,
    isOwned,
    remoteData
  };
}
