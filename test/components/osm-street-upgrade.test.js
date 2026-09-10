import { beforeAll, describe, expect, it, vi } from 'vitest';
import { elFactory } from './helpers.js';
import {
  localToLatLon,
  stretchForWindow
} from '../../src/tested/osm-street-import.js';

// The click-to-upgrade integration the pure-math tests can't reach: the
// osm-streets component turning an injected way record into real scene
// entities — a path shape + a managed street following it for a curved
// stretch, a plain straight street for the degenerate 2-point stretch —
// through the viewer (no-inspector) creation path, with the street's
// curve actually resolving against the minted shape.
//
// shape.js statically imports the app store (Firebase/PostHog chain);
// same two-method stub as shape-fill-export.test.js.
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
  window.STREET.utils = window.STREET.utils || {};
  await import('../../src/aframe-components/street-segment.js');
  await import('../../src/aframe-components/street-generated-clones.js');
  await import('../../src/aframe-components/street-generated-stencil.js');
  await import('../../src/aframe-components/street-generated-striping.js');
  await import('../../src/aframe-components/street-generated-pedestrians.js');
  await import('../../src/aframe-components/street-generated-rail.js');
  await import('../../src/aframe-components/managed-street.js');
  await import('../../src/aframe-components/shape.js');
  await import('../../src/aframe-components/shape-vertex.js');
  await import('../../src/aframe-components/street-path.js');
  await import('../../src/aframe-components/osm-streets.js');
  window.AFRAME.emitReady();
});

const ORIGIN = { lat: 37.7876, lon: -122.4008 };

// A raw (pre-projection) way record like decodeTransportation produces,
// from design points in local meters.
function rawWay(wayId, cls, localPoints) {
  return {
    wayId,
    class: cls,
    subclass: undefined,
    oneway: 0,
    polylines: [localPoints.map((p) => localToLatLon(ORIGIN, p))]
  };
}

async function osmStreetsComponent() {
  const el = await elFactory();
  // No urlTemplate: tick never fetches; ways are injected per test.
  el.setAttribute('osm-streets', {
    latitude: ORIGIN.lat,
    longitude: ORIGIN.lon
  });
  await vi.waitFor(() => {
    expect(el.components['osm-streets']).toBeTruthy();
  });
  return el.components['osm-streets'];
}

describe('osm-streets upgrade (viewer creation path)', () => {
  it('mints one path-following street for a curved stretch', async () => {
    const comp = await osmStreetsComponent();
    const scene = comp.el.sceneEl;
    comp.addTileWays('t-curved', [
      rawWay('way-curved', 'minor', [
        { x: 0, z: 0 },
        { x: 0, z: 150 },
        { x: 150, z: 150 }
      ])
    ]);
    const way = comp.allWays()[0];
    const corner = { x: 0, z: 150 };

    const created = comp.upgradeWay(way, corner);
    expect(created).toBe(1);

    const shapeEl = scene.querySelector('[shape]');
    expect(shapeEl).toBeTruthy();
    expect(shapeEl.id).toMatch(/^osm-path-/);
    expect(shapeEl.getAttribute('data-osm-way-id')).toBe('way-curved');
    const vertices = shapeEl.querySelectorAll('[shape-vertex]');
    expect(vertices).toHaveLength(3);

    const streetEl = scene.querySelector('[managed-street]');
    expect(streetEl).toBeTruthy();
    expect(streetEl.getAttribute('data-osm-way-id')).toBe('way-curved');
    expect(streetEl.getAttribute('data-osm-source')).toBe('tiles');

    await vi.waitFor(
      () => {
        const ms = streetEl.components['managed-street'];
        expect(ms).toBeTruthy();
        expect(ms.data.path).toBe(`#${shapeEl.id}`);
        // The street resolved the minted shape and built a real curve.
        expect(ms.streetCurve).toBeTruthy();
        // Smooth curve through the 300 m L-bend: arc length lands near
        // the control polygon's, and drives the street length.
        expect(ms.data.length).toBeGreaterThan(200);
      },
      { timeout: 10000 }
    );

    // Cross-section came from the class rules.
    await vi.waitFor(() => {
      expect(
        streetEl.querySelectorAll('[street-segment]').length
      ).toBeGreaterThan(0);
    });

    // Idempotent per way id.
    expect(comp.upgradeWay(way, corner)).toBe(0);
  }, 20000);

  it('degenerates a straight stretch to a plain street, no shape', async () => {
    const comp = await osmStreetsComponent();
    const scene = comp.el.sceneEl;
    comp.addTileWays('t-straight', [
      rawWay('way-straight', 'secondary', [
        { x: 0, z: 0 },
        { x: 300, z: 0 }
      ])
    ]);
    const way = comp.allWays()[0];

    const created = comp.upgradeWay(way, { x: 150, z: 0 });
    expect(created).toBe(1);

    expect(scene.querySelector('[shape]')).toBeNull();
    const streetEl = scene.querySelector('[managed-street]');
    expect(streetEl).toBeTruthy();
    await vi.waitFor(() => {
      const ms = streetEl.components['managed-street'];
      expect(ms).toBeTruthy();
      expect(ms.data.path).toBe('');
    });
    // Street local +Z points along the +x (north) chord → yaw 90.
    const rotation = streetEl.getAttribute('rotation');
    expect(rotation.y).toBeCloseTo(90, 0);
  });

  it('returns 0 for a stretch below the generate minimum', async () => {
    const comp = await osmStreetsComponent();
    comp.addTileWays('t-stub', [
      rawWay('way-stub', 'service', [
        { x: 0, z: 0 },
        { x: 0, z: 10 }
      ])
    ]);
    const way = comp.allWays()[0];
    expect(stretchForWindow(way.polylines, { x: 0, z: 5 })).toBeNull();
    expect(comp.upgradeWay(way, { x: 0, z: 5 })).toBe(0);
    // A too-short stretch must not burn the way's idempotency bit.
    expect(comp.upgradedWayIds.has('way-stub')).toBe(false);
  });
});
