import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { elFactory } from './helpers.js';

// shape.js statically imports the app store; the same two-method stub the other
// shape component tests use.
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

const nextFrame = () => new Promise(requestAnimationFrame);

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().remove();
});

async function makeShape(attrs) {
  const el = await elFactory();
  mounted.push(el.sceneEl);
  el.setAttribute('shape', attrs);
  for (const [x, z] of [
    [0, 0],
    [10, 0],
    [10, 10]
  ]) {
    const v = document.createElement('a-entity');
    v.setAttribute('shape-vertex', '');
    v.setAttribute('position', { x, y: 0, z });
    el.appendChild(v);
  }
  await nextFrame();
  return el;
}

const shape = (el) => el.components.shape;

// #2031: the area label is built by the component so it tracks every re-derive,
// but it shows only while the editor asks for it (the shape panel, i.e. while
// the shape is selected). An unselected shape, the viewer and play show none.
describe('shape area label visibility', () => {
  it('is hidden by default on a closed shape that has an area', async () => {
    const el = await makeShape('closed: true; fillOpacity: 0');
    expect(shape(el).area).toBeCloseTo(50, 3);
    expect(shape(el).areaLabelObject.visible).toBe(false);
  });

  it('shows on request and survives a re-derive, then hides on request', async () => {
    const el = await makeShape('closed: true; fillOpacity: 0');
    shape(el).setAreaLabelVisible(true);
    expect(shape(el).areaLabelObject.visible).toBe(true);

    // A vertex edit re-derives the ring and re-reads the flag.
    el.children[2].setAttribute('position', { x: 0, y: 0, z: 10 });
    shape(el).requestRederive();
    await nextFrame();
    expect(shape(el).areaLabelObject.visible).toBe(true);
    expect(shape(el).areaLabelObject.element.textContent).toBe('50.00m²');

    shape(el).setAreaLabelVisible(false);
    expect(shape(el).areaLabelObject.visible).toBe(false);
  });

  it('never shows on an open shape, even when requested', async () => {
    const el = await makeShape('closed: false');
    shape(el).setAreaLabelVisible(true);
    expect(shape(el).areaLabelObject.visible).toBe(false);
    el.setAttribute('shape', 'closed', true);
    await nextFrame();
    expect(shape(el).areaLabelObject.visible).toBe(true);
  });
});
