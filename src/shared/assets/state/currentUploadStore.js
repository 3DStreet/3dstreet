/**
 * Singleton in-flight upload state shared across editor + generator.
 *
 * Sits alongside (not in place of) the editor's per-entity assetUploadStore:
 * that one tracks placeholder-entity state for the drop-and-place flow; this
 * one drives the single "pending upload" card pinned at the top of the asset
 * gallery, which is the only upload surface the generator has.
 *
 * Only one upload may be in flight at a time. Callers must check `isBusy()`
 * before starting, and clear() on terminal success/failure.
 */

import { create } from 'zustand';
import assetsService from '../services/assetsService.js';

// Tracks the most recent assetAdded event so awaitArrival can resolve
// instantly when the event fired during the call to addAsset (i.e. before
// awaitingAssetId was set). One-upload-at-a-time means we only need the
// last id, not a queue.
let lastAddedAssetId = null;
let lastAddedAt = 0;
const ARRIVAL_GRACE_MS = 5000;

// AbortController for the active upload. Stored outside Zustand (not
// serializable). Created in start(), aborted in cancel(), nulled in clear().
let _abortController = null;

const useCurrentUploadStore = create((set, get) => ({
  // { status, progress, filename, sizeBytes, kind, awaitingAssetId } | null
  // status:
  //   'validating' | 'optimizing' | 'uploading' | 'thumbnailing'
  //     in-flight stages
  //   'finishing'
  //     upload returned ok and we set awaitingAssetId — the card stays
  //     visible (spinner only) until the new asset doc actually appears
  //     in the gallery items list. Treat absence as failure (timeout).
  upload: null,

  start: ({ filename, sizeBytes, kind }) => {
    _abortController = new AbortController();
    set({
      upload: {
        status: 'validating',
        progress: 0,
        filename: filename || '',
        sizeBytes: sizeBytes || 0,
        kind: kind || null,
        awaitingAssetId: null
      }
    });
  },

  /** Abort the in-flight upload and dismiss the pending card. */
  cancel: () => {
    if (_abortController) {
      _abortController.abort();
      _abortController = null;
    }
    set({ upload: null });
  },

  /** Returns the AbortSignal for the current upload, or null if not started. */
  getSignal: () => _abortController?.signal ?? null,

  update: (partial) => {
    const cur = get().upload;
    if (!cur) return;
    set({ upload: { ...cur, ...partial } });
  },

  /**
   * Transition into the "wait for round-trip" state. The card stays visible
   * (with the spinner, no progress bar movement) until the host clears it,
   * typically when the new asset doc appears in the gallery items list.
   */
  awaitArrival: (assetId) => {
    const cur = get().upload;
    if (!cur) return;
    // The assetAdded event fires synchronously inside addAsset → it may
    // already have been dispatched and missed. If we just saw it, resolve
    // immediately.
    if (
      assetId === lastAddedAssetId &&
      Date.now() - lastAddedAt < ARRIVAL_GRACE_MS
    ) {
      set({ upload: null });
      return;
    }
    set({
      upload: {
        ...cur,
        status: 'finishing',
        progress: 100,
        awaitingAssetId: assetId
      }
    });
  },

  clear: () => {
    _abortController = null;
    set({ upload: null });
  },

  /**
   * Used by the upload pipeline's `finally` block — leaves the card up when
   * the success path has handed off to round-trip arrival watching, but
   * cleans up after early-return error paths.
   */
  clearIfNotAwaiting: () => {
    const cur = get().upload;
    if (cur && cur.status !== 'finishing') set({ upload: null });
  },

  isBusy: () => !!get().upload
}));

// Round-trip: clear the pending card the moment Firestore confirms the new
// asset doc. This is independent of any single gallery view's filter state,
// so it works even if the user is filtered to a type that doesn't match the
// upload (e.g. uploaded a GLB while on the "Images" filter).
if (typeof window !== 'undefined') {
  assetsService.events.addEventListener('assetAdded', (e) => {
    const incomingId = e.detail?.assetId;
    if (!incomingId) return;
    lastAddedAssetId = incomingId;
    lastAddedAt = Date.now();
    const cur = useCurrentUploadStore.getState().upload;
    if (cur?.awaitingAssetId === incomingId) {
      useCurrentUploadStore.getState().clear();
    }
  });
}

export default useCurrentUploadStore;
