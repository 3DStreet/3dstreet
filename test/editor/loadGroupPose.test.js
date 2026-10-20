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
// stretched member, and the same box.
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
  '[groups] Removed tilt or scale from 3 groups on load; heading and position kept: "Scaled group" (scale 1.5 1.5 1.5), "Outer group" (scale 2 2 2), "Inner tilted group" (rotation x 10, z 0).';

beforeAll(async () => {
  window.BATCHING_ENABLED = false;
  sceneEl = document.createElement('a-scene');
  sceneEl.emit = vi.fn();
  sceneEl.object3D = new THREE.Scene();
  document.body.append(sceneEl);
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

  it('says nothing for a scene whose groups already conform, and loads it as saved (fails if the warning is unconditional)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    STREET.utils.createEntities(groupsConforming(), sceneEl);
    expect(warn).not.toHaveBeenCalled();
    expect(byId('level-group').getAttribute('rotation')).toEqual({
      x: 0,
      y: 30,
      z: 0
    });
    expect(byId('level-group').hasAttribute('scale')).toBe(false);
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
