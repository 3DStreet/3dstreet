import { beforeAll, describe, expect, it, vi } from 'vitest';
import { elFactory } from './helpers.js';

// Round-trip contract for the .managed-street.json export (issue #1720):
// exporting a managed street with STREET.utils.getManagedStreetJSON, importing
// the result through `sourceType: json-blob`, and exporting again must yield a
// deep-equal object — no properties dropped, no content grown back.
//
// A-Frame is registered against the global window. street-segment.js assigns
// STREET.colors/STREET.types at module load, and managed-street.js assigns
// STREET.utils.getManagedStreetJSON, so the STREET global must exist before
// importing them. managed-street.js lazy-imports the Zustand store (only
// needed by the Streetmix/StreetPlan URL loaders) so the json-blob path used
// here stays free of the store's Firebase/PostHog dependency chain.
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

// Exercises every generated-component kind plus the properties the import
// used to drop (seed, cycleOffset, facing, positionX, stencilHeight,
// clone-level direction), a boundary with variant/side, and a sloped segment.
const FIXTURE = {
  name: 'Round Trip Test',
  width: 20.4,
  length: 40,
  segments: [
    {
      name: 'Left Boundary',
      type: 'boundary',
      width: 4,
      elevation: 0.15,
      direction: 'outbound',
      color: '#ffffff',
      surface: 'grass',
      variant: 'grass',
      side: 'left'
    },
    {
      name: 'Dense Sidewalk',
      type: 'sidewalk',
      width: 3,
      elevation: 0.15,
      direction: 'none',
      color: '#ffffff',
      surface: 'sidewalk',
      generated: { pedestrians: [{ density: 'dense' }] }
    },
    {
      name: 'Drive In',
      type: 'drive-lane',
      width: 3,
      elevation: 0,
      direction: 'inbound',
      color: '#ffffff',
      surface: 'asphalt',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray: 'sedan-rig, suv-rig',
            spacing: 7.3,
            count: 2
          }
        ]
      }
    },
    {
      name: 'Drive Out',
      type: 'drive-lane',
      width: 3,
      elevation: 0,
      direction: 'outbound',
      color: '#ffffff',
      surface: 'asphalt',
      generated: {
        clones: [
          {
            mode: 'fixed',
            modelsArray: 'box-truck-rig',
            spacing: 10,
            cycleOffset: 0.25
          }
        ]
      }
    },
    {
      name: 'Parking',
      type: 'parking-lane',
      width: 2.4,
      elevation: 0,
      direction: 'outbound',
      color: '#dddddd',
      surface: 'concrete',
      generated: {
        clones: [
          {
            mode: 'random',
            modelsArray: 'sedan-rig',
            spacing: 6,
            count: 3,
            facing: 90,
            direction: 'none'
          }
        ],
        stencil: [
          {
            modelsArray: 'solid-stripe',
            spacing: 3,
            positionX: -0.45,
            facing: 270,
            stencilHeight: 2.4,
            cycleOffset: 1,
            direction: 'none'
          }
        ]
      }
    },
    {
      name: 'Rail',
      type: 'rail',
      width: 3,
      elevation: 0,
      direction: 'inbound',
      color: '#ffffff',
      surface: 'asphalt',
      generated: {
        clones: [
          { mode: 'random', modelsArray: 'tram', spacing: 20, count: 1 }
        ],
        rail: [{ gauge: 1067 }]
      }
    },
    {
      name: 'Sloped Sidewalk',
      type: 'sidewalk',
      width: 2,
      elevation: 0,
      direction: 'none',
      color: '#ffffff',
      surface: 'sidewalk',
      slope: true,
      slopeStart: 0,
      slopeEnd: 0.3,
      generated: { pedestrians: [{ density: 'sparse' }] }
    }
  ]
};

async function createManagedStreet(streetObject) {
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
      segments.forEach((segment) => {
        expect(segment.hasLoaded).toBe(true);
        // Positive completion signal (no magic delay): every fixture segment
        // carries generated content, so its `loaded` handler
        // (generateComponentsFromSegmentObject) has run once at least one
        // street-generated-* component is attached.
        const hasGenerated = Object.keys(segment.components).some((name) =>
          name.startsWith('street-generated')
        );
        expect(hasGenerated).toBe(true);
      });
    },
    { timeout: 10000 }
  );
  return el;
}

const exportJSON = (el) => window.STREET.utils.getManagedStreetJSON(el);

describe('managed-street JSON export round trip', () => {
  it('captures the live street state including once-dropped properties', async () => {
    const el = await createManagedStreet(FIXTURE);
    const exported = exportJSON(el);

    expect(exported.name).toBe('Round Trip Test');
    expect(exported.length).toBe(40);
    expect(exported.width).toBeCloseTo(20.4, 5);
    expect(exported.segments).toHaveLength(FIXTURE.segments.length);

    // modelsArray serializes with the comma-joined authoring convention
    const driveIn = exported.segments[2];
    expect(driveIn.generated.clones[0].modelsArray).toBe('sedan-rig, suv-rig');
    // random-mode generators self-assign a concrete seed; the export captures
    // it so a re-import reproduces the same placements
    expect(driveIn.generated.clones[0].seed).toBeGreaterThan(0);

    // import auto-adds a stripe between opposite-direction drive lanes;
    // the export reflects it
    const driveOut = exported.segments[3];
    expect(driveOut.generated.striping[0].striping).toBe('solid-doubleyellow');

    // properties the import used to drop survive on the live entity
    const parking = exported.segments[4];
    expect(parking.generated.stencil[0]).toMatchObject({
      positionX: -0.45,
      facing: 270,
      stencilHeight: 2.4,
      cycleOffset: 1,
      direction: 'none'
    });
    expect(parking.generated.clones[0]).toMatchObject({
      facing: 90,
      direction: 'none',
      count: 3
    });

    // boundary keeps its variant/side and the preset-generated building clones
    const boundary = exported.segments[0];
    expect(boundary).toMatchObject({ variant: 'grass', side: 'left' });
    expect(boundary.generated.clones[0].mode).toBe('fit');

    // slope survives
    expect(exported.segments[6]).toMatchObject({
      slope: true,
      slopeStart: 0,
      slopeEnd: 0.3
    });
  });

  it('re-importing an export and exporting again is lossless', async () => {
    const el = await createManagedStreet(FIXTURE);
    const first = exportJSON(el);

    const el2 = await createManagedStreet(first);
    const second = exportJSON(el2);

    expect(second).toEqual(first);
  });

  it('does not grow deleted striping back across a round trip', async () => {
    const el = await createManagedStreet(FIXTURE);
    const driveOutEl = el.querySelector('[data-layer-name="Drive Out"]');
    expect(driveOutEl.components['street-generated-striping__1']).toBeDefined();
    driveOutEl.removeAttribute('street-generated-striping__1');

    const first = exportJSON(el);
    // the export pins the deleted stripe as an explicit empty list so the
    // import-side auto-striping doesn't recreate it
    expect(first.segments[3].generated.striping).toEqual([]);

    const el2 = await createManagedStreet(first);
    expect(
      el2.querySelector('[data-layer-name="Drive Out"]').components[
        'street-generated-striping__1'
      ]
    ).toBeUndefined();

    const second = exportJSON(el2);
    expect(second).toEqual(first);
  });
});
