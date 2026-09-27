/* global STREET */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Characterization test for the scene JSON serializer / hydrator pair in
// src/json-utils_1.1.js (#2038): saved data → createEntities → live A-Frame
// entities → convertDOMElToObject must reproduce itself. Both directions are
// exercised against real component schemas (getModifiedProperty diffs live
// component data against schema defaults and mixins), which jsdom cannot do.
//
// json-utils statically imports the app store and two editor modules at
// module scope; the serializer reads one field (sceneTitle) and the load path
// writes one flag, so tiny stand-ins keep the Firebase/PostHog chain out.
vi.mock('../../src/store.js', () => {
  const state = { sceneTitle: 'Round Trip', viewerStartMigrated: false };
  return {
    default: {
      getState: () => state,
      setState: (patch) => Object.assign(state, patch),
      subscribe: () => () => {}
    }
  };
});
vi.mock('../../src/editor/lib/entity.js', () => {
  let n = 0;
  return { createUniqueId: () => `test-id-${++n}` };
});
vi.mock('../../src/editor/lib/cameraUtils.js', () => ({
  decodeCameraStateFromParam: () => null
}));

beforeAll(async () => {
  window.AFRAME_ASYNC = true;
  await import('aframe');
  // json-utils creates window.STREET; street-segment.js then attaches
  // STREET.colors/types and managed-street.js STREET.utils.getManagedStreetJSON.
  await import('../../src/json-utils_1.1.js');
  window.STREET.notify = {
    successMessage() {},
    warningMessage() {},
    errorMessage() {}
  };
  await import('../../src/aframe-components/street-align.js');
  await import('../../src/aframe-components/street-segment.js');
  await import('../../src/aframe-components/street-generated-clones.js');
  await import('../../src/aframe-components/street-generated-stencil.js');
  await import('../../src/aframe-components/street-generated-striping.js');
  await import('../../src/aframe-components/street-generated-pedestrians.js');
  await import('../../src/aframe-components/street-generated-rail.js');
  await import('../../src/aframe-components/managed-street.js');
  window.AFRAME.emitReady();
});

const mounted = [];
afterEach(() => {
  while (mounted.length) mounted.pop().remove();
});

const clone = (v) => JSON.parse(JSON.stringify(v));
const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

function whenLoaded(el) {
  return new Promise((resolve) =>
    el.hasLoaded ? resolve() : el.addEventListener('loaded', resolve)
  );
}

/**
 * Mount a scene shaped like index.html (three root entities, a street-assets
 * element) and mint `data` into it the way every scene load does.
 */
async function loadScene(data) {
  const sceneEl = document.createElement('a-scene');
  const assets = document.createElement('a-assets');
  const streetAssets = document.createElement('street-assets');
  streetAssets.setAttribute('url', 'https://assets.3dstreet.app/');
  assets.appendChild(streetAssets);
  for (const [id, attrs] of Object.entries(MIXINS)) {
    const mixin = document.createElement('a-mixin');
    mixin.id = id;
    for (const [k, v] of Object.entries(attrs)) mixin.setAttribute(k, v);
    assets.appendChild(mixin);
  }
  sceneEl.appendChild(assets);
  for (const id of ['street-container', 'environment', 'reference-layers']) {
    const root = document.createElement('a-entity');
    root.id = id;
    sceneEl.appendChild(root);
  }
  document.body.appendChild(sceneEl);
  mounted.push(sceneEl);
  await whenLoaded(sceneEl);

  STREET.utils.createEntities(
    clone(data),
    sceneEl.querySelector('#street-container')
  );
  for (const el of sceneEl.querySelectorAll('a-entity')) await whenLoaded(el);
  // Let managed-street's init settle (it re-scans its segment children).
  await tick();
  return sceneEl;
}

function serialize(sceneEl) {
  return STREET.utils.convertDOMElToObject(
    sceneEl.querySelector('#street-container')
  );
}

const MIXINS = {
  'mixin-a': { scale: '2 2 2', visible: 'true' },
  'mixin-b': { scale: '3 3 3' }
};

