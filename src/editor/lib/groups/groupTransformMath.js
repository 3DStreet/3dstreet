/* global THREE */
// Transform arithmetic for groups: rotating about a center that is not the
// origin, re-expressing a world pose under a new parent, and picking a group
// by its member box.
//
// Scratch values are created on first use rather than at module evaluation, so
// importing this module never needs THREE to be present yet.

let scratch = null;
function tmp() {
  if (!scratch) {
    scratch = {
      delta: new THREE.Quaternion(),
      inverse: new THREE.Quaternion(),
      parentInverse: new THREE.Matrix4(),
      local: new THREE.Matrix4(),
      recomposed: new THREE.Matrix4(),
      worldInverse: new THREE.Matrix4(),
      ray: new THREE.Ray(),
      hit: new THREE.Vector3()
    };
  }
  return scratch;
}

/**
 * The group's position after rotating it from `qStart` to `qNow` about its
 * center, so the center stays fixed in world space and the origin orbits it.
 *
 * Everything is in the group's PARENT frame: `posStart` is the group's
 * position at gesture start and `centerInParent` its center, both held from
 * the start of the gesture. `qNow` is absolute, so the delta is always taken from
 * the gesture start; composing per-frame deltas would compound the orbit.
 */
export function positionForRotationAboutCenter(
  posStart,
  qStart,
  qNow,
  centerInParent,
  out
) {
  const t = tmp();
  t.delta.copy(qNow).multiply(t.inverse.copy(qStart).invert());
  return out
    .copy(posStart)
    .sub(centerInParent)
    .applyQuaternion(t.delta)
    .add(centerInParent);
}

// Relative tolerance on the recomposed local matrix. A pose that three can
// store as position, rotation and scale reproduces its matrix to float
// precision; a sheared one misses by far more than this.
const RECOMPOSE_EPS = 1e-6;

/**
 * Express `worldMatrix` in the frame of a parent whose world matrix is
 * `parentMatrixWorld`, writing position, quaternion and scale into `out`.
 *
 * Returns whether that local pose is representable. Under a parent scaled
 * differently along its axes, a child turned relative to those axes would need
 * a shear, which an entity's position/rotation/scale cannot hold; the
 * decomposition then silently distorts the child, so the caller must refuse
 * the move rather than apply it.
 *
 * @param out {{position: THREE.Vector3, quaternion: THREE.Quaternion, scale: THREE.Vector3}}
 */
export function localPoseFromWorld(parentMatrixWorld, worldMatrix, out) {
  const t = tmp();
  if (Math.abs(parentMatrixWorld.determinant()) < 1e-12) return false;
  t.parentInverse.copy(parentMatrixWorld).invert();
  t.local.multiplyMatrices(t.parentInverse, worldMatrix);
  t.local.decompose(out.position, out.quaternion, out.scale);
  t.recomposed.compose(out.position, out.quaternion, out.scale);

  const a = t.local.elements;
  const b = t.recomposed.elements;
  let magnitude = 0;
  for (let i = 0; i < 16; i++) magnitude = Math.max(magnitude, Math.abs(a[i]));
  const tolerance = RECOMPOSE_EPS * Math.max(1, magnitude);
  for (let i = 0; i < 16; i++) {
    if (Math.abs(a[i] - b[i]) > tolerance) return false;
  }
  return true;
}

/**
 * Distance along a world-space `ray` to a group's box, or null for a miss.
 * The box is in the group's local axes and `matrixWorld` places it, so a
 * rotated group is picked by its rotated box, not a world-aligned stand-in.
 * A flat box (members all at one height) needs no padding to be picked from
 * above: three's slab test enters and leaves a zero-height slab at the same
 * distance and reports that hit.
 */
export function rayHitsGroupBox(ray, localBox, matrixWorld) {
  if (!localBox || localBox.isEmpty()) return null;
  const t = tmp();
  if (Math.abs(matrixWorld.determinant()) < 1e-12) return null;
  t.worldInverse.copy(matrixWorld).invert();
  t.ray.copy(ray).applyMatrix4(t.worldInverse);
  if (!t.ray.intersectBox(localBox, t.hit)) return null;
  return t.hit.applyMatrix4(matrixWorld).distanceTo(ray.origin);
}
