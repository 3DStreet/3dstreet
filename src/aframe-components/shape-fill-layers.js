/* global THREE */

// A closed shape's fill has two layers on one mesh - the material (a solid
// colour or a surface texture) and a pattern drawn over it - and each layer
// may need a texture: a street-surface image for the material, a drawn tile
// for the pattern. This module owns those textures for one shape, through one
// transition function, update(data), that compares what the shape WANTS now
// with what it HOLDS and moves between them. shape.js only wires it in; the
// colour, opacity and draw groups stay shape.js's.
//
// "Wanted" (shapeFillRender.js) is closed AND that layer painted. It is
// re-checked on every property sync, including init and a `closed` change, so
// a shape created with a texture already set - a loaded scene, a sticky draw
// style, a duplicate, an undone delete - loads it, and the draw tool's open
// preview loads nothing.
//
// SURFACE TEXTURES are scene assets. They load through the A-Frame material
// system's loadTexture, the path the lazy-texture hook patches (download on
// first use, the asset-load tracker's events, one source shared with every
// street segment on that surface), and are held for the scene's life. A
// per-scene cache hands a loaded texture to every later shape at once:
//   - a cache hit is a RETURN VALUE, read inside update(), with no callback;
//   - on a miss the shape records itself as pending and joins the entry's
//     waiters BEFORE the request goes out;
//   - waiters are told synchronously inside the load callback;
//   - so a bound map always belongs to a loaded surface, and shape.js never
//     multiplies a real texture by the placeholder colour.
// A failed load is not retried by an edit to the same shape; the placeholder
// stays (it is retried when the surface is chosen again, or by another shape).
//
// PATTERN TILES are drawn in code (src/tested/shape-fill.js) and shared per
// scene, one texture per exact (pattern, spacing, width), refcounted and
// disposed on the last release - the shared texture is the object three
// uploads, so disposing it frees the GPU copy. A change of tuple on a shape
// that already shows a tile waits for the next frame (several edits in one
// frame - a slider scrub - cost one raster), and the old tile stays bound
// until the new one replaces it, so the pattern never flashes off. The first
// tile is drawn synchronously, so a pattern never appears without its map.
//
// Program switches: three compiles a separate shader for a material with and
// without a map, so a material that gains or loses one needs needsUpdate. A
// swap of one map for another does not.

import {
  FILL_MATERIALS,
  parsePatternKey,
  patternPeriodInSpacings,
  patternTileSize,
  rasterPatternTile
} from '../tested/shape-fill.js';
import { wantedPatternKey, wantedSurfaceId } from './shapeFillRender.js';
import { getAssetImageSrc } from '../lazy-textures.js';

// Surface asset id → the repeat that lays one image over its real-world tile.
const SURFACE_REPEAT = {};
Object.keys(FILL_MATERIALS).forEach((name) => {
  const m = FILL_MATERIALS[name];
  if (m.textureId) {
    SURFACE_REPEAT[m.textureId] = { x: 1 / m.tileAcross, y: 1 / m.tileAlong };
  }
});

// --- Per-scene surface cache ----------------------------------------------

const surfaceCaches = new WeakMap();

function surfaceCache(sceneEl) {
  let cache = surfaceCaches.get(sceneEl);
  if (!cache) {
    cache = new Map();
    surfaceCaches.set(sceneEl, cache);
  }
  return cache;
}

// The scene's cache entry for a surface asset id - { status: 'pending' |
// 'loaded', texture, waiters } - or undefined.
export function lookupSurface(sceneEl, id) {
  return surfaceCache(sceneEl).get(id);
}

// Create the pending entry and send the request. The caller has already
// joined the entry's waiters, so even a loader that answered re-entrantly
// would find it there.
function requestSurface(sceneEl, id, img, loadTexture, waiter) {
  const entry = {
    status: 'pending',
    texture: null,
    waiters: new Set([waiter])
  };
  surfaceCache(sceneEl).set(id, entry);
  loadTexture(img, { repeat: SURFACE_REPEAT[id] }, (texture) => {
    if (texture) {
      // loadTexture leaves colour space alone (A-Frame's material component
      // sets it), and segments are sRGB; matching also lets the two share one
      // GPU upload.
      texture.colorSpace = THREE.SRGBColorSpace;
      entry.status = 'loaded';
      entry.texture = texture;
    } else {
      // Do not keep a failed entry: a later choice of this surface asks again.
      const cache = surfaceCache(sceneEl);
      if (cache.get(id) === entry) cache.delete(id);
    }
    const waiters = Array.from(entry.waiters);
    entry.waiters.clear();
    for (let i = 0; i < waiters.length; i++) {
      waiters[i](id, texture ? 'loaded' : 'failed', texture);
    }
  });
}

// --- Per-scene pattern tile cache ------------------------------------------

const patternCaches = new WeakMap();

function patternCache(sceneEl) {
  let cache = patternCaches.get(sceneEl);
  if (!cache) {
    cache = new Map();
    patternCaches.set(sceneEl, cache);
  }
  return cache;
}

function drawPatternTexture(key) {
  const { pattern, spacing, width } = parsePatternKey(key);
  const ratio = width / spacing;
  const size = patternTileSize(pattern, ratio);
  const texture = new THREE.DataTexture(
    rasterPatternTile(pattern, ratio, size),
    size,
    size
  );
  // A DataTexture defaults to nearest filtering with no mipmaps, which shimmers
  // badly on fine lines seen at a distance.
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.flipY = false;
  texture.premultiplyAlpha = false;
  texture.anisotropy = THREE.Texture.DEFAULT_ANISOTROPY;
  // One tile per period, in metres - the same for every shape holding this
  // tuple, so the shared texture can carry it.
  const period = patternPeriodInSpacings(pattern) * spacing;
  texture.repeat.set(1 / period, 1 / period);
  texture.needsUpdate = true;
  return texture;
}

