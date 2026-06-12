import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SceneBounds,
  cylinderFromAABB,
  detectUnbounded
} from '../../../../src/editor/lib/nav-experimental/sceneBounds.js';

// Make a minimal jsdom element that doubles as both the "scene" event
// target and a queryable container. Children are real DOM nodes with
// the relevant attributes so querySelector('[managed-street]') works.
function makeScene() {
  const scene = document.createElement('div');
  document.body.appendChild(scene);
  return scene;
}

function addEntity(scene, attributeNames) {
  const ent = document.createElement('div');
  for (const name of attributeNames) ent.setAttribute(name, '');
  scene.appendChild(ent);
  return ent;
}

function fireComponentChanged(scene, target, name) {
  // A-Frame fires componentchanged with detail.name; the event bubbles
  // up to the scene where SceneBounds listens.
  const event = new CustomEvent('componentchanged', {
    detail: { name },
    bubbles: true
  });
  // Override target to match A-Frame semantics. CustomEvent's target is
  // set by dispatch on the element, so dispatch from `target`.
  target.dispatchEvent(event);
}

describe('cylinderFromAABB', () => {
  it('centers on the AABB midpoint', () => {
    const c = cylinderFromAABB({ x: -2, y: 0, z: -4 }, { x: 2, y: 0, z: 4 });
    expect(c.center).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('uses max horizontal half-extent for radius (long thin street)', () => {
    // Long in Z, narrow in X — radius should be Z half-extent (4),
    // not X half-extent (1). This is the long-narrow-scene fix.
    const c = cylinderFromAABB({ x: -1, y: 0, z: -4 }, { x: 1, y: 0, z: 4 });
    expect(c.radius).toBe(4);
  });

  it('ignores Y in the radius calculation', () => {
    const c = cylinderFromAABB(
      { x: -1, y: -100, z: -1 },
      { x: 1, y: 100, z: 1 }
    );
    expect(c.radius).toBe(1);
  });

  it('handles offset AABBs', () => {
    const c = cylinderFromAABB({ x: 10, y: 0, z: 20 }, { x: 14, y: 0, z: 26 });
    expect(c.center).toEqual({ x: 12, y: 0, z: 23 });
    expect(c.radius).toBe(3);
  });
});

describe('detectUnbounded', () => {
  let scene;
  beforeEach(() => {
    scene = makeScene();
  });
  afterEach(() => scene.remove());

  it('returns false on empty scene', () => {
    expect(detectUnbounded(scene)).toBe(false);
  });

  it('returns false on scene with only managed-street', () => {
    addEntity(scene, ['managed-street']);
    expect(detectUnbounded(scene)).toBe(false);
  });

  it('returns true on scene with street-geo', () => {
    addEntity(scene, ['street-geo']);
    expect(detectUnbounded(scene)).toBe(true);
  });

  it('returns true on scene with google-maps-aerial', () => {
    addEntity(scene, ['google-maps-aerial']);
    expect(detectUnbounded(scene)).toBe(true);
  });

  it('returns false for null sceneEl', () => {
    expect(detectUnbounded(null)).toBe(false);
  });
});

describe('SceneBounds', () => {
  let scene;
  let bounds;

  beforeEach(() => {
    scene = makeScene();
    bounds = new SceneBounds(scene);
  });

  afterEach(() => {
    bounds.dispose();
    scene.remove();
  });

  it('returns empty bounds on a null scene', () => {
    const b = new SceneBounds(null);
    const out = b.getBounds();
    expect(out.bounded).toBe(false);
    expect(out.radius).toBe(0);
  });

  it('reports unbounded when street-geo is present', () => {
    addEntity(scene, ['street-geo']);
    const out = bounds.getBounds();
    expect(out.bounded).toBe(false);
  });

  it('reports unbounded when google-maps-aerial is present', () => {
    addEntity(scene, ['google-maps-aerial']);
    expect(bounds.getBounds().bounded).toBe(false);
  });

  it('reports empty bounds when bounded but no entities have object3D', () => {
    // Without a real A-Frame scene the entities have no object3D;
    // SceneBounds skips them and returns empty bounds rather than
    // crashing.
    addEntity(scene, ['managed-street']);
    const out = bounds.getBounds();
    expect(out.bounded).toBe(false);
  });

  it('caches getBounds() across calls', () => {
    const spy = vi.spyOn(bounds, '_compute');
    bounds.getBounds();
    bounds.getBounds();
    bounds.getBounds();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('invalidates the cache on child-attached', () => {
    const spy = vi.spyOn(bounds, '_compute');
    bounds.getBounds();
    scene.dispatchEvent(new Event('child-attached'));
    bounds.getBounds();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cache on child-detached', () => {
    const spy = vi.spyOn(bounds, '_compute');
    bounds.getBounds();
    scene.dispatchEvent(new Event('child-detached'));
    bounds.getBounds();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('invalidates the cache on newScene', () => {
    const spy = vi.spyOn(bounds, '_compute');
    bounds.getBounds();
    scene.dispatchEvent(new Event('newScene'));
    bounds.getBounds();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('invalidates on componentchanged for a dimension-affecting component on a street-segment', () => {
    const seg = addEntity(scene, ['street-segment']);
    const spy = vi.spyOn(bounds, '_compute');
    bounds.getBounds();
    fireComponentChanged(scene, seg, 'width');
    bounds.getBounds();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('invalidates on componentchanged for length on a street-segment', () => {
    const seg = addEntity(scene, ['street-segment']);
    const spy = vi.spyOn(bounds, '_compute');
    bounds.getBounds();
    fireComponentChanged(scene, seg, 'length');
    bounds.getBounds();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does NOT invalidate on componentchanged for an unrelated component', () => {
    const seg = addEntity(scene, ['street-segment']);
    const spy = vi.spyOn(bounds, '_compute');
    bounds.getBounds();
    fireComponentChanged(scene, seg, 'visible');
    bounds.getBounds();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('invalidates on componentchanged when the component name itself names a container type', () => {
    // e.g. adding a `managed-street` component to an entity by name.
    const ent = addEntity(scene, []);
    const spy = vi.spyOn(bounds, '_compute');
    bounds.getBounds();
    fireComponentChanged(scene, ent, 'managed-street');
    bounds.getBounds();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('invalidates on componentchanged for a change targeting a container entity', () => {
    const ent = addEntity(scene, ['managed-street']);
    const spy = vi.spyOn(bounds, '_compute');
    bounds.getBounds();
    // Any component change on a managed-street entity counts as a
    // potential bounds-affecting mutation.
    fireComponentChanged(scene, ent, 'position');
    bounds.getBounds();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('invalidates when a street-geo marker is added via componentchanged', () => {
    const ent = addEntity(scene, []);
    const spy = vi.spyOn(bounds, '_compute');
    bounds.getBounds();
    fireComponentChanged(scene, ent, 'street-geo');
    bounds.getBounds();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('disposes cleanly: no further events trigger invalidation', () => {
    const spy = vi.spyOn(bounds, '_compute');
    bounds.getBounds();
    bounds.dispose();
    scene.dispatchEvent(new Event('child-attached'));
    // After dispose the cache is null but no listeners remain, so
    // getBounds() recomputes once on next call (sceneEl is null
    // post-dispose so it returns empty).
    bounds.getBounds();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(bounds.getBounds().bounded).toBe(false);
  });
});
