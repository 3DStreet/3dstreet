/* global THREE */

// Pure measurement helpers shared by the shape draw tool, the on-canvas
// readout layer, and the shape sidebar. All angle work is done on the x/z
// plan-view projection of the vertices (the shape roadmap's KD-12 basis), so
// results stay correct if per-vertex height is added later. No THREE objects
// are retained between calls beyond short-lived scratch vectors.

const EPS_LENGTH = 1e-4; // metres — below this a segment has no direction

// Straight-line 3D distance between two positions. On the y=0 ground plane
// (where the draw tool places vertices) this is the ground distance.
export function segmentLength(a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

// Included angle at vertex v between segments (u->v) and (v->w), in DEGREES,
// measured in the x/z plane. Returns null for a degenerate corner (either
// adjacent segment is zero-length in x/z) so callers suppress the readout
// rather than render NaN. Range 0..180: a straight continuation reads 180, a
// full doubling-back reads 0.
export function includedAngleDeg(u, v, w) {
  const ax = u.x - v.x;
  const az = u.z - v.z;
  const bx = w.x - v.x;
  const bz = w.z - v.z;
  const la = Math.hypot(ax, az);
  const lb = Math.hypot(bx, bz);
  if (la < EPS_LENGTH || lb < EPS_LENGTH) return null;
  // clamp is mandatory: float error pushes the cosine slightly outside
  // [-1, 1] for near-collinear segments and acos would return NaN.
  const cos = Math.max(-1, Math.min(1, (ax * bx + az * bz) / (la * lb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

// Unit direction, in the x/z plane, that bisects the corner at v — points into
// the interior of the angle, used to place the angle label just outside the
// arc. Falls back to a segment-perpendicular for the straight (≈180°) case
// where the two directions cancel. Returns a THREE.Vector3 (y = 0).
export function angleLabelDir(u, v, w) {
  const a = new THREE.Vector3(u.x - v.x, 0, u.z - v.z);
  const b = new THREE.Vector3(w.x - v.x, 0, w.z - v.z);
  if (a.lengthSq() < EPS_LENGTH || b.lengthSq() < EPS_LENGTH) {
    return new THREE.Vector3(1, 0, 0);
  }
  a.normalize();
  b.normalize();
  const bisector = a.clone().add(b);
  if (bisector.lengthSq() < 1e-6) {
    // straight corner: a ≈ -b. Use a perpendicular in the x/z plane.
    return new THREE.Vector3(-a.z, 0, a.x);
  }
  return bisector.normalize();
}

// Perpendicular distance (in x/z) from point p to the segment a->b, plus the
// clamped parameter t. Used by the hover-readout mode to find the segment
// nearest the cursor on a large shape.
export function distanceToSegmentXZ(p, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const apx = p.x - a.x;
  const apz = p.z - a.z;
  const abLenSq = abx * abx + abz * abz;
  let t = abLenSq > 0 ? (apx * abx + apz * abz) / abLenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = a.x + t * abx;
  const cz = a.z + t * abz;
  return { distance: Math.hypot(p.x - cx, p.z - cz), t };
}

// Format a length (metres) per the units preference, matching measure-line's
// two-decimal convention.
export function formatLength(meters, unitsPreference) {
  if (unitsPreference === 'imperial') {
    return `${(meters * 3.28084).toFixed(2)}ft`;
  }
  return `${meters.toFixed(2)}m`;
}

// Angle label. A degree glyph is included here for the DOM/CSS2D label path
// (HTML renders "°" directly); the in-scene arc geometry is drawn separately.
export function formatAngle(deg) {
  return `${Math.round(deg)}°`;
}

// Area label (m² → the units preference). Matches formatLength's two-decimal
// convention; ft² = m² × 3.28084². The shape component has its own inline copy
// for its always-on label (core must not import editor/lib); this serves the
// editor sidebar's Area row.
export function formatArea(m2, unitsPreference) {
  if (unitsPreference === 'imperial') {
    return `${(m2 * 10.7639).toFixed(2)}ft²`;
  }
  return `${m2.toFixed(2)}m²`;
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
// merely share an endpoint do NOT (the draw tool tests only NON-adjacent
// edges, but this keeps the primitive robust when it does not). Used to reject
// a self-intersecting placement at draw time so every committed ring is simple.
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
