// The `enabled` false edge must freeze motions ALREADY IN FLIGHT, not just
// gate new input. mode-manager's activateSceneCamera() (drive start, WebXR
// entry) sets `controls.enabled = false` and hands the render camera to the
// scene rig — a committed tween that kept ticking would write the unrendered
// editor camera and corrupt the pose the borrower restores on exit.
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

describe('enabled=false mid-tween — camera-borrower handoff', () => {
  it('cancels an in-flight committed motion; no further camera writes', () => {
    const scene = H.rampScene({ baseY: 12, slopeDeg: 8 });
    // Elevated, gazing steeply down — the resolver offers the 'street' swoop.
    const cam = H.makePerspectiveCam({ pos: [0, 40, -6], lookAt: [0, 12, 18] });
    const c = H.makeControls({ camera: cam, scene, streetLevel: true });
    H.tickAll(c, 16, 1);
    expect(c.resolveContextAction().kind).toBe('street');

    c.triggerContextAction(); // committed swoop tween
    for (let i = 0; i < 10; i++) H.tickAll(c, 16); // mid-flight
    const midFlight = cam.position.clone();
    // Sanity: the tween is actually moving the camera.
    expect(midFlight.y).toBeLessThan(40);

    c.enabled = false; // the mode-manager handoff edge
    for (let i = 0; i < 120; i++) H.tickAll(c, 16);
    // Frozen exactly where the cancel caught it — no further writes.
    expect(cam.position.distanceTo(midFlight)).toBeCloseTo(0, 6);

    // Re-enable: nothing resumes on its own.
    c.enabled = true;
    for (let i = 0; i < 30; i++) H.tickAll(c, 16);
    expect(cam.position.distanceTo(midFlight)).toBeCloseTo(0, 6);
  });

  it('drops held WASD keys so flight does not resume after re-enable', () => {
    const scene = H.representativeScene({ groundSize: 400 });
    const cam = H.makePerspectiveCam({
      pos: [0, 13.5, 20],
      lookAt: [0, 13.5, 40]
    });
    const c = H.makeControls({
      camera: cam,
      scene,
      wasd: true,
      streetLevel: true
    });
    H.keyDown(c, 'KeyW');
    for (let i = 0; i < 10; i++) H.tickInput(c, 16);
    c.enabled = false; // handoff mid-flight (keyup will go to the borrower)
    c.enabled = true; // borrower returns the camera
    const returned = cam.position.clone();
    for (let i = 0; i < 30; i++) H.tickInput(c, 16);
    // The held key was cleared on the false edge — no ghost flight.
    expect(cam.position.distanceTo(returned)).toBeCloseTo(0, 6);
  });
});
