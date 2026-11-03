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

const EPS_LENGTH = 1e-9;

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
// The closing side's heading φ is h1 − k·step, where h1 is the first side's
// heading, so the turn at the first vertex is k·step. The turn at the last
// vertex is then turn(hd, h1) − k·step (hd = the last side's heading), so both
// are multiples exactly when turn(hd, h1) is — checked once up front; sides
// drawn at another step, or unsnapped, can fail it.
//
// Of the candidates, the one that moves the last vertex least wins (ties to
// the smaller turn at the first vertex), validated lazily in that order.
export function closingAdjustment({ vertices, step, minSpacing }) {
  const n = vertices.length;
  if (n < 3) return { refused: true };
  const vPrev = vertices[n - 2];
  const vLast = vertices[n - 1];
  const v0 = vertices[0];
  const v1 = vertices[1];

  const lastLen = Math.hypot(vLast.x - vPrev.x, vLast.z - vPrev.z);
  if (lastLen < EPS_LENGTH) return { refused: true };
  const dx = (vLast.x - vPrev.x) / lastLen;
  const dz = (vLast.z - vPrev.z) / lastLen;
  const hd = headingDeg(vPrev, vLast);
  const h1 = headingDeg(v0, v1);
  if (!isMultipleOf(turnDeg(hd, h1), step)) return { refused: true };

  // Where the last vertex is now, as a distance along its own side.
  const tOriginal = lastLen;
  const wx = v0.x - vPrev.x;
  const wz = v0.z - vPrev.z;

  const half = 180 / step; // every admissible step divides 180
  const candidates = [];
  for (let k = 1 - half; k <= half; k++) {
    // A 0° turn at the first vertex makes it a straight-through point, and a
    // 180° turn puts the closing side back along the first side. The second is
    // load-bearing: the overlap shares the first vertex with the first side, so
    // the edge test does not count it, and the remaining touch is caught only
    // when rounding happens to land the point exactly on that line.
    if (k === 0 || k === half) continue;
    const phi = h1 - k * step;
    // The same two turns at the last vertex make the closing side parallel to
    // the sliding side: there is no intersection to slide to.
    if (isMultipleOf(turnDeg(hd, phi), 180)) continue;
    const rad = (phi * Math.PI) / 180;
    const cx = Math.cos(rad);
    const cz = Math.sin(rad);
    // vPrev + t·d = v0 − s·c, solved for the signed parameters t and s.
    const det = dx * cz - dz * cx;
    if (Math.abs(det) < EPS_LENGTH) continue;
    const t = (wx * cz - wz * cx) / det;
    const s = (dx * wz - dz * wx) / det;
    // Signed t: a negative t would run the sliding side backwards, changing
    // the corner behind it. (Testing |s| instead of s changes nothing: each
    // negative-s candidate is the same point as its twin at φ + 180°.)
    if (t < minSpacing || s < minSpacing) continue;
    candidates.push({ k, t, move: Math.abs(t - tOriginal) });
  }
  candidates.sort((a, b) => a.move - b.move || Math.abs(a.k) - Math.abs(b.k));

  // Every committed side except the last, which the sliding side replaces:
  // when the slide shortens it, the new point lies on the old side, and
  // counting that would refuse a correct close on a rounding residue.
  const kept = [];
  for (let i = 0; i < n - 2; i++) kept.push([vertices[i], vertices[i + 1]]);
  const crossesKept = (a, b) =>
    kept.some(([c, d]) => segmentsIntersectXZ(a, b, c, d));

  for (const { t } of candidates) {
    const point = { x: vPrev.x + t * dx, y: vLast.y, z: vPrev.z + t * dz };
    if (crossesKept(vPrev, point) || crossesKept(point, v0)) continue;
    const ring = vertices.slice(0, n - 1).concat([point]);
    if (!ringEnclosesArea(ring)) continue;
    return { point };
  }
  return { refused: true };
}
