import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { elFactory } from './helpers.js';

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  await import('../../src/aframe-components/model-placeholder.js');
  window.AFRAME.emitReady();
});

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().remove();
});

// A catalog part with an entry in src/model-bounds.json, so the placeholder
// system has a box to draw for it.
const PART_SRC =
  'https://assets.3dstreet.app/sets/human-characters-poses-1/gltf-exports/draco/human-characters-poses-1.glb';
const PART = 'Character_1';

// The system reads the entity's model component record (its `data` and the
// `_loadSettled` flag gltf-part / gltf-model keep for batch-models) and the
// `mesh` object3D. The record is stood in for directly rather than loading a
// GLB: what is under test is show()'s contract, not the loader.
async function makeModelEntity({ settled }) {
  const el = await elFactory();
  mounted.push(el.sceneEl);
  el.components['gltf-part'] = {
    data: { src: PART_SRC, part: PART },
    _loadSettled: settled
  };
  return el;
}

const system = (el) => el.sceneEl.systems['model-placeholder'];

describe('model-placeholder show()', () => {
  it('draws a box for a pending model with known bounds', async () => {
    const el = await makeModelEntity({ settled: false });
    system(el).show(el);
    expect(system(el).has(el)).toBe(true);
    expect(el.object3D._placeholderBbox).toBeDefined();
  });

  // #2031: a gltf-part whose parent GLB is cached resolves synchronously inside
  // its own update(), so model-loaded (and batching's mesh strip) happen before
  // componentinitialized reaches the system. The box that componentinitialized
  // would then open has no event left to close it. A settled model never gets
  // one.
  it('never opens a box for a model whose load already settled', async () => {
    const el = await makeModelEntity({ settled: true });
    expect(el.getObject3D('mesh')).toBeUndefined();
    system(el).show(el);
    expect(system(el).has(el)).toBe(false);
    expect(el.object3D._placeholderBbox).toBeUndefined();
  });

  it('drops an open box once the model settles', async () => {
    const el = await makeModelEntity({ settled: false });
    system(el).show(el);
    expect(system(el).has(el)).toBe(true);
    el.components['gltf-part']._loadSettled = true;
    system(el).show(el);
    expect(system(el).has(el)).toBe(false);
  });
});
