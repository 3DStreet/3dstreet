// Characterization: cross-cutting shared-context invariants. All state that
// TASK-036 relocates is asserted only through VERIFIED two-arm observable
// proxies (KD-4b) — never a private field read. Each proxy ships a break-it
// check (see ExperimentalControls.crossCutting.breakcheck.test.js).
//
//   WE9  — tween-settle: zoom-undo cleared (two-arm) + grounded re-derived (two-arm)
//   WE10 — camera-anchor writer ordering (pose after a mixed tick)
//   WE11 — cross-controller zoom-undo invalidation (two-arm)
//   WE13a — WASD ↔ rotation hand-off
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as H from './_harness.js';

let Controls;
beforeAll(async () => {
  Controls = await H.loadControls();
  H.useControlsClass(Controls);
});
beforeEach(() => H.stubClock());
afterEach(() => H.teardownAll());

// A swoop-over-open-ground rig: entry tilt ≈ 54.7° (NOT the 60° default
// overview), so "retrace to entry" and "ease to default" are distinguishable
// (KD-4b: entry ≠ fallback). Landing is on the big ground plane so a small
// pan stays on-surface (a real probe hit, not a miss).
function swoopRig() {
  const scene = H.representativeScene({ groundSize: 400 });
  const cam = H.makePerspectiveCam({ pos: [80, 92, 80], lookAt: [40, 12, 40] });
  const c = H.makeControls({ camera: cam, scene, streetLevel: true });
  return { scene, cam, c };
}

describe('WE9 — tween-settle: zoom-undo memory (two-arm)', () => {
  it('wheel-out RETRACES the entry tilt with no intervening committed move, and eases to the DEFAULT overview after one', () => {
    // Arm A — capture then pure wheel-out.
    const A = swoopRig();
    const entryTilt = H.tilt(A.cam); // ≈ 54.7°, ≠ 60° default overview
    expect(entryTilt).toBeGreaterThan(45);
    expect(Math.abs(entryTilt - 60)).toBeGreaterThan(3);
    H.driveSwoopIn(A.c, A.cam, 3);
    H.driveSwoopOut(A.c, 80);
    const tiltA = H.tilt(A.cam);

    // Arm B — capture, a committed pan (clears the memory), then wheel-out.
    const B = swoopRig();
    H.driveSwoopIn(B.c, B.cam, 3);
    H.mouseDown(B.c, { clientX: 640, clientY: 360, button: 0 });
    H.mouseMove(B.c, { clientX: 645, clientY: 355 });
    H.mouseUp(B.c);
    H.driveSwoopOut(B.c, 80);
    const tiltB = H.tilt(B.cam);

    // Arm A retraces entry; arm B eases to the default overview (TH-28 = 60°).
    expect(tiltA).toBeCloseTo(entryTilt, 0);
    expect(tiltB).toBeCloseTo(60, 0);
    // The difference is the observable of the invariant firing.
    expect(Math.abs(tiltA - tiltB)).toBeGreaterThan(3);
  });

  it('grounded is re-derived at settle: grounded WASD follows the floor down; flying holds absolute height (two-arm)', () => {
    // Both arms: same slope, same drive. The only difference is whether the
    // grounded state was re-derived from the settled pose.
    const build = () => {
      const scene = H.rampScene({ baseY: 12, slopeDeg: 8 });
      const cam = H.makePerspectiveCam({ pos: [0, 13.5, 0], lookAt: [0, 13.5, 20] });
      const c = H.makeControls({ camera: cam, scene, wasd: true, streetLevel: true });
      return { cam, c };
    };
    const startY = 13.5;

    // Grounded arm: re-derive grounded from the settled street-level pose.
    const G = build();
    G.c._deriveGroundedFromPose();
    expect(G.c._grounded).toBe(true);
    H.keyDown(G.c, 'KeyW');
    for (let i = 0; i < 60; i++) H.step(G.c, 16);
    const yGrounded = G.cam.position.y;

    // Flying arm: a not-grounded pose (never settled onto the surface).
    const F = build();
    F.c._grounded = false;
    F.c._captureH();
    H.keyDown(F.c, 'KeyW');
    for (let i = 0; i < 60; i++) H.step(F.c, 16);
    const yFlying = F.cam.position.y;

    // Grounded followed the descending slope down; flying held absolute height.
    expect(yGrounded).toBeLessThan(startY - 0.5);
    expect(yFlying).toBeCloseTo(startY, 2);
    expect(yFlying - yGrounded).toBeGreaterThan(0.8); // clear y-trajectory difference
  });
});

