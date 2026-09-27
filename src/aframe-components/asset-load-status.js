/* global AFRAME */
import useStore from '../store.js';
import { AssetLoadTracker, LOAD_STATUS } from '../asset-load-tracker.js';

// Scene-wide asset load bookkeeping (#2009). Feeds an AssetLoadTracker from
// the load events entities already emit and mirrors its summary into the
// store; the editor's scene graph reads the tracker directly for per-row
// state (`sceneEl.systems['asset-load-status'].tracker`).
//
// Deterministic (counted): gltf-model and gltf-part — `model-loading` opens
// an entry, `model-loaded` / `model-error` settle it; textures — the lazy
// texture hook (src/lazy-textures.js) emits `texture-loading` / `-loaded` /
// `-error` on the scene, keyed by asset id.
// Streaming (activity only): splats via `splat-loading` / `splat-loaded` /
// `splat-error`; tile layers via `stream-active` / `stream-idle`.
//
// Nothing here blocks: the splash and LoadingSceneModal are independent.

const TICK_MS = 1000;

// Entities keyed by element are dropped once they leave the document.
const MODEL_COMPONENTS = new Set(['gltf-model', 'gltf-part']);

/** Whether a gltf-model / gltf-part component instance will load anything. */
function pointsAtModel(component) {
  if (!component) return false;
  const data = component.data;
  if (component.name === 'gltf-part') return !!(data && data.src && data.part);
  return typeof data === 'string' ? data !== '' : !!data;
}

function isAlive(key) {
  return typeof key === 'string' || key.isConnected !== false;
}

AFRAME.registerSystem('asset-load-status', {
  init: function () {
    const sceneEl = this.el;
    const tracker = (this.tracker = new AssetLoadTracker({ isAlive }));

    this.handlers = {
      'model-loading': (e) =>
        tracker.begin(e.target, {
          kind: 'model',
          src: e.detail && e.detail.src
        }),
      'model-loaded': (e) => tracker.settle(e.target, LOAD_STATUS.LOADED),
      'model-error': (e) => tracker.settle(e.target, LOAD_STATUS.ERROR),
      'texture-loading': (e) =>
        tracker.begin(textureKey(e.detail), {
          kind: 'texture',
          src: e.detail && e.detail.src
        }),
      'texture-loaded': (e) =>
        tracker.settle(textureKey(e.detail), LOAD_STATUS.LOADED),
      'texture-error': (e) =>
        tracker.settle(textureKey(e.detail), LOAD_STATUS.ERROR),
      'splat-loading': (e) =>
        tracker.setStreaming(e.target, true, { kind: 'splat' }),
      'splat-loaded': (e) =>
        tracker.setStreaming(e.target, false, { kind: 'splat' }),
      'splat-error': (e) =>
        tracker.setStreaming(e.target, false, { kind: 'splat' }),
      'stream-active': (e) =>
        tracker.setStreaming(e.target, true, {
          kind: (e.detail && e.detail.kind) || 'stream'
        }),
      'stream-idle': (e) =>
        tracker.setStreaming(e.target, false, {
          kind: (e.detail && e.detail.kind) || 'stream'
        })
    };
    for (const name in this.handlers) {
      sceneEl.addEventListener(name, this.handlers[name]);
    }
    // A model component that changes to point at nothing (gltf-model src
    // cleared, gltf-part without src or part) removes its mesh without any
    // model-loaded / model-error, and a removed component never settles
    // either: forget the entry instead of timing it out as a failure. These
    // events do not bubble: capture phase.
    this.onComponentChanged = (e) => {
      const name = e.detail && e.detail.name;
      if (!MODEL_COMPONENTS.has(name)) return;
      if (!pointsAtModel(e.target.components && e.target.components[name])) {
        tracker.forget(e.target);
      }
    };
    this.onComponentRemoved = (e) => {
      if (MODEL_COMPONENTS.has(e.detail && e.detail.name)) {
        tracker.forget(e.target);
      }
    };
    sceneEl.addEventListener('componentchanged', this.onComponentChanged, true);
    sceneEl.addEventListener('componentremoved', this.onComponentRemoved, true);

    this.unsubscribe = tracker.subscribe(() => {
      useStore.getState().setAssetLoadSummary(tracker.getSummary());
    });
    this.interval = setInterval(() => tracker.tick(), TICK_MS);
  },

  remove: function () {
    for (const name in this.handlers) {
      this.el.removeEventListener(name, this.handlers[name]);
    }
    this.el.removeEventListener(
      'componentchanged',
      this.onComponentChanged,
      true
    );
    this.el.removeEventListener(
      'componentremoved',
      this.onComponentRemoved,
      true
    );
    if (this.unsubscribe) this.unsubscribe();
    clearInterval(this.interval);
  }
});

function textureKey(detail) {
  if (!detail) return null;
  return 'texture:' + (detail.id || detail.src || '');
}
