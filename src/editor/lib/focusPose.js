import * as THREE from 'three';

/**
 * Entity-relative camera pose for `focus-camera-pose` (#1315 follow-up):
 * the full camera pose (position, orientation, fov) expressed in the
 * entity's frame, so a focus glide lands exactly where the author framed
 * it, off-center or tighter lens included, rather than re-centering on
 * the entity. One capture and one resolve for every focus route (the
 * hotspot click, the Focus button, the AI focus tool).
 *
 * Conventions: `relativePosition` is metres in the entity's rotated frame
 * (scale-free, matching how the glide has always applied it),
 * `relativeRotation` is degrees in A-Frame's YXZ order, `fov` is the
 * camera's vertical fov (0 = leave the lens alone). Legacy poses
 * (`lookAt: true`, the schema default) carry only a position and aim at
 * the entity's bounds center; the controls keep that path.
 */

const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();

function decomposeWorld(object3D) {
  object3D.updateMatrixWorld(true);
  object3D.matrixWorld.decompose(_pos, _quat, _scale);
  return { position: _pos.clone(), quaternion: _quat.clone() };
}

/** Current camera pose relative to `entityObject3D`, as component data. */
export function captureFocusPose(entityObject3D, camera) {
  const entity = decomposeWorld(entityObject3D);
  camera.updateMatrixWorld();
  const camPos = new THREE.Vector3();
  const camQuat = new THREE.Quaternion();
  camera.getWorldPosition(camPos);
  camera.getWorldQuaternion(camQuat);
  const inv = entity.quaternion.clone().invert();
  const relPos = camPos.sub(entity.position).applyQuaternion(inv);
  const relEuler = new THREE.Euler().setFromQuaternion(
    inv.multiply(camQuat),
    'YXZ'
  );
  const deg = THREE.MathUtils.radToDeg;
  return {
    relativePosition: { x: relPos.x, y: relPos.y, z: relPos.z },
    relativeRotation: {
      x: deg(relEuler.x),
      y: deg(relEuler.y),
      z: deg(relEuler.z)
    },
    fov: camera.fov || 0,
    lookAt: false
  };
}

/**
 * World cameraState ({ position, rotation (radians, XYZ), zoom }) for a
 * stored pose — the shape `controls.focusCameraState` consumes.
 */
export function resolveFocusPose(entityObject3D, data) {
  const entity = decomposeWorld(entityObject3D);
  const rel = data.relativePosition || { x: 0, y: 0, z: 0 };
  const rot = data.relativeRotation || { x: 0, y: 0, z: 0 };
  const rad = THREE.MathUtils.degToRad;
  const position = new THREE.Vector3(rel.x, rel.y, rel.z)
    .applyQuaternion(entity.quaternion)
    .add(entity.position);
  const localQuat = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rad(rot.x), rad(rot.y), rad(rot.z), 'YXZ')
  );
  const worldQuat = entity.quaternion.multiply(localQuat);
  const euler = new THREE.Euler().setFromQuaternion(worldQuat, 'XYZ');
  return {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: euler.x, y: euler.y, z: euler.z },
    zoom: data.fov || undefined
  };
}
