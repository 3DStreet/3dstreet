import { beforeAll, describe, expect, it, vi } from 'vitest';
import { elFactory } from './helpers.js';
import {
  formatCenterlinePoints,
  parseCenterlinePoints
} from '../../src/tested/street-centerline.js';
import {
  getStreetEndNodesLocal,
  getStreetEndNodesWorld
} from '../../src/aframe-components/street-nodes.js';

// Street-owned centerlines (#1930 pillar 1): a managed street bends along
// its own `points`, the legacy `path` shape reference is adopted (copied
// in, then cleared), the shared node reader agrees between straight and
// curved streets, and the derived street-graph system merges meeting ends.
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
  await import('../../src/aframe-components/street-align.js');
  await import('../../src/aframe-components/shape.js');
  await import('../../src/aframe-components/shape-vertex.js');
  await import('../../src/aframe-components/street-path.js');
  await import('../../src/aframe-components/street-graph.js');
  await import('../../src/aframe-components/managed-intersection.js');
  window.AFRAME.emitReady();
});

const STREET_JSON = JSON.stringify({
  name: 'test',
  length: 60,
  segments: [
    { type: 'sidewalk', width: 3, direction: 'none', surface: 'sidewalk' },
    { type: 'drive-lane', width: 3, direction: 'inbound' },
    { type: 'drive-lane', width: 3, direction: 'outbound' },
    { type: 'sidewalk', width: 3, direction: 'none', surface: 'sidewalk' }
  ]
});

function streetAttrs(extra = {}) {
  return {
    sourceType: 'json-blob',
    sourceValue: STREET_JSON,
    // json-blob parses on demand: synchronize triggers the initial parse
    synchronize: true,
    showVehicles: false,
    showStriping: false,
    ...extra
  };
}

async function loadedStreet(sceneEl, attrs, extraAttrs = {}) {
  const el = document.createElement('a-entity');
  for (const [name, value] of Object.entries(extraAttrs)) {
    el.setAttribute(name, value);
  }
  el.setAttribute('managed-street', streetAttrs(attrs));
  sceneEl.appendChild(el);
  await vi.waitFor(() => {
    expect(el.components['managed-street']).toBeTruthy();
    expect(el.querySelectorAll('[street-segment]').length).toBe(4);
  });
  return el;
}

// An L-bend, 100 m + 100 m, in street-local space.
const L_POINTS = [
  { x: 0, y: 0, z: -100 },
  { x: 0, y: 0, z: 0 },
  { x: 100, y: 0, z: 0 }
];

