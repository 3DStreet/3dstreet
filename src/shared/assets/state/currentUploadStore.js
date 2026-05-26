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
 *
 * Lifecycle: start() → update(...) through stages → once addAsset() returns
 * the new doc id, the pipeline calls markAwaiting(assetId) so the gallery
 * filters that id out of the grid while finalization (GLB preload, attribute
 * swap, thumbnail upload) runs. The pipeline calls clear() when truly done,
 * which both removes the pending card and unblocks the new asset card —
 * atomic swap, no overlap or flicker.
 */

import { create } from 'zustand';

// AbortController for the active upload. Stored outside Zustand (not
// serializable). Created in start(), aborted in cancel(), nulled in clear().
let _abortController = null;

const useCurrentUploadStore = create((set, get) => ({
  // { status, progress, filename, sizeBytes, kind, awaitingAssetId } | null
  // status:
  //   'validating' | 'optimizing' | 'uploading' | 'thumbnailing' | 'finishing'
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
   * Mark the new asset id so the gallery hides it from the grid until clear()
   * is called. Lets the pending card stay up showing "Finishing…" through
   * post-upload work without the real card popping in alongside it.
   */
  markAwaiting: (assetId) => {
    const cur = get().upload;
    if (!cur) return;
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

  isBusy: () => !!get().upload
}));

export default useCurrentUploadStore;
