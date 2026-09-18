// Pure arithmetic for the easy gizmo: the sizing law, the regime latch, the
// flattened layout's dodge rules, the press decision, and the box-union rule
// behind the object's base.
//
// Nothing here touches THREE at module scope, so the module is importable and
// testable without a scene. Functions may still read the `THREE` global that
// A-Frame installs, which is how the rest of this subsystem's neighbours work.

/* global THREE */

import {
  ARC_NEAR_FRAC,
  ARC_REACH_FRAC,
  CHEVRON_MAX,
  DODGE_HYSTERESIS_FRAC,
  FOLLOW_TAN,
  SQUARE_MAX_METRES,
  SQUARE_MIN_METRES,
  SQUARE_TARGET_METRES,
  SQUARE_TARGET_PX,
  STEP_METRES,
  STRIP_HALF_FRAC
} from './easyGizmoConstants.js';

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * A latch over a value with an enter/leave pair: true once `value` drops below
 * `enterBelow`, false once it rises above `leaveAbove`, and unchanged between
 * them. `current` may be null, which seeds from the midpoint.
 *
 * Written here rather than borrowed from the navigation system's equivalent:
 * that one's vocabulary, polarity and documented scope are navigation's, and
 * its own docblock says regime control never uses it.
 */
export function latchByHysteresis(value, enterBelow, leaveAbove, current) {
  if (current === null || current === undefined) {
    return value < (enterBelow + leaveAbove) / 2;
  }
  if (value < enterBelow) return true;
  if (value > leaveAbove) return false;
  return current;
}

/**
 * The drawn square's world size: the geometric mean of a world size and a
 * screen size, clamped.
 *
 * Returns null when the metres-per-pixel is unusable — a canvas with no height,
 * a camera mid-swap. `S` is the unit every dodge threshold is expressed in, so
 * a zero would collapse all three of them and turn a shift into a negative
 * offset; the caller holds its last good value instead of laying out a frame.
 */
export function squareSideMetres(metresPerPixelAtSquare) {
  const mpp = metresPerPixelAtSquare;
  if (!(mpp > 0)) return null;
  const side = Math.sqrt(SQUARE_TARGET_METRES * SQUARE_TARGET_PX * mpp);
  if (!Number.isFinite(side)) return null;
  return Math.min(Math.max(side, SQUARE_MIN_METRES), SQUARE_MAX_METRES);
}

/**
 * The elevation angle from the camera to a point, in degrees from horizontal.
 * Positive means the camera is above the point.
 *
 * This is the angle to the drawn element, not the camera's own pitch. The angle
 * to a point IS the foreshortening of whatever is drawn there, which is what
 * the regime responds to; the camera's pitch says only where it is aimed, and
 * an object at the top of the frame is seen tens of degrees further down than
 * one at the bottom.
 */
export function elevationAngleDegrees(cameraPosition, point) {
  const dx = cameraPosition.x - point.x;
  const dy = cameraPosition.y - point.y;
  const dz = cameraPosition.z - point.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(dist > 1e-6)) return 90;
  const s = Math.min(Math.max(dy / dist, -1), 1);
  return (Math.asin(s) * 180) / Math.PI;
}

/**
 * How much the support may change over a sub-span of the given horizontal
 * length before the surface stops being continuous with the object's current
 * one.
 *
 * The slope term is deliberately uncapped. It stops being the binding term once
 * the path is sampled at SUBSTEP or finer, where this collapses to STEP.
 */
export function continuityAllowance(subSpanMetres) {
  return Math.max(STEP_METRES, FOLLOW_TAN * subSpanMetres);
}

/**
 * Where the flattened handle sits relative to the object's base, given the gaps
 * to the nearest landing bar on each side.
 *
 * `gapBelow` / `gapAbove` are positive distances in metres, or null for no bar
 * on that side. `latches` carries the previous state of the four hysteretic
 * thresholds and is returned updated; pass null to seed.
 *
 * Returns `{ flipArc, shift, latches }`, where `shift` is a signed offset in
 * metres applied to the whole handle — square and arc together.
 */
