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
    const c = H.makeControls({
      camera: cam,
      dom: H.makeDomElement(),
      scene,
      streetLevel: true
    });
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
    expect(cam.position.distanceTo(poseAfterFirstSwitch.pos)).toBeGreaterThan(
      1e-4
    );

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

describe('rotation — sky grab pivots on the ground centre, not the cursor-ray fallback (KD-38 asymmetry)', () => {
  // The pan/rotate degenerate-cursor asymmetry: both gestures consume the same
  // worldPointAt anchor, but on a sky grab (source==='fallback') PAN uses the
  // fallback POINT directly (why it must lie on the cursor ray — #1867) while
  // ROTATE branches on source and orbits the screen-centre GROUND pivot,
  // ignoring the fallback point entirely. A degenerate-cursor test that
  // exercises only one gesture says nothing about the other, so this guards
  // the rotate side (LB pan's sky path is covered in ExperimentalControls.lbPan).
  it('Shift+LB over sky orbits fallbackCentre (y≈0), never the cursor-ray fallback point', () => {
    const scene = H.groundPlaneScene({ y: 0 });
    // Map mode (tilt 38° > T=25) but with a wide 90° FOV so the TOP of the
    // viewport looks ABOVE the horizon (sky) while the screen centre still
    // meets the ground — so worldPointAt's centre pivot is a real ground point
    // and the top-of-screen cursor grab misses everything → Step-3 fallback.
    const cam = H.makePerspectiveCam({ pos: [0, 40, 51], lookAt: [0, 0, 0], fov: 90 });
    const dom = H.makeDomElement(); // 1280x720 at (37,19) → centre client (677,379)
    const c = H.makeControls({ camera: cam, dom, scene, streetLevel: true });
    expect(H.tilt(cam)).toBeGreaterThan(25); // Map regime → orbit
    expect(H.tilt(cam)).toBeLessThan(45); // shallow enough that the top is sky

    // Cursor high in the viewport (client y=40, well above the horizon line):
    // its ray points above horizontal → misses all geometry → fallback.
    const SKY = { clientX: 677, clientY: 40 };
    const anchor = c._cursorAnchor.worldPointAt(SKY.clientX, SKY.clientY);
    expect(anchor.source).toBe('fallback'); // genuinely a sky grab
    // The fallback POINT sits UP on the cursor ray, above the ground — exactly
    // the point rotate must NOT pivot on (this is what pan uses, deliberately).
    expect(anchor.y).toBeGreaterThan(1);

    H.mouseDown(c, {
      clientX: SKY.clientX,
      clientY: SKY.clientY,
      button: 0,
      shiftKey: true
    });
    const pivot = c._latch.get('center').clone();

    // Regression guard: rotate orbits the screen-centre GROUND pivot
    // (_mapModePivot's fallbackCentre, y≈0), NOT the cursor-ray fallback point
    // (anchor.y>1). If a refactor made rotate consume the fallback point, pivot.y
    // would jump to ~anchor.y and this reds.
    expect(pivot.y).toBeLessThan(0.5);
    expect(Math.abs(pivot.y - anchor.y)).toBeGreaterThan(0.5);

    // And the orbit still produces motion — a dead gesture is also lurch-free,
    // so assert it actually rotates the camera about the ground pivot.
    const before = H.pose(cam);
    for (let i = 0; i < 8; i++) {
      H.mouseMove(c, { clientX: SKY.clientX + i * 8, clientY: SKY.clientY });
    }
    H.mouseUp(c);
    expect(Number.isFinite(cam.position.x)).toBe(true);
    expect(cam.position.distanceTo(before.pos)).toBeGreaterThan(1e-3);
  });
});
