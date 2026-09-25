// Plan-view export (shared DXF/PDF/SVG model) of a clone the user detached
// from its generator (#2011): it is the same marking as the generated clone
// it replaced, so it must stay on the clones toggle instead of vanishing —
// its "Detached Model" layer name no longer matches the "Cloned " prefix,
// and the shapes pass skips anything owned by a street.
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as THREE from 'three';

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

// Same fake entity as planModelCurves.test.js: a real DOM node whose
// getAttribute returns component objects, with an object3D.
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

const STENCIL_GEOMETRY = { primitive: 'plane', width: 2, height: 2 };

function makeStencil(layerName, { autocreated }) {
  const el = makeEntity('a-entity', { geometry: STENCIL_GEOMETRY });
  el.setAttribute('mixin', 'right');
  el.setAttribute('data-layer-name', layerName);
  if (autocreated) el.classList.add('autocreated');
  return el;
}

function buildStreetWithStencils() {
  const streetEl = makeEntity(
    'a-entity',
    { 'managed-street': { length: 20 } },
    { 'managed-street': { streetCurve: null } }
  );
  const segEl = makeEntity('a-entity', {
    'street-segment': { type: 'drive-lane', width: 3, length: 20 }
  });
  segEl.appendChild(makeStencil('Cloned Model • right', { autocreated: true }));
  segEl.appendChild(
    makeStencil('Detached Model • right', { autocreated: false })
  );
  streetEl.appendChild(segEl);
  // The clone pass sweeps from the a-scene root.
  const sceneEl = document.createElement('a-scene');
  sceneEl.appendChild(streetEl);
  document.body.appendChild(sceneEl);
}

describe('plan model: detached clone (#2011)', () => {
  it('draws a detached stencil on the markings layer like the generated one', () => {
    buildStreetWithStencils();
    const model = buildStreetPlanModel({
      includeIntersections: false,
      includeShapes: false,
      includeClones: true
    });
    expect(model.cloneCount).toBe(2);
    const markings = model.polylines.filter((p) => p.layer === 'C-ROAD-MRKG');
    expect(markings).toHaveLength(2);
    expect(model.shapeCount).toBe(0);
  });

  it('keeps a detached stencil behind the clones toggle', () => {
    buildStreetWithStencils();
    const model = buildStreetPlanModel({
      includeIntersections: false,
      includeShapes: true,
      includeClones: false
    });
    expect(model.cloneCount).toBe(0);
    expect(model.shapeCount).toBe(0);
    expect(model.polylines.some((p) => p.layer === 'C-ROAD-MRKG')).toBe(false);
  });
});
