/* global THREE */

// Sky placeholder gradients (#2009).
//
// Every preset of `street-environment` except `color` sets the scene
// background and environment from a ~150–220 KB equirectangular JPEG on the
// assets CDN. Until it arrives the scene rendered the renderer's clear color —
// black — for the whole download, which on a cold cache is the longest single
// "nothing is happening" moment of a scene load (the default scene included).
//
// The component now shows a tiny generated equirect texture right away: a
// vertical gradient painted on a canvas from a few color stops sampled off the
// real image (zenith → horizon → nadir), so the placeholder already has the
// preset's light and color. It is also used as `scene.environment` so PBR
// materials get plausible reflections instead of none. The real texture
// replaces it when it lands; on error the gradient stays.

// Row-average colors of each preset's equirect image at evenly spaced
// latitudes from the top of the image (zenith) to the bottom (nadir),
// measured with a canvas over the assets as served. Regenerate by sampling
// again if an image changes.
export const SKY_GRADIENTS = Object.freeze({
  day: [
    '#547d98',
    '#5b84a2',
    '#7aa0b4',
    '#a6bcbd',
    '#a0a394',
    '#8b9e9f',
    '#546d7e',
    '#3a4f61',
    '#334657'
  ],
  night: [
    '#233544',
    '#243745',
    '#2d4351',
    '#456169',
    '#424344',
    '#151a1e',
    '#13181c',
    '#12171b',
    '#11161a'
  ],
  'sunny-morning': [
    '#5773ab',
    '#5a77b3',
    '#7190cc',
    '#92b5e3',
    '#c1cdde',
    '#7c9bca',
    '#50679a',
    '#384b78',
    '#33446d'
  ],
  'cloudy-afternoon': [
    '#edeffb',
    '#eceef6',
    '#d1d2dc',
    '#bfbfc5',
    '#a09fa3',
    '#919198',
    '#80818b',
    '#777984',
    '#71747d'
  ],
  'sunny-afternoon': [
    '#627da5',
    '#6a82a6',
    '#7992b7',
    '#90accc',
    '#b1b7c1',
    '#7891b0',
    '#586a87',
    '#46556f',
    '#3f4e67'
  ],
  'sunny-noon': [
    '#aabad7',
    '#859abd',
    '#6e84a8',
    '#7488a7',
    '#9c9ea9',
    '#5e6d8a',
    '#475673',
    '#535f7a',
    '#626c86'
  ],
  foggy: [
    '#d1dcec',
    '#dce4f2',
    '#e2e5ee',
    '#cfcfd4',
    '#b5b4b7',
    '#a1a2a7',
    '#898d97',
    '#6e7583',
    '#636b79'
  ],
  cloudy: [
    '#5a6e97',
    '#8b97b4',
    '#5d73a4',
    '#8294b6',
    '#969baa',
    '#6c7a98',
    '#525d7b',
    '#5c6378',
    '#5d6276'
  ]
});

export const DEFAULT_SKY_PRESET = 'day';

// Equirect placeholders are tiny on purpose: three.js converts an equirect
// background to a cube map of height / 2 per face, so 128 px tall means a
// 64 px cube and a PMREM that costs nothing.
export const SKY_PLACEHOLDER_WIDTH = 8;
export const SKY_PLACEHOLDER_HEIGHT = 128;

/**
 * Color stops (top → bottom) of a preset's placeholder gradient; unknown
 * presets fall back to `day`.
 * @param {string} preset
 * @returns {string[]}
 */
export function getSkyGradientStops(preset) {
  return SKY_GRADIENTS[preset] || SKY_GRADIENTS[DEFAULT_SKY_PRESET];
}

/**
 * Paint a vertical gradient through `stops` over a 2D canvas context.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} width
 * @param {number} height
 * @param {string[]} stops evenly spaced colors, top → bottom
 */
export function paintSkyGradient(ctx, width, height, stops) {
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  const last = Math.max(1, stops.length - 1);
  stops.forEach((color, i) => gradient.addColorStop(i / last, color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Build the placeholder sky for a preset as an equirectangular canvas
 * texture, ready to assign to `scene.background` / `scene.environment`.
 * @param {string} preset
 * @param {object} [deps] injectable for tests
 * @param {Document} [deps.doc=document]
 * @param {object} [deps.three=THREE]
 * @returns {THREE.CanvasTexture}
 */
export function createSkyPlaceholderTexture(
  preset,
  {
    doc = typeof document !== 'undefined' ? document : undefined,
    three = typeof THREE !== 'undefined' ? THREE : undefined
  } = {}
) {
  const canvas = doc.createElement('canvas');
  canvas.width = SKY_PLACEHOLDER_WIDTH;
  canvas.height = SKY_PLACEHOLDER_HEIGHT;
  paintSkyGradient(
    canvas.getContext('2d'),
    canvas.width,
    canvas.height,
    getSkyGradientStops(preset)
  );
  const texture = new three.CanvasTexture(canvas);
  texture.mapping = three.EquirectangularReflectionMapping;
  texture.colorSpace = three.SRGBColorSpace;
  texture.minFilter = three.LinearFilter;
  texture.magFilter = three.LinearFilter;
  texture.generateMipmaps = false;
  texture.name = 'sky-placeholder:' + preset;
  texture.userData.skyPlaceholder = preset;
  return texture;
}

/**
 * True for a texture made by createSkyPlaceholderTexture.
 * @param {object|null} texture
 * @returns {boolean}
 */
export function isSkyPlaceholder(texture) {
  return !!(texture && texture.userData && texture.userData.skyPlaceholder);
}
