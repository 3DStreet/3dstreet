// Angle snap for the shape draw tool: pure geometry on the x/z plan view, no
// THREE and no editor state, so every rule here is unit-testable on plain
// {x, y, z} points.
//
// Conventions. A HEADING is the direction of a side, atan2(dz, dx) in degrees,
// normalised to [0, 360). A TURN is the signed change of heading from one side
// to the next, normalised to (-180, 180]. The corner a readout shows is
// 180 − |turn|, so a step that divides 180 keeps both the turn and the corner
// multiples of the step.
//
// Placing a point. The direction from the last vertex to the pointer is
// quantised to a multiple of the step from a base (the previous side, or the
// frame's axes for the first side), and the placed point is the pointer's
// perpendicular foot on that ray — the side follows the snapped direction and
// moving out along it lengthens it; movement across it does nothing. A pointer
// behind the vertex gives a foot at the vertex itself (t is clamped at 0), so
// the existing minimum-spacing refusal applies there.
//
// Closing a ring. The close is judged by the pointer being over the first
// vertex, not by a snapped point, because the first vertex is generally on no
// snapped ray from the last one. To make both closing corners snapped, the
// last vertex SLIDES along its own side (keeping that side's direction, so the
// corner behind it is untouched) to where the closing side meets the first
// vertex at a snapped turn. See closingAdjustment.
//
// Precision. The edge tests used to validate a close (segmentsIntersectXZ)
// are exact-arithmetic tests: collinearity is seen only at an orientation of
// exactly 0. Snapped points sit a few ulps off their ideal line, so a closing
// side running straight back along a neighbour is not reliably caught by them;
// that is why closingAdjustment excludes 0° and 180° closing turns by rule
// rather than leaving them to the edge tests. Unit vectors come from cos/sin
// for every heading, multiples of 90° included — special-casing those to exact
// values only moves which cases rounding decides.

import { ringEnclosesArea, segmentsIntersectXZ } from './shapeMeasure.js';

// Degrees. Below this an angle's residue against the step is rounding noise.
export const ANGLE_EPS_DEG = 1e-4;
// Fraction of the step by which the pointer must favour another direction
// before the shown direction changes, so a pointer wobbling on a boundary does
// not make the preview flicker between two sides.
export const SNAP_HYSTERESIS_FRACTION = 0.1;

// Metres. Far below any drawable length: it only guards divisions by a zero
// length.
const LENGTH_EPS = 1e-9;

function normaliseHeading(deg) {
  const h = deg % 360;
  return h < 0 ? h + 360 : h;
}

