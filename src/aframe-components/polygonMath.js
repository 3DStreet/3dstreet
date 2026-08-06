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

// Dimensionless. See ringEnclosesArea for where the value comes from.
const MIN_ENCLOSED_AREA_RATIO = 1e-9;

// Does this ring enclose a region at all, as opposed to being a line, a spur or
// a boundary that folds back exactly onto itself?
//
// NOT the same question as ringSelfIntersects, which asks whether the boundary
// CROSSES itself. A collinear ring crosses itself nowhere and encloses nothing;
// a ring pinched to a point — say A(0,0) B(10,0) C(10,10) D(5,0), where D sits
// on the non-adjacent edge A→B — encloses a perfectly good 25 m² region and
// still crosses itself. Both are invalid, for different reasons, and one
// predicate cannot answer for both. (A bow-tie happens to score zero here too,
// because its two lobes have opposite winding and cancel in the shoelace sum —
// a coincidence, not a reason to think one test covers the other.)
//
// Fill, area and extrusion need this one. THREE's triangulator does not throw
// and does not produce NaN on a ring with no interior: it silently returns
// FEWER cap triangles than the ring has regions — one for the pinched quad
// above, zero for a fully collinear ring — so an extruded degenerate shape gets
// complete side walls around nothing, with no error anywhere downstream to
// trace it by. The precondition has to be checked here because nothing further
// on will notice it was violated.
//
// The threshold is a RATIO, not an area. Area scales as length squared, so a
// fixed epsilon means something different on a 10 m shape than on a 5 cm one:
// the same relative degeneracy passes at one scale and fails at the other.
// Normalising by the ring's own perimeter squared makes the test dimensionless
// and therefore scale-free. (Bounding-box area is the other obvious normaliser
// and is rejected: a collinear ring has a ZERO-area bounding box, so the ratio
// is 0/0 exactly on the family the predicate exists to catch.)
//
// 1e-9 sits far below anything drawable — about 80 nm of height on a 10 m ring
// — and comfortably above the shoelace sum's own float noise on an exactly
// collinear ring. That margin assumes SHAPE-LOCAL coordinates, which is what
// the shape's own vertices are: the noise grows with distance from the origin,
// so a caller handing this world coordinates hundreds of kilometres out would
// erode it until degenerate rings started passing.
export function ringEnclosesArea(points) {
  if (points.length < 3) return false;
  let perimeter = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    perimeter += Math.hypot(b.x - a.x, b.z - a.z);
  }
  if (perimeter === 0) return false;
  return polygonAreaXZ(points) > MIN_ENCLOSED_AREA_RATIO * perimeter * perimeter;
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