// Already in the migrated form (migrations are covered in
// test/editor/sceneMigrations.test.js); exercises the serializer branches:
// element tag, class list, layer name, asset identity attrs, primitive +
// geometry/material ordering, a hidden entity, a two-mixin entity, and a
// managed street whose segments own their mesh (geometry/material skipped)
// and whose street-align is always written explicitly.
const FIXTURE = [
  {
    id: 'street-container',
    'data-layer-name': 'User Layers',
    children: [
      {
        id: 'props-layer',
        class: ['custom-layer'],
        'data-layer-name': 'Props',
        components: { position: '1 2 3', rotation: '0 90 0', scale: '2 2 2' },
        children: [
          {
            element: 'a-box',
            id: 'box-1',
            primitive: 'box',
            components: {
              geometry: 'width: 2; height: 3',
              material: 'color: #ff0000',
              position: '0 1.5 0'
            }
          },
          { id: 'hidden-1', components: { visible: false } },
          {
            id: 'mixed-1',
            mixin: 'mixin-a mixin-b',
            components: { position: '0 0 5' }
          },
          {
            id: 'cloud-model',
            'data-asset-id': 'asset123',
            'data-asset-owner-uid': 'owner456',
            components: { position: '4 0 0' }
          }
        ]
      },
      {
        id: 'street-1',
        'data-layer-name': 'Main Street',
        components: {
          'managed-street': 'length: 40',
          'street-align': 'width: center; length: start',
          position: '0 0 -10'
        },
        children: [
          {
            id: 'seg-sidewalk',
            components: {
              'street-segment':
                'type: sidewalk; width: 3; length: 40; elevation: 0.15; direction: none; color: #ffffff; surface: sidewalk'
            }
          },
          {
            id: 'seg-drive',
            components: {
              'street-segment':
                'type: drive-lane; width: 3; length: 40; direction: inbound; color: #ffffff; surface: asphalt'
            }
          },
          {
            id: 'seg-bike',
            components: {
              'street-segment':
                'type: bike-lane; width: 3; length: 40; direction: outbound; color: #00ff00; surface: asphalt'
            }
          }
        ]
      }
    ]
  },
  { id: 'environment' },
  { id: 'reference-layers' }
];

function findById(nodes, id) {
  for (const node of nodes || []) {
    if (node.id === id) return node;
    const hit = findById(node.children, id);
    if (hit) return hit;
  }
  return null;
}

function collect(nodes, out = []) {
  for (const node of nodes || []) {
    out.push(node);
    collect(node.children, out);
  }
  return out;
}

