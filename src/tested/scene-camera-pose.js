/**
 * Scene start-pose resolution (pure, unit-tested).
 *
 * One start pose: the Starting View entity (`viewer-start`). Everyone,
 * owner or visitor, opens a scene there when it exists. Without one, the
 * scene opens at the author's autosaved editor pose (`memory.cameraState`,
 * written on every save), else the default overview. A `?camera=` deep
 * link beats both.
 *
 * Older scenes pinned their opening view through the default snapshot's
 * camera state (set-thumbnail used to be the only way). That is migrated
 * into a Starting View entity at load (`legacyStartCameraState` +
 * `hasViewerStart`), so there is exactly one place a start pose lives.
 */

/**
 * The default vertical field of view in degrees: THREE's PerspectiveCamera
 * default, which is the inspector camera's resting fov, the Starting View's
 * (`viewer-start`) schema default, and the fallback wherever a camera state
 * carries no `zoom`. One value on purpose (#2031): the editor and viewer share
 * one camera, so a start pose "at the default" must mean the lens the editor
 * rests at, not a wider frustum-fit guess.
 */
export const DEFAULT_FOV_DEGREES = 50;

function defaultSnapshotState(memory) {
  const snapshots = memory?.snapshots;
  if (!Array.isArray(snapshots) || snapshots.length === 0) return null;
  const def = snapshots.find((s) => s && s.isDefault);
  return def?.cameraState || null;
}

/** Saved poses out of `memory`; either may be null. */
export function resolveSavedCameraStates(memory) {
  return {
    editorCameraState: memory?.cameraState || null,
    legacyStartCameraState: defaultSnapshotState(memory)
  };
}

/** True if any entity in the saved data tree carries `viewer-start`. */
export function hasViewerStart(entitiesData) {
  if (!Array.isArray(entitiesData)) return false;
  return entitiesData.some(
    (e) =>
      !!e &&
      ((e.components && 'viewer-start' in e.components) ||
        hasViewerStart(e.children))
  );
}

/**
 * Pick the pose the load fly-in should end at.
 * @param {Object} o
 * @param {Object|null} o.urlCameraState    `?camera=` deep link, wins outright
 * @param {Object|null} o.startCameraState  the Starting View entity's pose
 * @param {Object|null} o.editorCameraState autosaved editor pose
 */
export function pickLoadCameraState({
  urlCameraState = null,
  startCameraState = null,
  editorCameraState = null
}) {
  return urlCameraState || startCameraState || editorCameraState || null;
}
