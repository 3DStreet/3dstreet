/**
 * Overpass elements → extruded building geometry arrays (#1962 step F).
 *
 * Pure module (no THREE, no DOM) so it runs inside the buildings Web Worker
 * and under node unit tests. Input is the raw `out geom` Overpass response
 * for one tile (ways and multipolygon relations carrying inline lat/lon
 * geometry — no osmtogeojson pass needed); output is transferable indexed
 * geometry: flat roof at the building height plus vertical walls, in the
 * scene frame (x = north meters, y = up, z = east meters — the same frame
 * google3d's legacy reorientation uses).
 *
 * Height heuristics replicate osm4vr's feature2height so the rebuilt layer
 * matches the retired one visually: explicit `height` (feet when quoted
 * with '), else building:levels × 3 m, else roof:height, else a per-type
 * default (churches 20 m, sheds 3 m, …), else min(6 m, perimeter / 5) so
 * tiny footprints don't become towers. `min_height` / building:min_level
 * lift the base (bridges, skyway sections).
 *
 * Tile ownership: a building is emitted only when its outer-ring centroid
 * falls inside the tile's bbox. Adjacent tiles' Overpass queries both
 * return border buildings; the centroid rule partitions them exactly, so
 * unloading a tile never drops a building a neighbor still owns and no
 * building is rendered twice.
 */

import earcutImport from 'earcut';

// earcut ships CJS (module.exports = fn); interop differs between webpack
// and node ESM, so unwrap defensively.
const earcut = earcutImport.default || earcutImport;

import { EQUATOR_M, POLES_M } from './osm-tile-math.js';

const FEET_TO_METER = 0.3048;
export const LEVEL_HEIGHT_M = 3;
export const DEFAULT_BUILDING_HEIGHT_M = 6;

// Per-type height defaults, carried over from osm4vr.
const SMALL = LEVEL_HEIGHT_M;
export const BUILDING_TO_METER = {
  church: 20,
  water_tower: 20,
  bungalow: SMALL,
  cabin: SMALL,
  ger: SMALL,
  houseboat: SMALL,
  static_caravan: SMALL,
  kiosk: SMALL,
  chapel: SMALL,
  shrine: SMALL,
  bakehouse: SMALL,
  toilets: SMALL,
  stable: SMALL,
  boathouse: SMALL,
  hut: SMALL,
  shed: SMALL,
  carport: SMALL,
  garage: SMALL,
  garages: SMALL,
  beach_hut: SMALL,
  container: SMALL,
  guardhouse: SMALL
};

/** "12", "12 m", "40'" (feet) → meters. NaN for unparseable. */
export function heightToMeters(value) {
  const str = String(value);
  const parsed = parseFloat(str);
  return str.indexOf("'") > 0 ? parsed * FEET_TO_METER : parsed;
}

/** Building height in meters from tags; perimeterM feeds the small-footprint default. */
export function tagsToHeight(tags, perimeterM) {
  if (tags.height !== undefined) {
    const h = heightToMeters(tags.height);
    if (Number.isFinite(h)) return h;
  }
  if (tags['building:levels'] !== undefined) {
    const levels = parseInt(tags['building:levels'], 10);
    if (Number.isFinite(levels)) return levels * LEVEL_HEIGHT_M;
  }
  if (tags['roof:height'] !== undefined) {
    const h = heightToMeters(tags['roof:height']);
    if (Number.isFinite(h)) return h;
  }
  if (tags.building in BUILDING_TO_METER) {
    return BUILDING_TO_METER[tags.building];
  }
  return Math.min(DEFAULT_BUILDING_HEIGHT_M, perimeterM / 5);
}

/** Base elevation (m) of the walls — min_height / building:min_level. */
export function tagsToMinHeight(tags) {
  if (tags.min_height !== undefined) {
    const h = heightToMeters(tags.min_height);
    if (Number.isFinite(h)) return h;
  }
  if (tags['building:min_level'] !== undefined) {
    const levels = parseInt(tags['building:min_level'], 10);
    if (Number.isFinite(levels)) return levels * LEVEL_HEIGHT_M;
  }
  return 0;
}