describe('scene JSON round trip', () => {
  it('serializes a hydrated scene to a fixed point', async () => {
    const sceneEl = await loadScene(FIXTURE);
    const first = serialize(sceneEl);
    expect(first.title).toBe('Round Trip');
    expect(first.version).toBe('0.5.6');
    expect(first.memory).toEqual({});
    sceneEl.remove();
    mounted.pop();

    const again = await loadScene(first.data);
    const second = serialize(again);
    expect(second).toEqual(first);
  });

  it('keeps identity, layer and asset attributes and the user tree', async () => {
    const sceneEl = await loadScene(FIXTURE);
    const { data } = serialize(sceneEl);
    expect(data.map((e) => e.id)).toEqual([
      'street-container',
      'environment',
      'reference-layers'
    ]);
    // The User Layers root never persists visibility (see createEntities).
    expect(data[0].components?.visible).toBeUndefined();

    const layer = findById(data, 'props-layer');
    expect(layer.class).toEqual(['custom-layer']);
    expect(layer['data-layer-name']).toBe('Props');
    expect(layer.components.position).toBe('1 2 3');
    expect(layer.components.rotation).toBe('0 90 0');
    expect(layer.components.scale).toBe('2 2 2');
    expect(layer.children.map((c) => c.id)).toEqual([
      'box-1',
      'hidden-1',
      'mixed-1',
      'cloud-model'
    ]);

    const box = findById(data, 'box-1');
    expect(box.element).toBe('a-box');
    expect(box.primitive).toBe('box');
    expect(box.components.geometry).toContain('width: 2');
    expect(box.components.geometry).toContain('height: 3');
    expect(box.components.material).toContain('color: #ff0000');

    expect(findById(data, 'hidden-1').components.visible).toBe('false');

    const model = findById(data, 'cloud-model');
    expect(model['data-asset-id']).toBe('asset123');
    expect(model['data-asset-owner-uid']).toBe('owner456');
  });

  it('writes street-align explicitly and skips segment meshes and procedural output', async () => {
    const sceneEl = await loadScene(FIXTURE);
    const { data } = serialize(sceneEl);
    const street = findById(data, 'street-1');
    expect(street.components['street-align']).toBe(
      'width: center; length: start'
    );
    expect(street.components['managed-street']).toContain('length: 40');
    expect(street.children.map((c) => c.id)).toEqual([
      'seg-sidewalk',
      'seg-drive',
      'seg-bike'
    ]);
    for (const seg of street.children) {
      expect(seg.components['street-segment']).toBeDefined();
      expect(seg.components.geometry).toBeUndefined();
      expect(seg.components.material).toBeUndefined();
      expect(seg.primitive).toBeUndefined();
    }
    expect(findById(data, 'seg-drive').components['street-segment']).toContain(
      'type: drive-lane'
    );
  });

  it('skips procedural output and in-flight uploads', async () => {
    const sceneEl = await loadScene(FIXTURE);
    const layer = sceneEl.querySelector('#props-layer');
    // Generated children (clones, stencils, striping) are marked .autocreated
    // and regenerate on load from their generator's config.
    const generated = document.createElement('a-entity');
    generated.id = 'generated-1';
    generated.classList.add('autocreated');
    layer.appendChild(generated);
    // A placeholder pointing at a transient blob: URL is local-only.
    const pending = document.createElement('a-entity');
    pending.id = 'pending-upload';
    pending.setAttribute('data-temporary-file', '');
    layer.appendChild(pending);
    await whenLoaded(generated);
    await whenLoaded(pending);

    const ids = collect(serialize(sceneEl).data).map((n) => n.id);
    expect(ids).toContain('props-layer');
    expect(ids).not.toContain('generated-1');
    expect(ids).not.toContain('pending-upload');

    // convert-to-shapes asks for the rendered output itself.
    const withGenerated = STREET.utils.getElementData(layer, {
      includeAutocreated: true
    });
    expect(withGenerated.children.map((c) => c.id)).toContain('generated-1');
    expect(withGenerated.children.map((c) => c.id)).not.toContain(
      'pending-upload'
    );
  });

  it('reads mixin values without reordering the entity mixin list', async () => {
    const sceneEl = await loadScene(FIXTURE);
    const el = sceneEl.querySelector('#mixed-1');
    const order = () => el.mixinEls.map((m) => m.id);
    expect(order()).toEqual(['mixin-a', 'mixin-b']);
    const data1 = STREET.utils.getElementData(el);
    const data2 = STREET.utils.getElementData(el);
    // getMixedValue used to reverse mixinEls in place, flipping precedence
    // on every serialized component.
    expect(order()).toEqual(['mixin-a', 'mixin-b']);
    expect(data1).toEqual(data2);
    expect(data1.mixin).toBe('mixin-a mixin-b');
    // scale comes from the last mixin (mixin-b) and is not written out.
    expect(el.getAttribute('scale')).toEqual({ x: 3, y: 3, z: 3 });
    expect(data1.components.scale).toBeUndefined();
    expect(data1.components.position).toBe('0 0 5');
  });

  it('filterJSONstreet strips loader components and asset src from the string', async () => {
    const sceneEl = await loadScene(FIXTURE);
    const scene = serialize(sceneEl);
    const parsed = JSON.parse(STREET.utils.filterJSONstreet(scene));
    expect(parsed).toEqual(scene);

    const withLoader = clone(scene);
    withLoader.data[0].components = {
      ...withLoader.data[0].components,
      'set-loader-from-hash': 'defaultURL: x'
    };
    withLoader.memory = { cameraState: { position: { x: 1 } } };
    const filtered = JSON.parse(STREET.utils.filterJSONstreet(withLoader));
    expect(filtered.data[0].components['set-loader-from-hash']).toBeUndefined();
    expect(filtered.memory).toEqual({ cameraState: { position: { x: 1 } } });
  });
});
