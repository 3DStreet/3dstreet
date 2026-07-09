/**
 * Pure helpers for the viewer's fixed-aspect (letterboxed) presentation.
 * No AFRAME/DOM imports so they can be unit tested
 * (test/editor/viewer-aspect-utils.test.js) and shared by the store's
 * ?aspect= URL-param seeding without pulling in the A-Frame system.
 */

/**
 * Preset choices offered by the viewer UI. 'fill' means "match the
 * window" (the default, letterbox off); the rest are 'W:H' strings.
 */
export const VIEWER_ASPECT_PRESETS = [
  'fill',
  '16:9',
  '9:16',
  '1:1',
  '4:5',
  '21:9'
];

/**
 * Parse an aspect-ratio string into a width/height number.
 * Accepts 'W:H' / 'WxH' (e.g. '16:9', '9x16') and plain decimals
 * ('1.85'). Returns null for 'fill', empty, malformed, or degenerate
 * input — null means "no fixed aspect", i.e. fill the window.
 *
 * @param {string} value
 * @returns {number|null}
 */
export function parseAspectRatio(value) {
  if (typeof value !== 'string') return null;
  const str = value.trim().toLowerCase();
  if (!str || str === 'fill') return null;
  let ratio;
  const pair = str.match(/^(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)$/);
  if (pair) {
    ratio = parseFloat(pair[1]) / parseFloat(pair[2]);
  } else if (/^\d+(?:\.\d+)?$/.test(str)) {
    ratio = parseFloat(str);
  } else {
    return null;
  }
  // Reject 0/Infinity and absurd slivers that would render nothing useful.
  if (!isFinite(ratio) || ratio < 0.1 || ratio > 10) return null;
  return ratio;
}

/**
 * Largest rectangle of the given aspect that fits the container,
 * centered — the letterbox (or pillarbox) rect, in integer CSS pixels.
 *
 * @param {number} aspect width/height ratio (> 0)
 * @param {number} containerWidth
 * @param {number} containerHeight
 * @returns {{width: number, height: number, left: number, top: number}}
 */
export function fitRectToContainer(aspect, containerWidth, containerHeight) {
  let width = containerWidth;
  let height = width / aspect;
  if (height > containerHeight) {
    height = containerHeight;
    width = height * aspect;
  }
  width = Math.max(1, Math.round(width));
  height = Math.max(1, Math.round(height));
  return {
    width,
    height,
    left: Math.round((containerWidth - width) / 2),
    top: Math.round((containerHeight - height) / 2)
  };
}

/**
 * Canonical output resolution for a fixed aspect ratio — the size the
 * render buffer uses while letterboxed, independent of window size and
 * devicePixelRatio, so canvas captures (screentock snapshots,
 * CanvasRecorder's captureStream) are deterministic across devices.
 * The short side is `shortSide` px (default 1080 — the social/video
 * convention: 16:9 → 1920×1080, 9:16 → 1080×1920, 1:1 → 1080×1080,
 * 4:5 → 1080×1350, 21:9 → 2520×1080). Dimensions are rounded to even
 * numbers because H.264 encoders reject odd frame sizes.
 *
 * @param {number} aspect width/height ratio (> 0)
 * @param {number} [shortSide]
 * @returns {{width: number, height: number}}
 */
export function canonicalRenderSize(aspect, shortSide = 1080) {
  const even = (n) => Math.max(2, 2 * Math.round(n / 2));
  return aspect >= 1
    ? { width: even(shortSide * aspect), height: even(shortSide) }
    : { width: even(shortSide), height: even(shortSide / aspect) };
}

/**
 * Cap a CSS-pixel size to the scene's maxCanvasSize (device pixels),
 * preserving aspect — same semantics as A-Frame's private
 * constrainSizeTo (a-scene.js). a-scene.resize() applies this cap when
 * it sizes the renderer, so the viewer-aspect system must re-apply it
 * when sizing the renderer to the letterbox rect itself.
 *
 * @param {{width: number, height: number}} size CSS pixels
 * @param {{width: number, height: number}|undefined} maxSize device px, -1 = uncapped
 * @param {number} pixelRatio window.devicePixelRatio
 * @returns {{width: number, height: number}}
 */
export function constrainSizeTo(size, maxSize, pixelRatio) {
  const out = { width: size.width, height: size.height };
  if (!maxSize || (maxSize.width === -1 && maxSize.height === -1)) {
    return out;
  }
  if (
    out.width * pixelRatio < maxSize.width &&
    out.height * pixelRatio < maxSize.height
  ) {
    return out;
  }
  const aspectRatio = out.width / out.height;
  if (out.width * pixelRatio > maxSize.width && maxSize.width !== -1) {
    out.width = Math.round(maxSize.width / pixelRatio);
    out.height = Math.round(maxSize.width / aspectRatio / pixelRatio);
  }
  if (out.height * pixelRatio > maxSize.height && maxSize.height !== -1) {
    out.height = Math.round(maxSize.height / pixelRatio);
    out.width = Math.round((maxSize.height * aspectRatio) / pixelRatio);
  }
  return out;
}
