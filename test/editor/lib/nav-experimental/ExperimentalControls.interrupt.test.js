// Characterization: tween interrupt / pre-emption / input-policy (abort
// mid-tween, tween pre-empts tween, input policy during a committed move).
// Driven through full tick-engine frames. Frozen surface: camera pose + the
// tilt / landing pose it settles to.
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

// A street-level pose from which the context resolver offers a drone RISE.
function droneRig() {
  const scene = H.representativeScene();
  const cam = H.makePerspectiveCam({
    pos: [80, 13.5, 80],
    lookAt: [70, 13, 70]
  });
  const c = H.makeControls({
    camera: cam,
    scene,
    streetLevel: true,
    wasd: true
  });
  H.tickAll(c, 16, 1); // refresh the context snapshot
  return { scene, cam, c };
}

describe('abort mid-tween', () => {
  it('a mousedown during a committed move aborts the tween and freezes the pose', () => {
    const { cam, c } = droneRig();
    expect(c.resolveContextAction().kind).toBe('drone');
    const startY = cam.position.y;

    c.triggerContextAction(); // start the drone rise
    H.tickAll(c, 16, 6);
    // The rise is underway — the observable that a committed tween is running.
    expect(cam.position.y).toBeGreaterThan(startY + 1);
    const interruptY = cam.position.y;

    // Fresh press aborts the tween: subsequent frames add no auto-motion (a
    // still-running rise would keep climbing).
    H.mouseDown(c, { clientX: 640, clientY: 360, button: 0 });
    for (let i = 0; i < 10; i++) H.tickAll(c, 16);
    expect(cam.position.y).toBeCloseTo(interruptY, 5);

    // And a drag now moves the camera (the gesture took over).
    H.mouseMove(c, { clientX: 680, clientY: 380 });
    expect(cam.position.y === interruptY && cam.position.x === 80).toBe(false);
    H.mouseUp(c);
  });
});

describe('tween pre-empts tween', () => {
  it('a plan-view request mid-recovery cancels the recovery cleanly and runs to completion', () => {
    const { cam, c } = droneRig();
    const startY = cam.position.y;
    c.triggerContextAction(); // drone rise (recovery tween)
    H.tickAll(c, 16, 5);
    expect(cam.position.y).toBeGreaterThan(startY + 1); // recovery underway

    // Plan View pre-empts the recovery tween.
    c.handlePlanViewRequest();
    for (let i = 0; i < 80; i++) H.tickAll(c, 16);
    // Plan view completed: top-down. A recovery left stranded (fighting the
    // plan-view tween) would prevent it reaching / holding 90°.
    expect(H.tilt(cam)).toBeCloseTo(90, 0);
    const settled = cam.position.clone();
    for (let i = 0; i < 10; i++) H.tickAll(c, 16);
    expect(cam.position.distanceTo(settled)).toBeCloseTo(0, 5); // stable, nothing stranded
    expect(H.tilt(cam)).toBeCloseTo(90, 0);
  });
});

describe('input policy during a committed move — wheel is DROPPED (two-arm)', () => {
  it('a wheel that WOULD move the pose in the idle state is dropped during a plan-view tween', () => {
    // Control arm: the same wheel in a non-tween state moves the pose — proving
    // the wheel is potent, so "no change" in the test arm means dropped, not inert.
    const ctrlScene = H.representativeScene();
    const ctrlCam = H.makePerspectiveCam({
      pos: [80, 60, 80],
      lookAt: [40, 12, 40]
    });
    const ctrl = H.makeControls({
      camera: ctrlCam,
      scene: ctrlScene,
      streetLevel: true
    });
    const cy0 = ctrlCam.position.y;
    H.wheel(ctrl, { dy: -500 });
    H.tickInput(ctrl, 16);
    expect(ctrlCam.position.y).not.toBeCloseTo(cy0, 1); // wheel moves the idle camera

    // Test arm: identical wheel DURING a plan-view tween changes nothing.
    const scene = H.representativeScene();
    const cam = H.makePerspectiveCam({
      pos: [80, 60, 80],
      lookAt: [40, 12, 40]
    });
    const c = H.makeControls({ camera: cam, scene, streetLevel: true });
    c.handlePlanViewRequest();
    H.wheel(c, { dy: -500 }); // delivered mid-tween
    for (let i = 0; i < 80; i++) H.tickAll(c, 16);
    const landed = cam.position.clone();
    // Landed at plan-view top-down; the dropped wheel neither moved it nor
    // queued a burst that fires after the tween.
    expect(H.tilt(cam)).toBeCloseTo(90, 0);
    for (let i = 0; i < 10; i++) H.tickAll(c, 16);
    expect(cam.position.distanceTo(landed)).toBeCloseTo(0, 5); // no post-tween burst
  });

  it('a wheel during a recovery/teleport tween is dropped identically (settles to the same pose)', () => {
    // Two-arm on the recovery tween: the mid-tween wheel must leave the settled
    // pose identical to a recovery driven with no wheel at all.
    const droneSettle = (withWheel) => {
      const { cam, c } = droneRig();
      c.triggerContextAction();
      H.tickAll(c, 16, 5);
      if (withWheel) H.wheel(c, { dy: -500 }); // delivered mid-recovery
      for (let i = 0; i < 120; i++) H.tickAll(c, 16);
      return cam.position.clone();
    };
    const noWheel = droneSettle(false);
    const withWheel = droneSettle(true);
    expect(withWheel.distanceTo(noWheel)).toBeCloseTo(0, 3); // the mid-tween wheel changed nothing
  });
});
