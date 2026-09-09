/**
 * Raster basemap provider registry (#1962 step B).
 *
 * Single source of truth mapping provider/style pairs to XYZ tile URL
 * templates, attribution strings, and key requirements for the tiled 2D
 * basemap (`tiled-basemap` component via street-geo's `tiles2d` map type,
 * and later the 2.5D ground — #1962 step D).
 *
 * Deliberately vendor-separate from Google 3D: the paid providers here are
 * MapTiler (primary) and Mapbox (secondary). API keys are injected into the
 * resolved template — they come from the committed per-environment config
 * (config/.env.*, same convention as the Firebase client keys) and MUST be
 * origin-restricted in the provider dashboard, since any client-side map
 * key is visible to the browser regardless of where it lives in source.
 *
 * Pure module (no AFRAME/DOM/process.env): callers pass keys in, so unit
 * tests and future consumers (e.g. a Firebase key proxy) share the logic.
 */

// The OSMF donation-funded tile server: acceptable for local development
// only — its usage policy prohibits production app traffic. resolve() only
// falls back to it when the caller explicitly allows it (dev builds).
const OSM_DEV_PROVIDER = {
  name: 'OpenStreetMap (dev fallback)',
  attribution: '© OpenStreetMap contributors',
  requiresKey: false,
  styles: {
    default: {
      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maxLevel: 19
    }
  }
};

export const BASEMAP_PROVIDERS = {
  maptiler: {
    name: 'MapTiler',
    attribution: '© MapTiler © OpenStreetMap contributors',
    requiresKey: true,
    styles: {
      // Satellite imagery with street/label overlay — the closest match to
      // the legacy mapbox2d "satellite streets" look.
      hybrid: {
        urlTemplate:
          'https://api.maptiler.com/maps/hybrid/256/{z}/{x}/{y}.jpg?key={key}',
        maxLevel: 20
      },
      // Imagery only, no labels.
      satellite: {
        urlTemplate:
          'https://api.maptiler.com/maps/satellite/256/{z}/{x}/{y}.jpg?key={key}',
        maxLevel: 20
      },
      // Vector-cartography raster: the 2.5D ground look (streets + names,
      // no imagery), replacing osm4vr's raster OSM tiles in step D.
      streets: {
        urlTemplate:
          'https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key={key}',
        maxLevel: 20
      }
    }
  },
  mapbox: {
    name: 'Mapbox',
    attribution: '© Mapbox © OpenStreetMap contributors',
    requiresKey: true,
    styles: {
      hybrid: {
        urlTemplate:
          'https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/tiles/256/{z}/{x}/{y}?access_token={key}',
        maxLevel: 20
      },
      satellite: {
        urlTemplate:
          'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/256/{z}/{x}/{y}?access_token={key}',
        maxLevel: 20
      },
      streets: {
        urlTemplate:
          'https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}?access_token={key}',
        maxLevel: 20
      }
    }
  }
};

/**
 * Vector-tile sources carrying an OSM `building` layer with heights — the
 * 2.5D buildings layer's data source (replaces the public Overpass mirrors,
 * which shed load with 504s and rate-limit to 2 slots per IP). Both listed
 * tilesets follow the OpenMapTiles/Mapbox Streets convention: polygon
 * features in a `building` layer with `render_height`/`render_min_height`
 * (MapTiler) or `height`/`min_height` (Mapbox) in meters, plus `hide_3d`
 * on outlines whose building:parts are delivered separately.
 */
export const VECTOR_TILE_SOURCES = {
  maptiler: {
    urlTemplate: 'https://api.maptiler.com/tiles/v3/{z}/{x}/{y}.pbf?key={key}',
    // MapTiler Planet vector tiles end at z14 (~1.9 km at mid-latitudes).
    maxLevel: 14,
    buildingLayer: 'building',
    heightKeys: ['render_height', 'height'],
    minHeightKeys: ['render_min_height', 'min_height']
  },
  mapbox: {
    urlTemplate:
      'https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/{z}/{x}/{y}.mvt?access_token={key}',
    maxLevel: 16,
    buildingLayer: 'building',
    heightKeys: ['height'],
    minHeightKeys: ['min_height']
  }
};

/**
 * Resolve the building vector-tile source for a provider (same key
 * handling as resolveBasemapSource; no dev fallback exists — without a
 * key there is no buildings source and the caller disables the layer).
 *
 * @returns {{ urlTemplate, maxLevel, buildingLayer, heightKeys,
 *   minHeightKeys, attribution, providerName }|null}
 */
export function resolveVectorTileSource({
  provider = DEFAULT_BASEMAP_PROVIDER,
  keys = {}
} = {}) {
  const entry = BASEMAP_PROVIDERS[provider];
  const source = VECTOR_TILE_SOURCES[provider];
  const key = keys[provider];
  if (!entry || !source || !key) return null;
  return {
    ...source,
    urlTemplate: source.urlTemplate.replace(
      /{\s*key\s*}/g,
      encodeURIComponent(key)
    ),
    attribution: entry.attribution,
    providerName: entry.name
  };
}

export const DEFAULT_BASEMAP_PROVIDER = 'maptiler';
export const DEFAULT_BASEMAP_STYLE = 'hybrid';
export const BASEMAP_STYLES = ['hybrid', 'satellite', 'streets'];

/**
 * Resolve a provider/style pair to a ready-to-fetch tile source.
 *
 * @param {Object} options
 * @param {string} [options.provider] registry key (default maptiler)
 * @param {string} [options.style] style key (default hybrid)
 * @param {Object} [options.keys] API keys by provider, e.g.
 *   { maptiler: '...', mapbox: '...' } — callers read these from env config.
 * @param {boolean} [options.allowDevFallback] when the requested provider
 *   has no key, fall back to the OSM dev tiles instead of returning null.
 *   Pass true only in development builds (OSMF usage policy).
 * @returns {{ urlTemplate, attribution, maxLevel, providerName,
 *   isDevFallback }|null} null when the source cannot be resolved (unknown
 *   provider/style, or missing key without dev fallback).
 */
export function resolveBasemapSource({
  provider = DEFAULT_BASEMAP_PROVIDER,
  style = DEFAULT_BASEMAP_STYLE,
  keys = {},
  allowDevFallback = false
} = {}) {
  const entry = BASEMAP_PROVIDERS[provider];
  const styleEntry = entry && entry.styles[style];
  if (!entry || !styleEntry) {
    return null;
  }

  const key = keys[provider];
  if (entry.requiresKey && !key) {
    if (!allowDevFallback) {
      return null;
    }
    const fallbackStyle = OSM_DEV_PROVIDER.styles.default;
    return {
      urlTemplate: fallbackStyle.urlTemplate,
      attribution: OSM_DEV_PROVIDER.attribution,
      maxLevel: fallbackStyle.maxLevel,
      providerName: OSM_DEV_PROVIDER.name,
      isDevFallback: true
    };
  }

  return {
    urlTemplate: styleEntry.urlTemplate.replace(
      /{\s*key\s*}/g,
      encodeURIComponent(key || '')
    ),
    attribution: entry.attribution,
    maxLevel: styleEntry.maxLevel,
    providerName: entry.name,
    isDevFallback: false
  };
}
