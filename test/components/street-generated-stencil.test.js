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
  await import('../../src/aframe-components/street-generated-stencil.js');
  window.AFRAME.emitReady();
});

async function makeSegment(direction) {
  const el = await elFactory();
  el.setAttribute(
    'street-segment',
    `type: drive-lane; width: 3; length: 100; surface: asphalt; color: #ffffff; direction: ${direction}`
  );
  return el;
}

// The generator sets rotation on freshly created a-entities; wait for the
// clone to initialize (attribute writes are buffered until then) before
// reading it back.
const stencilRotationY = async (el) => {
  const comp = el.components['street-generated-stencil'];
  expect(comp.createdEntities.length).toBeGreaterThan(0);
  const clone = comp.createdEntities[0];
  if (!clone.hasLoaded) {
    await new Promise((resolve) =>
      clone.addEventListener('loaded', resolve, { once: true })
    );
  }
  return clone.getAttribute('rotation').y;
};

// Regression tests for #1959: a stencil whose own `direction` follows the
// lane must render inbound stencils rotated 180° and track later segment
// direction flips, while `direction: none` stays an absolute orientation.
describe('street-generated-stencil direction', () => {
  it('orients a direction-seeded stencil for an inbound lane', async () => {
    const el = await makeSegment('inbound');
    el.setAttribute(
      'street-generated-stencil',
      'modelsArray: left; spacing: 20; direction: inbound'
    );
    expect(await stencilRotationY(el)).toBe(180);
  });

  it('follows a segment direction flip', async () => {
    const el = await makeSegment('inbound');
    el.setAttribute(
      'street-generated-stencil',
      'modelsArray: left; spacing: 20; direction: inbound'
    );

    el.setAttribute('street-segment', 'direction', 'outbound');

    // street-segment.update() propagates the flip into the generator ...
    expect(el.getAttribute('street-generated-stencil').direction).toBe(
      'outbound'
    );
    // ... which re-renders its stencils in the outbound orientation.
    expect(await stencilRotationY(el)).toBe(0);
  });

  it('keeps direction: none stencils absolutely oriented through a flip', async () => {
    const el = await makeSegment('inbound');
    // e.g. angled-parking markings: fixed side-facing, must not flip
    el.setAttribute(
      'street-generated-stencil',
      'modelsArray: parking-t; spacing: 20; direction: none; facing: 45'
    );
    expect(await stencilRotationY(el)).toBe(45);

    el.setAttribute('street-segment', 'direction', 'outbound');

    expect(el.getAttribute('street-generated-stencil').direction).toBe('none');
    expect(await stencilRotationY(el)).toBe(45);
  });
});

// Per-object detach (#2011): stencil slots count group by group, stencil by
// stencil within a group; a skipped slot is left empty.
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

describe('street-generated-stencil skip slots', () => {
  const slotIndexes = (comp) =>
    comp.createdEntities.map((e) => Number(e.getAttribute('data-clone-index')));

  it('stamps stencils with consecutive slot indexes across groups', async () => {
    const el = await makeSegment('outbound');
    el.setAttribute(
      'street-generated-stencil',
      'modelsArray: left, right; spacing: 25; padding: 2'
    );
    const comp = el.components['street-generated-stencil'];
    // floor(100 / 25) = 4 groups × 2 stencils
    expect(slotIndexes(comp)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(comp.createdEntities.map((e) => e.getAttribute('mixin'))).toEqual([
      'left',
      'right',
      'left',
      'right',
      'left',
      'right',
      'left',
      'right'
    ]);
  });

  it('leaves skipped slots empty and keeps the other stencils in place', async () => {
    const el = await makeSegment('outbound');
    el.setAttribute(
      'street-generated-stencil',
      'modelsArray: left, right; spacing: 25; padding: 2'
    );
    const comp = el.components['street-generated-stencil'];
    await whenLoaded(comp.createdEntities);
    const before = new Map(
      comp.createdEntities.map((e) => [
        Number(e.getAttribute('data-clone-index')),
        e.getAttribute('position').z
      ])
    );
    expect(new Set(before.values()).size).toBe(before.size);

    el.setAttribute('street-generated-stencil', 'skip', [0, 5]);

    expect(slotIndexes(comp)).toEqual([1, 2, 3, 4, 6, 7]);
    await whenLoaded(comp.createdEntities);
    for (const stencil of comp.createdEntities) {
      const slot = Number(stencil.getAttribute('data-clone-index'));
      expect(stencil.getAttribute('position').z).toBe(before.get(slot));
    }
  });
});
