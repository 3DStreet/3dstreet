/**
 * Web Worker for the OSM buildings layer (#1962 step F).
 *
 * Owns the whole per-tile pipeline off the main thread: IndexedDB
 * cache-first Overpass fetch (endpoint rotation + backoff), JSON parse,
 * footprint extraction and earcut triangulation. The main thread receives
 * ready-to-upload transferable geometry arrays, so streaming a
 * neighborhood in never janks the editor (the retired osm4vr layer did
 * all of this on the main thread).
 *
 * IMPORTANT: nothing in this worker graph may import 'three' — webpack
 * externalizes it to the A-Frame page global, which does not exist in a
 * worker. Geometry stays as raw arrays until the component wraps it.
 *
 * Messages in:  { type: 'load', key, zoom, x, y, originLat, originLon,
 *                 endpoints?, cacheTtlMs? }
 * Messages out: { type: 'tile', key, positions, indices, buildingCount,
 *                 fromCache }
 *               { type: 'error', key, message, status? }
 */

import { tileToBBox } from '../tested/osm-tile-math.js';
import { buildTileGeometry } from '../tested/osm-building-geometry.js';
import { fetchOverpass } from './overpass-fetch.js';
import { cacheGet, cachePut } from './overpass-cache.js';

const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // one week

// Bump when the query shape changes so stale cached responses miss.
const QUERY_VERSION = 1;

function buildingsQuery(bbox) {
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  // `out geom` inlines way/member coordinates — no osmtogeojson pass.
  return (
    '[out:json][timeout:25];(' +
    `way["building"](${box});` +
    `relation["building"]["type"="multipolygon"](${box});` +
    ');out geom;'
  );
}

self.onmessage = async ({ data }) => {
  if (data?.type !== 'load') return;
  const { key, zoom, x, y, originLat, originLon, endpoints, cacheTtlMs } = data;
  try {
    const cacheKey = `buildings/v${QUERY_VERSION}/${key}`;
    let payload = await cacheGet(cacheKey, cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    const fromCache = !!payload;
    if (!payload) {
      const bbox = tileToBBox(x, y, zoom);
      payload = await fetchOverpass(buildingsQuery(bbox), { endpoints });
      await cachePut(cacheKey, payload);
    }
    const tileBBox = tileToBBox(x, y, zoom);
    const { positions, indices, buildingCount } = buildTileGeometry(
      payload.elements,
      { originLat, originLon, tileBBox }
    );
    self.postMessage(
      { type: 'tile', key, positions, indices, buildingCount, fromCache },
      [positions.buffer, indices.buffer]
    );
  } catch (err) {
    self.postMessage({
      type: 'error',
      key,
      message: err?.message || String(err),
      status: err?.status
    });
  }
};