// --- ring helpers (rings are arrays of [east_m, north_m]) ---

function projectRing(geometry, originLat, originLon) {
  const eastPerDeg = (EQUATOR_M * Math.cos((originLat * Math.PI) / 180)) / 360;
  const northPerDeg = POLES_M / 360;
  const ring = geometry.map(({ lat, lon }) => [
    (lon - originLon) * eastPerDeg,
    (lat - originLat) * northPerDeg
  ]);
  // Overpass closes rings (first point repeated); drop the duplicate.
  if (ring.length > 1) {
    const [e0, n0] = ring[0];
    const [e1, n1] = ring[ring.length - 1];
    if (e0 === e1 && n0 === n1) ring.pop();
  }
  return ring;
}

function signedArea(ring) {
  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const [e1, n1] = ring[i];
    const [e2, n2] = ring[(i + 1) % ring.length];
    area += e1 * n2 - e2 * n1;
  }
  return area / 2;
}

function perimeter(ring) {
  let length = 0;
  for (let i = 0; i < ring.length; i++) {
    const [e1, n1] = ring[i];
    const [e2, n2] = ring[(i + 1) % ring.length];
    length += Math.hypot(e2 - e1, n2 - n1);
  }
  return length;
}

function centroid(ring) {
  let e = 0;
  let n = 0;
  for (const [pe, pn] of ring) {
    e += pe;
    n += pn;
  }
  return [e / ring.length, n / ring.length];
}

// --- Overpass element → { outer, holes } footprints ---

function wayFootprint(element) {
  if (!Array.isArray(element.geometry) || element.geometry.length < 4) {
    return null;
  }
  const first = element.geometry[0];
  const last = element.geometry[element.geometry.length - 1];
  // Open ways (fences tagged building=* by mistake, truncated geometry)
  // can't be extruded.
  if (first.lat !== last.lat || first.lon !== last.lon) return null;
  return [{ outerGeometry: element.geometry, innerGeometries: [] }];
}

function relationFootprints(element) {
  if (!Array.isArray(element.members)) return null;
  const outers = [];
  const inners = [];
  for (const member of element.members) {
    if (member.type !== 'way' || !Array.isArray(member.geometry)) continue;
    if (member.role === 'outer') outers.push(member.geometry);
    else if (member.role === 'inner') inners.push(member.geometry);
  }
  if (outers.length === 0) return null;
  // Assign each inner ring to the outer whose bbox contains its first
  // point — earcut does no containment checks, and a stray hole outside
  // its ring corrupts the triangulation.
  return outers.map((outerGeometry) => {
    const bbox = outerGeometry.reduce(
      (b, p) => ({
        s: Math.min(b.s, p.lat),
        w: Math.min(b.w, p.lon),
        n: Math.max(b.n, p.lat),
        e: Math.max(b.e, p.lon)
      }),
      { s: Infinity, w: Infinity, n: -Infinity, e: -Infinity }
    );
    const innerGeometries = inners.filter((inner) => {
      const p = inner[0];
      return (
        p &&
        p.lat >= bbox.s &&
        p.lat <= bbox.n &&
        p.lon >= bbox.w &&
        p.lon <= bbox.e
      );
    });
    return { outerGeometry, innerGeometries };
  });
}

/**
 * Build indexed geometry for one tile.
 *
 * @param {Array} elements Overpass `out geom` elements (ways + relations).
 * @param {Object} options { originLat, originLon, tileBBox } — origin is the
 *   scene's geo anchor; tileBBox ({south, west, north, east}) gates
 *   centroid ownership. Pass tileBBox: null to keep every building.
 * @returns {{ positions: Float32Array, indices: Uint32Array,
 *   buildingCount: number }}
 */
