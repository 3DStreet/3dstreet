/* global describe, it */
import assert from 'assert';
import {
  resolveSavedCameraStates,
  pickLoadCameraState
} from '../../src/tested/scene-camera-pose.js';

const A = { position: { x: 1, y: 2, z: 3 } };
const B = { position: { x: 4, y: 5, z: 6 } };
const URL = { position: { x: 9, y: 9, z: 9 } };

describe('resolveSavedCameraStates', () => {
  it('returns nulls for empty memory', () => {
    assert.deepStrictEqual(resolveSavedCameraStates(undefined), {
      snapshotCameraState: null,
      editorCameraState: null
    });
  });

  it('default snapshot is the start pose, autosave is the editor pose', () => {
    const memory = {
      cameraState: A,
      snapshots: [
        { isDefault: false, cameraState: URL },
        { isDefault: true, cameraState: B }
      ]
    };
    assert.deepStrictEqual(resolveSavedCameraStates(memory), {
      snapshotCameraState: B,
      editorCameraState: A
    });
  });

  it('each falls back to the other when one is missing', () => {
    assert.deepStrictEqual(resolveSavedCameraStates({ cameraState: A }), {
      snapshotCameraState: A,
      editorCameraState: A
    });
    assert.deepStrictEqual(
      resolveSavedCameraStates({
        snapshots: [{ isDefault: true, cameraState: B }]
      }),
      { snapshotCameraState: B, editorCameraState: B }
    );
  });
});

describe('pickLoadCameraState', () => {
  it('a ?camera= deep link wins over everything', () => {
    assert.strictEqual(
      pickLoadCameraState({
        urlCameraState: URL,
        isOwner: true,
        startCameraState: A,
        editorCameraState: B
      }),
      URL
    );
  });

  it('viewer/embed launches open at the start pose even for the owner', () => {
    assert.strictEqual(
      pickLoadCameraState({
        viewerLaunch: true,
        isOwner: true,
        startCameraState: A,
        editorCameraState: B
      }),
      A
    );
  });

  it('non-owners in the editor open at the start pose', () => {
    assert.strictEqual(
      pickLoadCameraState({
        isOwner: false,
        startCameraState: A,
        editorCameraState: B
      }),
      A
    );
  });

  it('the owner lands on their editor pose, falling back to the start pose', () => {
    assert.strictEqual(
      pickLoadCameraState({
        isOwner: true,
        startCameraState: A,
        editorCameraState: B
      }),
      B
    );
    assert.strictEqual(
      pickLoadCameraState({ isOwner: true, startCameraState: A }),
      A
    );
  });

  it('returns null when nothing is saved (default overview)', () => {
    assert.strictEqual(pickLoadCameraState({ isOwner: true }), null);
    assert.strictEqual(pickLoadCameraState({ viewerLaunch: true }), null);
  });
});
