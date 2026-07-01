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
