// Plan-view export (shared DXF/PDF/SVG model) of CURVED streets and
// curve-styled drawn shapes: both must emit the sampled curve, not the
// straight rectangles / control polygon, using the same street-path-utils
// math the 3D scene renders with.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';
import { PathSampler } from '@/tested/street-path-utils.js';

// planModel imports aframe-components/intersection, which registers itself
// with AFRAME at module scope — stub the registry before the dynamic import.
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
    el.setAttribute(name, ''); // real attribute so CSS selectors match
  }
  const nativeGetAttribute = el.getAttribute.bind(el);
  el.getAttribute = (name) =>
    name in attrObjects ? attrObjects[name] : nativeGetAttribute(name);
  return el;
}

const L_PATH_POINTS = [
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, 10),
  new THREE.Vector3(10, 0, 10)
];

describe('plan model: curved managed street', () => {
  it('exports segment outlines along the curve, not straight rectangles', () => {
    const sampler = new PathSampler(L_PATH_POINTS, false);
    const streetEl = makeEntity(
      'a-entity',
      { 'managed-street': { length: sampler.totalLength } },
      {
        'managed-street': {
          streetCurve: { sampler, zStart: -sampler.totalLength, closed: false }
        }
      }
    );
    const segEl = makeEntity('a-entity', {
      'street-segment': {
        type: 'drive-lane',
        width: 3,
        length: sampler.totalLength
      }
    });
    streetEl.appendChild(segEl);
    document.body.appendChild(streetEl);

    const model = buildStreetPlanModel({
      includeIntersections: false,
      includeShapes: false
    });
    expect(model.segmentCount).toBe(1);
    const outline = model.polylines.find((p) => p.layer === 'C-ROAD');
    expect(outline).toBeTruthy();
    // a straight rectangle has 4 corners; the curved outline carries the
    // ring stations of both edges
    expect(outline.points.length).toBeGreaterThan(8);
    // plan Y is -z: the far leg of the L (x≈10, z≈10 → planY≈-10) must be
    // reached, which the straight rectangle never does
    const maxX = Math.max(...outline.points.map(([x]) => x));
    expect(maxX).toBeGreaterThan(9);
  });

  it('keeps the straight rectangle for straight streets', () => {
    const streetEl = makeEntity(
      'a-entity',
      { 'managed-street': { length: 20 } },
      { 'managed-street': { streetCurve: null } }
    );
    const segEl = makeEntity('a-entity', {
      'street-segment': { type: 'drive-lane', width: 3, length: 20 }
    });
    streetEl.appendChild(segEl);
    document.body.appendChild(streetEl);

    const model = buildStreetPlanModel({
      includeIntersections: false,
      includeShapes: false
    });
    const outline = model.polylines.find((p) => p.layer === 'C-ROAD');
    expect(outline.points).toHaveLength(4);
  });
});

describe('plan model: curve-styled drawn shape', () => {
  const makeShapeEl = (curveData) => {
    const vertEls = L_PATH_POINTS.map((p) => {
      const v = { object3D: { position: p.clone() } };
      return v;
    });
    const components = {
      shape: {
        getVertexEls: () => vertEls,
        // curveType/filletRadius are shape props (they moved off the
        // street-path component); linear is the schema default
        data: { closed: false, curveType: 'linear', ...(curveData || {}) }
      }
    };
    return makeEntity('a-entity', { shape: {} }, components);
  };

  it('exports the sampled curve for a smooth-styled shape', () => {
    document.body.appendChild(
      makeShapeEl({ curveType: 'smooth', filletRadius: 6 })
    );
    const model = buildStreetPlanModel({
      includeIntersections: false,
      includeSegments: false
    });
    const line = model.polylines.find((p) => p.layer === 'C-ANNO');
    expect(line).toBeTruthy();
    expect(line.points.length).toBeGreaterThan(10); // densified curve
  });

  it('exports the control polygon for an unstyled shape', () => {
    document.body.appendChild(makeShapeEl(null));
    const model = buildStreetPlanModel({
      includeIntersections: false,
      includeSegments: false
    });
    const line = model.polylines.find((p) => p.layer === 'C-ANNO');
    expect(line.points).toHaveLength(3);
  });
});
