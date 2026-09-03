/**
 * Geospatial scenes already contain the real buildings (Google 3D Tiles), so
 * an agent that adds synthetic buildings collides them with the photogrammetry
 * (WebMCP round 3 feedback). This module is the one place that decides
 * "is this a building?" and "is the scene geospatial?" for the LLM tool
 * surface; the handlers in nonCommandTools.js / EntityCreateCommand.js call
 * it. A human can still add buildings through the sidebar — this gates only
 * the agent tools, which lack the visual context to see the collision.
 */

/** Boundary variants whose model array is buildings (vs fences/seawall). */
export const BUILDING_BOUNDARY_VARIANTS = [
  'brownstone',
  'suburban',
  'arcade',
  'sp-mixeduse',
  'sp-residential',
  'sp-big-box'
];

export const GEO_BUILDINGS_REASON =
  'The scene is geospatial: Google 3D Tiles already renders the real buildings, so synthetic buildings would overlap them. Use non-building boundary variants (grass, parking, water) or omit boundaries, and verify placement with takeSnapshot type "plan".';

/** True when the scene has a location and the Google 3D Tiles layer is on. */
export function isGeospatialActive(doc = globalThis.document) {
  const geo = doc
    ?.querySelector?.('#reference-layers[street-geo]')
    ?.getAttribute?.('street-geo');
  return !!geo && geo.maps === 'google3d';
}

export function isBuildingBoundary(segment) {
  return (
    !!segment &&
    segment.type === 'boundary' &&
    BUILDING_BOUNDARY_VARIANTS.includes(segment.variant)
  );
}

/** True when the catalog lists this mixin id under the buildings category. */
export function isBuildingMixin(mixinId, catalog = globalThis.STREET?.catalog) {
  if (!mixinId || !Array.isArray(catalog)) return false;
  const entry = catalog.find((item) => item.id === mixinId);
  return entry?.category === 'buildings';
}

/**
 * Split a cross-section into the segments to keep and the building
 * boundaries to drop. Indices refer to the input array so a warning can name
 * what the caller asked for.
 */
export function partitionBuildingBoundaries(segments = []) {
  const kept = [];
  const dropped = [];
  segments.forEach((segment, index) => {
    if (isBuildingBoundary(segment)) {
      dropped.push({ index, variant: segment.variant });
    } else {
      kept.push(segment);
    }
  });
  return { kept, dropped };
}

export function describeDroppedBoundaries(dropped) {
  const list = dropped
    .map((d) => `segments[${d.index}] (variant '${d.variant}')`)
    .join(', ');
  return `Dropped building boundaries ${list}. ${GEO_BUILDINGS_REASON}`;
}
