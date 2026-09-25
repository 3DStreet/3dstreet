import { beforeAll, describe, expect, it } from 'vitest';
import { elFactory } from './helpers.js';

// A-Frame is registered against the global window. street-segment.js assigns
// STREET.colors/STREET.types at module load, so the STREET global must exist
// before importing it. We import only the two components under test (and their
// street-segment dependency) rather than the whole app bundle.
beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  window.STREET = window.STREET || {};
  await import('../../src/aframe-components/street-segment.js');
  await import('../../src/aframe-components/street-generated-clones.js');
  window.AFRAME.emitReady();
});

/**
 * Mount an entity with a street-segment and a fixed-mode clones generator.
 * Fixed mode is deterministic (no random seed round-trip) and produces
 * floor(length / spacing) clones.
 */
async function makeSegment() {
  const el = await elFactory();
  el.setAttribute(
    'street-segment',
    'type: drive-lane; width: 3; length: 100; surface: asphalt; color: #ffffff'
  );
  el.setAttribute(
    'street-generated-clones',
    'mode: fixed; modelsArray: box; spacing: 20; cycleOffset: 0.5'
  );
  return el;
}

describe('street-generated-clones', () => {
  it('registers the component', () => {
    expect(window.AFRAME.components['street-generated-clones']).toBeDefined();
  });

  it('generates clones from the segment dimensions', async () => {
    const el = await makeSegment();
    const comp = el.components['street-generated-clones'];
    expect(comp.createdEntities).toHaveLength(5); // floor(100 / 20)
  });

  // Regression test for #1759.
  it('does not regenerate on segment-changed when dimensions are unchanged', async () => {
    const el = await makeSegment();
    const comp = el.components['street-generated-clones'];
    const before = comp.createdEntities.slice();
    expect(before).toHaveLength(5);

    // The segment's first-init emit during scene load carries the same
    // dimensions the generator already used: it must NOT tear the clones down
    // and recreate them.
    el.emit('segment-changed', {
      widthChanged: true,
      lengthChanged: true,
      oldWidth: undefined,
      newWidth: 3,
      oldLength: undefined,
      newLength: 100
    });

    // Without the guard, update() runs clearEntities() (detaching every clone)
    // then recreates a fresh set of the same length — so the count alone can't
    // catch the bug. Assert the original elements survive untouched: still the
    // same objects (by reference) and still attached to the DOM.
    expect(comp.createdEntities).toHaveLength(5);
    expect(comp.createdEntities.every((clone, i) => clone === before[i])).toBe(
      true
    );
    expect(before.every((clone) => clone.isConnected)).toBe(true);
  });

  it('regenerates when the segment length actually changes', async () => {
    const el = await makeSegment();
    const comp = el.components['street-generated-clones'];
    const before = comp.createdEntities.slice();

    // Changing length emits segment-changed(lengthChanged) and must regenerate.
    el.setAttribute('street-segment', 'length', 40);

    expect(comp.createdEntities).toHaveLength(2); // floor(40 / 20)
    expect(comp.createdEntities.some((e) => before.includes(e))).toBe(false);
  });
});

// Per-object detach (#2011): a slot listed in `skip` is left empty, the
// remaining clones keep their slot indexes and poses, and (random mode) the
// seeded model picks after the hole are unchanged.
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

describe('street-generated-clones skip slots', () => {
  const slotIndexes = (comp) =>
    comp.createdEntities.map((e) => Number(e.getAttribute('data-clone-index')));

  it('stamps every clone with its slot index', async () => {
    const el = await makeSegment();
    const comp = el.components['street-generated-clones'];
    expect(slotIndexes(comp)).toEqual([0, 1, 2, 3, 4]);
    expect(
      comp.createdEntities.every(
        (e) =>
          e.getAttribute('data-parent-component') === 'street-generated-clones'
      )
    ).toBe(true);
  });

  it('leaves a skipped slot empty and keeps the other slots in place', async () => {
    const el = await makeSegment();
    const comp = el.components['street-generated-clones'];
    await whenLoaded(comp.createdEntities);
    const before = new Map(
      comp.createdEntities.map((e) => [
        Number(e.getAttribute('data-clone-index')),
        e.getAttribute('position').z
      ])
    );
    // fixed mode: z = length/2 - (slot + cycleOffset) * spacing
    expect([...before.values()]).toEqual([40, 20, 0, -20, -40]);

    el.setAttribute('street-generated-clones', 'skip', [1, 3]);

    expect(comp.createdEntities).toHaveLength(3);
    expect(slotIndexes(comp)).toEqual([0, 2, 4]);
    await whenLoaded(comp.createdEntities);
    for (const clone of comp.createdEntities) {
      const slot = Number(clone.getAttribute('data-clone-index'));
      expect(clone.getAttribute('position').z).toBe(before.get(slot));
    }
    // The generator reads the attribute form too ("1, 3" → strings).
    el.setAttribute('street-generated-clones', 'skip', '4');
    expect(slotIndexes(comp)).toEqual([0, 1, 2, 3]);
  });

  it('restores the slot when it is removed from skip', async () => {
    const el = await makeSegment();
    const comp = el.components['street-generated-clones'];
    el.setAttribute('street-generated-clones', 'skip', [2]);
    expect(slotIndexes(comp)).toEqual([0, 1, 3, 4]);
    el.setAttribute('street-generated-clones', 'skip', []);
    expect(slotIndexes(comp)).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps seeded model picks stable after the hole in random mode', async () => {
    const el = await elFactory();
    el.setAttribute(
      'street-segment',
      'type: drive-lane; width: 3; length: 100; surface: asphalt; color: #ffffff'
    );
    el.setAttribute(
      'street-generated-clones',
      'mode: random; modelsArray: box, sphere, cylinder; spacing: 10; count: 6; seed: 42'
    );
    const comp = el.components['street-generated-clones'];
    const layout = (c) =>
      c.createdEntities.map((e) => [
        Number(e.getAttribute('data-clone-index')),
        e.getAttribute('mixin'),
        e.getAttribute('position').z
      ]);
    await whenLoaded(comp.createdEntities);
    const before = layout(comp);
    expect(before).toHaveLength(6);
    expect(before.some(([, , z]) => z !== 0)).toBe(true);

    el.setAttribute('street-generated-clones', 'skip', [1]);

    await whenLoaded(comp.createdEntities);
    const after = layout(comp);
    expect(after).toHaveLength(5);
    expect(after).toEqual(before.filter(([slot]) => slot !== 1));
  });
});
