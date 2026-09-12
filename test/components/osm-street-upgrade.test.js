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
  // Real streets carry street-align (managed-street attaches it in init);
  // managed-intersection reads it for node placement, so it must be a
  // registered component here, not an inert attribute.
  await import('../../src/aframe-components/street-align.js');
  await import('../../src/aframe-components/shape.js');
  await import('../../src/aframe-components/shape-vertex.js');
  await import('../../src/aframe-components/street-path.js');
  await import('../../src/aframe-components/managed-intersection.js');
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

  it('splits at a crossing, mints one shared intersection, connects path arms', async () => {
    const comp = await osmStreetsComponent();
    const scene = comp.el.sceneEl;
    // Way A runs +z with a bend past the crossing; way B crosses it at
    // local (0, 100).
    comp.addTileWays('t-net', [
      rawWay('way-a', 'minor', [
        { x: 0, z: 0 },
        { x: 0, z: 200 },
        { x: 40, z: 400 }
      ]),
      rawWay('way-b', 'minor', [
        { x: -80, z: 100 },
        { x: 80, z: 100 }
      ])
    ]);
    const [wayA, wayB] = comp.allWays();

    // Generate A: split at the crossing into two pieces + one intersection.
    const createdA = comp.upgradeWay(wayA, { x: 0, z: 200 });
    expect(createdA).toBe(2);
    const intersections = scene.querySelectorAll('[managed-intersection]');
    expect(intersections).toHaveLength(1);
    const intersectionEl = intersections[0];
    await vi.waitFor(() => {
      const iPos = intersectionEl.getAttribute('position');
      expect(iPos.x).toBeCloseTo(0, 0);
      expect(iPos.z).toBeCloseTo(100, 0);
    });
    // Piece past the bend keeps its corner → one path shape; the piece
    // before the crossing is straight.
    expect(scene.querySelectorAll('[shape]')).toHaveLength(1);

    // Generate B: two more pieces, NO second intersection (proximity
    // reuse), and its street ends land inside the existing snap radius.
    const createdB = comp.upgradeWay(wayB, { x: 0, z: 100 });
    expect(createdB).toBe(2);
    expect(scene.querySelectorAll('[managed-intersection]')).toHaveLength(1);
    expect(scene.querySelectorAll('[managed-street]')).toHaveLength(4);

    // The intersection's signature watch picks the streets up as arms —
    // including the path-following piece (curve end frames) — and
    // produces real geometry.
    await vi.waitFor(
      () => {
        const mi = intersectionEl.components['managed-intersection'];
        expect(mi).toBeTruthy();
        expect(mi.lastGeometry).toBeTruthy();
        expect(mi.lastGeometry.mouths.length).toBeGreaterThanOrEqual(3);
      },
      { timeout: 15000 }
    );
  }, 30000);

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
    // A too-short stretch creates nothing, so the way stays generatable.
    expect(comp.isWayUpgraded('way-stub')).toBe(false);
  });
});
