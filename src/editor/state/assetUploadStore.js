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
import { galleryServiceV2 } from '@shared/gallery';

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
      data = await galleryServiceV2.getAsset(assetId, ownerUid);
    } catch {
      // permission-denied (foreign asset) or transient — degrade silently.
    }
    set((state) => ({
      assets: {
        ...state.assets,
        [key]: { data: data || null, fetching: false, fetchedAt: Date.now() }
      }
    }));
  }
}));

export default useAssetUploadStore;
