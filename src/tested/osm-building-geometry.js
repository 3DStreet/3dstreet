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
 * @param {Object} options { originLat, originLon, tileBBox, roofColor,
 *   wallColor } — origin is the scene's geo anchor; tileBBox ({south, west,
 *   north, east}) gates centroid ownership (pass null to keep every
 *   building); roofColor / wallColor ([r, g, b] in 0..1) fill the per-vertex
 *   color attribute so roofs read lighter than walls from above.
 * @returns {{ positions: Float32Array, normals: Float32Array,
 *   colors: Float32Array, indices: Uint32Array, buildingCount: number }}
 *   normals are flat per face (roof +y, walls outward) — every wall quad
 *   owns its vertices and roof vertices only share within their plane, so
 *   accumulating face normals yields flat shading without a lit-material
 *   `computeVertexNormals` pass on the main thread.
 */
export const DEFAULT_ROOF_COLOR = [0.6, 0.65, 0.7];
export const DEFAULT_WALL_COLOR = [0.45, 0.5, 0.56];

export function buildTileGeometry(
  elements,
  {
    originLat,
    originLon,
    tileBBox,
    roofColor = DEFAULT_ROOF_COLOR,
    wallColor = DEFAULT_WALL_COLOR
  }
) {
  const positions = [];
  const colors = [];
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
  const pushVertex = (e, n, y, color) => {
    positions.push(n, y, e);
    colors.push(color[0], color[1], color[2]);
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
        pushVertex(flat[i], flat[i + 1], height, roofColor);
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
          const a = pushVertex(e1, n1, minHeight, wallColor);
          const b = pushVertex(e2, n2, minHeight, wallColor);
          const c = pushVertex(e2, n2, height, wallColor);
          const d = pushVertex(e1, n1, height, wallColor);
          indices.push(a, b, c, a, c, d);
        }
      }
    }
  }

  const positionArray = new Float32Array(positions);
  const indexArray = new Uint32Array(indices);
  return {
    positions: positionArray,
    normals: computeFlatNormals(positionArray, indexArray),
    colors: new Float32Array(colors),
    indices: indexArray,
    buildingCount
  };
}

/** Accumulated face normals per vertex, normalized (see buildTileGeometry). */
export function computeFlatNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const abx = positions[b] - positions[a];
    const aby = positions[b + 1] - positions[a + 1];
    const abz = positions[b + 2] - positions[a + 2];
    const acx = positions[c] - positions[a];
    const acy = positions[c + 1] - positions[a + 1];
    const acz = positions[c + 2] - positions[a + 2];
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    for (const v of [a, b, c]) {
      normals[v] += nx;
      normals[v + 1] += ny;
      normals[v + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]);
    if (len > 0) {
      normals[i] /= len;
      normals[i + 1] /= len;
      normals[i + 2] /= len;
    }
  }
  return normals;
}
