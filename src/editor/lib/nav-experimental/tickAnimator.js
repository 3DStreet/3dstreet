/* global AFRAME */

// Per-frame pulse for nav-experimental. Two surfaces:
//
//   subscribe(fn) -> unsubscribe()    // called every frame with delta-ms
//   animate({ durationMs, ease, onTick, onDone }) -> handle
//
// `animate` is built on `subscribe`. WASD uses `subscribe` directly; Plan
// View (and future Phase 3 swoop / Phase 5 transitions) use `animate`.
//
// Implementation: a `nav-experimental-tick` A-Frame component, attached
// to a hidden child entity of the scene. Mirrors the `focus-animation`
// pattern (component on a regular entity, ticked by the standard scene
// render loop). Multiple TickAnimator instances share the single child
// entity via the module-level `_registeredTickAnimators` set.

const COMPONENT_NAME = 'nav-experimental-tick';
const _registeredTickAnimators = new Set();
let _componentRegistered = false;
let _hostEntity = null;

function _ensureComponentRegistered() {
  if (_componentRegistered) return;
  if (typeof AFRAME === 'undefined' || !AFRAME.registerComponent) return;
  if (AFRAME.components && AFRAME.components[COMPONENT_NAME]) {
    _componentRegistered = true;
    return;
  }
  AFRAME.registerComponent(COMPONENT_NAME, {
    tick(t, delta) {
      const snapshot = Array.from(_registeredTickAnimators);
      for (const ta of snapshot) ta._tick(delta);
    }
  });
  _componentRegistered = true;
}

function _ensureHostEntity(sceneEl) {
  if (_hostEntity && _hostEntity.isConnected) return;
  if (!sceneEl) return;
  // Create a hidden child entity with the tick component. A-Frame
  // initializes the component when the entity is appended to the scene,
  // and the component's tick is added to the scene's behaviors.tick array
  // via the standard component lifecycle.
  const ent = document.createElement('a-entity');
  ent.setAttribute('id', 'nav-experimental-tick-host');
  ent.setAttribute(COMPONENT_NAME, '');
  ent.setAttribute('visible', 'false');
  sceneEl.appendChild(ent);
  _hostEntity = ent;
}

function _teardownIfIdle() {
  if (_registeredTickAnimators.size > 0) return;
  if (_hostEntity && _hostEntity.parentNode) {
    _hostEntity.parentNode.removeChild(_hostEntity);
  }
  _hostEntity = null;
}

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

export class TickAnimator {
  constructor(sceneEl) {
    this._sceneEl = sceneEl || null;
    this._subscribers = new Set();
    this._currentTween = null;
    _registeredTickAnimators.add(this);
    _ensureComponentRegistered();
    _ensureHostEntity(sceneEl);
  }

  subscribe(fn) {
    this._subscribers.add(fn);
    return () => this._subscribers.delete(fn);
  }

  animate({ durationMs, ease, onTick, onDone }) {
    this.cancel();
    const e = ease || easeInOutQuad;
    const total = Math.max(1, durationMs || 0);
    let elapsed = 0;
    const sub = (delta) => {
      elapsed += delta;
      const tRaw = Math.min(1, elapsed / total);
      const tEased = e(tRaw);
      if (onTick) onTick(tEased, tRaw);
      if (tRaw >= 1) {
        unsubscribe();
        this._currentTween = null;
        if (onDone) onDone();
      }
    };
    const unsubscribe = this.subscribe(sub);
    const handle = {
      cancel: () => {
        unsubscribe();
        if (this._currentTween === handle) this._currentTween = null;
      },
      isActive: () => this._currentTween === handle
    };
    this._currentTween = handle;
    return handle;
  }

  cancel() {
    if (this._currentTween) this._currentTween.cancel();
    this._currentTween = null;
  }

  isAnimating() {
    return this._currentTween !== null;
  }

  _tick(delta) {
    const snapshot = Array.from(this._subscribers);
    for (const fn of snapshot) {
      try {
        fn(delta);
      } catch (err) {
        console.error('[nav-experimental] tick subscriber threw', err);
      }
    }
  }

  dispose() {
    this.cancel();
    this._subscribers.clear();
    _registeredTickAnimators.delete(this);
    _teardownIfIdle();
  }
}

// Test seam.
export const _internals = {
  easeInOutQuad,
  _registeredTickAnimators,
  COMPONENT_NAME
};