// The scene's tile for `key`, drawn on first use. Every acquire is matched by
// one release.
export function acquirePatternTexture(sceneEl, key) {
  const cache = patternCache(sceneEl);
  let entry = cache.get(key);
  if (!entry) {
    entry = { texture: drawPatternTexture(key), refCount: 0 };
    cache.set(key, entry);
  }
  entry.refCount++;
  return entry.texture;
}

export function releasePatternTexture(sceneEl, key) {
  const cache = patternCache(sceneEl);
  const entry = cache.get(key);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) {
    entry.texture.dispose();
    cache.delete(key);
  }
}

// --- Per-shape layer resources ---------------------------------------------

// `materials` is [materialLayer, patternLayer]. The other functions are
// injectable for tests; the surface cache always runs in front of
// `loadTexture`.
export function createFillLayers({
  sceneEl,
  materials,
  loadTexture = (img, data, cb) =>
    sceneEl.systems.material.loadTexture(img, data, cb),
  acquirePattern = (key) => acquirePatternTexture(sceneEl, key),
  releasePattern = (key) => releasePatternTexture(sceneEl, key),
  schedule = (fn) => requestAnimationFrame(fn),
  cancel = (handle) => cancelAnimationFrame(handle),
  onChange = () => {}
}) {
  const [surfaceMaterial, patternMaterial] = materials;
  // Read-only to callers. `surface.id` is kept when the surface stops being
  // wanted, so wanting it again needs no new request.
  const state = {
    surface: { id: null, status: 'none', texture: null, bound: false },
    pattern: { key: null, texture: null, bound: false, pending: null }
  };
  let disposed = false;
  let lastData = null;

  function setMap(material, texture) {
    const hadMap = !!material.map;
    material.map = texture;
    if (hadMap !== !!texture) material.needsUpdate = true;
  }

  // --- surface ---

  function bindSurface() {
    setMap(surfaceMaterial, state.surface.texture);
    state.surface.bound = true;
  }

  function unbindSurface() {
    setMap(surfaceMaterial, null);
    state.surface.bound = false;
  }

  // One function per shape, so a shape that leaves a surface and comes back
  // while it is still loading is one waiter, told once.
  function onSurfaceSettled(id, status, texture) {
    const s = state.surface;
    if (disposed || s.id !== id) return;
    s.status = status;
    s.texture = texture || null;
    if (status === 'loaded' && !s.bound && wantedSurfaceId(lastData) === id) {
      bindSurface();
    }
    onChange();
  }

  function updateSurface(wanted) {
    const s = state.surface;
    if (wanted === null) {
      if (s.bound) unbindSurface();
      return;
    }
    if (s.id === wanted) {
      if (s.status === 'loaded' && !s.bound) bindSurface();
      return;
    }
    if (s.bound) unbindSurface();
    s.id = wanted;
    s.texture = null;
    const img = document.getElementById(wanted);
    if (!getAssetImageSrc(img)) {
      // No image to load (the material system would fall through to an
      // unpatched path for it). The colour shows the tint alone.
      s.status = 'failed';
      return;
    }
    const entry = lookupSurface(sceneEl, wanted);
    if (entry && entry.status === 'loaded') {
      s.status = 'loaded';
      s.texture = entry.texture;
      bindSurface();
      return;
    }
    s.status = 'pending';
    if (entry) {
      entry.waiters.add(onSurfaceSettled);
      return;
    }
    requestSurface(sceneEl, wanted, img, loadTexture, onSurfaceSettled);
  }

  // --- pattern ---

  function cancelPending() {
    const p = state.pattern;
    if (p.pending !== null) {
      cancel(p.pending);
      p.pending = null;
    }
  }

  function unwantPattern() {
    const p = state.pattern;
    if (p.key === null) return false;
    releasePattern(p.key);
    if (p.bound) setMap(patternMaterial, null);
    p.key = null;
    p.texture = null;
    p.bound = false;
    return true;
  }

  function takePattern(key) {
    const p = state.pattern;
    const texture = acquirePattern(key);
    const old = p.key;
    p.key = key;
    p.texture = texture;
    setMap(patternMaterial, texture);
    p.bound = true;
    if (old !== null) releasePattern(old);
  }

  function runDeferredPattern() {
    const p = state.pattern;
    p.pending = null;
    if (disposed) return;
    const wanted = wantedPatternKey(lastData);
    let changed = false;
    if (wanted === null) {
      changed = unwantPattern();
    } else if (wanted !== p.key) {
      takePattern(wanted);
      changed = true;
    }
    if (changed) onChange();
  }

  function updatePattern(wanted) {
    const p = state.pattern;
    if (wanted === null) {
      cancelPending();
      unwantPattern();
      return;
    }
    if (p.key === null) {
      cancelPending();
      takePattern(wanted);
      return;
    }
    if (p.key === wanted) {
      cancelPending();
      return;
    }
    if (p.pending === null) p.pending = schedule(runDeferredPattern);
  }

  return {
    state,
    update(data) {
      if (disposed) return;
      lastData = data;
      updateSurface(wantedSurfaceId(data));
      updatePattern(wantedPatternKey(data));
    },
    dispose() {
      if (disposed) return;
      cancelPending();
      unwantPattern();
      disposed = true;
    }
  };
}
