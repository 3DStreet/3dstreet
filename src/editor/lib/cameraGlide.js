import * as THREE from 'three';

/**
 * Look-at camera glide (#2054): every focus / snapshot glide tweens the
 * camera POSITION and a virtual look-at TARGET, and derives the camera's
 * rotation from the pair each frame, instead of slerping between two
 * orientations. Both points travel in straight lines, so the view sweeps
 * the way a person turns their head toward what they are walking to, and
 * a glide that keeps its heading (the first double-click focus) is a pure
 * translation.
 *
 * The endpoints are exact: each endpoint's target is placed on that
 * pose's own forward axis, and the up vector the frame is built with is
 * either world up (both poses level, the usual editor case) or the
 * slerped pose up (a rolled or straight-down pose, e.g. plan view, where
 * world up is undefined or wrong), so the derived rotation at t = 0 and
 * t = 1 is the start and end quaternion.
 */

const WORLD_UP = new THREE.Vector3(0, 1, 0);
// |forward.y| above this is "looking straight up/down": world up can't
// orient the frame there.
const NEAR_VERTICAL = 0.995;
// |right.y| below this is "no roll".
const LEVEL_EPSILON = 1e-3;
const MIN_TARGET_DEPTH = 0.5;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();

function forwardOf(quaternion) {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(quaternion);
}

function isLevel(quaternion) {
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion);
  const forward = forwardOf(quaternion);
  return (
    Math.abs(right.y) < LEVEL_EPSILON && Math.abs(forward.y) < NEAR_VERTICAL
  );
}

/**
 * The point on `quaternion`'s forward axis from `position` at the depth of
 * `hint` along that axis (its projection), or at `fallbackDepth` when the
 * hint is missing or not in front of the camera.
 */
export function targetOnAxis(position, quaternion, hint, fallbackDepth) {
  const forward = forwardOf(quaternion);
  let depth = hint ? _dir.subVectors(hint, position).dot(forward) : 0;
  if (!(depth >= MIN_TARGET_DEPTH)) {
    depth = Math.max(fallbackDepth || 0, MIN_TARGET_DEPTH);
  }
  return position.clone().addScaledVector(forward, depth);
}

/** Quaternion of a camera at `position` looking at `target` with world up. */
export function lookAtQuaternion(position, target, up = WORLD_UP) {
  _m.lookAt(position, target, up);
  return new THREE.Quaternion().setFromRotationMatrix(_m);
}

/**
 * Build a glide between two camera poses. `startTarget` / `endTarget` are
 * hints (the orbit center, the framed entity's center): each is projected
 * onto its pose's forward axis. `endQuaternion` defaults to looking at
 * `endTarget` with world up.
 *
 * Returns `{ endTarget, endQuaternion, apply(camera, t) }`; `apply` writes
 * the camera's position and quaternion for eased progress `t` in [0, 1].
 */
export function createLookAtGlide({
  startPosition,
  startQuaternion,
  startTarget,
  endPosition,
  endQuaternion,
  endTarget
}) {
  const sp = startPosition.clone();
  const sq = startQuaternion.clone();
  const ep = endPosition.clone();
  const eq = endQuaternion
    ? endQuaternion.clone()
    : lookAtQuaternion(ep, endTarget);
  const et = targetOnAxis(ep, eq, endTarget, 10);
  // With no usable start hint, start looking at the depth the end target
  // sits at from here, so the look point has the same distance to cover.
  const st = targetOnAxis(sp, sq, startTarget, et.distanceTo(sp));
  const worldUp = isLevel(sq) && isLevel(eq);

  const pos = new THREE.Vector3();
  const tgt = new THREE.Vector3();

  function apply(camera, t) {
    if (t >= 1) {
      camera.position.copy(ep);
      camera.quaternion.copy(eq);
      return;
    }
    if (t <= 0) {
      camera.position.copy(sp);
      camera.quaternion.copy(sq);
      return;
    }
    pos.lerpVectors(sp, ep, t);
    tgt.lerpVectors(st, et, t);
    _dir.subVectors(tgt, pos);
    const len = _dir.length();
    _q.slerpQuaternions(sq, eq, t);
    if (len < 1e-6) {
      // Position and target coincide mid-flight: no direction to derive.
      camera.position.copy(pos);
      camera.quaternion.copy(_q);
      return;
    }
    if (worldUp && Math.abs(_dir.y / len) < NEAR_VERTICAL) {
      _up.copy(WORLD_UP);
    } else {
      _up.set(0, 1, 0).applyQuaternion(_q);
    }
    _m.lookAt(pos, tgt, _up);
    camera.position.copy(pos);
    camera.quaternion.setFromRotationMatrix(_m);
  }

  return { endTarget: et, endQuaternion: eq, apply };
}

/**
 * First-step focus pose (#2054): keep the camera's heading and slide it
 * so `center` sits on the view axis at `distance`. Returns null when that
 * would put the camera below `minY` (looking up at the object), where the
 * full framing is the only sensible first step.
 */
export function headingPreservingFocusPosition(
  cameraQuaternion,
  center,
  distance,
  minY = -Infinity
) {
  const forward = forwardOf(cameraQuaternion);
  const position = center.clone().addScaledVector(forward, -distance);
  if (position.y < minY) return null;
  return position;
}
