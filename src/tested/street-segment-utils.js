// One Streetmix "curb level" step in meters. Elevation is stored in meters
// everywhere in 3DStreet; this constant exists only to convert deprecated
// integer `level` values (legacy saved scenes, pre-33 Streetmix payloads).
const CURB_HEIGHT = 0.15;
const BASE_SURFACE_DEPTH = 0.15; // Minimum material depth above dirt layer

// Calculate the Y position and below-box geometry height for a given elevation
// in meters. The below-box primitive places its top face at the entity's local
// origin, so using the same value for both entity Y and box height means the
// top surface sits at Y=height and the box extends downward to Y=0 (the dirt
// layer top).
// elevation 0 = 0.15m (base depth only), 0.15m (curb) = 0.30m, 0.30m = 0.45m, etc.
// Negative elevations (below road level) are intentionally unsupported for
// now: the Math.max clamps them to the base surface depth, so they render at
// road level.
function calculateHeight(elevation) {
  if (elevation === undefined || elevation === null) {
    return BASE_SURFACE_DEPTH;
  }
  return Math.max(BASE_SURFACE_DEPTH, BASE_SURFACE_DEPTH + elevation);
}

// Surface heights for a sloped segment (coastmix schema v34): the surface
// tilts between two metric elevations across the segment width. The segment
// entity sits at the mean height; the geometry's top face is displaced by
// startDelta at the segment's start (local -x) edge and endDelta at the end
// (local +x) edge.
function calculateSlopedHeights(startElevation, endElevation) {
  const startHeight = calculateHeight(startElevation);
  const endHeight = calculateHeight(endElevation);
  const height = (startHeight + endHeight) / 2;
  return {
    height,
    startDelta: startHeight - height,
    endDelta: endHeight - height
  };
}

// Convert a deprecated integer elevation level to meters.
// e.g., level 0 → 0m, level 1 → 0.15m, level 2 → 0.30m
// Negative levels clamp to 0: negative elevations are intentionally
// unsupported, and legacy levels below 0 already rendered at road level.
function levelToElevation(level) {
  if (level === undefined || level === null || isNaN(level)) {
    return 0;
  }
  return Math.max(0, level * CURB_HEIGHT);
}

// Migrate a saved street-segment component value from the deprecated integer
// `level` property to metric `elevation`. Saved scenes serialize components as
// prop strings ("type: sidewalk; level: 1; ...") but callers may also hold the
// parsed object form — both are handled. Values that already carry `elevation`
// are returned unchanged (the stray `level`, if any, is ignored by the schema).
function migrateSegmentLevelToElevation(componentValue) {
  if (typeof componentValue === 'string') {
    if (/(^|;)\s*elevation\s*:/.test(componentValue)) {
      return componentValue;
    }
    return componentValue.replace(
      /(^|;)(\s*)level\s*:\s*(-?\d+(?:\.\d+)?)/g,
      (match, sep, ws, num) =>
        `${sep}${ws}elevation: ${levelToElevation(parseFloat(num))}`
    );
  }
  if (
    componentValue &&
    typeof componentValue === 'object' &&
    'level' in componentValue
  ) {
    const { level, ...rest } = componentValue;
    if (rest.elevation === undefined) {
      rest.elevation = levelToElevation(parseFloat(level));
    }
    return rest;
  }
  return componentValue;
}

// Migrate a saved street-segment component value from the deprecated
// `type: building` to `type: boundary` (the rename covers the wider set of
// adjacent land uses: buildings, waterfront, fences, parking lots, ...).
// Handles the serialized prop-string form and the parsed object form.
function migrateSegmentBuildingType(componentValue) {
  if (typeof componentValue === 'string') {
    return componentValue.replace(
      /(^|;)(\s*)type\s*:\s*building(\s*)(;|$)/,
      '$1$2type: boundary$3$4'
    );
  }
  if (
    componentValue &&
    typeof componentValue === 'object' &&
    componentValue.type === 'building'
  ) {
    return { ...componentValue, type: 'boundary' };
  }
  return componentValue;
}

// Migrate a saved managed-street component value from the short-lived
// `showBuildings` property name to `showBoundaries` (renamed with the
// building -> boundary segment type).
function migrateShowBuildingsFlag(componentValue) {
  if (typeof componentValue === 'string') {
    return componentValue.replace(
      /(^|;)(\s*)showBuildings\s*:/,
      '$1$2showBoundaries:'
    );
  }
  if (
    componentValue &&
    typeof componentValue === 'object' &&
    'showBuildings' in componentValue
  ) {
    const { showBuildings, ...rest } = componentValue;
    if (rest.showBoundaries === undefined) {
      rest.showBoundaries = showBuildings;
    }
    return rest;
  }
  return componentValue;
}

export {
  calculateHeight,
  calculateSlopedHeights,
  levelToElevation,
  migrateSegmentLevelToElevation,
  migrateSegmentBuildingType,
  migrateShowBuildingsFlag,
  CURB_HEIGHT,
  BASE_SURFACE_DEPTH
};
