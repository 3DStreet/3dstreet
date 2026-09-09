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

// Generators that orient through their own `direction` property, whose
// schema default 'none' means "fixed absolute orientation via `facing`".
// Every path that creates them for the user (Streetmix/StreetPlan import,
// segment type change) seeds the segment's travel direction into the
// component; segment direction propagation deliberately skips 'none'
// (side-facing benches, angled parking must not flip with the lane).
const DIRECTION_SEEDED_GENERATORS = [
  'street-generated-stencil',
  'street-generated-clones'
];

/**
 * Seed the host lane's travel direction into a generator's initial attribute
 * string, so a manually added stencil/clones component starts out following
 * the lane like the import and type-change creation paths do (#1959).
 * Returns `attrValue` unchanged for non-directional generators, lanes with
 * no travel direction, or a seed value that already sets a direction.
 */
export function seedLaneDirection(componentName, attrValue, segmentDirection) {
  const baseName = componentName.split('__')[0];
  if (!DIRECTION_SEEDED_GENERATORS.includes(baseName)) return attrValue;
  if (segmentDirection !== 'inbound' && segmentDirection !== 'outbound') {
    return attrValue;
  }
  if (/(^|;)\s*direction\s*:/.test(attrValue)) return attrValue;
  const trimmed = attrValue.trim().replace(/;+\s*$/, '');
  return trimmed
    ? `${trimmed}; direction: ${segmentDirection}`
    : `direction: ${segmentDirection}`;
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

// Per-type width presets shown as pills next to the Width field, in the
// user's active unit system. The two tables are curated design values, NOT
// unit conversions of each other: imperial pills are the round foot values
// US guides publish, metric pills are the "nice" decimetre-rounded values
// international guides publish for the same lane role.
//
// Sources (also the basis for the future docs page on these controls):
// - NACTO Urban Street Design Guide — Lane Width: 10 ft lanes recommended
//   in urban areas, 11 ft for designated truck/bus routes, 12 ft historic
//   highway-era default.
//   https://nacto.org/publication/urban-street-design-guide/street-design-elements/lane-width/
// - NACTO Urban Bikeway Design Guide — Bike Lanes: 5–6 ft ridable surface,
//   7 ft where buffered/high-volume.
//   https://nacto.org/publication/urban-bikeway-design-guide/bike-lanes/conventional-bike-lanes/
// - NACTO Urban Street Design Guide — Sidewalks: ~5 ft minimum clear path
//   (ADA), 6–8+ ft for comfortable two-abreast walking on commercial
//   streets.
//   https://nacto.org/publication/urban-street-design-guide/street-design-elements/sidewalks/
// - NACTO — Parking lanes commonly 7–9 ft depending on vehicle mix.
// - NACTO Transit Street Design Guide — transitways/rail 11–14 ft
//   (12 ft typical dedicated lane, 14 ft shared/offset conditions).
//   https://nacto.org/publication/transit-street-design-guide/
// - Dividers/medians: 2 ft painted buffer minimum; 4 ft raised divider;
//   8 ft accommodates planting (NACTO median/refuge guidance uses 6 ft
//   minimum for pedestrian refuges).
// Metric values follow the same roles rounded to the decimetre (e.g. 3.0 /
// 3.3 / 3.6 m general lanes, 1.5–2.1 m bike, 1.5–2.4 m sidewalks), matching
// the figures used in metric editions of these guides.
//
// Types not listed (boundary, grass) get no pills.
export const WIDTH_PRESETS = {
  metric: {
    'drive-lane': [3.0, 3.3, 3.6],
    'bus-lane': [3.0, 3.3, 3.6],
    'bike-lane': [1.5, 1.8, 2.1],
    sidewalk: [1.5, 1.8, 2.4],
    'parking-lane': [2.1, 2.4, 2.7],
    divider: [0.6, 1.2, 2.4],
    rail: [3.4, 3.7, 4.3]
  },
  // Values in feet; committed as their exact metre equivalent.
  imperial: {
    'drive-lane': [10, 11, 12],
    'bus-lane': [10, 11, 12],
    'bike-lane': [5, 6, 7],
    sidewalk: [5, 6, 8],
    'parking-lane': [7, 8, 9],
    divider: [2, 4, 8],
    rail: [11, 12, 14]
  }
};

// UI copy of the surface → A-Frame texture <img> asset id table in
// street-segment.js generateMesh() (keep in sync). Used to draw texture
// swatches in the Material dropdown; entries with no texture fall back to a
// flat chip.
export const SURFACE_TEXTURE_IDS = {
  asphalt: 'seamless-road',
  concrete: 'seamless-bright-road',
  grass: 'grass-texture',
  sidewalk: 'seamless-sidewalk',
  gravel: 'compacted-gravel-texture',
  sand: 'sandy-asphalt-texture',
  'cracked-asphalt': 'asphalt-texture',
  'parking-lot': 'parking-lot-texture'
  // water deliberately omitted: the scene builds its material from a normal
  // map + animation, so the raw texture reads as a black tile; the dropdown
  // shows a flat blue chip instead (getFlatSwatchColor).
};

/** Flat chip color for surfaces the Material dropdown can't show a texture for. */
export function getFlatSwatchColor(surface) {
  if (surface === 'solid') return '#dddddd';
  return SURFACE_COLORS[surface] ?? SURFACE_COLORS.none;
}

// Stencil model → turn movements it paints. Only arrow stencils count;
// words, hashes and sharrows contribute nothing.
const STENCIL_TURNS = {
  left: ['left'],
  right: ['right'],
  straight: ['straight'],
  'left-straight': ['left', 'straight'],
  'right-straight': ['right', 'straight'],
  both: ['left', 'right'],
  all: ['left', 'straight', 'right']
};

/**
 * Union of turn movements painted on a segment by its stencil generators,
 * as { left, straight, right } booleans, or null when no arrow stencil is
 * present (the strip then falls back to the plain direction arrow).
 */
export function getSegmentTurns(segmentEl) {
  const turns = { left: false, straight: false, right: false };
  let any = false;
  Object.keys(segmentEl.components || {}).forEach((name) => {
    if (!name.startsWith('street-generated-stencil')) return;
    const models = segmentEl.components[name]?.data?.modelsArray || [];
    models.forEach((model) => {
      (STENCIL_TURNS[model] || []).forEach((t) => {
        turns[t] = true;
        any = true;
      });
    });
  });
  return any ? turns : null;
}

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
