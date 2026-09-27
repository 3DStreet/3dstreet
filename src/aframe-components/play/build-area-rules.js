/**
 * Pure rules for `build-area` (visitor building on a closed shape). No
 * A-Frame or three imports so they are unit-testable and shared by the
 * A-Frame system, the viewer palette dock and the author's sidebar.
 */

/**
 * Parse the schema's comma-separated `palette` string into unique,
 * trimmed mixin ids, in author order.
 * @param {string} value
 * @returns {string[]}
 */
export function parsePalette(value) {
  if (typeof value !== 'string' || !value.trim()) return [];
  const seen = new Set();
  const ids = [];
  for (const raw of value.split(',')) {
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/** Inverse of parsePalette: the string the schema stores. */
export function serializePalette(ids) {
  return parsePalette((ids || []).join(',')).join(',');
}

/**
 * Whether one more object may be placed in an area holding `count`
 * visitor objects. `maxObjects` <= 0 means unlimited.
 */
export function canPlace(count, maxObjects) {
  if (!Number.isFinite(maxObjects) || maxObjects <= 0) return true;
  return count < maxObjects;
}

/**
 * Even-odd point-in-polygon test on the XZ plane. `ring` is an array of
 * {x, z} (any extra keys ignored); the closing edge is implied. A ring
 * with fewer than three vertices encloses nothing.
 */
export function pointInRingXZ(point, ring) {
  if (!point || !Array.isArray(ring) || ring.length < 3) return false;
  const px = point.x;
  const pz = point.z;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x;
    const zi = ring[i].z;
    const xj = ring[j].x;
    const zj = ring[j].z;
    const crosses = zi > pz !== zj > pz;
    if (!crosses) continue;
    const xAtZ = ((xj - xi) * (pz - zi)) / (zj - zi) + xi;
    if (px < xAtZ) inside = !inside;
  }
  return inside;
}

/**
 * Union of the enabled areas' palettes, first-seen order, so one dock
 * serves every build area in the scene.
 * @param {Array<{enabled: boolean, palette: string}>} areas component data
 */
export function mergePalettes(areas) {
  const merged = [];
  const seen = new Set();
  for (const area of areas || []) {
    if (!area || area.enabled === false) continue;
    for (const id of parsePalette(area.palette)) {
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
    }
  }
  return merged;
}

/**
 * Footprint radius (XZ) of a model from its bounds ({min, max} in model
 * space, as src/model-bounds.js returns), scaled; `fallback` when unknown.
 */
export function footprintRadius(bounds, scale = 1, fallback = 0.75) {
  if (!bounds || !bounds.min || !bounds.max) return fallback;
  const halfX = (bounds.max[0] - bounds.min[0]) / 2;
  const halfZ = (bounds.max[2] - bounds.min[2]) / 2;
  const r = Math.max(halfX, halfZ) * scale;
  return Number.isFinite(r) && r > 0 ? r : fallback;
}

/**
 * Tap-to-place spot (no drop point): the free point nearest `start` inside
 * `ring` where an object of `radius` does not overlap any `occupied`
 * ({x, z, r}) object. Searched on rings of candidates spreading out from
 * `start`, so repeated taps fan out beside the previous object instead of
 * stacking on it. Returns {x, z}, or null when no free spot inside the ring
 * is found within `maxRings` (the caller falls back to `start`).
 */
export function findFreeSpotXZ(
  start,
  ring,
  occupied,
  radius,
  { gap = 0.25, maxRings = 12 } = {}
) {
  const fits = (x, z) => {
    if (!pointInRingXZ({ x, z }, ring)) return false;
    for (const o of occupied || []) {
      const min = radius + (o.r || 0) + gap;
      if ((x - o.x) ** 2 + (z - o.z) ** 2 < min * min) return false;
    }
    return true;
  };
  if (fits(start.x, start.z)) return { x: start.x, z: start.z };
  const step = Math.max(radius * 2 + gap, 0.5);
  for (let k = 1; k <= maxRings; k++) {
    const dist = k * step;
    const count = Math.max(8, Math.round((2 * Math.PI * dist) / step));
    let best = null;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const x = start.x + Math.cos(a) * dist;
      const z = start.z + Math.sin(a) * dist;
      if (fits(x, z)) {
        best = { x, z };
        break;
      }
    }
    if (best) return best;
  }
  return null;
}

// Distance from (x, z) to segment a-b on the XZ plane.
function distanceToSegmentXZ(x, z, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len2 = dx * dx + dz * dz;
  const t = len2
    ? Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2))
    : 0;
  return Math.hypot(x - (a.x + t * dx), z - (a.z + t * dz));
}

/**
 * A point guaranteed inside `ring` (XZ), as deep inside as a grid search
 * finds: the inside sample farthest from every edge. For a convex ring it
 * lands near the centre; for an L- or U-shaped ring, whose corner-average
 * can fall in the notch outside the shape, it lands in the widest arm.
 * Returns {x, z}, or null for a degenerate ring.
 */
export function interiorPointXZ(ring, samples = 24) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of ring) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }
  let best = null;
  let bestDepth = -1;
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const x = minX + ((i + 0.5) / samples) * (maxX - minX);
      const z = minZ + ((j + 0.5) / samples) * (maxZ - minZ);
      if (!pointInRingXZ({ x, z }, ring)) continue;
      let depth = Infinity;
      for (let k = 0, m = ring.length - 1; k < ring.length; m = k++) {
        depth = Math.min(depth, distanceToSegmentXZ(x, z, ring[m], ring[k]));
      }
      if (depth > bestDepth) {
        bestDepth = depth;
        best = { x, z };
      }
    }
  }
  return best;
}
