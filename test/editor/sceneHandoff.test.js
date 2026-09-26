import { describe, it, expect } from 'vitest';
import {
  buildHandoffScene,
  handoffUrlFor
} from '../../src/editor/lib/sceneHandoff.js';
import { decodeSceneHash } from '../../src/tested/scene-hash-codec.js';

const sceneObject = {
  title: 'Corner',
  version: '0.5.6',
  data: [
    {
      id: 'street-container',
      children: [
        {
          components: {
            shape: { closed: true },
            'build-area': { palette: 'tree3,bench', maxObjects: 5 }
          },
          children: [
            {
              components: { 'shape-vertex': '', position: { x: 0, y: 0, z: 0 } }
            },
            { mixin: 'tree3', components: { position: { x: 1, y: 0, z: 1 } } }
          ]
        }
      ]
    }
  ],
  memory: {}
};

describe('sceneHandoff', () => {
  it('strips build-area components at any depth and keeps everything else', () => {
    const scene = buildHandoffScene({ sceneObject, sourceSceneId: 'abc' });
    const shape = scene.data[0].children[0];
    expect(shape.components['build-area']).toBeUndefined();
    expect(shape.components.shape).toEqual({ closed: true });
    expect(shape.children).toHaveLength(2);
    expect(shape.children[1].mixin).toBe('tree3');
    expect(scene.memory.forkedFrom).toBe('abc');
    // The input is not mutated.
    expect(
      sceneObject.data[0].children[0].components['build-area']
    ).toBeDefined();
  });

  it('strips the string-form component values filterJSONstreet produces', () => {
    // Production input: convertDOMElToObject + filterJSONstreet stringify
    // component values ("enabled: true; palette: tree3,bench").
    const stringForm = {
      title: 'Corner',
      data: [
        {
          components: {
            shape: 'closed: true',
            'build-area': 'enabled: true; palette: tree3,bench; maxObjects: 5'
          },
          children: [{ mixin: 'tree3', components: { position: '1 0 1' } }]
        }
      ],
      memory: {}
    };
    const scene = buildHandoffScene({ sceneObject: stringForm });
    expect(scene.data[0].components).toEqual({ shape: 'closed: true' });
    expect(scene.data[0].children[0].mixin).toBe('tree3');
  });

  it('stamps the camera state when given and omits forkedFrom for local drafts', () => {
    const cameraState = { position: { x: 1, y: 2, z: 3 } };
    const scene = buildHandoffScene({ sceneObject, cameraState });
    expect(scene.memory.cameraState).toEqual(cameraState);
    expect(scene.memory.forkedFrom).toBeUndefined();
  });

  it('produces a deflate hash the loader can decode back to the scene', async () => {
    const scene = buildHandoffScene({ sceneObject });
    const url = await handoffUrlFor(scene, 'https://3dstreet.app/');
    const prefix = 'https://3dstreet.app/#deflate-3dstreet-json:';
    expect(url.startsWith(prefix)).toBe(true);
    const roundTrip = JSON.parse(
      await decodeSceneHash(url.slice(prefix.length))
    );
    expect(roundTrip).toEqual(scene);
  });
});
