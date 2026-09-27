// Plan-view export (shared DXF/PDF/SVG model) of managed intersections: the
// pass must redraw the component's node-derived polygons — roadway surface,
// sidewalk corner wedges, crosswalk bands — from its lastGeometry, so the
// exported linework matches the rendered meshes.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';
import { computeIntersectionGeometry } from '@/tested/managed-intersection-utils.js';

// planModel imports aframe-components (intersection, managed-intersection),
// which register with AFRAME at module scope — stub the registry before the
// dynamic import.
let buildStreetPlanModel;
beforeAll(async () => {
  globalThis.AFRAME = globalThis.AFRAME || {
    registerComponent: () => {},
    registerGeometry: () => {},
    registerSystem: () => {}
  };
  ({ buildStreetPlanModel } = await import('@/editor/lib/plan/planModel.js'));
});

afterEach(() => {
  document.body.innerHTML = '';
});

// A fake A-Frame entity: a real DOM node (so querySelectorAll/closest work)
// whose getAttribute returns component OBJECTS like A-Frame's does, with an
// object3D and a components map.
function makeEntity(tag, attrObjects = {}, components = {}) {
  const el = document.createElement(tag);
  el.isEntity = true;
  el.object3D = new THREE.Object3D();
  el.components = components;
  for (const name of Object.keys(attrObjects)) {
    el.setAttribute(name, '');
  }
  const nativeGetAttribute = el.getAttribute.bind(el);
  el.getAttribute = (name) =>
    name in attrObjects ? attrObjects[name] : nativeGetAttribute(name);
  return el;
}

// 4-way crossing: roadway ±5, sidewalks out to ±8, nodes at the origin.
const fourWayGeometry = () =>
  computeIntersectionGeometry(
    [
      {
        point: { x: 0, z: 0 },
        dir: { x: 0, z: 1 },
        road: { min: -5, max: 5 },
        full: { min: -8, max: 8 }
      },
      {
        point: { x: 0, z: 0 },
        dir: { x: 0, z: -1 },
        road: { min: -5, max: 5 },
        full: { min: -8, max: 8 }
      },
      {
        point: { x: 0, z: 0 },
        dir: { x: 1, z: 0 },
        road: { min: -5, max: 5 },
        full: { min: -8, max: 8 }
      },
      {
        point: { x: 0, z: 0 },
        dir: { x: -1, z: 0 },
        road: { min: -5, max: 5 },
        full: { min: -8, max: 8 }
      }
    ],
    { curbRadius: 2, mouthMargin: 3 }
  );

function makeIntersectionEntity(geometry, crosswalk = 'crosswalk-zebra') {
  return makeEntity(
    'a-entity',
    { 'managed-intersection': { crosswalk } },
    {
      'managed-intersection': {
        data: { crosswalk },
        lastGeometry: geometry
      }
    }
  );
}

describe('plan model: managed intersection', () => {
  it('exports surface, corner wedges, and crosswalk bands', () => {
    const geometry = fourWayGeometry();
    document.body.appendChild(makeIntersectionEntity(geometry));

    const model = buildStreetPlanModel({
      includeSegments: false,
      includeShapes: false
    });

    expect(model.intersectionCount).toBe(1);

    // Surface polygon on the road layer, carrying the fillet tessellation.
    const surface = model.polylines.filter((p) => p.layer === 'C-ROAD');
    expect(surface).toHaveLength(1);
    expect(surface[0].closed).toBe(true);
    expect(surface[0].points.length).toBe(geometry.surface.length);

    // One sidewalk wedge per corner.
    const wedges = model.polylines.filter((p) => p.layer === 'C-WALK');
    expect(wedges).toHaveLength(4);

    // One crosswalk band per mouth, 2m wide (zebra) across the 10m roadway.
    const bands = model.polylines.filter((p) => p.layer === 'C-ROAD-MRKG');
    expect(bands).toHaveLength(4);
    bands.forEach((band) => {
      expect(band.points).toHaveLength(4);
      const d01 = Math.hypot(
        band.points[1][0] - band.points[0][0],
        band.points[1][1] - band.points[0][1]
      );
      const d12 = Math.hypot(
        band.points[2][0] - band.points[1][0],
        band.points[2][1] - band.points[1][1]
      );
      const sides = [d01, d12].sort((a, b) => a - b);
      expect(sides[0]).toBeCloseTo(2); // band width
      expect(sides[1]).toBeCloseTo(10); // roadway width
    });
  });

  it('applies the entity world transform and honors crosswalk: none', () => {
    const geometry = fourWayGeometry();
    const el = makeIntersectionEntity(geometry, 'none');
    el.object3D.position.set(100, 0, -50);
    document.body.appendChild(el);

    const model = buildStreetPlanModel({
      includeSegments: false,
      includeShapes: false
    });

    expect(
      model.polylines.filter((p) => p.layer === 'C-ROAD-MRKG')
    ).toHaveLength(0);
    // Surface lands around plan (100, 50) — projectToPlan flips Z.
    const surface = model.polylines.find((p) => p.layer === 'C-ROAD');
    const cx =
      surface.points.reduce((s, p) => s + p[0], 0) / surface.points.length;
    const cy =
      surface.points.reduce((s, p) => s + p[1], 0) / surface.points.length;
    expect(cx).toBeCloseTo(100, 0);
    expect(cy).toBeCloseTo(50, 0);
  });

  it('skips placeholder intersections (no lastGeometry) and hidden entities', () => {
    document.body.appendChild(makeIntersectionEntity(null));
    const hidden = makeIntersectionEntity(fourWayGeometry());
    hidden.getAttribute = ((orig) => (name) =>
      name === 'visible' ? false : orig(name))(hidden.getAttribute);
    document.body.appendChild(hidden);

    const model = buildStreetPlanModel({
      includeSegments: false,
      includeShapes: false
    });
    expect(model.intersectionCount).toBe(0);
    expect(model.polylines).toHaveLength(0);
  });

  it('stays out of the model when includeIntersections is off', () => {
    document.body.appendChild(makeIntersectionEntity(fourWayGeometry()));
    const model = buildStreetPlanModel({
      includeSegments: false,
      includeShapes: false,
      includeIntersections: false
    });
    expect(model.intersectionCount).toBe(0);
    expect(model.polylines).toHaveLength(0);
  });
});
