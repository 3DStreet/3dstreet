/* global STREET */
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from 'vitest';
// A-Frame's own parsers, which the loader calls through AFRAME.utils. The
// package exports only its built bundle, so they are reached by path.
import * as styleParser from '../../node_modules/aframe/src/utils/styleParser.js';
import * as coordinates from '../../node_modules/aframe/src/utils/coordinates.js';
import * as THREE from 'three';
import { defineEntityElement } from './lib/groups/_entityElement.js';

// Loading a saved scene through the real scene loader (json-utils), over
// entity elements whose position, rotation and scale attributes drive an
// object3D. Nothing else of A-Frame runs.

defineEntityElement();

let sceneEl;
let container;
let createElementsForScenesFromJSON;

// A copy of a scene that needs levelling on load: a scaled group with a
// member, an outer scaled group holding a tilted inner group, and a tilted,
// scaled box that is not a group.
const groupsToLevel = () => [
  {
    id: 'street-container',
    'data-layer-name': 'User Layers',
    children: [
      {
        id: 'scaled-group',
        class: ['user-group'],
        'data-layer-name': 'Scaled group',
        components: {
          position: '0 0 -6',
          rotation: '0 30 0',
          scale: '1.5 1.5 1.5'
        },
        children: [
          {
            id: 'scaled-member',
            primitive: 'box',
            'data-layer-name': 'Member of scaled group',
            components: {
              geometry: 'primitive: box',
              material: 'color: #3a7bd5',
              position: '2 0.5 0',
              rotation: '0 15 0',
              scale: '1 2 1'
            }
          }
        ]
      },
      {
        id: 'outer-group',
        class: ['user-group'],
        'data-layer-name': 'Outer group',
        components: { position: '8 0 -6', scale: '2 2 2' },
        children: [
          {
            id: 'inner-group',
            class: ['user-group'],
            'data-layer-name': 'Inner tilted group',
            components: { position: '1 0 0', rotation: '10 45 0' },
            children: [
              {
                id: 'inner-member',
                primitive: 'box',
                'data-layer-name': 'Member of inner group',
                components: {
                  geometry: 'primitive: box',
                  material: 'color: #e35d5b',
                  position: '0 0.5 0'
                }
              }
            ]
          }
        ]
      },
      tiltedBox()
    ]
  }
];

// The same scene with nothing to level: a level group holding a turned,
// stretched member, a group whose mixin turns it about Y, and the same box.
const groupsConforming = () => [
  {
    id: 'street-container',
    'data-layer-name': 'User Layers',
    children: [
      {
        id: 'level-group',
        class: ['user-group'],
        'data-layer-name': 'Level group',
        components: { position: '0 0 -6', rotation: '0 30 0' },
        children: [
          {
            id: 'level-member',
            primitive: 'box',
            'data-layer-name': 'Member of level group',
            components: {
              geometry: 'primitive: box',
              material: 'color: #3a7bd5',
              position: '2 0.5 0',
              rotation: '15 0 0',
              scale: '1 2 1'
            }
          }
        ]
      },
      {
        id: 'mixin-group',
        class: ['user-group'],
        mixin: 'turned-mixin',
        'data-layer-name': 'Group with a turning mixin',
        components: { position: '4 0 -6' }
      },
      tiltedBox()
    ]
  }
];

function tiltedBox() {
  return {
    id: 'tilted-box',
    primitive: 'box',
    'data-layer-name': 'Tilted box (not a group)',
    components: {
      geometry: 'primitive: box',
      material: 'color: #2fa84f',
      position: '-6 1 -6',
      rotation: '20 30 10',
      scale: '2 1 1'
    }
  };
}

const WARNING =
  '[scene-load] Brought 3 items within their kinds\' limits; position and heading kept: group "Scaled group" (removed scale 1.5 1.5 1.5), group "Outer group" (removed scale 2 2 2), group "Inner tilted group" (removed rotation x 10, z 0).';

const item = (id, components, extra = {}) => ({
  id,
  'data-layer-name': id,
  components,
  ...extra
});

