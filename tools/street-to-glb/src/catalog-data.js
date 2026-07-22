// catalog-data.js — the managed-street constants ported verbatim from the app
// so the assembler is a faithful, DOM-free reimplementation.
//
// Sources (kept in sync by hand):
//   src/aframe-components/street-segment.js         COLORS, TYPES, surface maps
//   src/tested/street-segment-utils.js              height math
//   src/aframe-components/street-generated-clones.js buildingWidths / buildingDepths
//   src/aframe-components/street-label.js           SURFACE_SWATCHES
//   src/assets.js                                   texture + legacy model URLs
//   src/catalog.json                                model src + baseRotation

import { readFileSync } from 'node:fs';

export const ASSET_BASE = 'https://assets.3dstreet.app/';

// --- catalog.json --------------------------------------------------------
export const catalog = JSON.parse(
  readFileSync(new URL('../../../src/catalog.json', import.meta.url), 'utf8')
);
const catalogById = new Map(catalog.filter((e) => e.id).map((e) => [e.id, e]));

// --- STREET.colors (street-segment.js) -----------------------------------
export const COLORS = {
  red: '#ff9393',
  blue: '#00b6b6',
  green: '#adff83',
  yellow: '#f7d117',
  lightGray: '#dddddd',
  white: '#ffffff',
  brown: '#664B00'
};

// --- height math (street-segment-utils.js) -------------------------------
export const BASE_SURFACE_DEPTH = 0.15;
export function calculateHeight(elevation) {
  if (elevation === undefined || elevation === null) return BASE_SURFACE_DEPTH;
  return Math.max(BASE_SURFACE_DEPTH, BASE_SURFACE_DEPTH + elevation);
}

// --- surface → texture id (street-segment.js generateMesh) ---------------
const textureMaps = {
  asphalt: 'seamless-road',
  concrete: 'seamless-bright-road',
  grass: 'grass-texture',
  sidewalk: 'seamless-sidewalk',
  gravel: 'compacted-gravel-texture',
  sand: 'sandy-asphalt-texture',
  'cracked-asphalt': 'asphalt-texture',
  'parking-lot': 'parking-lot-texture',
  water: 'water-texture',
  hatched: 'hatched-base',
  none: 'none',
  solid: ''
};

// texture id → CDN image URL (src/assets.js). water has no diffuse image.
const textureUrls = {
  'seamless-road': 'materials/TexturesCom_Roads0086_1_seamless_S_rotate.jpg',
  'seamless-bright-road': 'materials/asphalthd_Base_Color.jpg',
  'seamless-sidewalk': 'materials/TexturesCom_FloorsRegular0301_1_seamless_S.jpg',
  'hatched-base': 'materials/seamless-lane-with-hatch-half.jpg',
  'grass-texture': 'materials/TexturesCom_Grass0052_1_seamless_S.jpg',
  'compacted-gravel-texture': 'materials/compacted-gravel_color.webp',
  'parking-lot-texture': 'materials/TexturesCom_Roads0111_1_seamless_S.jpg',
  'asphalt-texture': 'materials/TexturesCom_AsphaltDamaged0057_1_seamless_S.jpg',
  'sandy-asphalt-texture': 'materials/sandy-asphalt-texture_color.webp'
};

// Resolve a segment surface to { textureUrl|null, visible }.
export function surfaceTexture(surface) {
  const id = textureMaps[surface];
  if (id === 'none' || id === undefined) return { textureUrl: null, visible: false };
  const rel = textureUrls[id];
  return { textureUrl: rel ? ASSET_BASE + rel : null, visible: true };
}

// street-segment.js calculateTextureRepeat(length, width, textureSourceId)
export function calculateTextureRepeat(length, width, surface) {
  const textureSourceId = textureMaps[surface];
  let repeatX = 0.3;
  let repeatY = length / 6;
  if (textureSourceId === 'seamless-bright-road') {
    repeatX = width / 8;
    repeatY = length / 8;
  } else if (textureSourceId === 'seamless-sandy-road') {
    repeatX = width / 30;
    repeatY = length / 30;
  } else if (textureSourceId === 'seamless-sidewalk') {
    repeatX = width / 2;
    repeatY = length / 2;
  } else if (textureSourceId === 'grass-texture') {
    repeatX = width / 4;
    repeatY = length / 6;
  } else if (textureSourceId === 'asphalt-texture') {
    repeatX = width / 8;
    repeatY = length / 8;
  } else if (textureSourceId === 'parking-lot-texture') {
    repeatX = width / 80;
    repeatY = length / 40;
  } else if (textureSourceId === 'water-texture') {
    repeatX = width / 5;
    repeatY = length / 5;
  } else if (textureSourceId === 'hatched-base') {
    repeatX = 1;
    repeatY = length / 4;
  }
  return [repeatX, repeatY];
}

