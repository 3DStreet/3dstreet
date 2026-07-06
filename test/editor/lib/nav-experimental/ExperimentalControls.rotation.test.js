// Characterization: Shift+LB rotation (map-orbit pivot stays fixed; live-Shift
// truck↔rotate mid-drag switch). Frozen surface: camera pose + the pivot's
// on-screen projection; the mode-change event stream.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as H from './_harness.js';

let Controls;
beforeAll(async () => {
  Controls = await H.loadControls();
  H.useControlsClass(Controls);
});
beforeEach(() => {
  H.stubClock();
  H.clearSceneGlobals();
});
afterEach(() => H.teardownAll());

describe('rotation — map-orbit keeps a tilted off-axis pivot fixed (Tier 2)', () => {
  it('the pivot stays within ε px of its screen position through the orbit arc', () => {
    const scene = H.representativeScene();
    const cam = H.makePerspectiveCam({ pos: [0, 80, 60], lookAt: [0, 12, 0] });
    const c = H.makeControls({ camera: cam, dom: H.makeDomElement(), scene, streetLevel: true });
    expect(H.floorBelow(c, cam).source).not.toBe('cache'); // real surface, not the miss/cache path
    expect(H.tilt(cam)).toBeGreaterThan(25); // Map regime → orbit

    // Off-axis grab (700,300 is not the viewport centre). The orbit pivot is
    // read from the latch for observation (setup/driving, not an assertion).
    H.mouseDown(c, { clientX: 700, clientY: 300, button: 0, shiftKey: true });
    const pivot = c._latch.get('center').clone();
    const before = H.screenOf(cam, c._domElement, pivot);

    for (let i = 0; i < 12; i++) {
      H.mouseMove(c, { clientX: 700 + i * 6, clientY: 300 + (i % 3) });
      const now = H.screenOf(cam, c._domElement, pivot);
      // Single-shared-rotation keeps the pivot pinned on screen.
      expect(Math.hypot(now.x - before.x, now.y - before.y)).toBeLessThan(1.5);
    }
    H.mouseUp(c);
  });
});

describe('rotation — live-Shift truck↔rotate mid-drag switch (Tier 2)', () => {
  it('one continuous drag toggles sub-mode rotate→pan→rotate, emitting each edge', () => {
    const scene = H.representativeScene();
    const cam = H.makePerspectiveCam({ pos: [0, 80, 60], lookAt: [0, 12, 0] });
    const c = H.makeControls({ camera: cam, scene, streetLevel: true });
    const modes = H.onEvent(c, 'nav-experimental:modechange');

    H.mouseDown(c, { clientX: 640, clientY: 360, button: 0, shiftKey: true });
    expect(c._latch.get('mode')).toBe('rotate'); // canary (KD-4c): latch is orchestrator-retained
    H.mouseMove(c, { clientX: 660, clientY: 360 });

    // Shift released mid-drag → pan.
    H.keyUp(c, 'ShiftLeft', { shiftKey: false });
    expect(c._latch.get('mode')).toBe('pan'); // canary (KD-4c): latch is orchestrator-retained
    const poseAfterFirstSwitch = H.pose(cam);
    H.mouseMove(c, { clientX: 680, clientY: 370 });
    // The pan actually moves the camera (pose evolves across the switch).
    expect(cam.position.distanceTo(poseAfterFirstSwitch.pos)).toBeGreaterThan(1e-4);

    // Shift pressed again → rotate.
    H.keyDown(c, 'ShiftLeft', { shiftKey: true });
    expect(c._latch.get('mode')).toBe('rotate'); // canary (KD-4c): latch is orchestrator-retained
    H.mouseMove(c, { clientX: 700, clientY: 360 });
    H.mouseUp(c);

    // The coarse mode stream reflects both switches and the final release.
    const seq = modes.events.map((e) => e.mode);
    expect(seq).toContain('rotate');
    expect(seq).toContain('pan');
    expect(seq[seq.length - 1]).toBe(null); // gesture end
  });
});