// Streets, an intersection, shapes and an old ruler saved outside their kinds'
// limits, a street inside a scaled group, and a classic street (no kind).
const kindsToLevel = () => [
  {
    id: 'street-container',
    'data-layer-name': 'User Layers',
    children: [
      item('start-street', {
        'managed-street': '',
        'street-align': '',
        position: '3 0 4',
        rotation: '0 30 0',
        scale: '2 1 2'
      }),
      item('middle-street', {
        'managed-street': '',
        'street-align': 'width: center; length: middle',
        position: '10 0 0',
        scale: '2 1 2'
      }),
      item('tilted-street', {
        'managed-street': '',
        'street-align': 'width: center; length: middle',
        rotation: '5 30 0'
      }),
      item('mirrored-street', {
        'managed-street': '',
        'street-align': 'width: center; length: middle',
        scale: '-1 1 1'
      }),
      item('scaled-intersection', {
        'managed-intersection': '',
        scale: '1.2 1.2 1.2'
      }),
      item('big-area', {
        shape: 'closed: true; lineWidth: 0.5',
        rotation: '0 45 0',
        scale: '2 1 2'
      }),
      item('tilted-area', { shape: '', rotation: '0 30 20' }),
      item('ruler', {
        'measure-line': 'start: 0 0 0; end: 8 0 0',
        scale: '2 2 2'
      }),
      item(
        'scaled-group',
        { position: '0 0 -20', scale: '2 2 2' },
        {
          class: ['user-group'],
          children: [
            item('grouped-street', {
              'managed-street': '',
              'street-align': 'width: center; length: middle',
              scale: '2 1 2'
            })
          ]
        }
      ),
      item('classic-street', {
        street: 'length: 60',
        'streetmix-loader': 'streetmixStreetURL: https://streetmix.net/x/1',
        scale: '2 2 2'
      })
    ]
  }
];

// The same kinds already within their limits, the tilted street included; most
// carry no saved scale or rotation.
const kindsConforming = () => [
  {
    id: 'street-container',
    'data-layer-name': 'User Layers',
    children: [
      item('start-street', {
        'managed-street': '',
        'street-align': 'width: center; length: start',
        rotation: '0 30 0'
      }),
      item('tilted-street', {
        'managed-street': '',
        'street-align': 'width: center; length: middle',
        rotation: '5 30 0',
        scale: '1 1 1'
      }),
      item('plain-intersection', { 'managed-intersection': '' }),
      item('level-area', { shape: '', rotation: '0 45 0' }),
      item('bare-area', { shape: '' }),
      item(
        'level-group',
        { position: '0 0 -20' },
        {
          class: ['user-group'],
          children: [item('grouped-street', { 'managed-street': '' })]
        }
      )
    ]
  }
];

const KINDS_WARNING =
  "[scene-load] Brought 9 items within their kinds' limits; position and heading kept: " +
  'managed street "start-street" (removed scale 2 1 2), ' +
  'managed street "middle-street" (removed scale 2 1 2), ' +
  'managed street "mirrored-street" (removed scale -1 1 1), ' +
  'managed intersection "scaled-intersection" (removed scale 1.2 1.2 1.2), ' +
  'shape "big-area" (removed scale 2 1 2), ' +
  'shape "tilted-area" (removed rotation x 0, z 20), ' +
  'shape "ruler" (removed scale 2 2 2), ' +
  'group "scaled-group" (removed scale 2 2 2), ' +
  'managed street "grouped-street" (removed scale 2 1 2).';

const vec = (x, y, z) => ({ x, y, z });

beforeAll(async () => {
  window.BATCHING_ENABLED = false;
  sceneEl = document.createElement('a-scene');
  sceneEl.emit = vi.fn();
  sceneEl.object3D = new THREE.Scene();
  document.body.append(sceneEl);
  const mixin = document.createElement('a-mixin');
  mixin.id = 'turned-mixin';
  mixin.setAttribute('rotation', '0 90 0');
  mixin.setAttribute('scale', '1 1 1');
  document.body.append(mixin);
  globalThis.AFRAME = {
    registerComponent() {},
    utils: { styleParser, coordinates },
    scenes: [sceneEl]
  };
  await import('../../src/json-utils_1.1.js');
  ({ createElementsForScenesFromJSON } =
    await import('../../src/editor/lib/SceneUtils.js'));
});

beforeEach(() => {
  container?.remove();
  container = document.createElement('a-entity');
  container.id = 'street-container';
  sceneEl.append(container);
  STREET.notify = {
    successMessage: vi.fn(),
    errorMessage: vi.fn(),
    warningMessage: vi.fn(),
    infoMessage: vi.fn()
  };
  STREET.utils.newScene = vi.fn();
  vi.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  vi.restoreAllMocks();
});

const byId = (id) => document.getElementById(id);