// --- street-label.js accent swatches -------------------------------------
export const SURFACE_SWATCHES = {
  asphalt: '#4e5459',
  'cracked-asphalt': '#4e5459',
  concrete: '#c4c8cc',
  sidewalk: '#c4c8cc',
  grass: '#81b371',
  'planting-strip': '#81b371',
  gravel: '#b1a58f',
  sand: '#e3d5ac',
  hatched: '#d8dade'
};

export function accentColorFor(color, surface) {
  if (color) {
    const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(color.trim());
    const isNamedWhite = /^white$/i.test(color.trim());
    if (hex && !isNamedWhite) {
      const [r, g, b] =
        hex[1].length === 3
          ? hex[1].split('').map((c) => parseInt(c + c, 16))
          : [0, 2, 4].map((i) => parseInt(hex[1].slice(i, i + 2), 16));
      if ((r + g + b) / 3 < 240) return color;
    } else if (!isNamedWhite && !hex) {
      return color;
    }
  }
  return SURFACE_SWATCHES[surface] || '#d8dade';
}

// --- buildingWidths / buildingDepths (street-generated-clones.js) --------
export const buildingWidths = {
  SM3D_Bld_Mixed_4fl: 5.251,
  SM3D_Bld_Mixed_Double_5fl: 10.9041,
  SM3D_Bld_Mixed_4fl_2: 5.309,
  SM3D_Bld_Mixed_5fl: 5.903,
  SM3D_Bld_Mixed_Corner_4fl: 5.644,
  SM_Bld_House_Preset_03_1800: 20,
  SM_Bld_House_Preset_08_1809: 20,
  SM_Bld_House_Preset_09_1845: 20,
  'arched-building-01': 9.191,
  'arched-building-02': 11.19,
  'arched-building-03': 13.191,
  'arched-building-04': 15.191,
  seawall: 15,
  'sp-prop-mixeduse-2L-29ft': 8.84,
  'sp-prop-mixeduse-2L-30ft': 9.14,
  'sp-prop-mixeduse-3L-18ft': 5.49,
  'sp-prop-mixeduse-3L-22ft': 6.71,
  'sp-prop-mixeduse-3L-23ft-corner': 7.01,
  'sp-prop-mixeduse-3L-42ft': 12.8,
  'sp-prop-mixeduse-3L-78ft-corner': 23.77,
  'sp-prop-sf-2L-64ft': 19.5,
  'sp-prop-sf-2L-62ft': 18.9,
  'sp-prop-sf-1L-62ft': 18.9,
  'sp-prop-sf-1L-41ft': 12.5,
  'sp-prop-townhouse-3L-20ft': 6.1,
  'sp-prop-townhouse-3L-23ft': 7.01,
  'sp-prop-bigbox-1L-220ft': 67,
  'sp-prop-bigbox-1L-291ft': 88.7,
  'sp-prop-parking-3L-155ft': 47.2,
  'sp-prop-parking-3L-97ft-centered': 29.6,
  'sp-prop-gov-3L-61ft': 18.6
};

export const buildingDepths = {
  SM3D_Bld_Mixed_4fl: 6,
  SM3D_Bld_Mixed_Double_5fl: 6,
  SM3D_Bld_Mixed_4fl_2: 6,
  SM3D_Bld_Mixed_5fl: 6,
  SM3D_Bld_Mixed_Corner_4fl: 6,
  SM_Bld_House_Preset_03_1800: 20,
  SM_Bld_House_Preset_08_1809: 20,
  SM_Bld_House_Preset_09_1845: 20,
  'arched-building-01': 10,
  'arched-building-02': 10,
  'arched-building-03': 10,
  'arched-building-04': 10,
  'sp-prop-mixeduse-2L-29ft': 16,
  'sp-prop-mixeduse-2L-30ft': 16,
  'sp-prop-mixeduse-3L-18ft': 8,
  'sp-prop-mixeduse-3L-22ft': 7.2,
  'sp-prop-mixeduse-3L-23ft-corner': 7.09,
  'sp-prop-mixeduse-3L-42ft': 16.42,
  'sp-prop-mixeduse-3L-78ft-corner': 27.3,
  'sp-prop-sf-2L-64ft': 15.22,
  'sp-prop-sf-2L-62ft': 18.36,
  'sp-prop-sf-1L-62ft': 24.27,
  'sp-prop-sf-1L-41ft': 10.15,
  'sp-prop-townhouse-3L-20ft': 10.22,
  'sp-prop-townhouse-3L-23ft': 10.22,
  'sp-prop-bigbox-1L-220ft': 44.79,
  'sp-prop-bigbox-1L-291ft': 79,
  'sp-prop-parking-3L-155ft': 43.14,
  'sp-prop-parking-3L-97ft-centered': 43.14,
  'sp-prop-gov-3L-61ft': 16.23
};

