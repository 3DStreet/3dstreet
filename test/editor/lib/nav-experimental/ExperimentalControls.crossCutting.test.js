// Characterization: cross-cutting shared-context invariants. State that the
// decomposition relocates is asserted only through VERIFIED two-arm observable
// proxies — never a private field read. Each proxy ships a break-it check (see
// ExperimentalControls.crossCutting.breakcheck.test.js):
//
//   tween-settle: zoom-undo cleared (two-arm) + grounded re-derived (two-arm)
//   camera-anchor writer ordering (pose after a mixed tick)
//   cross-controller zoom-undo invalidation (two-arm)
//   WASD ↔ rotation hand-off
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

// A swoop-over-open-ground rig: entry tilt ≈ 53° (well above 45° and clearly
// off the 60° default overview), so "retrace to entry" and "ease to default"
// are distinguishable (entry ≠ fallback). The look-at ground point (30,45) sits
// clear of the scatter cube at (40,40) so the cursor ray never grazes it.
// Landing is on the big ground plane so a small pan stays on-surface (a real
// probe hit, not a miss).
function swoopRig() {
  const scene = H.representativeScene({ groundSize: 400 });
  const cam = H.makePerspectiveCam({ pos: [80, 92, 80], lookAt: [30, 12, 45] });
  const c = H.makeControls({ camera: cam, scene, streetLevel: true });
  return { scene, cam, c };
}

describe('tween-settle — zoom-undo memory (two-arm)', () => {
  it('wheel-out RETRACES the entry tilt with no intervening committed move, and eases to the DEFAULT overview after one', () => {
    // Arm A — capture then pure wheel-out.
    const A = swoopRig();
    // Real-hit gate: the rig must probe a real surface, not the miss/cache path.
    expect(H.floorBelow(A.c, A.cam).source).not.toBe('cache');
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
      const cam = H.makePerspectiveCam({
        pos: [0, 13.5, 0],
        lookAt: [0, 13.5, 20]
      });
      const c = H.makeControls({
        camera: cam,
        scene,
        wasd: true,
        streetLevel: true
      });
      return { cam, c };
    };
    const startY = 13.5;

    // Grounded arm: re-derive grounded from the settled street-level pose.
    const G = build();
    expect(H.floorBelow(G.c, G.cam).source).not.toBe('cache'); // real ramp hit
    G.c._deriveGroundedFromPose();
    H.keyDown(G.c, 'KeyW');
    for (let i = 0; i < 60; i++) H.tickInput(G.c, 16);
    const yGrounded = G.cam.position.y;

    // Flying arm: a not-grounded pose (never settled onto the surface).
    const F = build();
    F.c._grounded = false;
    F.c._captureH();
    H.keyDown(F.c, 'KeyW');
    for (let i = 0; i < 60; i++) H.tickInput(F.c, 16);
    const yFlying = F.cam.position.y;

    // Grounded followed the descending slope down; flying held absolute height.
    expect(yGrounded).toBeLessThan(startY - 0.5);
    expect(yFlying).toBeCloseTo(startY, 2);
    expect(yFlying - yGrounded).toBeGreaterThan(0.8); // clear y-trajectory difference
  });

  it('a real settle (not a hand-call) re-derives grounded: after a committed street swoop, WASD follows the slope down', () => {
    // End-to-end guard on the REAL trigger site: drive the context "street"
    // swoop to completion so its tween settles the camera grounded on the ramp
    // — WITHOUT calling _deriveGroundedFromPose() by hand — then WASD down the
    // slope must follow the floor (grounded), proving the settle grounded us.
    const scene = H.rampScene({ baseY: 12, slopeDeg: 8 });
    // Elevated above the ramp, gazing steeply down along +Z (down-slope) so the
    // resolver offers the descending 'street' swoop.
    const cam = H.makePerspectiveCam({ pos: [0, 40, -6], lookAt: [0, 12, 18] });
    const c = H.makeControls({
      camera: cam,
      scene,
      wasd: true,
      streetLevel: true
    });
    expect(H.floorBelow(c, cam).source).not.toBe('cache'); // real ramp hit

    H.tickAll(c, 16, 1); // refresh the context snapshot
    const action = c.resolveContextAction();
    expect(action.kind).toBe('street');
    expect(action.enabled).toBe(true);

    c.triggerContextAction(); // committed swoop-to-street tween
    for (let i = 0; i < 120; i++) H.tickAll(c, 16);
    const landedY = cam.position.y;
    // Settled roughly one eye-margin above the ramp surface below.
    expect(H.aglBelow(c, cam)).toBeCloseTo(1.5, 0);

    // Now WASD down-slope (+Z): a grounded camera follows the floor DOWN.
    H.keyDown(c, 'KeyW');
    for (let i = 0; i < 60; i++) H.tickInput(c, 16);
    expect(cam.position.y).toBeLessThan(landedY - 0.5); // followed the slope down
  });
});

