import { beforeAll, describe, expect, it, vi } from 'vitest';
import { elFactory } from './helpers.js';

// Hatched-as-generator (#1728) and auto-striping-on-edit (#1720) coverage:
// - `surface: hatched` json-blobs migrate to a full-width
//   street-generated-striping treatment that crops to the segment width
// - the divider type preset produces hatching via the generator
// - dividers get an auto edge stripe against adjacent lanes
// - separator stripes recompute when a segment's type or direction changes
beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  window.STREET = window.STREET || {};
  window.STREET.utils = window.STREET.utils || {};
  await import('../../src/aframe-components/street-segment.js');
  await import('../../src/aframe-components/street-generated-clones.js');
  await import('../../src/aframe-components/street-generated-stencil.js');
  await import('../../src/aframe-components/street-generated-striping.js');
  await import('../../src/aframe-components/street-generated-pedestrians.js');
  await import('../../src/aframe-components/street-generated-rail.js');
  await import('../../src/aframe-components/managed-street.js');
  window.AFRAME.emitReady();
});

const laneSegment = (name, direction, overrides = {}) => ({
  name,
  type: 'drive-lane',
  width: 3,
  elevation: 0,
  direction,
  color: '#ffffff',
  surface: 'asphalt',
  ...overrides
});

async function createManagedStreet(streetObject, expectations) {
  const el = await elFactory();
  el.setAttribute('managed-street', {
    sourceType: 'json-blob',
    sourceValue: JSON.stringify(streetObject),
    synchronize: true
  });
  await vi.waitFor(
    () => {
      const segments = el.querySelectorAll('[street-segment]');
      expect(segments).toHaveLength(streetObject.segments.length);
      segments.forEach((segment) => expect(segment.hasLoaded).toBe(true));
      expectations(el);
    },
    { timeout: 10000 }
  );
  return el;
}

const segmentByName = (el, name) =>
  el.querySelector(`[data-layer-name="${name}"]`);

describe('hatched surface migration on json-blob import', () => {
  it('converts a hatched divider to asphalt plus a width-cropping striping treatment', async () => {
    const el = await createManagedStreet(
      {
        name: 'Hatched Migration',
        length: 40,
        segments: [
          laneSegment('Drive In', 'inbound'),
          {
            name: 'Divider',
            type: 'divider',
            width: 1,
            elevation: 0,
            direction: 'none',
            color: '#ffffff',
            surface: 'hatched'
          },
          laneSegment('Drive Out', 'outbound')
        ]
      },
      (streetEl) => {
        const divider = segmentByName(streetEl, 'Divider');
        expect(divider.getAttribute('street-segment').surface).toBe('asphalt');
        expect(
          divider.components['street-generated-striping__1']
        ).toBeDefined();
      }
    );

    const divider = segmentByName(el, 'Divider');
    const striping = divider.components['street-generated-striping__1'];
    expect(striping.data.striping).toBe('hatched');

    // the hatch plane spans the full segment width, centered on the segment
    await vi.waitFor(() => {
      expect(striping.createdEntities).toHaveLength(1);
      const plane = striping.createdEntities[0];
      expect(plane.getAttribute('geometry').width).toBe(1);
      expect(plane.getAttribute('position').x).toBe(0);
    });

    // the texture tiles at a fixed 4m period in both axes (crops to width
    // instead of stretching across it)
    const material = striping.calculateStripingMaterial('hatched', 40, 1);
    expect(material.stripingTextureId).toBe('hatched-base');
    expect(material.stripingWidth).toBe(1);
    expect(material.repeatX).toBeCloseTo(1 / 4, 5);
    expect(material.repeatY).toBeCloseTo(40 / 4, 5);
  });

  it('gives an un-hatched divider an auto edge stripe against adjacent lanes', async () => {
    const el = await createManagedStreet(
      {
        name: 'Divider Edge Stripe',
        length: 40,
        segments: [
          laneSegment('Drive In', 'inbound'),
          {
            name: 'Median',
            type: 'divider',
            width: 1,
            elevation: 0,
            direction: 'none',
            color: '#ffffff',
            surface: 'asphalt'
          },
          laneSegment('Drive Out', 'outbound')
        ]
      },
      (streetEl) => {
        expect(
          segmentByName(streetEl, 'Median').components[
            'street-generated-striping__1'
          ]
        ).toBeDefined();
        expect(
          segmentByName(streetEl, 'Drive Out').components[
            'street-generated-striping__1'
          ]
        ).toBeDefined();
      }
    );

    // solid edge stripes on both divider edges (parity with the streetmix
    // importer's getSeparatorMixinId)
    expect(
      segmentByName(el, 'Median').components['street-generated-striping__1']
        .data.striping
    ).toBe('solid-stripe');
    expect(
      segmentByName(el, 'Drive Out').components['street-generated-striping__1']
        .data.striping
    ).toBe('solid-stripe');
  });
});

describe('auto-striping on segment edits', () => {
  const twoLanes = (secondDirection) => ({
    name: 'Two Lanes',
    length: 40,
    segments: [
      laneSegment('Lane A', 'inbound'),
      laneSegment('Lane B', secondDirection)
    ]
  });

  const laneBStriping = (el) =>
    segmentByName(el, 'Lane B').components['street-generated-striping__1'];

  it('updates the separator when a direction flip creates opposing lanes', async () => {
    const el = await createManagedStreet(twoLanes('inbound'), (streetEl) => {
      expect(laneBStriping(streetEl)).toBeDefined();
    });
    // same type, same direction → dashed
    expect(laneBStriping(el).data.striping).toBe('dashed-stripe');

    segmentByName(el, 'Lane B').setAttribute(
      'street-segment',
      'direction',
      'outbound'
    );
    expect(laneBStriping(el).data.striping).toBe('solid-doubleyellow');
  });

  it('adds a divider edge stripe alongside the preset hatch on type change', async () => {
    const el = await createManagedStreet(twoLanes('outbound'), (streetEl) => {
      expect(laneBStriping(streetEl)).toBeDefined();
    });
    expect(laneBStriping(el).data.striping).toBe('solid-doubleyellow');

    const laneB = segmentByName(el, 'Lane B');
    laneB.setAttribute('street-segment', 'type', 'divider');

    // the divider preset regenerated __1 as the full-width hatch...
    expect(laneB.components['street-generated-striping__1'].data.striping).toBe(
      'hatched'
    );
    expect(laneB.getAttribute('street-segment').surface).toBe('asphalt');
    // ...and the auto separator against Lane A landed in the next free slot
    expect(laneB.components['street-generated-striping__2'].data.striping).toBe(
      'solid-stripe'
    );
  });

  it('removes a stale separator when a neighbor stops being a lane', async () => {
    const el = await createManagedStreet(twoLanes('outbound'), (streetEl) => {
      expect(laneBStriping(streetEl)).toBeDefined();
    });

    segmentByName(el, 'Lane A').setAttribute(
      'street-segment',
      'type',
      'sidewalk'
    );
    // sidewalk | drive-lane pairs get no separator
    expect(laneBStriping(el)).toBeUndefined();
  });
});