// --- boundary variants (street-segment.js TYPES.boundary.variants) -------
export const BOUNDARY_VARIANTS = {
  brownstone: {
    modelsArray:
      'SM3D_Bld_Mixed_4fl, SM3D_Bld_Mixed_Corner_4fl, SM3D_Bld_Mixed_5fl, SM3D_Bld_Mixed_4fl_2, SM3D_Bld_Mixed_Double_5fl',
    surface: 'cracked-asphalt'
  },
  suburban: {
    modelsArray:
      'SM_Bld_House_Preset_03_1800, SM_Bld_House_Preset_08_1809, SM_Bld_House_Preset_09_1845',
    spacing: 2,
    surface: 'grass'
  },
  arcade: {
    modelsArray:
      'arched-building-01, arched-building-02, arched-building-03, arched-building-04',
    surface: 'sidewalk'
  },
  water: {
    modelsArray: 'seawall',
    surface: 'water',
    spacing: 0,
    mode: 'fit',
    positionY: 0.5
  },
  grass: { modelsArray: 'fence', surface: 'grass', spacing: -0.75, mode: 'fit' },
  parking: {
    modelsArray: 'fence',
    surface: 'parking-lot',
    spacing: -0.75,
    mode: 'fit'
  },
  'sp-mixeduse': {
    modelsArray:
      'sp-prop-mixeduse-2L-29ft, sp-prop-mixeduse-2L-30ft, sp-prop-mixeduse-3L-18ft, sp-prop-mixeduse-3L-22ft, sp-prop-mixeduse-3L-23ft-corner, sp-prop-mixeduse-3L-42ft, sp-prop-mixeduse-3L-78ft-corner',
    surface: 'sidewalk'
  },
  'sp-residential': {
    modelsArray:
      'sp-prop-sf-2L-64ft, sp-prop-sf-2L-62ft, sp-prop-sf-1L-62ft, sp-prop-sf-1L-41ft, sp-prop-townhouse-3L-20ft, sp-prop-townhouse-3L-23ft',
    surface: 'grass'
  },
  'sp-big-box': {
    modelsArray:
      'sp-prop-bigbox-1L-220ft, sp-prop-bigbox-1L-291ft, sp-prop-parking-3L-155ft, sp-prop-parking-3L-97ft-centered, sp-prop-gov-3L-61ft',
    surface: 'parking-lot'
  },
  custom: {}
};

// --- stencil atlas cells (src/assets.js stencils block) ------------------
// [scaleX, scaleY, totalRows, totalColumns, row, column]  (1-indexed row/col)
export const STENCIL_ATLAS = {
  right: [2, 2, 4, 4, 2, 3],
  left: [2, 2, 4, 4, 3, 3],
  both: [2, 2, 4, 4, 1, 2],
  all: [2, 2, 4, 4, 1, 3],
  'left-straight': [2, 2, 4, 4, 3, 2],
  'right-straight': [2, 2, 4, 4, 2, 2],
  straight: [2, 2, 4, 4, 4, 2],
  sharrow: [1.5, 3, 4, 8, 3, 2],
  'bike-arrow': [1, 4, 2, 8, 2, 1],
  'word-bus': [3, 3, 8, 8, 4, 1],
  'word-lane': [3, 3, 8, 8, 4, 2],
  'word-taxi': [3, 3, 8, 8, 3, 1],
  'word-only': [3, 3, 8, 8, 3, 2],
  'word-only-small': [2.5, 2, 8, 8, 3, 2],
  'word-yield': [3, 3, 8, 8, 2, 1],
  'word-slow': [3, 3, 8, 8, 2, 2],
  'word-xing': [3, 3, 8, 8, 1, 1],
  'word-stop': [3, 3, 8, 8, 1, 2],
  'word-loading-small': [2.75, 1.75, 8, 4, 1, 4],
  'perpendicular-stalls': [5, 10, 4, 8, 4, 5],
  'parking-t': [1.5, 2, 8, 16, 7, 4],
  'hash-left': [3, 6, 4, 8, 2, 7],
  'hash-right': [3, 6, 4, 8, 2, 8],
  'hash-chevron': [3, 3, 4, 4, 2, 4]
};
export const STENCIL_ATLAS_URL = ASSET_BASE + 'materials/stencils-atlas_2048.png';