export function computeDodge({ S, gapBelow, gapAbove, latches }) {
  const reach = ARC_REACH_FRAC * S;
  const near = ARC_NEAR_FRAC * S;
  const clear = STRIP_HALF_FRAC * S;
  const leave = 1 + DODGE_HYSTERESIS_FRAC;
  const below =
    gapBelow === null || gapBelow === undefined ? Infinity : gapBelow;
  const above =
    gapAbove === null || gapAbove === undefined ? Infinity : gapAbove;
  const prev = latches || {};

  const next = {
    belowInReach: latchByHysteresis(
      below,
      reach,
      reach * leave,
      prev.belowInReach ?? null
    ),
    aboveInReach: latchByHysteresis(
      above,
      reach,
      reach * leave,
      prev.aboveInReach ?? null
    ),
    belowNear: latchByHysteresis(
      below,
      near,
      near * leave,
      prev.belowNear ?? null
    ),
    aboveNear: latchByHysteresis(
      above,
      near,
      near * leave,
      prev.aboveNear ?? null
    )
  };

  // Rule 1 protects the ARC, which reaches 0.47 S from the base, so it is keyed
  // on the arc's own reach on BOTH sides. Flipping onto a bar that is itself
  // within reach trades one occlusion for another, so with a bar in reach
  // either side the arc stays where it would have been anyway.
  const flipArc = next.belowInReach && !next.aboveInReach;

  // Rules 2 and 3 protect the STRIP, whose half-height is 0.11 S, so 0.15 S is
  // their scale. They can both apply — rule 2's condition is a strict subset of
  // rule 1's — and they demand opposite shifts, so the nearer bar wins.
  let shift = 0;
  const wantUp = next.belowNear ? near - below : null;
  const wantDown = next.aboveNear ? -(near - above) : null;
  if (wantUp !== null && wantDown !== null) {
    shift = below <= above ? wantUp : wantDown;
  } else if (wantUp !== null) {
    shift = wantUp;
  } else if (wantDown !== null) {
    shift = wantDown;
  }

  // The winning shift moves the handle up to 0.15 S TOWARD the loser's bar,
  // which may itself be within 0.15 S — so a dodge meant to keep one bar
  // reachable can seat the handle on the other. Clamp to the band that clears
  // both; where no such band exists, clear the nearer bar and accept the
  // farther one as occluded.
  const lowLimit = clear - below;
  const highLimit = above - clear;
  if (lowLimit <= highLimit) {
    shift = Math.min(Math.max(shift, lowLimit), highLimit);
  } else {
    shift = below <= above ? lowLimit : highLimit;
  }
  if (!Number.isFinite(shift)) shift = 0;

  return { flipArc, shift, latches: next };
}

/**
 * How many chevrons span a gap, and the resulting step. The stack divides the
 * gap rather than being laid out from one end, so it reaches the whole way over
 * a short hop and a tall one alike.
 */
export function chevronLayout(spanMetres, targetSpacingMetres, previousCount) {
  if (!(targetSpacingMetres > 0)) return { count: 1, step: spanMetres };
  const ratio = spanMetres / targetSpacingMetres;
  let count = Math.min(
    Math.max(Math.round(spanMetres / targetSpacingMetres), 1),
    CHEVRON_MAX
  );
  // A 15% dead band around each half-step prevents count flicker on zoom.
  if (
    previousCount >= 1 &&
    previousCount <= CHEVRON_MAX &&
    ratio >= previousCount - 0.65 &&
    ratio <= previousCount + 0.65
  ) {
    count = previousCount;
  }
  return { count, step: spanMetres / count };
}

let clipStart;
let clipEnd;
let clipMatrix;
const clipPlanes = [
  ['x', 0.95],
  ['y', 0.95],
  ['z', 1]
];
const clipSigns = [-1, 1];