describe('managed-street owned centerline', () => {
  it('bends along its own points and follows their arc length', async () => {
    const host = await elFactory();
    const el = await loadedStreet(host.sceneEl, {
      points: formatCenterlinePoints(L_POINTS),
      curveType: 'linear'
    });
    const ms = el.components['managed-street'];
    await vi.waitFor(() => {
      expect(ms.streetCurve).toBeTruthy();
    });
    expect(ms.streetCurve.sampler.totalLength).toBeCloseTo(200, 1);
    expect(ms.data.length).toBeCloseTo(200, 1);
    expect(ms.hasOwnedCurve()).toBe(true);
    // the street got an id so street-ribbon geometries can resolve it
    expect(el.id).toBeTruthy();

    // Segments render as ribbons along the curve.
    await vi.waitFor(() => {
      const seg = el.querySelector('[street-segment]');
      expect(seg.getAttribute('geometry')?.primitive).toBe('street-ribbon');
    });

    // Straightening: clear the points.
    el.setAttribute('managed-street', 'points', '');
    await vi.waitFor(() => {
      expect(ms.streetCurve).toBeNull();
    });
  });

  it('re-derives the curve when curve settings change (smooth vs linear)', async () => {
    const host = await elFactory();
    const el = await loadedStreet(host.sceneEl, {
      points: formatCenterlinePoints(L_POINTS),
      curveType: 'linear'
    });
    const ms = el.components['managed-street'];
    await vi.waitFor(() => expect(ms.streetCurve).toBeTruthy());
    const rev = ms.streetCurve.rev;
    el.setAttribute('managed-street', 'curveType', 'smooth');
    await vi.waitFor(() => {
      expect(ms.streetCurve.rev).toBeGreaterThan(rev);
    });
    // a centripetal spline passes THROUGH the corner vertex and bulges a
    // little on either side: longer than the 200 m control polygon
    expect(ms.streetCurve.sampler.totalLength).toBeGreaterThan(200);
    expect(ms.streetCurve.sampler.totalLength).toBeLessThan(230);
    expect(ms.data.length).toBeCloseTo(ms.streetCurve.sampler.totalLength, 1);
  });

  it('adopts a legacy path shape: copies its vertices in and clears path', async () => {
    const host = await elFactory();
    const sceneEl = host.sceneEl;
    // A shape at (50, 0, 20) with three vertices; the street at (10, 0, 20).
    const shape = document.createElement('a-entity');
    shape.id = 'legacy-path-1';
    shape.setAttribute('shape', { curveType: 'arc', filletRadius: 7 });
    shape.setAttribute('position', '50 0 20');
    for (const p of ['-40 0 -30', '0 0 0', '40 0 30']) {
      const v = document.createElement('a-entity');
      v.setAttribute('shape-vertex', '');
      v.setAttribute('position', p);
      shape.appendChild(v);
    }
    sceneEl.appendChild(shape);

    const el = await loadedStreet(
      sceneEl,
      { path: '#legacy-path-1' },
      { position: '10 0 20' }
    );
    const ms = el.components['managed-street'];
    await vi.waitFor(
      () => {
        expect(ms.data.path).toBe('');
        expect(parseCenterlinePoints(ms.data.points)).toHaveLength(3);
      },
      { timeout: 10000 }
    );
    const pts = parseCenterlinePoints(ms.data.points);
    // shape vertex (50-40, 0, 20-30) = (10, 0, -10) world → street-local
    // (0, 0, -30) for the street at (10, 0, 20)
    expect(pts[0].x).toBeCloseTo(0, 2);
    expect(pts[0].z).toBeCloseTo(-30, 2);
    expect(pts[2].x).toBeCloseTo(80, 2);
    expect(pts[2].z).toBeCloseTo(30, 2);
    expect(ms.data.curveType).toBe('arc');
    expect(ms.data.filletRadius).toBe(7);
    await vi.waitFor(() => expect(ms.streetCurve).toBeTruthy());

    // The shape is now just a drawing: deleting it changes nothing.
    shape.parentNode.removeChild(shape);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(ms.streetCurve).toBeTruthy();
    expect(parseCenterlinePoints(ms.data.points)).toHaveLength(3);
  });

  it('street end nodes: straight from length+align, curved from the end frames', async () => {
    const host = await elFactory();
    const sceneEl = host.sceneEl;
    const straight = await loadedStreet(sceneEl, {}, { position: '0 0 0' });
    await vi.waitFor(() => {
      expect(straight.getAttribute('street-align')?.length).toBe('middle');
    });
    const s = getStreetEndNodesLocal(straight);
    expect(s.curved).toBe(false);
    expect(s.totalWidth).toBeCloseTo(12);
    expect(s.start.position.z).toBeCloseTo(-30);
    expect(s.end.position.z).toBeCloseTo(30);
    // `along` points from the node INTO the street body
    expect(s.start.along.z).toBe(1);
    expect(s.end.along.z).toBe(-1);

    const curved = await loadedStreet(
      sceneEl,
      { points: formatCenterlinePoints(L_POINTS), curveType: 'linear' },
      { position: '500 0 0', rotation: '0 90 0' }
    );
    const cms = curved.components['managed-street'];
    await vi.waitFor(() => expect(cms.streetCurve).toBeTruthy());
    const c = getStreetEndNodesLocal(curved);
    expect(c.curved).toBe(true);
    expect(c.start.position.z).toBeCloseTo(-100);
    expect(c.end.position.x).toBeCloseTo(100);
    // into the body: +Z at the start of the L, -X at its end
    expect(c.start.along.z).toBeCloseTo(1);
    expect(c.end.along.x).toBeCloseTo(-1);

    const w = getStreetEndNodesWorld(curved);
    // yaw 90: street-local +Z is world +X, street-local +X is world -Z
    expect(w.start.position.x).toBeCloseTo(500 - 100, 1);
    expect(w.start.position.z).toBeCloseTo(0, 1);
    expect(w.end.position.x).toBeCloseTo(500, 1);
    expect(w.end.position.z).toBeCloseTo(-100, 1);
    expect(w.start.along.x).toBeCloseTo(1, 3);
    expect(w.end.along.z).toBeCloseTo(1, 3);
  });

  it('a curved end node follows a manual length trim or extension', async () => {
    const host = await elFactory();
    const el = await loadedStreet(host.sceneEl, {
      points: formatCenterlinePoints(L_POINTS),
      curveType: 'linear'
    });
    const ms = el.components['managed-street'];
    await vi.waitFor(() => expect(ms.streetCurve).toBeTruthy());
    // trimmed: content spans s in [0, 150], half way along the second leg
    el.setAttribute('managed-street', 'length', 150);
    let n = getStreetEndNodesLocal(el);
    expect(n.start.position.z).toBeCloseTo(-100);
    expect(n.end.position.x).toBeCloseTo(50);
    expect(n.end.position.z).toBeCloseTo(0);
    // extended: straight past the curve's end along its exit tangent
    el.setAttribute('managed-street', 'length', 250);
    n = getStreetEndNodesLocal(el);
    expect(n.end.position.x).toBeCloseTo(150);
    expect(n.end.along.x).toBeCloseTo(-1);
  });

  it('points that collapse to no curve leave a straight street with straight nodes', async () => {
    const host = await elFactory();
    const el = await loadedStreet(host.sceneEl, {
      points: formatCenterlinePoints([
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0.5 }
      ])
    });
    const ms = el.components['managed-street'];
    await vi.waitFor(() => {
      expect(el.getAttribute('street-align')?.length).toBe('middle');
    });
    expect(ms.hasOwnedCurve()).toBe(true);
    expect(ms.streetCurve).toBeNull();
    const n = getStreetEndNodesLocal(el);
    expect(n).not.toBeNull();
    expect(n.curved).toBe(false);
    expect(n.start.position.z).toBeCloseTo(-ms.data.length / 2);
    expect(n.end.position.z).toBeCloseTo(ms.data.length / 2);
  });

  it('street-graph merges ends that meet and records an intersection occupant', async () => {
    const host = await elFactory();
    const sceneEl = host.sceneEl;
    // Two straight 60 m streets end to end along +Z (middle-aligned), and
    // an intersection standing where they meet.
    const a = await loadedStreet(sceneEl, {}, { position: '0 0 0', id: 'ga' });
    const b = await loadedStreet(sceneEl, {}, { position: '0 0 60', id: 'gb' });
    const ix = document.createElement('a-entity');
    ix.id = 'gix';
    ix.setAttribute('managed-intersection', '');
    ix.setAttribute('position', '0.5 0 30');
    sceneEl.appendChild(ix);
    await vi.waitFor(() =>
      expect(ix.components['managed-intersection']).toBeTruthy()
    );

    const system = sceneEl.systems['street-graph'];
    system.invalidate();
    const graph = system.getGraph();
    expect(graph.ends).toHaveLength(4);
    expect(graph.nodes).toHaveLength(3);
    const shared = system.nodeForStreetEnd(a, 'end');
    expect(shared).toBe(system.nodeForStreetEnd(b, 'start'));
    expect(shared.ends).toHaveLength(2);
    expect(shared.x).toBeCloseTo(0);
    expect(shared.z).toBeCloseTo(30);
    expect(shared.intersectionId).toBe('gix');
    expect(system.nodeForStreetEnd(a, 'start').intersectionId).toBeNull();
    expect(system.nodesNear({ x: 0, z: 31 }, 5)[0]).toBe(shared);
  });
});
