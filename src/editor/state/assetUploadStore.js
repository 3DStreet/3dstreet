/**
 * Asset upload state — Zustand.
 *
 * Two slices:
 *   uploads — keyed by entity.id, holds in-flight upload state for an entity:
 *               { status, progress, sizeBytes, originalFilename }
 *             Status values: 'uploading' | 'optimizing' | 'failed' | 'local'.
 *             Once an upload succeeds the entity gets data-asset-id +
 *             data-asset-owner-uid attrs and the in-flight slot can be cleared
 *             (the hook reads metadata from the assets cache instead).
 *
 *   assets  — keyed by `${assetId}:${ownerUid}`, caches the Firestore asset
 *             doc fetched on demand. Shape: { data, fetching, fetchedAt }.
 *             Permission-denied (foreign asset under owner-only rule) and
 *             not-found both resolve to data: null so the UI can degrade.
 */

import { create } from 'zustand';
import { assetsService } from '@shared/assets';

const useAssetUploadStore = create((set, get) => ({
  uploads: {},
  assets: {},

  setUpload: (entityId, partial) => {
    if (!entityId) return;
    set((state) => ({
      uploads: {
        ...state.uploads,
        [entityId]: { ...(state.uploads[entityId] || {}), ...partial }
      }
    }));
  },

  clearUpload: (entityId) => {
    if (!entityId) return;
    set((state) => {
      if (!state.uploads[entityId]) return state;
      const next = { ...state.uploads };
      delete next[entityId];
      return { uploads: next };
    });
  },

  /**
   * Merge a partial update into a cached asset doc. Called after the mesh
   * details modal saves a name / metadata edit so the layers panel, props
   * panel, and asset card reflect the change without a refetch.
   */
  patchAsset: (assetId, ownerUid, partial) => {
    if (!assetId || !ownerUid || !partial) return;
    const key = `${assetId}:${ownerUid}`;
    set((state) => {
      const existing = state.assets[key];
      if (!existing?.data) return state;
      return {
        assets: {
          ...state.assets,
          [key]: {
            ...existing,
            data: { ...existing.data, ...partial }
          }
        }
      };
    });
  },

  /**
   * Trigger a Firestore fetch for an asset, idempotent. Subsequent calls
   * during the in-flight period and after success short-circuit.
   */
  ensureAsset: async (assetId, ownerUid) => {
    if (!assetId || !ownerUid) return;
    const key = `${assetId}:${ownerUid}`;
    const existing = get().assets[key];
    if (existing?.data || existing?.fetching) return;

    set((state) => ({
      assets: {
        ...state.assets,
        [key]: { data: null, fetching: true, fetchedAt: null }
      }
    }));

    let data = null;
    try {
      data = await assetsService.getAsset(assetId, ownerUid);
    } catch {
      // permission-denied (foreign asset) or transient — degrade silently.
    }
    set((state) => ({
      assets: {
        ...state.assets,
        [key]: { data: data || null, fetching: false, fetchedAt: Date.now() }
      }
    }));
  },

  dropAsset: (assetId, ownerUid) => {
    if (!assetId || !ownerUid) return;
    const key = `${assetId}:${ownerUid}`;
    set((state) => {
      if (!state.assets[key]) return state;
      const next = { ...state.assets };
      delete next[key];
      return { assets: next };
    });
  }
}));

// Keep the cache in sync with any updates / deletes dispatched by
// assetsService, regardless of which UI surface triggered them
// (mesh details modal, gallery panel actions, future cloud-model resolver…).
if (typeof window !== 'undefined') {
  assetsService.events.addEventListener('assetUpdated', (e) => {
    const { assetId, userId, updates } = e.detail || {};
    if (assetId && userId && updates) {
      useAssetUploadStore.getState().patchAsset(assetId, userId, updates);
    }
  });
  assetsService.events.addEventListener('assetDeleted', (e) => {
    const { assetId, userId, hard } = e.detail || {};
    if (!assetId || !userId) return;
    if (hard) {
      useAssetUploadStore.getState().dropAsset(assetId, userId);
    } else {
      useAssetUploadStore
        .getState()
        .patchAsset(assetId, userId, { deleted: true });
    }
  });
  assetsService.events.addEventListener('assetRestored', (e) => {
    const { assetId, userId } = e.detail || {};
    if (!assetId || !userId) return;
    useAssetUploadStore
      .getState()
      .patchAsset(assetId, userId, { deleted: false });
  });
}

export default useAssetUploadStore;
