// Pure arithmetic for the easy gizmo: the sizing law, the regime latch, the
// flattened layout's dodge rules, the press decision, and the box-union rule
// behind the object's base.
//
// Nothing here touches THREE at module scope, so the module is importable and
// testable without a scene. Functions may still read the `THREE` global that
// A-Frame installs, which is how the rest of this subsystem's neighbours work.

/* global THREE */

import {
  ARC_FLAT_CLEAR_FRAC,
  ARC_FLAT_RADIUS_FRAC,
  ARC_HEAD_RADIUS,
  ARC_LIFT_MAX_DEG,
  ARC_LIFT_SLACK_FRAC,
  ARC_LIFT_SYMMETRIC,
  ARC_MIN_TUBE_PX,
  ARC_TUBE_RADIUS,
  CHEVRON_MAX,
  DODGE_HYSTERESIS_FRAC,
  FOLLOW_TAN,
  HEAD_BASE_FLAT_FRAC,
  HEAD_BASE_FRAC,
  LANDING_BAR_HEIGHT_FRAC,
  SQUARE_MAX_METRES,
  SQUARE_MIN_METRES,
  SQUARE_TARGET_METRES,
  SQUARE_TARGET_PX,
  STEP_METRES,
  STRIP_NARROW_FRAC
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
 * The flattened layout's clearances, in metres, derived from what is drawn.
 *
 * - `tubeWorld`: the arc tube's drawn thickness, with its pixel minimum.
 * - `clearance`: how far the flattened arc's centre line sits from the move
 *   strip's, before any lift: the larger of the strip's and its arrowheads'
 *   half-heights, the arc's own half-thickness (its heads', which are the
 *   thickest part) and a visible gap between them.
 * - `stripClear`: the closest a flattened landing bar's centre may come to the
 *   strip's: the two half-heights plus the same gap. The strip and a flattened
 *   bar stand in one plane, so this holds on screen exactly.
 */
export function dodgeExtents(S, metresPerPixel, t) {
  const tubeWorld = Math.max(S * 0.06, ARC_MIN_TUBE_PX * metresPerPixel);
  const arcHalfThickness = (ARC_HEAD_RADIUS * tubeWorld) / ARC_TUBE_RADIUS;
  const gap = S * ARC_FLAT_CLEAR_FRAC;
  const headBase = lerp(HEAD_BASE_FRAC, HEAD_BASE_FLAT_FRAC, t);
  const handleHeight = S * Math.max(STRIP_NARROW_FRAC, headBase);
  return {
    tubeWorld,
    clearance: handleHeight / 2 + gap + arcHalfThickness,
    stripClear: (S * (STRIP_NARROW_FRAC + LANDING_BAR_HEIGHT_FRAC)) / 2 + gap
  };
}

/**
 * How much further the flattened arc is moved from the move handle, in metres,
 * to make up for parallax.
 *
 * The flattened arc is a horizontal ring whose drawn front is up to its radius
 * nearer the camera than the strip, so seen from elevation θ it is drawn up to
 * `radius · tan θ` lower (camera above) or higher (camera below) than its
 * height. The world clearance absorbs a small part of that; this is the rest.
 *
 * `elevationDeg` is the elevation from the camera to the handle as drawn,
 * positive with the camera above. `side` is +1 with the arc above the strip and
 * −1 below. With `symmetric` false, the lift applies only when the camera and
 * the arc are on the same side, the one case where parallax at rest draws the
 * arc toward the handle.
 */
export function flatArcLift(
  S,
  elevationDeg,
  side,
  symmetric = ARC_LIFT_SYMMETRIC
) {
  const deg = symmetric
    ? Math.abs(elevationDeg)
    : Math.max(0, side * elevationDeg);
  const rad = (Math.min(deg, ARC_LIFT_MAX_DEG) * Math.PI) / 180;
  return (
    S * Math.max(0, ARC_FLAT_RADIUS_FRAC * Math.tan(rad) - ARC_LIFT_SLACK_FRAC)
  );
}