describe('camera-anchor writer ordering (Tier 1.5)', () => {
  it('a run of ticks where wheel and WASD both act produces a well-defined composite pose', () => {
    const scene = H.groundPlaneScene({ y: 0 });
    const cam = H.makePerspectiveCam({ pos: [0, 30, 0], lookAt: [0, 0, -20] });
    const c = H.makeControls({
      camera: cam,
      scene,
      wasd: true,
      streetLevel: true
    });

    // Drive several mixed ticks so the WASD contribution (~2.4 m over the run)
    // sits well OUTSIDE the composite-pose tolerance — a dropped WASD writer
    // then moves the pinned pose enough to red (a single tick's 0.48 m would
    // hide inside a ±0.5 tolerance).
    H.keyDown(c, 'KeyW');
    const before = cam.position.clone();
    for (let i = 0; i < 5; i++) {
      H.wheel(c, { dy: -300, clientX: 640, clientY: 360 });
      H.tickInput(c, 16);
    }
    const d = cam.position.clone().sub(before);

    // Both the wheel (vertical dolly) and WASD (forward, −Z) contributed.
    expect(Math.abs(d.y)).toBeGreaterThan(1); // wheel dolly descended
    expect(Math.abs(d.z)).toBeGreaterThan(2); // WASD advanced beyond tolerance
    // Pin the composite pose (the observable of the read-then-write order). A
    // dropped WASD writer shifts z by the ~2.4 m advance — outside this ±0.05
    // (precision-1) tolerance — so the pin reds. (Re-pinned for GH-1858: the
    // lurch-cap budget now scales with the ticks a multi-tick frame applies,
    // so these 3-tick frames dolly farther than under the old flat cap.)
    expect(cam.position.y).toBeCloseTo(7.43, 1);
    expect(cam.position.z).toBeCloseTo(-8.49, 1);
  });
});

describe('cross-controller zoom-undo invalidation (two-arm)', () => {
  it('an immediate wheel-out retraces, but a rotation in between invalidates the retrace', () => {
    // Arm A — partial swoop then immediate wheel-out (retrace preserved).
    const A = swoopRig();
    expect(H.floorBelow(A.c, A.cam).source).not.toBe('cache');
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

  it('a WASD step in between also invalidates the retrace', () => {
    // Same shape, but the intervening controller is WASD — guards the
    // _clearZoomUndo call on the WASD-drain path specifically.
    const A = swoopRig();
    const entryTilt = H.tilt(A.cam);
    H.driveSwoopIn(A.c, A.cam, 5);
    H.driveSwoopOut(A.c, 80);
    const tiltA = H.tilt(A.cam);

    const B = swoopRig();
    B.c.setWasdEnabled(true);
    H.driveSwoopIn(B.c, B.cam, 5);
    // One advancing WASD step clears the zoom-undo memory.
    H.keyDown(B.c, 'KeyW');
    H.tickInput(B.c, 16);
    H.keyUp(B.c, 'KeyW');
    H.driveSwoopOut(B.c, 80);
    const tiltB = H.tilt(B.cam);

    expect(tiltA).toBeCloseTo(entryTilt, 0);
    expect(tiltB).toBeCloseTo(60, 0);
    expect(Math.abs(tiltA - tiltB)).toBeGreaterThan(3);
  });
});

describe('WASD ↔ rotation hand-off (Tier 1.5)', () => {
  it('pressing a movement key mid-rotate ends the rotation gesture and starts WASD', () => {
    const scene = H.groundPlaneScene({ y: 0 });
    const cam = H.makePerspectiveCam({
      pos: [0, 1.5, 0],
      lookAt: [0, 1.5, -1]
    });
    const c = H.makeControls({
      camera: cam,
      scene,
      wasd: true,
      streetLevel: true
    });

    H.mouseDown(c, { clientX: 640, clientY: 360, button: 0, shiftKey: true });
    expect(c._latch.get('mode')).toBe('rotate'); // canary (KD-4c): latch is orchestrator-retained
    const qRot = cam.quaternion.clone();
    H.mouseMove(c, { clientX: 660, clientY: 360 });
    expect(1 - Math.abs(cam.quaternion.dot(qRot))).toBeGreaterThan(1e-6); // rotating

    // Press W while Shift is still held (a genuine mid-rotate WASD entry).
    H.keyDown(c, 'KeyW', { shiftKey: true });

    // Rotation gesture ended: a further mouse movement no longer rotates.
    const qEnd = cam.quaternion.clone();
    H.mouseMove(c, { clientX: 700, clientY: 360 });
    expect(1 - Math.abs(cam.quaternion.dot(qEnd))).toBeLessThan(1e-9);

    // WASD engaged: a frame now advances the camera position.
    const pEnd = cam.position.clone();
    H.tickInput(c, 16);
    expect(cam.position.distanceTo(pEnd)).toBeGreaterThan(1e-4);
  });
});
