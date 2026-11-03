// The pure half of a closed shape's fill appearance: the material and pattern
// catalogues, the fill's UV frame, and the pattern geometry. No THREE and no
// DOM, so every rule here is tested directly; the A-Frame side
// (shape.js, shape-fill-textures.js) wraps these in materials and textures.
//
// The frame. Both layers share one UV set, in metres, in the shape's own
// (entity-local) x/z frame, measured from the entity origin - the gizmo point,
// which no vertex edit moves. So a pattern never stretches with the outline,
// and dragging a vertex never slides it.
//
//   - Angle θ (degrees) turns the frame the way a positive rotation.y turns an
//     object. At θ = 0 "along" runs toward -z, which is the direction a street
//     segment runs its surface texture along its length (a BoxGeometry top
//     face has u increasing with +x and v increasing toward -z), so a texture
//     lies on a shape exactly as on an unrotated segment.
//   - u = across = x cos θ - z sin θ - offsetAcross
//     v = along  = -x sin θ - z cos θ - offsetAlong
//     Offsets are subtracted after rotation, so they follow Angle, and a
//     positive "along" slides the pattern toward the shape's second vertex.
//   - At offset 0, 0 a stripe or tile edge passes through the origin.
//
// Each layer's real-world size is then a texture `repeat` (1 / tile size), which
// glTF carries as a scale-only KHR_texture_transform. See docs/shapes.md
// "Fill appearance".

import { SURFACE_ASSET_IDS } from './street-segment-utils.js';

// --- Catalogues ------------------------------------------------------------

// The fill's material list, in panel order. shapeStyle.js and the shape
// schema take their lists from here. `tileAcross` x `tileAlong` is the
// real-world size of one image in metres, the same size a street segment of
// that surface paints it at (calculateTextureRepeat in street-segment.js), so a
// shape beside a segment shows the same grain. Sand and gravel have no fixed
// segment size - a segment stretches them across its lane - so theirs
// reproduce a segment's texel density at a 3.25 m lane.
export const FILL_MATERIALS = {
  solid: { textureId: null },
  concrete: {
    textureId: SURFACE_ASSET_IDS.concrete,
    tileAcross: 8,
    tileAlong: 8
  },
  grass: { textureId: SURFACE_ASSET_IDS.grass, tileAcross: 4, tileAlong: 6 },
  sidewalk: {
    textureId: SURFACE_ASSET_IDS.sidewalk,
    tileAcross: 2,
    tileAlong: 2
  },
  gravel: {
    textureId: SURFACE_ASSET_IDS.gravel,
    tileAcross: 10.8,
    tileAlong: 6
  },
  sand: { textureId: SURFACE_ASSET_IDS.sand, tileAcross: 10.8, tileAlong: 6 },
  'cracked-asphalt': {
    textureId: SURFACE_ASSET_IDS['cracked-asphalt'],
    tileAcross: 8,
    tileAlong: 8
  },
  'parking-lot': {
    textureId: SURFACE_ASSET_IDS['parking-lot'],
    tileAcross: 80,
    tileAlong: 40
  }
};

export const FILL_MATERIAL_IDS = Object.keys(FILL_MATERIALS);

export const FILL_PATTERNS = [
  'none',
  'stripes',
  'crosshatch',
  'checkerboard',
  'dots'
];

// A-Frame does not validate `oneOf`, so a stored value can be anything a saved
// scene or setAttribute put there. An unknown one renders as the default and
// is left as stored.
export function resolveFillMaterial(value) {
  return Object.prototype.hasOwnProperty.call(FILL_MATERIALS, value)
    ? value
    : 'solid';
}

export function resolveFillPattern(value) {
  return FILL_PATTERNS.includes(value) ? value : 'none';
}

// --- Pattern size guards ---------------------------------------------------

