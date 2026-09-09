/**
 * Mapbox Vector Tile `building` layer → Overpass-shaped elements
 * (#1962 step F, data-source swap).
 *
 * The buildings layer used to query the public Overpass mirrors per tile;
 * they rate-limit to two slots per IP and shed load with 504s, so a
 * neighborhood took minutes and often never finished. Commercial vector
 * tiles (MapTiler Planet / Mapbox Streets — see VECTOR_TILE_SOURCES in
 * basemap-providers.js) carry the same OSM building footprints with
 * precomputed heights on a CDN, one z14 tile per ~2 km.
 *
 * Rather than a second extrusion path, this module adapts decoded features
 * into the `out geom` element shape `buildTileGeometry` already consumes
 * ({ type: 'way' | 'relation', tags, geometry | members }), so the height
 * heuristics, winding fixes, hole handling and tile-clip ownership in
 * osm-building-geometry.js apply unchanged.
 *
 * Pure module: no THREE, no DOM — runs in the buildings worker and under
 * node tests. `featuresToElements` is the testable core; `decodeBuildings`
 * is the thin pbf front-end.
 */

import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';

const DEFAULT_HEIGHT_KEYS = ['render_height', 'height'];
const DEFAULT_MIN_HEIGHT_KEYS = ['render_min_height', 'min_height'];

function firstNumeric(props, keys) {
  for (const key of keys) {
    const value = props[key];
    if (value !== undefined && value !== null && value !== '') {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

/** GeoJSON [lon, lat] ring → Overpass {lat, lon} geometry. */
function ringToGeometry(ring) {
  return ring.map(([lon, lat]) => ({ lat, lon }));
}

/** One GeoJSON Polygon's rings → a way (no holes) or a multipolygon relation. */
function polygonToElement(rings, tags, id) {
  if (!rings || rings.length === 0 || rings[0].length < 4) return null;
  if (rings.length === 1) {
    return { type: 'way', id, tags, geometry: ringToGeometry(rings[0]) };
  }
  return {
    type: 'relation',
    id,
    tags: { ...tags, type: 'multipolygon' },
    members: rings.map((ring, i) => ({
      type: 'way',
      role: i === 0 ? 'outer' : 'inner',
      geometry: ringToGeometry(ring)
    }))
  };
}

/**
 * Convert building-layer GeoJSON features to Overpass-shaped elements.
 *
 * @param {Array} features GeoJSON Features (Polygon / MultiPolygon) with
 *   the tileset's building properties.
 * @param {Object} [options]
 * @param {string[]} [options.heightKeys] property names tried in order for
 *   the roof height (meters).
 * @param {string[]} [options.minHeightKeys] same for the wall base.
 * @returns {Array} elements for buildTileGeometry.
 */
export function featuresToElements(
  features,
  {
    heightKeys = DEFAULT_HEIGHT_KEYS,
    minHeightKeys = DEFAULT_MIN_HEIGHT_KEYS
  } = {}
) {
  const elements = [];
  let nextId = 1;
  for (const feature of features || []) {
    const props = feature.properties || {};
    // Outlines whose building:parts ship as separate features would render
    // twice (the parts are the better 3D model) — same filter MapLibre's
    // 3D-buildings style uses.
    if (props.hide_3d === true || props.hide_3d === 'true') continue;
    const geometry = feature.geometry;
    if (!geometry) continue;

    const tags = { building: props.class || props.type || 'yes' };
    const height = firstNumeric(props, heightKeys);
    if (height !== undefined) tags.height = height;
    const minHeight = firstNumeric(props, minHeightKeys);
    if (minHeight !== undefined && minHeight > 0) tags.min_height = minHeight;

    const polygons =
      geometry.type === 'Polygon'
        ? [geometry.coordinates]
        : geometry.type === 'MultiPolygon'
          ? geometry.coordinates
          : [];
    for (const rings of polygons) {
      const element = polygonToElement(rings, tags, nextId++);
      if (element) elements.push(element);
    }
  }
  return elements;
}

/**
 * Decode one MVT tile buffer's building layer into Overpass-shaped
 * elements with lat/lon geometry.
 *
 * @param {ArrayBuffer|Uint8Array} buffer raw .pbf/.mvt bytes.
 * @param {Object} tile { x, y, zoom } of the buffer (for tile → lat/lon).
 * @param {Object} [options] { buildingLayer = 'building', heightKeys,
 *   minHeightKeys }
 */
export function decodeBuildings(
  buffer,
  { x, y, zoom },
  { buildingLayer = 'building', heightKeys, minHeightKeys } = {}
) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const tile = new VectorTile(new PbfReader(bytes));
  const layer = tile.layers[buildingLayer];
  if (!layer) return [];
  const features = [];
  for (let i = 0; i < layer.length; i++) {
    const feature = layer.feature(i);
    // 3 = Polygon in the MVT spec; skip stray points/lines.
    if (feature.type !== 3) continue;
    features.push(feature.toGeoJSON(x, y, zoom));
  }
  return featuresToElements(features, { heightKeys, minHeightKeys });
}