export function buildTileGeometry(
  elements,
  { originLat, originLon, tileBBox }
) {
  const positions = [];
  const indices = [];
  let buildingCount = 0;

  const eastPerDeg = (EQUATOR_M * Math.cos((originLat * Math.PI) / 180)) / 360;
  const northPerDeg = POLES_M / 360;
  const bboxEN = tileBBox
    ? {
        minE: (tileBBox.west - originLon) * eastPerDeg,
        maxE: (tileBBox.east - originLon) * eastPerDeg,
        minN: (tileBBox.south - originLat) * northPerDeg,
        maxN: (tileBBox.north - originLat) * northPerDeg
      }
    : null;

  // (east, north, height) → scene frame (x = north, y = up, z = east).
  const pushVertex = (e, n, y) => {
    positions.push(n, y, e);
    return positions.length / 3 - 1;
  };

  for (const element of elements || []) {
    const tags = element.tags || {};
    // building:part needs outline-suppression logic to avoid double
    // rendering; the retired layer's parts support was best-effort and we
    // deliberately render outlines only.
    if (!tags.building) continue;

    let footprints = null;
    if (element.type === 'way') footprints = wayFootprint(element);
    else if (element.type === 'relation') {
      footprints = relationFootprints(element);
    }
    if (!footprints) continue;

    for (const footprint of footprints) {
      const outer = projectRing(footprint.outerGeometry, originLat, originLon);
      if (outer.length < 3) continue;

      // Centroid ownership: exactly one tile emits each border building.
      if (bboxEN) {
        const [ce, cn] = centroid(outer);
        if (
          ce < bboxEN.minE ||
          ce >= bboxEN.maxE ||
          cn < bboxEN.minN ||
          cn >= bboxEN.maxN
        ) {
          continue;
        }
      }

      // Normalize winding: outer CCW, holes CW. With the (e,n) → (z,x)
      // mapping this makes earcut's roof triangles face +y and the wall
      // quads face outward (see the wall loop below).
      if (signedArea(outer) < 0) outer.reverse();
      const holes = footprint.innerGeometries
        .map((g) => projectRing(g, originLat, originLon))
        .filter((ring) => ring.length >= 3);
      for (const hole of holes) {
        if (signedArea(hole) > 0) hole.reverse();
      }

      const height = tagsToHeight(tags, perimeter(outer));
      const minHeight = tagsToMinHeight(tags);
      if (!(height > minHeight)) continue;

      // Flatten rings for earcut: [e0, n0, e1, n1, ...] + hole start indices.
      const flat = [];
      const holeIndices = [];
      for (const [e, n] of outer) flat.push(e, n);
      for (const hole of holes) {
        holeIndices.push(flat.length / 2);
        for (const [e, n] of hole) flat.push(e, n);
      }

      const roofTriangles = earcut(
        flat,
        holeIndices.length ? holeIndices : null
      );
      if (roofTriangles.length === 0) continue;
      buildingCount++;

      // Roof: one vertex per footprint point at `height`.
      const roofBase = positions.length / 3;
      for (let i = 0; i < flat.length; i += 2) {
        pushVertex(flat[i], flat[i + 1], height);
      }
      for (const idx of roofTriangles) indices.push(roofBase + idx);

      // Walls: a quad per ring edge, from minHeight up to height. Outward
      // orientation follows from the normalized winding (outer CCW gives
      // outward faces; inner CW gives courtyard-facing faces).
      const rings = [outer, ...holes];
      for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
          const [e1, n1] = ring[i];
          const [e2, n2] = ring[(i + 1) % ring.length];
          const a = pushVertex(e1, n1, minHeight);
          const b = pushVertex(e2, n2, minHeight);
          const c = pushVertex(e2, n2, height);
          const d = pushVertex(e1, n1, height);
          indices.push(a, b, c, a, c, d);
        }
      }
    }
  }

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    buildingCount
  };
}