// The pattern lengths' fallbacks and floors, in metres, for the render guard
// below and the sticky style. They match the literals in the shape schema
// (a components-suite test compares them); the schema's minimums bind only
// the properties panel, so the guard applies them again.
export const PATTERN_SPACING_DEFAULT = 1;
export const PATTERN_WIDTH_DEFAULT = 0.15;
export const PATTERN_SPACING_MIN = 0.05;
export const PATTERN_WIDTH_MIN = 0.01;

function guardLength(value, fallback, min) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n < min ? min : n;
}

// The spacing and width a pattern is drawn at: a non-finite value takes the
// default, a value below the minimum takes the minimum, and the width never
// exceeds the spacing (a stripe as wide as its pitch is a solid sheet). Stored
// values are never rewritten.
export function effectivePatternSize(spacing, width) {
  const s = guardLength(spacing, PATTERN_SPACING_DEFAULT, PATTERN_SPACING_MIN);
  const w = guardLength(width, PATTERN_WIDTH_DEFAULT, PATTERN_WIDTH_MIN);
  return { spacing: s, width: w > s ? s : w };
}

// One string per exact (pattern, spacing, width), the identity of a drawn
// pattern tile. Checkerboard has no width. Numbers stringify and parse back
// exactly, so the key carries the tuple without loss.
export function patternKey(pattern, spacing, width) {
  return pattern === 'checkerboard'
    ? `${pattern}|${spacing}`
    : `${pattern}|${spacing}|${width}`;
}

export function parsePatternKey(key) {
  const [pattern, spacing, width] = key.split('|');
  const s = Number(spacing);
  return {
    pattern,
    spacing: s,
    width: width === undefined ? s : Number(width)
  };
}

// --- Angle at commit -------------------------------------------------------

const MIN_SIDE_M = 1e-3;
const RAD_TO_DEG = 180 / Math.PI;

// The Angle a newly drawn shape starts with: the plan-view direction of its
// first side of at least 1 mm, in degrees in (-180, 180], rounded to 0.01°.
// Toward -z reads 0 and toward +z reads 180. All sides degenerate → 0.
// `points` are {x, z} positions (world positions at commit: a newly drawn shape
// has no world rotation, even inside a turned group).
export function fillAngleFromRing(points) {
  for (let i = 0; i + 1 < points.length; i++) {
    const sx = points[i + 1].x - points[i].x;
    const sz = points[i + 1].z - points[i].z;
    if (Math.hypot(sx, sz) < MIN_SIDE_M) continue;
    let deg = Math.round(Math.atan2(-sx, -sz) * RAD_TO_DEG * 100) / 100;
    if (deg <= -180) deg += 360;
    return deg === 0 ? 0 : deg;
  }
  return 0;
}

// --- UVs -------------------------------------------------------------------

function finiteOr0(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

// The fill UV of one entity-local point, as [across, along] in metres. The
// reference the in-place writer below is tested against; keep the two in step.
export function fillUV(x, z, angleDeg, offsetAlong, offsetAcross) {
  const t = finiteOr0(angleDeg) / RAD_TO_DEG;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    x * c - z * s - finiteOr0(offsetAcross),
    -x * s - z * c - finiteOr0(offsetAlong)
  ];
}

// Write the fill UVs for flat xyz `positions` into flat uv `uvs`, in place.
// Runs on every rebuild of the cap (every frame of a vertex drag), so it
// allocates nothing.
export function writeFillUVs(
  positions,
  uvs,
  angleDeg,
  offsetAlong,
  offsetAcross
) {
  const t = finiteOr0(angleDeg) / RAD_TO_DEG;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const oAlong = finiteOr0(offsetAlong);
  const oAcross = finiteOr0(offsetAcross);
  const n = uvs.length / 2;
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const z = positions[i * 3 + 2];
    uvs[i * 2] = x * c - z * s - oAcross;
    uvs[i * 2 + 1] = -x * s - z * c - oAlong;
  }
}