describe('loading a scene levels its groups', () => {
  it('levels every group, leaves members and other entities as saved, and warns once naming them (fails if the pass is not wired into the load, runs after entities are made, or runs on a copy)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    STREET.utils.createEntities(groupsToLevel(), sceneEl);

    expect(byId('scaled-group').getAttribute('scale')).toEqual({
      x: 1,
      y: 1,
      z: 1
    });
    expect(byId('scaled-group').getAttribute('rotation')).toEqual({
      x: 0,
      y: 30,
      z: 0
    });
    expect(byId('outer-group').getAttribute('scale')).toEqual({
      x: 1,
      y: 1,
      z: 1
    });
    expect(byId('inner-group').getAttribute('rotation')).toEqual({
      x: 0,
      y: 45,
      z: 0
    });
    expect(byId('scaled-member').getAttribute('scale')).toEqual({
      x: 1,
      y: 2,
      z: 1
    });
    expect(byId('scaled-member').getAttribute('rotation')).toEqual({
      x: 0,
      y: 15,
      z: 0
    });
    expect(byId('tilted-box').getAttribute('rotation')).toEqual({
      x: 20,
      y: 30,
      z: 10
    });
    expect(byId('tilted-box').getAttribute('scale')).toEqual({
      x: 2,
      y: 1,
      z: 1
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(WARNING);
  });

  it('says nothing for a scene whose groups already conform, mixin included, and loads it as saved (fails if the warning is unconditional, or a conforming mixin group gets values written)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    STREET.utils.createEntities(groupsConforming(), sceneEl);
    expect(warn).not.toHaveBeenCalled();
    expect(byId('level-group').getAttribute('rotation')).toEqual({
      x: 0,
      y: 30,
      z: 0
    });
    expect(byId('level-group').hasAttribute('scale')).toBe(false);
    expect(byId('mixin-group').getAttribute('mixin')).toBe('turned-mixin');
    expect(byId('mixin-group').hasAttribute('rotation')).toBe(false);
    expect(byId('mixin-group').hasAttribute('scale')).toBe(false);
    expect(byId('level-member').getAttribute('rotation')).toEqual({
      x: 15,
      y: 0,
      z: 0
    });
  });

  it('runs on both scene-loading routes (fails if only one route is wired)', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    STREET.utils.createElementsFromJSON({ data: groupsToLevel(), memory: {} });
    expect(byId('scaled-group').getAttribute('scale')).toEqual({
      x: 1,
      y: 1,
      z: 1
    });

    container.remove();
    container = document.createElement('a-entity');
    container.id = 'street-container';
    sceneEl.append(container);
    createElementsForScenesFromJSON(groupsToLevel(), {});
    expect(byId('scaled-group').getAttribute('scale')).toEqual({
      x: 1,
      y: 1,
      z: 1
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('loading a scene brings streets, intersections and shapes within their limits', () => {
  it('brings every kind within its limits, keeps street tilt and position, turns an old ruler into a level shape, and warns once naming each item and kind (fails if the limits are applied before the ruler migration, it warns per item, walks the top level only, or misses a kind)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    STREET.utils.createEntities(kindsToLevel(), sceneEl);

    for (const id of [
      'start-street',
      'middle-street',
      'tilted-street',
      'mirrored-street',
      'scaled-intersection',
      'big-area',
      'tilted-area',
      'ruler',
      'scaled-group',
      'grouped-street'
    ]) {
      expect(byId(id).object3D.scale.toArray(), id).toEqual([1, 1, 1]);
    }
    expect(byId('start-street').getAttribute('rotation')).toEqual(
      vec(0, 30, 0)
    );
    expect(byId('start-street').getAttribute('position')).toEqual(vec(3, 0, 4));
    expect(byId('tilted-street').getAttribute('rotation')).toEqual(
      vec(5, 30, 0)
    );
    expect(byId('big-area').getAttribute('rotation')).toEqual(vec(0, 45, 0));
    expect(byId('big-area').getAttribute('shape')).toBe(
      'closed: true; lineWidth: 0.5'
    );
    expect(byId('tilted-area').getAttribute('rotation')).toEqual(vec(0, 30, 0));
    expect(byId('ruler').hasAttribute('shape')).toBe(true);
    expect(byId('ruler').hasAttribute('measure-line')).toBe(false);
    expect(byId('classic-street').getAttribute('scale')).toEqual(vec(2, 2, 2));
    expect(byId('start-street').getAttribute('street-align')).toContain(
      'length: start'
    );
    expect(byId('middle-street').getAttribute('street-align')).toBe(
      'width: center; length: middle'
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(KINDS_WARNING);
  });

  it('says nothing for a scene whose kinds already conform, and writes no scale or rotation they did not save (fails if the warning is unconditional, or unit scale or a rotation is written onto a conforming item)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const saved = kindsConforming();
    STREET.utils.createEntities(kindsConforming(), sceneEl);
    expect(warn).not.toHaveBeenCalled();

    const parse = (value) => {
      const [x, y, z] = value.split(' ').map(Number);
      return vec(x, y, z);
    };
    const check = (node) => {
      if (node.id !== 'street-container') {
        const el = byId(node.id);
        for (const name of ['scale', 'rotation']) {
          const value = node.components?.[name];
          expect(el.hasAttribute(name), `${node.id} ${name}`).toBe(
            value !== undefined
          );
          if (value !== undefined) {
            expect(el.getAttribute(name), `${node.id} ${name}`).toEqual(
              parse(value)
            );
          }
        }
      }
      node.children?.forEach(check);
    };
    saved.forEach(check);
  });
});
