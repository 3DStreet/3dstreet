/**
 * Owned centerline codec + helpers for managed streets (#1930 pillar 1).
 *
 * `managed-street.points` carries the street's centerline control points
 * INLINE, in street-local meters, as one string:
 *
 *   "x y z, x y z, x y z"
 *
 * (comma-separated points, whitespace-separated coordinates, at most three
 * decimals). Empty = a classic straight street, whose centerline is the
 * 2-point degenerate case derived from `length` + `street-align` (see
 * street-nodes-utils.js). With ≥2 points the street bends along the curve
 * built from them (`curveType` / `filletRadius` / `closed` live on the
 * street too, the same options `shape` uses). A drawn shape is now only an
 * authoring tool: assigning one COPIES its vertices in (see
 * `shapeVerticesToStreetPoints`), so the street owns its geometry, moves
 * and rotates with its own transform, and survives the shape being edited
 * or deleted.
 *
 * Pure (no AFRAME/THREE/DOM); unit-tested in test/editor/streetCenterline.test.js.
 */

const PRECISION = 3;

function fmt(n) {
  const v = Number(n) || 0;
  // Trim trailing zeros so "10.000" writes as "10" and "-0" as "0".
  const s = v.toFixed(PRECISION).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/**
 * @param {Array<{x:number,y?:number,z:number}>} points
 * @returns {string} the `points` property value ('' for fewer than 2 points)
 */
export function formatCenterlinePoints(points) {
  if (!Array.isArray(points) || points.length < 2) return '';
  return points
    .map((p) => `${fmt(p.x)} ${fmt(p.y ?? 0)} ${fmt(p.z)}`)
    .join(', ');
}

/**
 * Parse a `points` value. Tolerates "x z" pairs (y = 0), surrounding
 * whitespace and a trailing separator; anything malformed yields [] so a
 * bad string reads as "straight" rather than throwing mid-init.
 * @param {string} str
 * @returns {Array<{x:number,y:number,z:number}>}
 */
export function parseCenterlinePoints(str) {
  if (!str || typeof str !== 'string') return [];
  const out = [];
  for (const chunk of str.split(',')) {
    const parts = chunk.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) continue;
    const nums = parts.map(Number);
    if (nums.some((n) => !Number.isFinite(n))) return [];
    if (nums.length === 3) {
      out.push({ x: nums[0], y: nums[1], z: nums[2] });
    } else if (nums.length === 2) {
      out.push({ x: nums[0], y: 0, z: nums[1] });
    } else {
      return [];
    }
  }
  return out.length >= 2 ? out : [];
}

/** True when a `points` value describes a curved (owned-centerline) street. */
export function hasCenterlinePoints(str) {
  return parseCenterlinePoints(str).length >= 2;
}

/**
 * A-Frame yaw (degrees about +Y) applied to a vector: the rotation that
 * takes a street-local vector into its parent's space.
 */
export function rotateY(v, yawDeg) {
  const t = (yawDeg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

/**
 * Express points given in a street's PARENT space in the street's local
 * space, for an upright street (rotation about Y only, no scale).
 * @param {Array<{x,y,z}>} parentPoints
 * @param {{x,y,z}} streetPosition
 * @param {number} streetYawDeg
 */
export function parentPointsToStreetLocal(
  parentPoints,
  streetPosition,
  streetYawDeg
) {
  return parentPoints.map((p) =>
    rotateY(
      {
        x: p.x - streetPosition.x,
        y: (p.y ?? 0) - (streetPosition.y ?? 0),
        z: p.z - streetPosition.z
      },
      -streetYawDeg
    )
  );
}

/**
 * Where a street entity should sit so that its points are centered: the
 * centroid of the control points (the OSM generate convention — the street
 * origin lands mid-way along its own centerline, which is what
 * origin-centered scene systems expect).
 */
export function centroidOf(points) {
  const c = { x: 0, y: 0, z: 0 };
  if (!points.length) return c;
  for (const p of points) {
    c.x += p.x;
    c.y += p.y ?? 0;
    c.z += p.z;
  }
  c.x /= points.length;
  c.y /= points.length;
  c.z /= points.length;
  return c;
}

/** Points re-expressed relative to `origin`. */
export function pointsRelativeTo(points, origin) {
  return points.map((p) => ({
    x: p.x - origin.x,
    y: (p.y ?? 0) - (origin.y ?? 0),
    z: p.z - origin.z
  }));
}

/** Straight-line length of the control polygon (a cheap curve-length proxy). */
export function polylineLength(points, closed = false) {
  let L = 0;
  const n = points.length;
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    L += Math.hypot(b.x - a.x, (b.y ?? 0) - (a.y ?? 0), b.z - a.z);
  }
  return L;
}
