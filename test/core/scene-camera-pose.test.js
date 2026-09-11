/* global describe, it */
import assert from 'assert';
import {
  resolveSavedCameraStates,
  hasViewerStart,
  pickLoadCameraState
} from '../../src/tested/scene-camera-pose.js';

const A = { position: { x: 1, y: 2, z: 3 } };
const B = { position: { x: 4, y: 5, z: 6 } };
const URL = { position: { x: 9, y: 9, z: 9 } };

describe('resolveSavedCameraStates', () => {
  it('returns nulls for empty memory', () => {
    assert.deepStrictEqual(resolveSavedCameraStates(undefined), {
      editorCameraState: null,
      legacyStartCameraState: null
    });
  });

  it('splits the autosaved editor pose from the legacy default-snapshot pose', () => {
    const memory = {
      cameraState: A,
      snapshots: [
        { isDefault: false, cameraState: URL },
        { isDefault: true, cameraState: B }
      ]
    };
    assert.deepStrictEqual(resolveSavedCameraStates(memory), {
      editorCameraState: A,
      legacyStartCameraState: B
    });
  });

  it('a non-default snapshot is not a start pose', () => {
    const memory = { snapshots: [{ isDefault: false, cameraState: B }] };
    assert.strictEqual(
      resolveSavedCameraStates(memory).legacyStartCameraState,
      null
    );
  });
});

describe('hasViewerStart', () => {
  it('finds a viewer-start at any depth and nowhere else', () => {
    assert.strictEqual(hasViewerStart([]), false);
    assert.strictEqual(
      hasViewerStart([{ components: { position: '0 0 0' } }]),
      false
    );
    assert.strictEqual(
      hasViewerStart([{ components: { 'viewer-start': '' } }]),
      true
    );
    assert.strictEqual(
      hasViewerStart([
        {
          components: {},
          children: [{ components: { 'viewer-start': { fov: 50 } } }]
        }
      ]),
      true
    );
  });
});

describe('pickLoadCameraState', () => {
  it('a ?camera= deep link wins over everything', () => {
    assert.strictEqual(
      pickLoadCameraState({
        urlCameraState: URL,
        startCameraState: A,
        editorCameraState: B
      }),
      URL
    );
  });

  it('the Starting View wins over the editor pose, for everyone', () => {
    assert.strictEqual(
      pickLoadCameraState({ startCameraState: A, editorCameraState: B }),
      A
    );
  });

  it('without a Starting View the autosaved editor pose is used', () => {
    assert.strictEqual(pickLoadCameraState({ editorCameraState: B }), B);
  });

  it('returns null when nothing is saved (default overview)', () => {
    assert.strictEqual(pickLoadCameraState({}), null);
  });
});