// Heading of the side a → b, in degrees.
export function headingDeg(a, b) {
  return normaliseHeading((Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI);
}

// Signed turn from one heading to another, in (-180, 180].
export function turnDeg(fromHeading, toHeading) {
  let t = (toHeading - fromHeading) % 360;
  if (t <= -180) t += 360;
  else if (t > 180) t -= 360;
  return t;
}

export function isMultipleOf(angle, step) {
  const residue = angle - step * Math.round(angle / step);
  return Math.abs(residue) < ANGLE_EPS_DEG;
}

function isReverseTurn(turn) {
  return Math.abs(Math.abs(turn) - 180) < ANGLE_EPS_DEG;
}

// The snapped heading for a pointer at `rawHeading`: the nearest multiple of
// `step` from `base`, never a straight reversal when `excludeReverse`, and
// `currentHeading` kept while the pointer is not clearly nearer another.
// Distances are always wrapped turns — a raw difference of headings would have
// no hysteresis across the 0°/360° seam.
export function snapHeading({
  rawHeading,
  base,
  step,
  excludeReverse,
  currentHeading
}) {
  const offset = turnDeg(base, rawHeading);
  let k = Math.round(offset / step);
  if (excludeReverse && isReverseTurn(turnDeg(base, base + k * step))) {
    const below = Math.abs(turnDeg(base + (k - 1) * step, rawHeading));
    const above = Math.abs(turnDeg(base + (k + 1) * step, rawHeading));
    k = below <= above ? k - 1 : k + 1;
  }
  const nearest = normaliseHeading(base + k * step);
  if (currentHeading === null || currentHeading === undefined) return nearest;
  const currentTurn = turnDeg(base, currentHeading);
  const admissible =
    isMultipleOf(currentTurn, step) &&
    !(excludeReverse && isReverseTurn(currentTurn));
  if (
    admissible &&
    Math.abs(turnDeg(currentHeading, rawHeading)) <=
      Math.abs(turnDeg(nearest, rawHeading)) + SNAP_HYSTERESIS_FRACTION * step
  ) {
    return normaliseHeading(currentHeading);
  }
  return nearest;
}

// The perpendicular foot of `raw` on the ray from `last` along `heading`,
// clamped to the ray (never behind `last`). Keeps the pointer's height.
export function snapPlacement({ last, raw, heading }) {
  const rad = (heading * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uz = Math.sin(rad);
  const t = Math.max(0, (raw.x - last.x) * ux + (raw.z - last.z) * uz);
  return { x: last.x + t * ux, y: raw.y, z: last.z + t * uz };
}

// Where the last vertex slides to so that both closing corners — at the last
// vertex and at the first — are snapped turns. Returns { point } or
// { refused: true }.
//
// The closing side's heading φ is firstSideHeading − k·step, so the turn at
// the first vertex is k·step. The turn at the last vertex is then
// turn(lastSideHeading, firstSideHeading) − k·step, so both are multiples
// exactly when that turn is — checked once up front; sides drawn at another
// step, or unsnapped, can fail it.
//
// Of the candidates (closingCandidates), the one that moves the last vertex
// least wins, validated lazily in that order: the new sliding side and the new
// closing side must cross no other side, and the ring must enclose a region.
export function closingAdjustment({ vertices, step, minSpacing }) {
  const found = closingCandidates({ vertices, step, minSpacing });
  if (!found) return { refused: true };
  const n = vertices.length;
  const sideStart = vertices[n - 2];
  const first = vertices[0];
  // Every committed side except the last, which the sliding side replaces:
  // when the slide shortens it, the new point lies on the old side, and
  // counting that would refuse a correct close on a rounding residue.
  const crossesKeptSide = (a, b) => {
    for (let i = 0; i < n - 2; i++) {
      if (segmentsIntersectXZ(a, b, vertices[i], vertices[i + 1])) return true;
    }
    return false;
  };
  for (const { distance } of found.candidates) {
    const point = {
      x: sideStart.x + distance * found.direction.x,
      y: vertices[n - 1].y,
      z: sideStart.z + distance * found.direction.z
    };
    if (crossesKeptSide(sideStart, point) || crossesKeptSide(point, first)) {
      continue;
    }
    if (!ringEnclosesArea(vertices.slice(0, n - 1).concat([point]))) continue;
    return { point };
  }
  return { refused: true };
}

// The positions the last vertex could slide to, least movement first (ties
// to the smaller turn at the first vertex), before any crossing or area test:
// { direction, candidates: [{ distance, firstTurnSteps, move }] }, where a
// candidate's point is the last side's start plus `distance` along the unit
// `direction` of that side, and `move` (the sort key) is how far the last
// vertex travels. Null when no close can be snapped at all.
function closingCandidates({ vertices, step, minSpacing }) {
  const n = vertices.length;
  if (n < 3) return null;
  const sideStart = vertices[n - 2]; // the last side runs sideStart → sideEnd
  const sideEnd = vertices[n - 1];
  const first = vertices[0];
  const second = vertices[1];

  const sideLength = Math.hypot(
    sideEnd.x - sideStart.x,
    sideEnd.z - sideStart.z
  );
  if (sideLength < LENGTH_EPS) return null;
  const direction = {
    x: (sideEnd.x - sideStart.x) / sideLength,
    z: (sideEnd.z - sideStart.z) / sideLength
  };
  const lastSideHeading = headingDeg(sideStart, sideEnd);
  const firstSideHeading = headingDeg(first, second);
  if (!isMultipleOf(turnDeg(lastSideHeading, firstSideHeading), step)) {
    return null;
  }

  // From the last side's start to the first vertex.
  const toFirstX = first.x - sideStart.x;
  const toFirstZ = first.z - sideStart.z;
  const half = 180 / step; // every admissible step divides 180
  const candidates = [];
  for (let k = 1 - half; k <= half; k++) {
    // A 0° turn at the first vertex makes it a straight-through point, and a
    // 180° turn puts the closing side back along the first side. The second is
    // load-bearing: the overlap shares the first vertex with the first side, so
    // the edge test does not count it, and the remaining touch is caught only
    // when rounding happens to land the point exactly on that line.
    if (k === 0 || k === half) continue;
    const closingHeading = firstSideHeading - k * step;
    // The same two turns at the last vertex make the closing side parallel to
    // the sliding side: there is no intersection to slide to.
    if (isMultipleOf(turnDeg(lastSideHeading, closingHeading), 180)) continue;
    const rad = (closingHeading * Math.PI) / 180;
    const closingX = Math.cos(rad);
    const closingZ = Math.sin(rad);
    // sideStart + distance·direction = first − closingLength·closing, solved
    // for the signed distance along the last side and the closing side's
    // signed length.
    const det = direction.x * closingZ - direction.z * closingX;
    if (Math.abs(det) < LENGTH_EPS) continue;
    const distance = (toFirstX * closingZ - toFirstZ * closingX) / det;
    const closingLength =
      (direction.x * toFirstZ - direction.z * toFirstX) / det;
    // Signed distance: a negative one would run the last side backwards,
    // changing the corner behind it. (Testing |closingLength| instead changes
    // nothing: each negative one is the same point as its twin at +180°.)
    if (distance < minSpacing || closingLength < minSpacing) continue;
    candidates.push({
      distance,
      firstTurnSteps: k,
      move: Math.abs(distance - sideLength)
    });
  }
  candidates.sort(
    (a, b) =>
      a.move - b.move || Math.abs(a.firstTurnSteps) - Math.abs(b.firstTurnSteps)
  );
  return { direction, candidates };
}
