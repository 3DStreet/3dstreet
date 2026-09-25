import { beforeAll, describe, expect, it } from 'vitest';
import { elFactory } from './helpers.js';

// A-Frame is registered against the global window. street-segment.js assigns
// STREET.colors/STREET.types at module load, so the STREET global must exist
// before importing it.
beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  window.STREET = window.STREET || {};
  await import('../../src/aframe-components/street-segment.js');
  await import('../../src/aframe-components/street-generated-pedestrians.js');
  window.AFRAME.emitReady();
});

// A sidewalk with a fixed seed: normal density on 100 m is floor(0.125 *
// 100) = 12 pedestrians, laid out deterministically.
async function makeSidewalk() {
  const el = await elFactory();
  el.setAttribute(
    'street-segment',
    'type: sidewalk; width: 3; length: 100; surface: sidewalk; color: #ffffff; direction: none'
  );
  el.setAttribute('street-generated-pedestrians', 'density: normal; seed: 7');
  return el;
}

// Generators set position/rotation on freshly created a-entities; those
// attribute writes are buffered until the entity initializes, so wait for
// every clone to load before reading its pose back.
const whenLoaded = (entities) =>
  Promise.all(
    entities.map((e) =>
      e.hasLoaded
        ? null
        : new Promise((resolve) =>
            e.addEventListener('loaded', resolve, { once: true })
          )
    )
  );

const layout = (comp) =>
  comp.createdEntities.map((e) => {
    const p = e.getAttribute('position');
    return [
      Number(e.getAttribute('data-clone-index')),
      e.getAttribute('mixin'),
      p.x,
      p.z
    ];
  });

// Per-object detach (#2011): a skipped slot is left empty and, because the
// seeded draws for it are still consumed, every pedestrian after the hole
// keeps its position, model and facing.
describe('street-generated-pedestrians skip slots', () => {
  it('stamps every pedestrian with its slot index', async () => {
    const el = await makeSidewalk();
    const comp = el.components['street-generated-pedestrians'];
    expect(comp.createdEntities).toHaveLength(12);
    expect(layout(comp).map(([slot]) => slot)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11
    ]);
    expect(
      comp.createdEntities.every(
        (e) =>
          e.getAttribute('data-parent-component') ===
          'street-generated-pedestrians'
      )
    ).toBe(true);
  });

  it('leaves a skipped slot empty without shifting the seeded layout', async () => {
    const el = await makeSidewalk();
    const comp = el.components['street-generated-pedestrians'];
    await whenLoaded(comp.createdEntities);
    const before = layout(comp);
    expect(before.some(([, , , z]) => z !== 0)).toBe(true);

    el.setAttribute('street-generated-pedestrians', 'skip', [2, 9]);

    await whenLoaded(comp.createdEntities);
    const after = layout(comp);
    expect(after).toHaveLength(10);
    expect(after).toEqual(before.filter(([slot]) => slot !== 2 && slot !== 9));
  });
});
