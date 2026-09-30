import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { installEditorFrame } from '@/editor/lib/editorFrame.js';

let sceneEl;
let inspector;
const renderer = {};
const camera = new THREE.PerspectiveCamera();

// One editor frame as the renderer runs it: the clock advances, three updates
// matrices, then calls the scene's before and after hooks around drawing.
function frame({ newFrame = true } = {}) {
  if (newFrame) sceneEl.time += 16;
  const scene = sceneEl.object3D;
  scene.updateMatrixWorld();
  scene.onBeforeRender(renderer, scene, camera, null);
  scene.onAfterRender(renderer, scene, camera);
}

beforeEach(() => {
  sceneEl = document.createElement('a-scene');
  sceneEl.object3D = new THREE.Scene();
  sceneEl.time = 0;
  inspector = { opened: true };
  vi.stubGlobal('AFRAME', { INSPECTOR: inspector });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('editor frame window', () => {
  it('installs once per scene into the render hooks', () => {
    const frameA = installEditorFrame(sceneEl);
    expect(installEditorFrame(sceneEl)).toBe(frameA);
    expect(sceneEl.object3D.onBeforeRender).not.toBe(
      THREE.Object3D.prototype.onBeforeRender
    );
    expect(sceneEl.object3D.onAfterRender).not.toBe(
      THREE.Object3D.prototype.onAfterRender
    );
  });

  it('keeps render hooks the scene already had, running them after its own with one warning', () => {
    const calls = [];
    sceneEl.object3D.onBeforeRender = () => calls.push('previous before');
    sceneEl.object3D.onAfterRender = () => calls.push('previous after');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const editorFrame = installEditorFrame(sceneEl);
    editorFrame.register(() => calls.push('before'));
    editorFrame.register(() => calls.push('after'), { phase: 'after' });
    frame();
    expect(calls).toEqual([
      'before',
      'previous before',
      'after',
      'previous after'
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('runs callbacks in order, before and after drawing', () => {
    const editorFrame = installEditorFrame(sceneEl);
    const calls = [];
    editorFrame.register(() => calls.push('after'), { phase: 'after' });
    editorFrame.register(() => calls.push('late'), { order: 10 });
    editorFrame.register(() => calls.push('early'), { order: -10 });
    editorFrame.register(() => calls.push('default'));
    frame();
    expect(calls).toEqual(['early', 'default', 'late', 'after']);
  });

  it('does nothing while the editor is closed (fails with no gate)', () => {
    const editorFrame = installEditorFrame(sceneEl);
    const callback = vi.fn();
    editorFrame.register(callback);
    frame();
    expect(callback).toHaveBeenCalledTimes(1);
    inspector.opened = false;
    for (let i = 0; i < 5; i++) frame();
    expect(callback).toHaveBeenCalledTimes(1);
    inspector.opened = true;
    frame();
    expect(callback).toHaveBeenCalledTimes(2);
  });

  it('runs once-per-frame work on the first render of a frame only, and every-render work on each', () => {
    const editorFrame = installEditorFrame(sceneEl);
    const perFrame = vi.fn();
    const perFrameAfter = vi.fn();
    const everyRender = vi.fn();
    editorFrame.register(perFrame);
    editorFrame.register(perFrameAfter, { phase: 'after' });
    editorFrame.register(everyRender, { everyRender: true });
    frame();
    // A second render in the same frame, as a screenshot makes.
    frame({ newFrame: false });
    expect(perFrame).toHaveBeenCalledTimes(1);
    expect(perFrameAfter).toHaveBeenCalledTimes(1);
    expect(everyRender).toHaveBeenCalledTimes(2);
    expect(everyRender.mock.calls[1][0].firstOfFrame).toBe(false);
  });

  it('isolates a throwing callback: the render continues, the others run, and the thrower is dropped (fails if a throw escapes the hook)', () => {
    const editorFrame = installEditorFrame(sceneEl);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const first = vi.fn();
    const thrower = vi.fn(() => {
      throw new Error('boom');
    });
    const third = vi.fn();
    editorFrame.register(first);
    editorFrame.register(thrower);
    editorFrame.register(third);

    expect(() => frame()).not.toThrow();
    expect(first).toHaveBeenCalledTimes(1);
    expect(thrower).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);

    frame();
    expect(thrower).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(2);
    expect(third).toHaveBeenCalledTimes(2);
  });

  it('retries a callback that allows repeated throws, and drops it only after that many in a row', () => {
    const editorFrame = installEditorFrame(sceneEl);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    let throwing = true;
    const flaky = vi.fn(() => {
      if (throwing) throw new Error('flaky');
    });
    editorFrame.register(flaky, { maxConsecutiveThrows: 5 });
    for (let i = 0; i < 4; i++) frame();
    throwing = false;
    frame();
    throwing = true;
    for (let i = 0; i < 5; i++) frame();
    expect(flaky).toHaveBeenCalledTimes(10);
    frame();
    expect(flaky).toHaveBeenCalledTimes(10);
    // One message when each run of throws starts, and one when it is dropped.
    expect(error).toHaveBeenCalledTimes(3);
  });

  it('unregisters on request', () => {
    const editorFrame = installEditorFrame(sceneEl);
    const callback = vi.fn();
    const unregister = editorFrame.register(callback);
    frame();
    unregister();
    frame();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('skips a callback unregistered by an earlier one in the same pass (fails if the pass runs a list taken before the removal)', () => {
    const editorFrame = installEditorFrame(sceneEl);
    const later = vi.fn();
    const unregister = {};
    editorFrame.register(() => unregister.later(), { order: 1 });
    unregister.later = editorFrame.register(later, { order: 2 });
    frame();
    frame();
    expect(later).not.toHaveBeenCalled();
  });

  it('treats every render as a new frame on a scene with no clock', () => {
    const editorFrame = installEditorFrame(sceneEl);
    const perFrame = vi.fn();
    editorFrame.register(perFrame);
    sceneEl.time = undefined;
    frame({ newFrame: false });
    frame({ newFrame: false });
    expect(perFrame).toHaveBeenCalledTimes(2);
    expect(perFrame.mock.calls.every(([c]) => c.firstOfFrame)).toBe(true);
  });
});