/**
 * Where the flattened handle sits relative to the object's base, and which side
 * of it the arc takes, given the gaps to the nearest landing bar on each side.
 *
 * `gapBelow` / `gapAbove` are positive distances in metres, or null for no bar
 * on that side. `stripClear` is the closest a bar may come to the strip
 * (`dodgeExtents`). `latches` carries the arc's previous side and is returned
 * updated; pass null to seed.
 *
 * Returns `{ flipArc, shift, latches }`, where `shift` is a signed offset in
 * metres applied to the whole handle — square and arc together — and `flipArc`
 * puts the arc above the strip.
 */
export function computeDodge({ stripClear, gapBelow, gapAbove, latches }) {
  const below =
    gapBelow === null || gapBelow === undefined ? Infinity : gapBelow;
  const above =
    gapAbove === null || gapAbove === undefined ? Infinity : gapAbove;

  // The handle moves only as far as it must to keep `stripClear` from each bar:
  // up off a bar close below, down off one close above. Where no position
  // clears both, it clears the nearer bar and the farther is accepted as
  // occluded.
  const lowLimit = stripClear - below;
  const highLimit = above - stripClear;
  let shift;
  if (lowLimit <= highLimit) {
    shift = Math.min(Math.max(0, lowLimit), highLimit);
  } else {
    shift = below <= above ? lowLimit : highLimit;
  }
  if (!Number.isFinite(shift)) shift = 0;

  // The arc takes the side of the strip with more room, measured from the
  // handle where it now sits. With no bar on either side it returns to its
  // default side, below. Nothing here depends on the camera, so orbiting never
  // moves it.
  let flipArc = false;
  if (below !== Infinity || above !== Infinity) {
    const roomBelow = below + shift;
    const roomAbove = above - shift;
    const leave = 1 + DODGE_HYSTERESIS_FRAC;
    flipArc = latches?.flipArc
      ? !(roomAbove * leave < roomBelow)
      : roomBelow * leave < roomAbove;
  }

  return { flipArc, shift, latches: { flipArc } };
}

/**
 * Offset each side of a convex polygon along its own outward normal, joining
 * neighbouring sides with a mitre.
 *
 * `points` is flat `[x0, y0, x1, y1, …]` in either winding, and `count` how
 * many vertices of it to use. Side `i` runs from vertex `i` to `i + 1`, and
 * `offsets[i]` moves it outward (negative moves it inward). The result is
 * written into `out`, flat, where vertex `i` is the meeting point of offset
 * sides `i − 1` and `i`, so side `i` of the result is offset side `i`.
 */
export function offsetConvexPolygon(
  points,
  offsets,
  out = [],
  count = points.length / 2
) {
  let area = 0;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    area +=
      points[2 * i] * points[2 * j + 1] - points[2 * j] * points[2 * i + 1];
  }
  const turn = area >= 0 ? 1 : -1;
  for (let i = 0; i < count; i++) {
    const h = (i + count - 1) % count;
    const j = (i + 1) % count;
    const x = points[2 * i];
    const y = points[2 * i + 1];
    // Outward normals of the side arriving at this vertex and the one leaving.
    let ax = turn * (y - points[2 * h + 1]);
    let ay = turn * (points[2 * h] - x);
    let bx = turn * (points[2 * j + 1] - y);
    let by = turn * (x - points[2 * j]);
    const la = Math.hypot(ax, ay) || 1;
    const lb = Math.hypot(bx, by) || 1;
    ax /= la;
    ay /= la;
    bx /= lb;
    by /= lb;
    // Solve a·p = a·v + dA and b·p = b·v + dB for p = v + q.
    const dA = offsets[h];
    const dB = offsets[i];
    const det = ax * by - ay * bx;
    if (Math.abs(det) < 1e-9) {
      out[2 * i] = x + bx * dB;
      out[2 * i + 1] = y + by * dB;
    } else {
      out[2 * i] = x + (dA * by - dB * ay) / det;
      out[2 * i + 1] = y + (dB * ax - dA * bx) / det;
    }
  }
  return out;
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
