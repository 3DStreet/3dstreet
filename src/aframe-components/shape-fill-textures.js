/* global THREE */

// The textures one shape's fill needs: a street-surface image for the material
// layer and a drawn tile for the pattern layer. update(data) compares what the
// shape wants now with what it holds and moves between them; shape.js owns
// the colours, opacities and draw groups. When a texture is wanted, how
// surfaces are cached and how tiles are shared: docs/shapes.md
// "Fill appearance".

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
function lookupSurface(sceneEl, id) {
  return surfaceCache(sceneEl).get(id);
}

// Create the pending entry and send the request. The waiter is in the entry
// before the request goes out, so even a loader that answered re-entrantly
// would find it there. Waiters are told inside the load callback itself.
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
// one release; the last release disposes the texture, which frees its GPU copy.
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

// --- Per-shape fill textures -----------------------------------------------

// `materials` is the fill's two THREE materials, [material layer, pattern
// layer]; this object sets only their `map`. The other functions are
// injectable for tests; the surface cache always runs in front of
// `loadTexture`.
export function createFillTextures({
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
  const [materialLayerMat, patternLayerMat] = materials;
  // Read-only to callers.
  //   surface.status: 'none' (nothing asked for yet), 'pending' (loading),
  //     'loaded' or 'failed'. `surface.id` is kept when the surface stops being
  //     wanted, so wanting it again needs no new request. A bound map always
  //     has status 'loaded'.
  //   pattern.swapFrame: the frame handle of a scheduled tile swap, or null.
  const state = {
    surface: { id: null, status: 'none', texture: null, bound: false },
    pattern: { key: null, texture: null, bound: false, swapFrame: null }
  };
  let disposed = false;
  let lastData = null;

  // Three compiles a separate program for a material with and without a map,
  // so gaining or losing one needs needsUpdate; swapping one map for another
  // does not.
  function setMap(material, texture) {
    const hadMap = !!material.map;
    material.map = texture;
    if (hadMap !== !!texture) material.needsUpdate = true;
  }

  // --- surface ---

  function bindSurface() {
    setMap(materialLayerMat, state.surface.texture);
    state.surface.bound = true;
  }

  function unbindSurface() {
    setMap(materialLayerMat, null);
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
    // A texture another shape already loaded is bound at once, with no
    // callback.
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

  function cancelSwap() {
    const p = state.pattern;
    if (p.swapFrame !== null) {
      cancel(p.swapFrame);
      p.swapFrame = null;
    }
  }

  // Release and unbind the held tile. Returns whether a tile was held.
  function releaseHeldPattern() {
    const p = state.pattern;
    if (p.key === null) return false;
    releasePattern(p.key);
    if (p.bound) setMap(patternLayerMat, null);
    p.key = null;
    p.texture = null;
    p.bound = false;
    return true;
  }

  // Acquire and bind the tile for `key`, then release the one it replaces.
  function bindPattern(key) {
    const p = state.pattern;
    const texture = acquirePattern(key);
    const old = p.key;
    p.key = key;
    p.texture = texture;
    setMap(patternLayerMat, texture);
    p.bound = true;
    if (old !== null) releasePattern(old);
  }

  // A scheduled swap re-reads what is wanted when it runs, so edits made since
  // it was scheduled - including turning the pattern off - win.
  function runSwap() {
    const p = state.pattern;
    p.swapFrame = null;
    if (disposed) return;
    const wanted = wantedPatternKey(lastData);
    let changed = false;
    if (wanted === null) {
      changed = releaseHeldPattern();
    } else if (wanted !== p.key) {
      bindPattern(wanted);
      changed = true;
    }
    if (changed) onChange();
  }

  function updatePattern(wanted) {
    const p = state.pattern;
    if (wanted === null) {
      cancelSwap();
      releaseHeldPattern();
      return;
    }
    // The first tile is drawn at once, so the pattern never shows without it.
    if (p.key === null) {
      cancelSwap();
      bindPattern(wanted);
      return;
    }
    if (p.key === wanted) {
      cancelSwap();
      return;
    }
    // A different tile waits a frame, so a scrub costs one raster per frame;
    // the old tile stays bound until then.
    if (p.swapFrame === null) p.swapFrame = schedule(runSwap);
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
      cancelSwap();
      releaseHeldPattern();
      disposed = true;
    }
  };
}
