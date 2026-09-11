/**
 * Scene start-pose resolution (pure, unit-tested).
 *
 * A scene has up to three saved camera poses:
 *   - the Viewer Start entity (`viewer-start`), when the author added one:
 *     THE start pose. Where visitors open the scene and where Start glides.
 *   - the default snapshot's camera state (legacy: set-thumbnail used to be
 *     the only way to pin the opening view; setting a thumbnail now also
 *     writes the Viewer Start, so this is the fallback for older scenes).
 *   - `memory.cameraState`, autosaved on every save: the author's own
 *     "where I left off" editor pose.
 *
 * Owners opening their scene in the editor land where they left off; every
 * other launch (viewer/embed, a non-owner in the editor, a scene with no
 * editor pose) opens at the start pose. A `?camera=` deep link beats both.
 */

function defaultSnapshotState(memory) {
  const snapshots = memory?.snapshots;
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
  const def = snapshots.find((s) => s && s.isDefault);
  return def?.cameraState || null;
}

/**
 * Split saved `memory` into the legacy start pose (snapshot > autosave) and
 * the editor pose (autosave > snapshot). Either may be null.
 */
export function resolveSavedCameraStates(memory) {
  const snapshot = defaultSnapshotState(memory);
  const autosaved = memory?.cameraState || null;
  return {
    snapshotCameraState: snapshot || autosaved,
    editorCameraState: autosaved || snapshot
  };
}

/**
 * Pick the pose the load fly-in should end at.
 * @param {Object} o
 * @param {Object|null} o.urlCameraState  `?camera=` deep link, wins outright
 * @param {boolean} o.viewerLaunch        `?viewer=true` / `?embed=true`
 * @param {boolean} o.isOwner             current user authored the scene (or
 *                                        the scene has no author: local file)
 * @param {Object|null} o.startCameraState effective start pose
 *                                        (viewer-start entity > snapshot)
 * @param {Object|null} o.editorCameraState author's autosaved editor pose
 */
export function pickLoadCameraState({
  urlCameraState = null,
  viewerLaunch = false,
  isOwner = false,
  startCameraState = null,
  editorCameraState = null
}) {
  if (urlCameraState) return urlCameraState;
  if (viewerLaunch || !isOwner) return startCameraState || null;
  return editorCameraState || startCameraState || null;
}
