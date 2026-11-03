import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { elFactory } from './helpers.js';

// shape.js statically imports the app store; see shape-fill-export.test.js for
// why a two-method stub is enough here.
vi.mock('../../src/store.js', () => ({
  default: {
    getState: () => ({ unitsPreference: 'metric' }),
    subscribe: () => () => {}
  }
}));

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  window.STREET = window.STREET || {};
  await import('../../src/aframe-components/shape.js');
  await import('../../src/aframe-components/shape-vertex.js');
  window.AFRAME.emitReady();
});

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().remove();
});

describe('the transform markers a shape carries', () => {
  it('is yaw-only and not scalable, and is free to change parent (fails if a shape still keeps its parent, or loses its yaw-only rule)', async () => {
    const el = await elFactory();
    mounted.push(el.sceneEl);
    el.setAttribute('shape', 'closed: true');

    expect(el.hasAttribute('data-transform-no-reparent')).toBe(false);
    expect(el.hasAttribute('data-transform-yaw-only')).toBe(true);
    expect(el.hasAttribute('data-transform-no-scale')).toBe(true);
  });
});