// --- Pattern geometry ------------------------------------------------------
//
// In (across, along) metres after offset, with spacing s and width w:
//   stripes      lines along (-1, 1)/√2 - 45° from Angle - covered where
//                ((across + along)/√2) mod s < w; period s√2
//   crosshatch   stripes, plus ((along - across)/√2) mod s < w; period s√2
//   checkerboard squares of side s, covered where
//                floor(across/s) + floor(along/s) is even; period 2s
//   dots         discs of diameter w centred at ((i+½)s, (j+½)s); period s
//
// One tile is one period square. Inside it, (tu, tv) ∈ [0, 1) and the
// width/spacing ratio r is all that matters, so a tile is drawn once per
// pattern and size and repeated at 1/period per metre.

const SQRT2 = Math.SQRT2;

function frac(x) {
  return x - Math.floor(x);
}

export function patternPeriodInSpacings(pattern) {
  if (pattern === 'stripes' || pattern === 'crosshatch') return SQRT2;
  if (pattern === 'checkerboard') return 2;
  return 1;
}

function coverageInTile(pattern, r, tu, tv) {
  switch (pattern) {
    case 'stripes':
      return frac(tu + tv) < r;
    case 'crosshatch':
      return frac(tu + tv) < r || frac(tv - tu) < r;
    case 'checkerboard':
      return (Math.floor(tu * 2) + Math.floor(tv * 2)) % 2 === 0;
    case 'dots': {
      const du = tu - 0.5;
      const dv = tv - 0.5;
      return du * du + dv * dv < (r * r) / 4;
    }
    default:
      return false;
  }
}

// A pattern's tile: its period in spacings, and its coverage in tile units.
function patternTile(pattern, ratio) {
  return {
    periodInSpacings: patternPeriodInSpacings(pattern),
    coverage: (tu, tv) => coverageInTile(pattern, ratio, tu, tv)
  };
}

// Whether the pattern covers the point at fill UV (u, v): the layout the drawn
// tile reproduces, through the same period and coverage the raster uses.
export function patternCoverageAtUV(pattern, u, v, spacing, width) {
  const size = effectivePatternSize(spacing, width);
  const tile = patternTile(pattern, size.width / size.spacing);
  const period = tile.periodInSpacings * size.spacing;
  return tile.coverage(frac(u / period), frac(v / period));
}

// The tile's pixel size: the smallest power of two in [256, 2048] that draws
// the narrowest non-zero feature - a line (r) or a gap (1 - r), in tile units -
// at least 4 px wide, else 2048. Checkerboard's features are half a tile.
const TILE_SIZES = [256, 512, 1024, 2048];
const MIN_FEATURE_PX = 4;

export function patternTileSize(pattern, ratio) {
  if (pattern === 'checkerboard') return TILE_SIZES[0];
  const r = Math.min(1, Math.max(0, Number(ratio) || 0));
  let narrowest = Infinity;
  if (r > 0) narrowest = r;
  if (1 - r > 0 && 1 - r < narrowest) narrowest = 1 - r;
  for (let i = 0; i < TILE_SIZES.length; i++) {
    if (narrowest * TILE_SIZES[i] >= MIN_FEATURE_PX) return TILE_SIZES[i];
  }
  return TILE_SIZES[TILE_SIZES.length - 1];
}

// The tile's RGBA8 pixels, row 0 at tv = 0. RGB is white everywhere and the
// coverage is in alpha (from 2x2 samples per texel), so the pattern layer's
// material colour (fillPatternColor) tints it. White gaps rather than
// transparent black matter: mipmaps average the gaps' RGB into the lines, and
// black would darken them at distance.
export function rasterPatternTile(pattern, ratio, size) {
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let hits = 0;
      for (let sj = 0; sj < 2; sj++) {
        const tv = (j + 0.25 + sj * 0.5) / size;
        for (let si = 0; si < 2; si++) {
          const tu = (i + 0.25 + si * 0.5) / size;
          if (coverageInTile(pattern, ratio, tu, tv)) hits++;
        }
      }
      const o = (j * size + i) * 4;
      data[o] = 255;
      data[o + 1] = 255;
      data[o + 2] = 255;
      data[o + 3] = Math.round((hits * 255) / 4);
    }
  }
  return data;
}
