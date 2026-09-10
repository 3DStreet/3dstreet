/**
 * OSM street styling + width heuristics (#1930 demo path).
 *
 * Pure module (no AFRAME/THREE/DOM) shared by two consumers:
 *
 * 1. The draped road overlay on the 2.5D ground (`tiled-basemap`'s
 *    MVTOverlay): `getRoadOverlayStyle(layerName, properties)` is the
 *    per-feature style callback rendering the OpenMapTiles `transportation`
 *    layer as highlighted, clickable-looking streets and hiding every other
 *    layer.
 * 2. The click-to-upgrade importer: `roadWidthMeters(class)` is the
 *    class-based width heuristic (OpenMapTiles `transportation` carries no
 *    lane count or width fields — real cross-sections arrive with the
 *    Overpass-backed hydrator, #1930 phase 6).
 *
 * The OpenMapTiles `class` values are documented at
 * https://openmaptiles.org/schema/#transportation
 */

// Total paved width in meters by transportation class — used both to draw
// overlay strokes at true ground scale and to pick a managed-street preset
// on upgrade. Deliberately conservative middle-of-road values.
export const ROAD_WIDTH_M_BY_CLASS = {
  motorway: 22,
  trunk: 18,
  primary: 15,
  secondary: 12,
  tertiary: 10,
  minor: 9, // residential/unclassified
  service: 5,
  track: 4,
  path: 2.5,
  pedestrian: 6,
  raceway: 8,
  busway: 7,
  bus_guideway: 7
};

export const DEFAULT_ROAD_WIDTH_M = 9;

// Classes that are not drivable/walkable street surfaces we want to offer
// for upgrade or draw as street ribbons.
export const EXCLUDED_ROAD_CLASSES = new Set(['ferry', 'aerialway']);

export function roadWidthMeters(cls) {
  return ROAD_WIDTH_M_BY_CLASS[cls] ?? DEFAULT_ROAD_WIDTH_M;
}

// Overlay stroke colors: a deliberate "interactive layer" tint distinct
// from the muted basemap cartography underneath, darker for higher road
// classes. Tuned for the streets-v2 raster beneath it.
const MAJOR_STROKE = '#3d6fb4';
const MID_STROKE = '#5585c2';
const MINOR_STROKE = '#7aa3d4';

const OVERLAY_STYLE_BY_CLASS = {
  motorway: { stroke: MAJOR_STROKE, order: 6 },
  trunk: { stroke: MAJOR_STROKE, order: 6 },
  primary: { stroke: MID_STROKE, order: 5 },
  secondary: { stroke: MID_STROKE, order: 4 },
  tertiary: { stroke: MINOR_STROKE, order: 3 },
  minor: { stroke: MINOR_STROKE, order: 3 },
  busway: { stroke: MINOR_STROKE, order: 3 },
  bus_guideway: { stroke: MINOR_STROKE, order: 3 },
  pedestrian: { stroke: '#9db8d8', order: 2 },
  service: { stroke: '#9db8d8', order: 2 },
  track: { stroke: '#9db8d8', order: 1 },
  path: { stroke: '#9db8d8', order: 1 }
};

const HIDDEN = { visible: false };

/**
 * Meters-per-pixel of an MVT overlay tile canvas: the transportation
 * source's deepest tiles are z14 (~1.9 km at mid latitudes) rendered onto a
 * `resolution`-px canvas, and deeper display tiles rescale the same data.
 * We approximate stroke widths against the deepest level so streets read at
 * roughly true width when zoomed in. Exported for tests.
 */
export function strokeWidthPx(
  cls,
  { resolution = 512, tileSpanM = 1900 } = {}
) {
  const metersPerPx = tileSpanM / resolution;
  // Clamp so minor roads stay visible when a z14 texture covers the whole
  // tile (~3.7 m/px) and majors don't turn into blobs.
  return Math.min(8, Math.max(1.25, roadWidthMeters(cls) / metersPerPx));
}

/**
 * Per-feature style callback for MVTOverlay (`getStyle`). Draws only the
 * `transportation` layer: tunnels and non-street classes are hidden,
 * everything else strokes in the interactive tint. `properties` is null
 * when the renderer asks for layer-level draw order only.
 *
 * @param {string} layerName MVT layer the feature belongs to.
 * @param {Object|null} properties Feature properties.
 * @returns {Object} VectorTileStyle-shaped object.
 */
export function getRoadOverlayStyle(layerName, properties) {
  if (layerName !== 'transportation') {
    return HIDDEN;
  }
  if (properties === null) {
    // Layer-order query: transportation above whatever else might draw.
    return { order: 10 };
  }
  const cls = properties.class;
  if (EXCLUDED_ROAD_CLASSES.has(cls)) {
    return HIDDEN;
  }
  if (properties.brunnel === 'tunnel') {
    return HIDDEN;
  }
  const base = OVERLAY_STYLE_BY_CLASS[cls];
  return {
    stroke: base ? base.stroke : MINOR_STROKE,
    strokeWidth: strokeWidthPx(cls),
    // LineStrings should never fill; polygons (pedestrian plazas) get a
    // translucent fill of the same family.
    fill: 'rgba(122, 163, 212, 0.25)',
    order: base ? base.order : 1
  };
}
