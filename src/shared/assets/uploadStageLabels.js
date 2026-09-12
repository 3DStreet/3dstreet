/**
 * One stage→label mapping for every surface that shows an in-flight upload:
 * the gallery's pending card, the assets panel Upload button, and the
 * editor's properties panel / scene-graph dot. They used to keep their own
 * tables and drifted ("Uploading 100%" on one, "Finishing…" on the other —
 * #1989). Strings live in sharedMessages because the pending card also
 * renders in the generator and bollardbuddy islands, where no IntlProvider
 * is mounted.
 *
 * Stages are the `status` values written by uploadAsset() /
 * uploadAndPlaceAsset() into currentUploadStore and the editor's per-entity
 * upload slot:
 *   validating   quota preflight, before any bytes move
 *   optimizing   GLB pipeline in the worker (CPU-bound, up to 30s)
 *   uploading    bytes moving; progress is byte-weighted across every file
 *   thumbnailing / finishing   asset doc written; thumbnail upload, preload
 *                and entity swap still running
 */

export const UPLOAD_STAGE_MESSAGE_IDS = {
  validating: 'uploadStagePreparing',
  optimizing: 'uploadStageOptimizing',
  uploading: 'uploadStageUploading',
  thumbnailing: 'uploadStageFinishing',
  finishing: 'uploadStageFinishing'
};

export function isUploadStage(status) {
  return Object.prototype.hasOwnProperty.call(UPLOAD_STAGE_MESSAGE_IDS, status);
}

/**
 * @param {(id: string, values?: object) => string} t - a sharedMessages
 *   formatter (useSharedMessages() or a bound formatSharedMessage).
 * @param {string} status
 * @param {number} [progress] - 0..100; only shown for `uploading`, and only
 *   once it is above zero so a just-started upload reads "Uploading…" rather
 *   than "Uploading 0%".
 * @returns {string|null} null when `status` is not an in-flight stage.
 */
export function getUploadStageLabel(t, status, progress = 0) {
  const id = UPLOAD_STAGE_MESSAGE_IDS[status];
  if (!id) return null;
  const pct = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
  if (status === 'uploading' && pct > 0) {
    return t('uploadStageUploadingPct', { pct });
  }
  return t(id);
}
