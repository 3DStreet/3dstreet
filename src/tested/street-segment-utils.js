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
function calculateHeight(elevation) {
  if (elevation === undefined || elevation === null) {
    return BASE_SURFACE_DEPTH;
  }
  return Math.max(BASE_SURFACE_DEPTH, BASE_SURFACE_DEPTH + elevation);
}

// Convert a deprecated integer elevation level to meters.
// e.g., level 0 → 0m, level 1 → 0.15m, level 2 → 0.30m
function levelToElevation(level) {
  if (level === undefined || level === null || isNaN(level)) {
    return 0;
  }
  return level * CURB_HEIGHT;
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

module.exports.calculateHeight = calculateHeight;
module.exports.levelToElevation = levelToElevation;
module.exports.migrateSegmentLevelToElevation = migrateSegmentLevelToElevation;
module.exports.CURB_HEIGHT = CURB_HEIGHT;
module.exports.BASE_SURFACE_DEPTH = BASE_SURFACE_DEPTH;