describe('WE10 — camera-anchor writer ordering (Tier 1.5)', () => {
  it('a tick where wheel and WASD both act produces a well-defined composite pose', () => {
    const scene = H.groundPlaneScene({ y: 0 });
    const cam = H.makePerspectiveCam({ pos: [0, 30, 0], lookAt: [0, 0, -20] });
    const c = H.makeControls({ camera: cam, scene, wasd: true, streetLevel: true });

    // Magnitudes chosen so both writers move the pose beyond tolerance (L-A).
    H.wheel(c, { dy: -300, clientX: 640, clientY: 360 });
    H.keyDown(c, 'KeyW');
    const before = cam.position.clone();
    H.step(c, 16);
    const d = cam.position.clone().sub(before);

    // Both the wheel (vertical dolly) and WASD (forward, −Z) contributed.
    expect(Math.abs(d.y)).toBeGreaterThan(1); // wheel dolly descended
    expect(Math.abs(d.z)).toBeGreaterThan(1); // WASD moved forward
    // Pin the composite pose (the observable of the read-then-write order).
    expect(cam.position.y).toBeCloseTo(25.8, 0);
    expect(cam.position.z).toBeCloseTo(-3.4, 0);
  });
});

describe('WE11 — cross-controller zoom-undo invalidation (two-arm)', () => {
  it('an immediate wheel-out retraces, but a rotation in between invalidates the retrace', () => {
    // Arm A — partial swoop then immediate wheel-out (retrace preserved).
    const A = swoopRig();
    const entryTilt = H.tilt(A.cam);
    H.driveSwoopIn(A.c, A.cam, 5);
    H.driveSwoopOut(A.c, 80);
    const tiltA = H.tilt(A.cam);

    // Arm B — partial swoop, a rotation gesture in between, then wheel-out.
    const B = swoopRig();
    H.driveSwoopIn(B.c, B.cam, 5);
    H.mouseDown(B.c, { clientX: 640, clientY: 360, button: 0, shiftKey: true });
    H.mouseMove(B.c, { clientX: 650, clientY: 360 });
    H.mouseUp(B.c);
    H.driveSwoopOut(B.c, 80);
    const tiltB = H.tilt(B.cam);

    // A retraces to entry; B does not (eases to the default overview instead).
    expect(tiltA).toBeCloseTo(entryTilt, 0);
    expect(tiltB).toBeCloseTo(60, 0);
    expect(Math.abs(tiltA - tiltB)).toBeGreaterThan(3);
  });
});

describe('WE13a — WASD ↔ rotation hand-off (Tier 1.5)', () => {
  it('pressing a movement key mid-rotate ends the rotation gesture and starts WASD', () => {
    const scene = H.groundPlaneScene({ y: 0 });
    const cam = H.makePerspectiveCam({ pos: [0, 1.5, 0], lookAt: [0, 1.5, -1] });
    const c = H.makeControls({ camera: cam, scene, wasd: true, streetLevel: true });

    H.mouseDown(c, { clientX: 640, clientY: 360, button: 0, shiftKey: true });
    H.mouseMove(c, { clientX: 660, clientY: 360 });
    expect(c._latch.isActive()).toBe(true);
    expect(c._latch.get('mode')).toBe('rotate');

    // Press W while Shift is still held (a genuine mid-rotate WASD entry).
    H.keyDown(c, 'KeyW', { shiftKey: true });

    // Rotation gesture ended; WASD engaged.
    expect(c._latch.isActive()).toBe(false);
    expect([...c._heldKeys]).toContain('KeyW');

    // Further mouse movement no longer rotates (no active latch).
    const q = cam.quaternion.clone();
    H.mouseMove(c, { clientX: 700, clientY: 360 });
    expect(1 - Math.abs(cam.quaternion.dot(q))).toBeLessThan(1e-9);
  });
});
