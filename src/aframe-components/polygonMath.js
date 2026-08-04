// Pure polygon math on the x/z plan-view projection, shared by the `shape`
// component (runtime) and its unit tests. Deliberately dependency-free — no
// THREE, no A-Frame, no store — so it can be imported headlessly (shape.js
// itself registers A-Frame components and imports the store at module load, so
// it cannot be imported into a plain test). Inputs are arrays of vertex-like
// objects with numeric `x` and `z`; `y` is ignored (the shape is planar).

const EPS_AREA = 1e-9; // m² of signed area below which a ring is degenerate

// Enclosed area (m²) of the polygon's x/z footprint, via the shoelace formula
// with Math.abs — winding-independent (CW and CCW report the same magnitude),
// correct for concave rings, and never NaN for finite input. < 3 vertices has
// no enclosed area → 0.
export function polygonAreaXZ(points) {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) * 0.5;
}

// Area-weighted centroid ({x, z}) of the polygon's x/z footprint. Uses the
// SIGNED area (its sign must match the moment sum's, so do NOT abs here). For a
// degenerate ring (< 3 vertices, or |signed area| below EPS — collinear /
// zero-area) it falls back to the arithmetic mean of the vertices, which never
// divides by zero. May fall OUTSIDE a strongly concave ring — that is accepted
// (robust in-polygon placement is deferred).
export function polygonCentroidXZ(points) {
  const n = points.length;
  if (n === 0) return { x: 0, z: 0 };
  if (n < 3) return meanXZ(points);
  let signedArea = 0;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const cross = a.x * b.z - b.x * a.z;
    signedArea += cross;
    cx += (a.x + b.x) * cross;
    cz += (a.z + b.z) * cross;
  }
  signedArea *= 0.5;
  if (Math.abs(signedArea) < EPS_AREA) return meanXZ(points);
  const k = 1 / (6 * signedArea);
  // Clamp to the vertices' x/z bounding box. For a near-degenerate (but
  // above-threshold) sliver, k blows up and the raw centroid can land far off
  // the shape; clamping keeps the area label on/near the polygon for any pose.
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return {
    x: Math.max(minX, Math.min(maxX, cx * k)),
    z: Math.max(minZ, Math.min(maxZ, cz * k))
  };
}

// Orientation of the ordered triple (a, b, c) in the x/z plane: >0 CCW, <0 CW,
// 0 collinear.
function orientationXZ(a, b, c) {
  return (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
}

// True iff point q lies on segment p-r (assuming the three are collinear).
function onSegmentXZ(p, q, r) {
  return (
    Math.min(p.x, r.x) <= q.x &&
    q.x <= Math.max(p.x, r.x) &&
    Math.min(p.z, r.z) <= q.z &&
    q.z <= Math.max(p.z, r.z)
  );
}

// Do segments p1-p2 and p3-p4 cross, in the x/z plane? A PROPER crossing
// (interiors intersect) OR a collinear overlap counts as true; segments that
// merely share an endpoint do NOT (callers commonly test only NON-adjacent
// edges, but this keeps the primitive robust when they do not).
export function segmentsIntersectXZ(p1, p2, p3, p4) {
  const d1 = orientationXZ(p3, p4, p1);
  const d2 = orientationXZ(p3, p4, p2);
  const d3 = orientationXZ(p1, p2, p3);
  const d4 = orientationXZ(p1, p2, p4);

  // General case: each segment straddles the line through the other.
  if (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  ) {
    // A shared endpoint is a touch, not a crossing — exclude it so adjacent
    // ring edges never read as intersecting.
    if (sharesEndpoint(p1, p2, p3, p4)) return false;
    return true;
  }

  // Collinear overlap (a degenerate self-touch) — reject too, unless it is only
  // the shared-endpoint touch of adjacent edges.
  if (d1 === 0 && onSegmentXZ(p3, p1, p4) && !sharesEndpoint(p1, p2, p3, p4)) {
    return true;
  }
  if (d2 === 0 && onSegmentXZ(p3, p2, p4) && !sharesEndpoint(p1, p2, p3, p4)) {
    return true;
  }
  if (d3 === 0 && onSegmentXZ(p1, p3, p2) && !sharesEndpoint(p1, p2, p3, p4)) {
    return true;
  }
  if (d4 === 0 && onSegmentXZ(p1, p4, p2) && !sharesEndpoint(p1, p2, p3, p4)) {
    return true;
  }
  return false;
}

const ENDPOINT_EPS = 1e-6;
function samePointXZ(a, b) {
  return (
    Math.abs(a.x - b.x) < ENDPOINT_EPS && Math.abs(a.z - b.z) < ENDPOINT_EPS
  );
}
function sharesEndpoint(p1, p2, p3, p4) {
  return (
    samePointXZ(p1, p3) ||
    samePointXZ(p1, p4) ||
    samePointXZ(p2, p3) ||
    samePointXZ(p2, p4)
  );
}

// Is the closed ring through `points` (in order, wrapping last→first) NOT
// simple — i.e. does any pair of NON-ADJACENT edges cross or overlap? Adjacent
// edges always share an endpoint, which segmentsIntersectXZ excludes anyway;
// skipping them keeps the intent explicit. The wrap edge (n-1 → 0) is adjacent
// to both edge 0 and edge n-2.
//
// O(n²), run inside the shape's re-derive: a self-crossing ring has no
// well-defined interior, so the triangulated fill and the shoelace area are
// both meaningless and the component suppresses them. Fewer than 4 vertices
// cannot self-intersect (every edge pair is adjacent) → false.
export function ringSelfIntersects(points) {
  const n = points.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    // Start at i+2 (skip the adjacent next edge); stop before the edge that
    // wraps round to i, which is adjacent on the other side.
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // wrap edge is adjacent to edge 0
      const c = points[j];
      const d = points[(j + 1) % n];
      if (segmentsIntersectXZ(a, b, c, d)) return true;
    }
  }
  return false;
}

function meanXZ(points) {
  let x = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    z += p.z;
  }
  const inv = 1 / points.length;
  return { x: x * inv, z: z * inv };
}
