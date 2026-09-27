// Model bounds lookup and registry (#2009).
//
// The model-placeholder system draws a ghost box where a 3D model will
// appear until its GLB has downloaded. That needs the model's bounds before
// the bytes arrive. Two sources:
//   - src/model-bounds.json: precomputed offline by
//     scripts/assets/compute-model-bounds.mjs for every catalog model and
//     every named gltf-part in the shared sets, keyed by asset path relative
//     to the CDN root (`sets/…/bus-rig.glb`, `sets/…/street-props.glb#palmtree`).
//   - a runtime registry for user-uploaded assets, whose bounds live on
//     their Firestore doc (computed by the optimizer worker at upload) and
//     are registered per entity when the scene loader resolves the doc.
//
// Bounds are in glTF model space (meters, Y up): what the model occupies
// under its entity before the entity's own transform. Pure module, no
// A-Frame or three.js; the placeholder system and the loader import it.

import table from './model-bounds.json';

/**
 * Validate and normalize bounds from either the packed JSON form
 * `[minX, minY, minZ, maxX, maxY, maxZ]` or `{ min: [..], max: [..] }`.
 * @returns {{min: number[], max: number[]}|null} null when malformed,
 *   non-finite, inverted, or a single point.
 */
export function normalizeBounds(value) {
  let min;
  let max;
  if (Array.isArray(value) && value.length === 6) {
    min = value.slice(0, 3);
    max = value.slice(3, 6);
  } else if (value && Array.isArray(value.min) && Array.isArray(value.max)) {
    min = value.min.slice(0, 3);
    max = value.max.slice(0, 3);
  } else {
    return null;
  }
  if (min.length !== 3 || max.length !== 3) return null;
  min = min.map(Number);
  max = max.map(Number);
  if (![...min, ...max].every(Number.isFinite)) return null;
  let extent = 0;
  for (let i = 0; i < 3; i++) {
    if (max[i] < min[i]) return null;
    extent = Math.max(extent, max[i] - min[i]);
  }
  if (extent <= 0) return null;
  return { min, max };
}

/**
 * Asset path of a model URL: no scheme/host, no query or hash, no leading
 * `./` or `/`. `url(...)` wrappers are tolerated.
 */
export function assetPathFromUrl(url) {
  if (typeof url !== 'string') return '';
  let path = url
    .trim()
    .replace(/^url\((.*)\)$/, '$1')
    .trim();
  path = path.replace(/[?#].*$/, '');
  path = path.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*\//i, '');
  path = path.replace(/^(\.\/|\/)+/, '');
  return path;
}

/**
 * Build a lookup over a bounds table. A URL matches an entry when its asset
 * path ends with the entry's key, so a custom `<street-assets url>` base
 * with extra path segments still resolves.
 * @param {Record<string, number[]|{min:number[],max:number[]}>} entries
 * @returns {(src: string, part?: string) => {min:number[],max:number[]}|null}
 */
export function createBoundsLookup(entries) {
  const normalized = new Map();
  for (const key of Object.keys(entries || {})) {
    const bounds = normalizeBounds(entries[key]);
    if (bounds) normalized.set(key, bounds);
  }
  return function lookup(src, part) {
    let path = assetPathFromUrl(src);
    if (!path) return null;
    if (part) path += '#' + part;
    // Exact, then progressively drop leading segments (custom base URL).
    for (;;) {
      const hit = normalized.get(path);
      if (hit) return hit;
      const slash = path.indexOf('/');
      if (slash === -1) return null;
      path = path.slice(slash + 1);
    }
  };
}

/** Lookup over the precomputed catalog/mixin table. */
export const lookupModelBounds = createBoundsLookup(table.bounds);

// --- per-entity registry (user assets) ---------------------------------------

const entityBounds = new WeakMap();
const listeners = new Set();

/**
 * Remember bounds for one entity (a user asset whose doc carries them) and
 * notify the placeholder system.
 * @returns {{min:number[],max:number[]}|null} the normalized bounds stored
 */
export function registerEntityBounds(el, bounds) {
  const normalized = normalizeBounds(bounds);
  if (!el || !normalized) return null;
  entityBounds.set(el, normalized);
  for (const listener of Array.from(listeners)) {
    try {
      listener(el, normalized);
    } catch (err) {
      console.error('[model-bounds] listener failed', err);
    }
  }
  return normalized;
}

export function getEntityBounds(el) {
  return (el && entityBounds.get(el)) || null;
}

/** @param {(el: Element, bounds: {min:number[],max:number[]}) => void} listener */
export function onEntityBounds(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
