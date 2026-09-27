// Legacy start pose → Starting View entity.
//
// Before the Starting View existed, set-thumbnail pinned the opening view
// through the default snapshot's camera state. There is now exactly one place
// a start pose lives, so a saved scene with a default-snapshot pose and no
// `viewer-start` entity gets one synthesized (top-level, at that pose) before
// its entities are created. Idempotent: the entity is saved with the scene on
// the next save and the check finds it from then on. The snapshot's
// cameraState itself is left alone (the gallery's "fly to this view" still
// reads it).
//
// Runs once per scene: `memory.viewerStartMigrated` (written on every save
// once the scene has, or has had, a Starting View entity) says the entity owns
// the start pose from then on, so deleting the entity and saving is a durable
// off switch and the snapshot pose is not resurrected on the next load. The
// caller mirrors the returned flag into the store for the save path.
import * as THREE from 'three';
import {
  resolveSavedCameraStates,
  hasViewerStart,
  DEFAULT_FOV_DEGREES
} from '../../tested/scene-camera-pose.js';

const USER_LAYERS_ROOT_ID = 'street-container';

/**
 * Mutates `entitiesData` in place (may push one entity).
 * @returns {{ viewerStartMigrated: boolean, migrated: boolean }}
 *   `viewerStartMigrated` is the flag the scene should carry from now on;
 *   `migrated` is true only when an entity was synthesized by this call.
 */
export function migrateDefaultSnapshotToViewerStart(entitiesData, memory) {
  const owned =
    !!memory?.viewerStartMigrated ||
    (Array.isArray(entitiesData) && hasViewerStart(entitiesData));
  if (owned || !Array.isArray(entitiesData)) {
    return { viewerStartMigrated: owned, migrated: false };
  }
  const { legacyStartCameraState: state } = resolveSavedCameraStates(memory);
  if (!state || !state.position) {
    return { viewerStartMigrated: false, migrated: false };
  }
  const rot = state.rotation || {};
  // Saved rotations are radians applied as XYZ (see the fly-in's scratch
  // camera); A-Frame rotation is degrees, YXZ.
  const quaternion = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rot.x || 0, rot.y || 0, rot.z || 0, 'XYZ')
  );
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
  const deg = THREE.MathUtils.radToDeg;
  // Saved data's top level holds the scene's direct children; user layers
  // live under the street-container entry. The Starting View is a user
  // layer (pinned to the top of the list, saved with the scene), so it
  // goes there; a file with no container entry falls back to top level.
  const container = entitiesData.find((e) => e && e.id === USER_LAYERS_ROOT_ID);
  const target = container
    ? (container.children = container.children || [])
    : entitiesData;
  target.push({
    element: 'a-entity',
    components: {
      position: {
        x: state.position.x || 0,
        y: state.position.y || 0,
        z: state.position.z || 0
      },
      rotation: { x: deg(euler.x), y: deg(euler.y), z: deg(euler.z) },
      'viewer-start': { fov: state.zoom || DEFAULT_FOV_DEGREES },
      'data-layer-name': 'Starting View'
    }
  });
  return { viewerStartMigrated: true, migrated: true };
}
