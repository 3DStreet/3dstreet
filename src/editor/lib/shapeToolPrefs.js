/**
 * Per-device shape tool preferences, backed by localStorage: what the canvas
 * shows on shapes (side lengths, area, angles) and how the draw tool places points
 * (angle snap, axis alignment, whether picking the tool opens the panel).
 * These are editor preferences only — never part of the scene JSON, never on
 * the undo stack. The store holds the live value (shapeToolSettings); this
 * module only loads and saves it. localStorage can be unavailable (private
 * windows, blocked site data), so every access is guarded: a failed write
 * leaves the store's value for the session.
 */

// The admissible snap steps, largest first: every whole-degree step from 1 to
// 90 that divides 180. Snap quantises the turn at each corner and the corner
// shown is 180 minus the turn, so only these steps keep both a multiple of the
// step — and only these let a closed ring be snapped at every corner.
export const SNAP_STEPS = [
  90, 60, 45, 36, 30, 20, 18, 15, 12, 10, 9, 6, 5, 4, 3, 2, 1
];
export const SNAP_OFF = 0;

// Marks the panel section holding the tool's controls, so the draw tool can
// recognise focus left on one of them.
export const SHAPE_TOOL_SETTINGS_ATTR = 'data-shape-tool-settings';

export const SHAPE_TOOL_DEFAULTS = Object.freeze({
  showLengths: true,
  showArea: true,
  showAngles: false,
  snapStep: SNAP_OFF,
  alignToAxes: false,
  openPanelOnSelect: true
});

const STORAGE_KEY = '3dstreet-shape-tool-settings';
const BOOLEAN_KEYS = [
  'showLengths',
  'showArea',
  'showAngles',
  'alignToAxes',
  'openPanelOnSelect'
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A full settings record from anything: each key keeps its value only when it
 * is of the right kind, else takes its default. The step is never coerced — a
 * '45' or a 72 from hand-edited storage is not a step the list offers.
 */
export function normaliseShapeToolSettings(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const out = { ...SHAPE_TOOL_DEFAULTS };
  for (const key of BOOLEAN_KEYS) {
    if (typeof source[key] === 'boolean') out[key] = source[key];
  }
  if (source.snapStep === SNAP_OFF || SNAP_STEPS.includes(source.snapStep)) {
    out.snapStep = source.snapStep;
  }
  return out;
}

export function loadShapeToolSettings() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    raw = null;
  }
  return normaliseShapeToolSettings(raw);
}

// Best effort: `settings` is the store's already-normalised record.
export function persistShapeToolSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // The store keeps the value for the session.
  }
}
