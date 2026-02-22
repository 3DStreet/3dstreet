const CURB_HEIGHT = 0.15; // Height per elevation level in meters
const BASE_SURFACE_DEPTH = 0.15; // Minimum material depth above dirt layer

// Calculate the Y position and below-box geometry height for a given elevation level.
// The below-box primitive places its top face at the entity's local origin, so using
// the same value for both entity Y and box height means the top surface sits at Y=height
// and the box extends downward to Y=0 (the dirt layer top).
// Level 0 = 0.15m (base depth only), Level 1 = 0.30m, Level 2 = 0.45m, etc.
function calculateHeight(elevationLevel) {
  if (elevationLevel === undefined || elevationLevel === null) {
    return BASE_SURFACE_DEPTH;
  }
  return Math.max(
    BASE_SURFACE_DEPTH,
    BASE_SURFACE_DEPTH + elevationLevel * CURB_HEIGHT
  );
}

module.exports.calculateHeight = calculateHeight;
module.exports.CURB_HEIGHT = CURB_HEIGHT;
module.exports.BASE_SURFACE_DEPTH = BASE_SURFACE_DEPTH;
