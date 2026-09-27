/* global describe, it */
import assert from 'assert';
import {
  resolveSavedCameraStates,
  hasViewerStart,
  pickLoadCameraState,
  DEFAULT_FOV_DEGREES
} from '../../src/tested/scene-camera-pose.js';
import { DEFAULT_FOV_DEGREES as NAV_DEFAULT_FOV_DEGREES } from '../../src/editor/lib/nav-experimental/constants.js';

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

// #2031: one default fov. THREE's PerspectiveCamera default, the inspector
// camera's resting fov, the Starting View's schema default and every
// camera-state `zoom` fallback all read this value; the nav constants module
// re-exports it rather than carrying a second literal.
describe('DEFAULT_FOV_DEGREES', () => {
  it('is 50 and is the same value the nav constants export', () => {
    assert.strictEqual(DEFAULT_FOV_DEGREES, 50);
    assert.strictEqual(NAV_DEFAULT_FOV_DEGREES, DEFAULT_FOV_DEGREES);
  });
});
