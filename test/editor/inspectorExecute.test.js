/* global AFRAME, STREET */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { TRANSFORM_REFUSED } from '@/editor/lib/transformGuard.js';
import { defineEntityElement } from './lib/groups/_entityElement.js';
import { vec3Components } from './lib/groups/_groupFixtures.js';

// The editor's own Inspector.execute (src/editor/index.jsx), not a harness
// copy of it: what it runs, what it names the undo step, and what it tells
// the user when the command is refused. Only the app shell, analytics and
// error reporting are stubbed; the scene never finishes loading, so the
// Inspector does not mount its UI.

vi.mock('@/editor/instrument', () => ({}));
vi.mock('@/editor/components/MainWrapper', () => ({ default: () => null }));
vi.mock('@shared/analytics/posthog', () => ({ initPostHog: vi.fn() }));
vi.mock('posthog-js', () => ({
  default: { register: vi.fn(), capture: vi.fn() }
}));

defineEntityElement();

let inspector;
let root;

beforeAll(async () => {
  const sceneEl = document.createElement('a-scene');
  sceneEl.object3D = new THREE.Scene();
  sceneEl.hasLoaded = false;
  document.body.append(sceneEl);
  // What the editor's modules register with A-Frame as they load.
  globalThis.AFRAME = {
    scenes: [sceneEl],
    components: vec3Components(),
    systems: {},
    registerComponent: vi.fn(),
    registerSystem: vi.fn(),
    registerPrimitive: vi.fn(),
    registerGeometry: vi.fn(),
    registerShader: vi.fn()
  };
  globalThis.STREET = { notify: { warningMessage: vi.fn() } };
  ({ inspector } = await import('@/editor/index.jsx'));
  root = document.createElement('a-entity');
  root.id = 'street-container';
  sceneEl.append(root);
}, 60000);

afterEach(() => {
  inspector.history.undos.length = 0;
  inspector.history.redos.length = 0;
  for (const el of [...root.children]) el.remove();
  STREET.notify.warningMessage.mockClear();
});

function entityIn(parent, { id, cls, rotation, scale } = {}) {
  const el = document.createElement('a-entity');
  el.id = id;
  if (cls) el.className = cls;
  parent.append(el);
  if (rotation) el.setAttribute('rotation', rotation);
  if (scale) el.setAttribute('scale', scale);
  return el;
}

describe("the editor's execute", () => {
  it('is the inspector the rest of the editor calls', () => {
    expect(AFRAME.INSPECTOR).toBe(inspector);
  });

  it('runs the rewritten command, under the name the caller gave (fails if it builds the command from the request rather than from what was resolved, or drops the name)', () => {
    const item = entityIn(root, {
      id: 'item',
      rotation: '10 30 5',
      scale: '2 2 2'
    });
    const result = inspector.execute(
      'entityupdate',
      { entity: item, component: 'class', value: 'user-group' },
      'Make group'
    );
    expect(result).not.toBe(TRANSFORM_REFUSED);
    expect(item.getAttribute('rotation')).toEqual({ x: 0, y: 30, z: 0 });
    expect(item.getAttribute('scale')).toEqual({ x: 1, y: 1, z: 1 });
    expect(inspector.history.undos).toHaveLength(1);
    expect(inspector.history.undos[0].type).toBe('multi');
    expect(inspector.history.undos[0].name).toBe('Make group');
  });

  it("hands the caller's callback to the command it runs (fails if execute drops it)", () => {
    const callback = vi.fn();
    inspector.execute(
      'entitycreate',
      { parentEl: root, noSelectEntity: true, components: {} },
      undefined,
      callback
    );
    const created = root.lastElementChild;
    created.dispatchEvent(new Event('loaded'));
    expect(callback).toHaveBeenCalledWith(created);
  });

  it('refuses a group scale: returns the refusal, records nothing and tells the user why (fails if it runs the command, returns nothing, or does not notify)', () => {
    const g = entityIn(root, { id: 'g', cls: 'user-group' });
    const result = inspector.execute('entityupdate', {
      entity: g,
      component: 'scale',
      value: '2 2 2'
    });
    expect(result).toBe(TRANSFORM_REFUSED);
    expect(g.hasAttribute('scale')).toBe(false);
    expect(inspector.history.undos).toHaveLength(0);
    expect(STREET.notify.warningMessage).toHaveBeenCalledWith(
      'Scaling is not available for this element.'
    );
  });
});
