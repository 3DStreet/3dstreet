/**
 * Street nodes and longitudinal spans — the shared endpoint math for managed
 * streets (#1930 phase 0).
 *
 * A managed street lays its content out in straight space: x across the
 * street (lateral offsets assigned by street-align), z along it, with local
 * +Z running start → end. Where the street's two END NODES sit in that space
 * depends only on `managed-street.length` and the `street-align` values:
 *
 *   length 'start'  → z in [-L, 0]        width 'center' → centerline x = 0
 *   length 'middle' → z in [-L/2, +L/2]   width 'left'   → centerline x = +W/2
 *   length 'end'    → z in [0, +L]        width 'right'  → centerline x = -W/2
 *
 * This module is the ONE place that math lives. Before it, the endpoint
 * gizmo, managed-street's curve zStart, and managed-intersection's arm
 * collection each re-derived it — with drifting defaults. Consumers:
 *
 * - `getStreetNodes` / `endpointLocalZ` / `centerlineX` — straight-street
 *   nodes in street-local space (the gizmo, intersections, the graph).
 * - `zStartForAlign` — where straight-space z = 0 of the street's arc-length
 *   parameterization sits (s = z - zStart; the curved-street mapping).
 * - `getLongitudinalSpan` — the z extent a segment-local generator fills.
 *   Segments are centered on their own origin (z ∈ [-L/2, +L/2]); the
 *   generators used to hardcode ±L/2. Insets are the render-time hook of
 *   #1930 pillar 2: an intersection occupying a node will shorten the span
 *   without touching the street's stored length. Today every caller passes
 *   zero insets.
 *
 * Pure (no AFRAME/THREE/DOM); unit-tested in test/editor/streetNodesUtils.test.js.
 */

export const LENGTH_ALIGNS = ['middle', 'start', 'end'];
export const WIDTH_ALIGNS = ['center', 'left', 'right'];

/** Default alignment values, mirroring the street-align schema. */
export const DEFAULT_LENGTH_ALIGN = 'middle';
export const DEFAULT_WIDTH_ALIGN = 'center';

function normalizeLengthAlign(lengthAlign) {
  return LENGTH_ALIGNS.includes(lengthAlign)
    ? lengthAlign
    : DEFAULT_LENGTH_ALIGN;
}

function normalizeWidthAlign(widthAlign) {
  return WIDTH_ALIGNS.includes(widthAlign) ? widthAlign : DEFAULT_WIDTH_ALIGN;
}

/**
 * Street-local z of the start node (s = 0 of the street's arc length).
 * @param {number} length
 * @param {string} [lengthAlign] 'middle' | 'start' | 'end'
 */
export function zStartForAlign(length, lengthAlign) {
  const L = Number(length) || 0;
  switch (normalizeLengthAlign(lengthAlign)) {
    case 'start':
      return L === 0 ? 0 : -L;
    case 'end':
      return 0;
    default:
      return L === 0 ? 0 : -L / 2;
  }
}

/**
 * Street-local z of both end nodes.
 * @returns {{ start: number, end: number }}
 */
export function endpointLocalZ(length, lengthAlign) {
  const start = zStartForAlign(length, lengthAlign);
  return { start, end: start + (Number(length) || 0) };
}

/**
 * Street-local x of the centerline for a travelled way `totalWidth` wide.
 * street-align's width alignment puts the travelled way's center at 0
 * ('center'), the street entity origin at its left edge ('left', so the
 * centerline is at +W/2), or at its right edge ('right', centerline -W/2).
 */
export function centerlineX(totalWidth, widthAlign) {
  const W = Number(totalWidth) || 0;
  switch (normalizeWidthAlign(widthAlign)) {
    case 'left':
      return W / 2;
    case 'right':
      return -W / 2;
    default:
      return 0;
  }
}

/**
 * The two end nodes of a straight managed street in street-local space,
 * with `along` — the unit direction from the node INTO the street body
 * (start +Z, end -Z; the intersection-arm `dir` convention, used by every
 * node consumer) — and the lateral axis (+X) at each node. A straight
 * street is the 2-point degenerate case of the owned centerline: a curved
 * street's nodes come from its curve's end frames instead (see
 * getStreetEndNodesWorld in aframe-components/street-nodes.js).
 *
 * @param {Object} street
 * @param {number} street.length
 * @param {string} [street.lengthAlign]
 * @param {string} [street.widthAlign]
 * @param {number} [street.totalWidth=0] travelled-way width
 * @returns {{ centerX: number, start: Node, end: Node }} where Node is
 *   `{ key, x, z, along: {x, z}, right: {x, z} }`
 */
export function getStreetNodes({
  length,
  lengthAlign,
  widthAlign,
  totalWidth = 0
}) {
  const x = centerlineX(totalWidth, widthAlign);
  const z = endpointLocalZ(length, lengthAlign);
  return {
    centerX: x,
    start: {
      key: 'start',
      x,
      z: z.start,
      along: { x: 0, z: 1 },
      right: { x: 1, z: 0 }
    },
    end: {
      key: 'end',
      x,
      z: z.end,
      along: { x: 0, z: -1 },
      right: { x: 1, z: 0 }
    }
  };
}

/**
 * Segment-local longitudinal extent a generator should fill. Segments are
 * centered on their origin, so the street's start node is at -L/2 and its
 * end node at +L/2 in segment space; insets pull each end inward.
 *
 * @param {number} length segment/street length
 * @param {{ insetStart?: number, insetEnd?: number }} [insets]
 * @returns {{ zStart: number, zEnd: number, length: number }} zStart ≤ zEnd
 *   (never crossed: insets are clamped so the span cannot go negative)
 */
export function getLongitudinalSpan(
  length,
  { insetStart = 0, insetEnd = 0 } = {}
) {
  const L = Math.max(0, Number(length) || 0);
  let a = Math.max(0, Number(insetStart) || 0);
  let b = Math.max(0, Number(insetEnd) || 0);
  if (a + b > L) {
    // both insets claim more than there is: share what's left pro rata
    const scale = a + b > 0 ? L / (a + b) : 0;
    a *= scale;
    b *= scale;
  }
  const zStart = -L / 2 + a;
  const zEnd = L / 2 - b;
  return { zStart, zEnd, length: zEnd - zStart };
}
