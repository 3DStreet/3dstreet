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
