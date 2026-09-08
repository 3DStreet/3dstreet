// Shared helpers for the condensed street-segment sidebar (#1753): the
// cross-section strip, the compact segment block and the generator sections
// all derive their data through here so the three components stay in sync.

import {
  getTravelledWaySegments,
  getBoundarySegments
} from '@/aframe-components/street-layout-utils';

/**
 * Commit a property change through the inspector's undoable command path.
 * Mirrors PropertyRow's updateProperty side effect: editing the surface of a
 * boundary segment (or any street-generated-clones prop) first flips the
 * boundary variant to `custom` so the preset doesn't overwrite the edit.
 */
export function executeSegmentUpdate(entity, componentName, property, value) {
  const shouldSwitchToCustom =
    (componentName === 'street-segment' && property === 'surface') ||
    componentName.startsWith('street-generated-clones');

  if (shouldSwitchToCustom) {
    const streetSegment = entity.getAttribute('street-segment');
    if (
      streetSegment &&
      streetSegment.type === 'boundary' &&
      streetSegment.variant !== 'custom'
    ) {
      AFRAME.INSPECTOR.execute('entityupdate', {
        entity,
        component: 'street-segment',
        property: 'variant',
        value: 'custom',
        noSelectEntity: true
      });
    }
  }

  AFRAME.INSPECTOR.execute('entityupdate', {
    entity,
    component: componentName,
    property,
    value
  });
}

// Representative color per surface material for the cross-section strip.
// These are display-only approximations of the textures, not scene colors.
const SURFACE_COLORS = {
  asphalt: '#5c5c5c',
  concrete: '#c9c9c9',
  grass: '#4f7a3a',
  sidewalk: '#c9c9c9',
  gravel: '#8a8a8a',
  sand: '#e0c98a',
  'cracked-asphalt': '#6b6a62',
  'parking-lot': '#9a9a9a',
  water: '#3a7ebf',
  solid: '#3a3a3a',
  hatched: '#3a3a3a',
  none: '#3a3a3a'
};

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

const hexToRgb = (hex) => {
  let h = (hex || '').replace('#', '');
  if (h.length === 3) {
    h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const rgbToHex = ([r, g, b]) =>
  '#' +
  [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');

/**
 * Strip bar fill for a segment: the surface material's representative color
 * tinted by segment.color, matching how the scene multiplies texture × color
 * (white = untinted). Derived from live data, never a preset.
 */
export function getSegmentBarColor(segmentData) {
  const base = SURFACE_COLORS[segmentData?.surface] ?? SURFACE_COLORS.asphalt;
  const tint = hexToRgb(segmentData?.color);
  if (!tint) return base;
  const baseRgb = hexToRgb(base);
  return rgbToHex([
    (baseRgb[0] * tint[0]) / 255,
    (baseRgb[1] * tint[1]) / 255,
    (baseRgb[2] * tint[2]) / 255
  ]);
}

/** Glyph ink over a strip bar: dark on light fills, white otherwise. */
export function getBarInkColor(bgHex) {
  const rgb = hexToRgb(bgHex);
  if (!rgb) return '#fff';
  // Relative-luminance approximation is plenty for a 2-way ink choice.
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  return luminance > 0.6 ? '#222' : '#fff';
}

// Per-type width presets in metres (Streetmix-style standards). Types not
// listed (boundary, divider, grass, rail) get no pills.
export const WIDTH_PRESETS = {
  'bike-lane': [1.5, 1.8, 2.4],
  'drive-lane': [3.0, 3.3, 3.6],
  'bus-lane': [3.0, 3.3, 3.6],
  sidewalk: [1.8, 2.4, 3.6],
  'parking-lane': [2.1, 2.4]
};

/**
 * The strip's bars in left→right visual order (−x → +x), mirroring
 * street-align's layout: left boundaries stack outward (so they render in
 * reverse DOM order), then the travelled way in DOM order, then right
 * boundaries outward. Hidden boundaries (showBoundaries off) are skipped —
 * the strip shows what the scene shows.
 */
export function getStripSegments(streetEl) {
  const travelled = getTravelledWaySegments(streetEl);
  const showBoundaries =
    streetEl.getAttribute('managed-street')?.showBoundaries !== false;
  if (!showBoundaries) return travelled;
  const boundaries = getBoundarySegments(streetEl);
  return [
    ...boundaries.left.slice().reverse(),
    ...travelled,
    ...boundaries.right
  ];
}

// Per-generator-type "more" disclosure state, remembered for the session
// (across selection changes) but deliberately not persisted. Keyed by the
// base component name so Clones and Clones 2 share one state.
const moreOpenByType = {};

export function isMoreOpen(componentName) {
  return !!moreOpenByType[componentName.split('__')[0]];
}

export function setMoreOpen(componentName, open) {
  moreOpenByType[componentName.split('__')[0]] = open;
}