/** Last visible point toward an off-screen destination, or null when no clamp is needed. */
export function lastVisiblePointOnSegment(from, to, camera, out) {
  if (!clipStart) {
    clipStart = new THREE.Vector4();
    clipEnd = new THREE.Vector4();
    clipMatrix = new THREE.Matrix4();
  }
  camera.updateMatrixWorld();
  clipMatrix.multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse
  );
  clipStart.set(from.x, from.y, from.z, 1).applyMatrix4(clipMatrix);
  clipEnd.set(to.x, to.y, to.z, 1).applyMatrix4(clipMatrix);
  let enter = 0;
  let leave = 1;
  // Clip the connection in homogeneous coordinates, including near/far planes.
  // This also works when both endpoints are outside but the connection crosses the view.
  for (const [axis, inset] of clipPlanes) {
    for (const sign of clipSigns) {
      const a = inset * clipStart.w + sign * clipStart[axis];
      const b = inset * clipEnd.w + sign * clipEnd[axis];
      if (a < 0 && b < 0) return null;
      if (a < 0) enter = Math.max(enter, a / (a - b));
      if (b < 0) leave = Math.min(leave, a / (a - b));
    }
  }
  if (enter > leave || leave >= 1) return null;
  return out.copy(from).lerp(to, leave);
}

/**
 * What the gizmo does with a press, given only facts about it.
 *
 * The listener wiring around this is DOM and ordering behaviour and is covered
 * by live test; the decision itself is a function, which is the same split the
 * shape-vertex layer makes.
 *
 * 'claim' takes the gesture. 'swallow' suppresses the press and does nothing
 * with it — an inert control must not fall through, or pressing the gizmo
 * mid-animation would deselect the object. 'ignore' lets the press proceed.
 */
export function decideEasyPress({
  targetIsCanvas,
  alreadyClaimed,
  otherAffordanceHit,
  hit,
  inert
}) {
  if (!targetIsCanvas) return 'ignore';
  if (alreadyClaimed) return 'ignore';
  if (otherAffordanceHit) return 'ignore';
  if (!hit) return 'ignore';
  return inert ? 'swallow' : 'claim';
}

/**
 * The object-local bounding box of an object3D's meshes, or null when nothing
 * qualifies.
 *
 * Two rules, and both are the difference between a handle on the object and a
 * handle twenty metres underground.
 *
 * PREFER A MESH'S OWN `boundingBox` where it has one, falling back to
 * `geometry.boundingBox` only when it does not. SkinnedMesh, InstancedMesh and
 * BatchedMesh each carry an object-level box describing the POSED or INSTANCED
 * result, while the geometry's box describes the authored REST POSE. Rigged
 * catalog trees have rest-pose bounds running tens of metres either side of a
 * few-metre tree, so reading the geometry box alone puts the base far below the
 * ground while the model itself draws correctly.
 *
 * AND TRANSFORM EACH MESH'S BOX INTO THE OBJECT FRAME INDIVIDUALLY. The stock
 * `Box3.setFromObject` gets the first rule right but returns a WORLD box, and
 * re-expressing that in the object's frame takes the AABB of an AABB, which
 * inflates under any rotation that is not a yaw.
 *
 * Reports no box rather than a fabricated one when nothing qualifies, so a
 * did-not-run stays distinguishable and layout can fall back to the object's
 * origin.
 */
export function deriveLocalBoxOf(object) {
  if (!object) return null;
  const cached = object._batchLocalBbox;
  if (cached && !cached.isEmpty()) return cached.clone();

  object.updateWorldMatrix(true, true);
  const toLocal = new THREE.Matrix4().copy(object.matrixWorld).invert();
  const meshLocal = new THREE.Matrix4();
  const meshBox = new THREE.Box3();
  const box = new THREE.Box3();
  let found = false;

  object.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    let source;
    if (node.boundingBox !== undefined) {
      if (node.boundingBox === null) node.computeBoundingBox();
      source = node.boundingBox;
    } else {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      source = node.geometry.boundingBox;
    }
    if (!source) return;
    meshLocal.multiplyMatrices(toLocal, node.matrixWorld);
    meshBox.copy(source).applyMatrix4(meshLocal);
    box.union(meshBox);
    found = true;
  });

  return found && !box.isEmpty() ? box : null;
}
