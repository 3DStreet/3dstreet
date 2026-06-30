/**
 * Geo location provenance — single source of truth for the street-geo `source`
 * field (#1644 / #1654). Every producer that establishes a scene's geospatial
 * location should stamp one of these values, and the Geospatial panel maps them
 * to human copy via geoSourcePhrase(). An empty source means "unknown" (legacy
 * scenes saved before this field existed).
 */
export const GEO_SOURCES = {
  STREETMIX: 'streetmix',
  GEOJSON: 'geojson',
  MANUAL: 'manual',
  // The 3DStreet mobile app (Bollard Buddy, separate iOS repo).
  BOLLARD_BUDDY: 'bollard-buddy',
  AI_ASSISTANT: 'ai-assistant'
};

// Human phrase for where a saved-but-not-activated location came from, shown in
// the Geospatial panel hero. A source with no entry here (e.g. MANUAL) renders
// with no attribution.
const GEO_SOURCE_PHRASES = {
  [GEO_SOURCES.STREETMIX]: 'imported from Streetmix',
  [GEO_SOURCES.GEOJSON]: 'imported from GeoJSON',
  [GEO_SOURCES.AI_ASSISTANT]: 'set by the AI assistant',
  [GEO_SOURCES.BOLLARD_BUDDY]: 'from the 3DStreet app'
};

/**
 * Map a source value to display copy. Legacy scenes with no stamped source are,
 * in practice, from the mobile app (historically the only path that left a
 * location unactivated), so an empty/undefined source defaults to the app
 * phrasing. Unknown non-empty values return '' so we don't attribute a source
 * we can't name.
 */
export const geoSourcePhrase = (source) => {
  if (source === undefined || source === '') {
    return GEO_SOURCE_PHRASES[GEO_SOURCES.BOLLARD_BUDDY];
  }
  return GEO_SOURCE_PHRASES[source] || '';
};
