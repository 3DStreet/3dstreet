/**
 * Web Worker for the OSM buildings layer (#1962 step F).
 *
 * Owns the whole per-tile pipeline off the main thread: IndexedDB
 * cache-first vector-tile fetch, protobuf decode, footprint extraction and
 * earcut triangulation. The main thread receives ready-to-upload
 * transferable geometry arrays, so streaming a neighborhood in never
 * janks the editor.
 *
 * Data source: a commercial vector tileset's `building` layer (MapTiler
 * Planet by default — see VECTOR_TILE_SOURCES in basemap-providers.js),
 * not the public Overpass mirrors, which rate-limit to two slots per IP
 * and shed load with 504s. The Overpass fetch module stays in this
 * directory for #1930's centerline import.
 *
 * IMPORTANT: nothing in this worker graph may import 'three' — webpack
 * externalizes it to the A-Frame page global, which does not exist in a
 * worker. Geometry stays as raw arrays until the component wraps it.
 *
 * Messages in:  { type: 'load', key, zoom, x, y, originLat, originLon,
 *                 urlTemplate, buildingLayer?, heightKeys?, minHeightKeys?,
 *                 cacheTtlMs? }
 * Messages out: { type: 'tile', key, positions, normals, colors, indices,
 *                 buildingCount, fromCache }
 *               { type: 'error', key, message, status? }
 */

import { tileToBBox } from '../tested/osm-tile-math.js';
import { buildTileGeometry } from '../tested/osm-building-geometry.js';
import { decodeBuildings } from '../tested/vector-tile-buildings.js';
import { cacheGet, cachePut } from './overpass-cache.js';

const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // one week
const FETCH_TIMEOUT_MS = 15000;
const FETCH_ATTEMPTS = 2;

// Bump when the cached element shape changes so stale rows miss.
const CACHE_VERSION = 2;

class TileFetchError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function tileUrl(template, zoom, x, y) {
  return template.replace('{z}', zoom).replace('{x}', x).replace('{y}', y);
}

/** Fetch a tile's bytes; retries once on a network error or 5xx. */
async function fetchTile(url) {
  let lastError = null;
  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      // Empty tile (no data at this location) is a valid, cacheable miss.
      if (response.status === 204 || response.status === 404) {
        return new ArrayBuffer(0);
      }
      if (!response.ok) {
        lastError = new TileFetchError(
          `vector tile responded ${response.status}`,
          response.status
        );
        // Client errors (bad key, over quota) will not heal on retry.
        if (response.status < 500) throw lastError;
      } else {
        return await response.arrayBuffer();
      }
    } catch (err) {
      if (err instanceof TileFetchError && err.status < 500) throw err;
      lastError =
        err instanceof TileFetchError
          ? err
          : new TileFetchError(
              `vector tile fetch failed: ${err?.message || err?.name}`
            );
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError || new TileFetchError('vector tile fetch failed');
}

self.onmessage = async ({ data }) => {
  if (data?.type !== 'load') return;
  const {
    key,
    zoom,
    x,
    y,
    originLat,
    originLon,
    urlTemplate,
    buildingLayer,
    heightKeys,
    minHeightKeys,
    cacheTtlMs
  } = data;
  try {
    if (!urlTemplate) throw new TileFetchError('no vector tile source');
    const cacheKey = `buildings/v${CACHE_VERSION}/${key}`;
    let elements = await cacheGet(cacheKey, cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    const fromCache = !!elements;
    if (!elements) {
      const buffer = await fetchTile(tileUrl(urlTemplate, zoom, x, y));
      elements =
        buffer.byteLength === 0
          ? []
          : decodeBuildings(
              buffer,
              { x, y, zoom },
              { buildingLayer, heightKeys, minHeightKeys }
            );
      await cachePut(cacheKey, elements);
    }
    const tileBBox = tileToBBox(x, y, zoom);
    const { positions, normals, colors, indices, buildingCount } =
      buildTileGeometry(elements, { originLat, originLon, tileBBox });
    self.postMessage(
      {
        type: 'tile',
        key,
        positions,
        normals,
        colors,
        indices,
        buildingCount,
        fromCache
      },
      [positions.buffer, normals.buffer, colors.buffer, indices.buffer]
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
