/**
 * Geospatial Data Source registry (#2090).
 *
 * One descriptor per data source, the contract #2090 calls for ("layer type,
 * coverage polygon, archive URL, license and attribution, update date, schema
 * version, accuracy, vertical datum"). The client reads the registry to list
 * the sources that cover a scene's location (Geospatial panel → Data layers),
 * and a `geo-layer` entity under `#reference-layers` names a source by `id`.
 * The analog for basemaps is `basemap-providers.js`.
 *
 * A source is resolved in three steps, each swappable on its own:
 *
 *   descriptor (this file)  →  format adapter  →  layer kind renderer
 *   where and what it is       raw files → a      draws one normalized
 *                              normalized model   model (terrain-grid, ...)
 *
 * so a second terrain source in another format (a Cloud-Optimized GeoTIFF, a
 * terrain-RGB tile pyramid) only needs a new adapter, and a parcel or zoning
 * source only needs a new kind.
 *
 * **Scenes store intent, not facts.** A scene saves the source id and the
 * layer's display settings; the data is fetched from `baseUrl` at load and is
 * never serialized. Pin `baseUrl` to an immutable version (a commit, a dated
 * archive) and bump `version` when moving it, so a saved scene shows the same
 * data it was made with.
 *
 * Pure module: no AFRAME/DOM.
 */

/** Layer kinds: how a normalized model is drawn. */
export const GEO_LAYER_KINDS = {
  // A regular height grid in a projected CRS, optionally with a per-cell
  // class raster (land cover, habitat), a shade raster, water bodies and
  // linear features. Drawn as a draped terrain surface.
  TERRAIN_GRID: 'terrain-grid'
};

/**
 * How much a source's content can be trusted, shown next to the layer.
 * Matches the vocabulary Yelamu uses per layer (documented / inferred /
 * illustrative) plus `measured` for survey-grade data.
 */
export const GEO_CONFIDENCE = {
  MEASURED: 'measured',
  DOCUMENTED: 'documented',
  INFERRED: 'inferred',
  ILLUSTRATIVE: 'illustrative'
};

const YELAMU_COMMIT = '57867f1162f368a205718a870963849c55558dd9';

export const GEO_DATA_SOURCES = [
  {
    id: 'yelamu-1769',
    name: 'San Francisco c. 1769 (Yelamu)',
    shortName: 'SF 1769',
    description:
      'Reconstructed terrain, shoreline, habitats, ponds and creeks of the San Francisco peninsula around 1769, the homeland of the Ramaytush Ohlone.',
    kind: GEO_LAYER_KINDS.TERRAIN_GRID,
    format: 'yelamu-real-city@1',
    // Pinned to a commit through jsDelivr (CORS-enabled, immutable). The
    // project's own site serves the latest build at
    // https://yelamu.thomasparas.com/assets/real-city/.
    baseUrl: `https://cdn.jsdelivr.net/gh/ThomasParas/yelamu@${YELAMU_COMMIT}/viewer/public/assets/real-city/`,
    version: YELAMU_COMMIT.slice(0, 7),
    era: 'c. 1769',
    crs: 'EPSG:32610',
    verticalDatum: 'NAVD88',
    resolutionM: 10,
    // Grid extent from meta.json, as lon/lat (west, south, east, north).
    coverage: { west: -122.53, south: 37.6989, east: -122.33, north: 37.841 },
    license: 'GPL-3.0-or-later',
    licenseUrl: 'https://www.gnu.org/licenses/gpl-3.0.html',
    attribution:
      'Yelamu by Thomas Paras (GPL-3.0-or-later), built from SFEI Hidden Nature SF, USGS 3DEP and NOAA Shoreline Data Rescue Project data',
    homepage: 'https://yelamu.thomasparas.com/',
    sourceRepository: 'https://github.com/ThomasParas/yelamu',
    confidence: GEO_CONFIDENCE.INFERRED,
    caveat:
      'A historical-ecology reconstruction, not a survey. Not for navigation, engineering or legal use. Shorelines, landforms and ponds are partly inferred.',
    // Feature classes a renderer must not draw unless the scene asks for
    // them. Yelamu marks its village sites as approximate and not official;
    // cultural content needs the Association of Ramaytush Ohlone's
    // permission, so 3DStreet never draws them by default.
    optInFeatures: ['villages']
  }
];

const REQUIRED_FIELDS = [
  'id',
  'name',
  'kind',
  'format',
  'baseUrl',
  'version',
  'crs',
  'coverage',
  'license',
  'attribution'
];

/**
 * Check a descriptor has every field the client relies on. Returns a list of
 * problems (empty when valid), so the registry test can report all of them.
 */
export function validateDataSource(source) {
  const problems = [];
  for (const field of REQUIRED_FIELDS) {
    if (source[field] === undefined || source[field] === '') {
      problems.push(`${source.id || '(no id)'}: missing ${field}`);
    }
  }
  if (source.id && !/^[a-z0-9-]+$/.test(source.id)) {
    // Ids appear in saved scenes and URLs; keep them plain.
    problems.push(`${source.id}: id must be lowercase letters, digits and -`);
  }
  if (source.kind && !Object.values(GEO_LAYER_KINDS).includes(source.kind)) {
    problems.push(`${source.id}: unknown kind ${source.kind}`);
  }
  const c = source.coverage;
  if (
    c &&
    !(
      c.west < c.east &&
      c.south < c.north &&
      [c.west, c.east].every((v) => v >= -180 && v <= 180) &&
      [c.south, c.north].every((v) => v >= -90 && v <= 90)
    )
  ) {
    problems.push(`${source.id}: coverage must be a lon/lat box`);
  }
  if (source.baseUrl && !source.baseUrl.endsWith('/')) {
    problems.push(`${source.id}: baseUrl must end with /`);
  }
  return problems;
}

export function getDataSource(id, registry = GEO_DATA_SOURCES) {
  return registry.find((s) => s.id === id) || null;
}

/** True when (lon, lat) is inside the source's coverage box. */
export function sourceCovers(source, longitude, latitude) {
  const c = source.coverage;
  return (
    Number.isFinite(longitude) &&
    Number.isFinite(latitude) &&
    longitude >= c.west &&
    longitude <= c.east &&
    latitude >= c.south &&
    latitude <= c.north
  );
}

/** Sources whose coverage contains the location, in registry order. */
export function sourcesForLocation(
  longitude,
  latitude,
  registry = GEO_DATA_SOURCES
) {
  return registry.filter((s) => sourceCovers(s, longitude, latitude));
}