// --- striping (street-generated-striping.js calculateStripingMaterial) ---
const STRIPE_YELLOW = '#f7d117';
export const STRIPING = {
  'solid-stripe': ['striping-solid-stripe', 6, '#ffffff', 0.2],
  'solid-stripe-yellow': ['striping-solid-stripe', 6, STRIPE_YELLOW, 0.2],
  'dashed-stripe': ['striping-dashed-stripe', 6, '#ffffff', 0.2],
  'short-dashed-stripe': ['striping-dashed-stripe', 3, '#ffffff', 0.2],
  'short-dashed-stripe-yellow': ['striping-dashed-stripe', 3, STRIPE_YELLOW, 0.2],
  'solid-doubleyellow': ['striping-solid-double', 6, STRIPE_YELLOW, 0.5],
  'solid-dashed': ['striping-solid-dashed', 6, '#ffffff', 0.4],
  'solid-dashed-yellow': ['striping-solid-dashed', 6, STRIPE_YELLOW, 0.4],
  'solid-dashed-yellow-mirror': ['striping-solid-dashed-mirror', 6, STRIPE_YELLOW, 0.4]
};
const stripingTextureFiles = {
  'striping-solid-stripe': 'materials/striping-solid-stripe-128-1024.webp',
  'striping-dashed-stripe': 'materials/striping-dashed-stripe-128-1024.webp',
  'striping-solid-double': 'materials/striping-solid-double-256-1024.webp',
  'striping-solid-dashed': 'materials/striping-solid-dashed-256-1024.webp',
  'striping-solid-dashed-mirror':
    'materials/striping-solid-dashed-mirror-256-1024.webp'
};
export function stripingTextureUrl(id) {
  const rel = stripingTextureFiles[id];
  return rel ? ASSET_BASE + rel : null;
}

// --- legacy hardcoded mixins (src/assets.js) not carrying catalog src ----
const SHARED_GLB = {
  humans: 'sets/human-characters-poses-1/gltf-exports/draco/human-characters-poses-1.glb',
  humans2: 'sets/human-characters-poses-2/gltf-exports/draco/human-characters-poses-2.glb',
  streetProps: 'sets/street-props/gltf-exports/draco/street-props.glb',
  microMobilityDevices:
    'sets/micro-mobility-devices/gltf-exports/draco/micro-mobility-devices_v01.glb'
};
const LEGACY_MODELS = {
  bus: { src: 'sets/flyer-bus/gltf-exports/draco/new-flyer-bus.glb' },
  tram: { src: 'sets/light-rail-vehicle/gltf-exports/draco/light_rail_vehicle.glb' },
  trolley: { src: 'sets/sanfrancisco-cablecar/gltf-exports/draco/sanfrancisco-cablecar_v01.glb' },
  fence: { src: 'sets/fences/gltf-exports/draco/fence4.glb', scale: 0.1 },
  seawall: { src: SHARED_GLB.streetProps, part: 'sea_wall' },
  Bicycle_1: { src: SHARED_GLB.microMobilityDevices, part: 'Bicycle_1' },
  ElectricScooter_1: { src: SHARED_GLB.microMobilityDevices, part: 'ElectricScooter_1' }
};
for (let i = 1; i <= 8; i++)
  LEGACY_MODELS['char' + i] = { src: SHARED_GLB.humans, part: 'Character_' + i };
for (let i = 9; i <= 16; i++)
  LEGACY_MODELS['char' + i] = { src: SHARED_GLB.humans2, part: 'Character_' + i };

// Resolve a mixin id to a loadable model descriptor, or null if unknown.
// { url, part?, baseRotation, scale? }
export function resolveModel(id) {
  const entry = catalogById.get(id);
  if (entry && entry.src) {
    return { url: ASSET_BASE + entry.src, baseRotation: entry.baseRotation || 0 };
  }
  const legacy = LEGACY_MODELS[id];
  if (legacy) {
    return {
      url: ASSET_BASE + legacy.src,
      part: legacy.part,
      baseRotation: (entry && entry.baseRotation) || 0,
      scale: legacy.scale
    };
  }
  return null;
}

export function baseRotationFor(id) {
  return catalogById.get(id)?.baseRotation || 0;
}
