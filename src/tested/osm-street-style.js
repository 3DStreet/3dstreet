/**
 * OSM street styling + width heuristics (#1930 demo path).
 *
 * Pure module (no AFRAME/THREE/DOM) shared by two consumers:
 *
 * 1. The street ribbons `osm-streets` draws on the 2.5D ground
 *    (`osm-street-ribbon.js`): `ribbonStyleForClass(class)` gives the tint
 *    and draw order per OpenMapTiles `transportation` class.
 * 2. The click-to-upgrade importer: `roadWidthMeters(class)` is the
 *    class-based width heuristic (OpenMapTiles `transportation` carries no
 *    lane count or width fields — real cross-sections arrive with the
 *    Overpass-backed hydrator, #1930 phase 6).
 *
 * The OpenMapTiles `class` values are documented at
 * https://openmaptiles.org/schema/#transportation
 */

// Total paved width in meters by transportation class — used both to draw
// ribbons at true ground scale and to pick a managed-street preset on
// upgrade. Deliberately conservative middle-of-road values.
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

// Ribbon colors: a deliberate "interactive layer" tint distinct from the
// muted basemap cartography underneath, darker for higher road classes.
// Tuned for the streets-v2 raster beneath it. `order` doubles as the
// vertical stacking rank at junctions (higher draws on top).
const MAJOR = '#3d6fb4';
const MID = '#5585c2';
const MINOR = '#7aa3d4';
const LIGHT = '#9db8d8';

const RIBBON_STYLE_BY_CLASS = {
  motorway: { color: MAJOR, order: 6 },
  trunk: { color: MAJOR, order: 6 },
  primary: { color: MID, order: 5 },
  secondary: { color: MID, order: 4 },
  tertiary: { color: MINOR, order: 3 },
  minor: { color: MINOR, order: 3 },
  busway: { color: MINOR, order: 3 },
  bus_guideway: { color: MINOR, order: 3 },
  pedestrian: { color: LIGHT, order: 2 },
  service: { color: LIGHT, order: 2 },
  track: { color: LIGHT, order: 1 },
  path: { color: LIGHT, order: 1 }
};

const DEFAULT_RIBBON_STYLE = { color: MINOR, order: 1 };

/**
 * @param {string} cls OpenMapTiles transportation class.
 * @returns {{color: string, order: number}}
 */
export function ribbonStyleForClass(cls) {
  return RIBBON_STYLE_BY_CLASS[cls] || DEFAULT_RIBBON_STYLE;
}
