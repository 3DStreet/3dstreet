// Characterization: tween interrupt / pre-emption / input-policy (WE14 abort-
// mid-tween, WE15 tween pre-empts tween, WE16 input policy during a committed
// move). Driven through full tick-engine frames (KD-3). Frozen surface:
// camera pose + the animating/recovery flags via observable pose (KD-4a).
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as H from './_harness.js';

let Controls;
beforeAll(async () => {
  Controls = await H.loadControls();
  H.useControlsClass(Controls);
});
beforeEach(() => H.stubClock());
afterEach(() => H.teardownAll());

// A street-level pose from which the context resolver offers a drone RISE.
function droneRig() {
  const scene = H.representativeScene();
  const cam = H.makePerspectiveCam({ pos: [80, 13.5, 80], lookAt: [70, 13, 70] });
  const c = H.makeControls({ camera: cam, scene, streetLevel: true, wasd: true });
  H.run(c, 16, 1); // refresh the context snapshot
  return { scene, cam, c };
}

describe('WE14 — abort mid-tween', () => {
  it('a mousedown during a committed move aborts the tween and freezes the pose', () => {
    const { cam, c } = droneRig();
    expect(c.resolveContextAction().kind).toBe('drone');

    c.triggerContextAction(); // start the drone rise
    H.run(c, 16, 6);
    expect(c._recoveryActive).toBe(true);
    expect(c._tick.isAnimating()).toBe(true);
    const interruptY = cam.position.y;

    // Fresh press aborts the tween.
    H.mouseDown(c, { clientX: 640, clientY: 360, button: 0 });
    expect(c._recoveryActive).toBe(false);
    expect(c._tick.isAnimating()).toBe(false);

    // Pose frozen at the interrupt point; subsequent frames add no auto-motion.
    for (let i = 0; i < 10; i++) H.run(c, 16);
    expect(cam.position.y).toBeCloseTo(interruptY, 5);

    // And a drag now moves the camera (the gesture took over).
    H.mouseMove(c, { clientX: 680, clientY: 380 });
    // (any pan sub-mode moves the camera off the frozen pose)
    expect(cam.position.y === interruptY && cam.position.x === 80).toBe(false);
    H.mouseUp(c);
  });
});

describe('WE15 — tween pre-empts tween', () => {
  it('a plan-view request mid-recovery cancels the recovery cleanly and runs to completion', () => {
    const { cam, c } = droneRig();
    c.triggerContextAction(); // drone rise (recovery tween)
    H.run(c, 16, 5);
    expect(c._recoveryActive).toBe(true);

    // Plan View pre-empts the recovery tween.
    c.handlePlanViewRequest();
    expect(c._recoveryActive).toBe(false); // recovery cancelled, not stranded
    expect(c._planViewActive).toBe(true);

    for (let i = 0; i < 80; i++) H.run(c, 16);
    // Plan view completed: top-down and no longer active.
    expect(c._planViewActive).toBe(false);
    expect(H.tilt(cam)).toBeCloseTo(90, 0);
  });
});

describe('WE16 — input policy during a committed move (wheel is DROPPED)', () => {
  it('wheel delivered during a plan-view tween is dropped (pose unchanged by it)', () => {
    const scene = H.representativeScene();
    const cam = H.makePerspectiveCam({ pos: [80, 60, 80], lookAt: [40, 12, 40] });
    const c = H.makeControls({ camera: cam, scene, streetLevel: true });

    c.handlePlanViewRequest();
    expect(c._isInactive()).toBe(true);
    // Wheel mid-tween: _onWheel returns before touching the accumulator.
    H.wheel(c, { dy: -500 });
    expect(c._wheelAccum).toBe(0); // dropped, not queued
    for (let i = 0; i < 80; i++) H.run(c, 16);
    // Landed at plan view top-down — the dropped wheel changed nothing.
    expect(H.tilt(cam)).toBeCloseTo(90, 0);
  });

  it('wheel delivered during a recovery/teleport tween is dropped identically', () => {
    const { c } = droneRig();
    c.triggerContextAction();
    H.run(c, 16, 5);
    expect(c._tweenOwnsCamera()).toBe(true);
    H.wheel(c, { dy: -500 });
    expect(c._wheelAccum).toBe(0); // same drop — no burst, no contrast
  });
});
