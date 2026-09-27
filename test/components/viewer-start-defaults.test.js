/* global AFRAME, THREE */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { elFactory } from './helpers.js';
import { DEFAULT_FOV_DEGREES } from '../../src/tested/scene-camera-pose.js';

// viewer-start.js statically imports the app store (Firebase/PostHog chain at
// module scope); the system only reads two flags from it.
vi.mock('../../src/store.js', () => ({
  default: {
    getState: () => ({ playEntryOrigin: 'editor', isInspectorEnabled: true }),
    setState: () => {},
    subscribe: () => () => {}
  }
}));

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  window.STREET = window.STREET || {};
  window.STREET.notify = { warningMessage: () => {} };
  await import('../../src/aframe-components/play/viewer-start.js');
  window.AFRAME.emitReady();
});

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().remove();
  delete window.AFRAME.INSPECTOR;
});

// The system writes the shared editor/viewer camera through
// AFRAME.INSPECTOR.camera; a bare PerspectiveCamera stands in for it.
function stubInspectorCamera() {
  const camera = new THREE.PerspectiveCamera(DEFAULT_FOV_DEGREES);
  window.AFRAME.INSPECTOR = { camera };
  return camera;
}

describe('viewer-start fov', () => {
  it('defaults to the one shared fov constant', () => {
    expect(AFRAME.components['viewer-start'].schema.fov.default).toBe(
      DEFAULT_FOV_DEGREES
    );
    expect(DEFAULT_FOV_DEGREES).toBe(50);
  });

  // #2031: the first update after init (scene load, entity creation) leaves
  // the camera alone; a later fov edit applies to the lens at once.
  it('leaves the camera alone at init and applies later fov edits live', async () => {
    const camera = stubInspectorCamera();
    const el = await elFactory();
    mounted.push(el.sceneEl);
    el.setAttribute('viewer-start', 'fov: 55');
    await new Promise((resolve) =>
      el.hasLoaded ? resolve() : el.addEventListener('loaded', resolve)
    );
    expect(el.getAttribute('viewer-start').fov).toBe(55);
    expect(camera.fov).toBe(DEFAULT_FOV_DEGREES);

    el.setAttribute('viewer-start', 'fov', 40);
    expect(camera.fov).toBe(40);

    // Another property changing does not touch the lens.
    el.setAttribute('viewer-start', 'freeLook', false);
    expect(camera.fov).toBe(40);

    // Back to the default (what the panel's reset commits).
    el.setAttribute('viewer-start', 'fov', DEFAULT_FOV_DEGREES);
    expect(camera.fov).toBe(DEFAULT_FOV_DEGREES);
  });

  it('ignores a fov edit when there is no editor camera or the value is bad', async () => {
    const el = await elFactory();
    mounted.push(el.sceneEl);
    el.setAttribute('viewer-start', 'fov: 55');
    await new Promise((resolve) =>
      el.hasLoaded ? resolve() : el.addEventListener('loaded', resolve)
    );
    const system = el.sceneEl.systems['viewer-start'];
    expect(system.applyFov(40)).toBe(false); // no INSPECTOR
    const camera = stubInspectorCamera();
    expect(system.applyFov(0)).toBe(false);
    expect(system.applyFov(NaN)).toBe(false);
    expect(camera.fov).toBe(DEFAULT_FOV_DEGREES);
    expect(system.applyFov(35)).toBe(true);
    expect(camera.fov).toBe(35);
  });
});
