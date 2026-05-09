import { useEffect, useState } from 'react';
import { auth } from '@shared/services/firebase.js';
import useAssetUploadStore from '@/editor/state/assetUploadStore.js';

export const STATUS_LABELS = {
  optimizing: { color: '#f4a01a', text: 'Optimizing GLB…' },
  uploading: { color: '#f4a01a', text: 'Uploading' },
  uploaded: { color: '#2bb673', text: 'Uploaded to cloud' },
  failed: { color: '#e0473d', text: 'Upload failed' },
  local: { color: '#7f7f7f', text: 'Local only — will not persist' }
};

const PERSISTENT_ATTRS = ['data-asset-id', 'data-asset-owner-uid'];

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

  if (!upload && !assetId) return null;

  // Status: in-flight slot wins; otherwise the entity is uploaded (assetId set).
  const status = upload?.status || 'uploaded';
  const progress = upload?.progress || 0;

  const remoteData = cachedAsset?.data;
  const sizeBytes = remoteData?.size || upload?.sizeBytes || 0;
  const originalFilename =
    remoteData?.originalFilename || upload?.originalFilename || null;

  const isOwned = !!ownerUid && ownerUid === auth.currentUser?.uid;

  return {
    status,
    progress,
    assetId,
    ownerUid,
    sizeBytes,
    originalFilename,
    isOwned
  };
}
