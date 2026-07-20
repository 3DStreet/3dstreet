// Break-it checks (the proxy acceptance bar). Each re-runs a two-arm proxy's
// core assertion with the specific invariant hand-disabled and asserts the
// proxy now RED-alarms. A proxy that stays green with its invariant disabled is
// worthless; these are the proof it doesn't.
//
// Disablement targets:
//   zoom-undo cleared / cross-controller invalidation → _clearZoomUndo no-op
//   grounded re-derived → _deriveGroundedFromPose no-op
//   WASD ↔ rotation hand-off → _endRotationGestureForWasd no-op
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

function swoopRig() {
  // Look-at ground point (30,45) clears the scatter cube at (40,40), so the
  // cursor ray never grazes it. Entry tilt ≈ 53° (≠ 60° default overview).
  const scene = H.representativeScene({ groundSize: 400 });
  const cam = H.makePerspectiveCam({ pos: [80, 92, 80], lookAt: [30, 12, 45] });
  const c = H.makeControls({ camera: cam, scene, streetLevel: true });
  return { cam, c };
}

// Run the zoom-undo two-arm and return |tiltA − tiltB| (the discriminating
// quantity). `disableClear` monkey-patches _clearZoomUndo to a no-op for arm B
// only, so the committed move can no longer clear the memory.
function zoomUndoArmDifference({ disableClear }) {
  const A = swoopRig();
  H.driveSwoopIn(A.c, A.cam, 3);
  H.driveSwoopOut(A.c, 80);
  const tiltA = H.tilt(A.cam);

  const B = swoopRig();
  H.driveSwoopIn(B.c, B.cam, 3);
  const doPanAndOut = () => {
    H.mouseDown(B.c, { clientX: 640, clientY: 360, button: 0 });
    H.mouseMove(B.c, { clientX: 645, clientY: 355 });
    H.mouseUp(B.c);
    H.driveSwoopOut(B.c, 80);
  };
  if (disableClear) {
    H.withInvariantDisabled(B.c, 'clearZoomUndo', doPanAndOut);
  } else {
    doPanAndOut();
  }
  const tiltB = H.tilt(B.cam);
  return Math.abs(tiltA - tiltB);
}

describe('break-it — zoom-undo proxy reds when _clearZoomUndo is disabled', () => {
  it('the proxy PASSES with the invariant live (arms diverge)', () => {
    expect(zoomUndoArmDifference({ disableClear: false })).toBeGreaterThan(3);
  });

  it('the proxy FAILS with _clearZoomUndo disabled (arms collapse together)', () => {
    // With the clear disabled, arm B retains the memory too → both arms
    // retrace → the difference vanishes → the assertion would red.
    const failed = H.assertionFails(() => {
      expect(zoomUndoArmDifference({ disableClear: true })).toBeGreaterThan(3);
    });
    expect(failed).toBe(true);
  });
});

// Grounded two-arm: the discriminating quantity is (yFlying − yGrounded) after
// driving down a slope. `disableDerive` makes _deriveGroundedFromPose a no-op
// for the grounded arm, so grounded is never set true and both arms hold.
function groundedArmDifference({ disableDerive }) {
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
  const G = build();
  if (disableDerive) {
    H.withInvariantDisabled(G.c, 'grounded', () =>
      G.c._deriveGroundedFromPose()
    );
  } else {
    G.c._deriveGroundedFromPose();
  }
  H.keyDown(G.c, 'KeyW');
  for (let i = 0; i < 60; i++) H.tickInput(G.c, 16);
  const yGrounded = G.cam.position.y;

  const F = build();
  F.c._grounded = false;
  F.c._captureH();
  H.keyDown(F.c, 'KeyW');
  for (let i = 0; i < 60; i++) H.tickInput(F.c, 16);
  const yFlying = F.cam.position.y;

  return yFlying - yGrounded;
}

describe('break-it — grounded proxy reds when _deriveGroundedFromPose is disabled', () => {
  it('the proxy PASSES with the invariant live (grounded follows the slope down)', () => {
    expect(groundedArmDifference({ disableDerive: false })).toBeGreaterThan(
      0.8
    );
  });

  it('the proxy FAILS with _deriveGroundedFromPose disabled (grounded arm behaves like flying)', () => {
    const failed = H.assertionFails(() => {
      expect(groundedArmDifference({ disableDerive: true })).toBeGreaterThan(
        0.8
      );
    });
    expect(failed).toBe(true);
  });
});

// Cross-controller invalidation: same disablement target (_clearZoomUndo), but
// the intervening move is a rotation.
function crossControllerDifference({ disableClear }) {
  const A = swoopRig();
  const entryTilt = H.tilt(A.cam);
  H.driveSwoopIn(A.c, A.cam, 5);
  H.driveSwoopOut(A.c, 80);
  const tiltA = H.tilt(A.cam);

  const B = swoopRig();
  H.driveSwoopIn(B.c, B.cam, 5);
  const rotateAndOut = () => {
    H.mouseDown(B.c, { clientX: 640, clientY: 360, button: 0, shiftKey: true });
    H.mouseMove(B.c, { clientX: 650, clientY: 360 });
    H.mouseUp(B.c);
    H.driveSwoopOut(B.c, 80);
  };
  if (disableClear) H.withInvariantDisabled(B.c, 'clearZoomUndo', rotateAndOut);
  else rotateAndOut();
  const tiltB = H.tilt(B.cam);
  return { diff: Math.abs(tiltA - tiltB), entryTilt };
}

describe('break-it — cross-controller invalidation reds when _clearZoomUndo is disabled', () => {
  it('the proxy PASSES with the invariant live (rotation invalidates the retrace)', () => {
    expect(
      crossControllerDifference({ disableClear: false }).diff
    ).toBeGreaterThan(3);
  });

  it('the proxy FAILS with _clearZoomUndo disabled (rotation no longer invalidates)', () => {
    const failed = H.assertionFails(() => {
      expect(
        crossControllerDifference({ disableClear: true }).diff
      ).toBeGreaterThan(3);
    });
    expect(failed).toBe(true);
  });
});

// WASD ↔ rotation hand-off: the observable is "a further mouseMove after the
// mid-rotate W press no longer rotates". `disableEnd` no-ops
// _endRotationGestureForWasd so the rotation gesture is NOT ended — the further
// move keeps rotating and the proxy reds.
function rotationAfterWasdEntry({ disableEnd }) {
  const scene = H.groundPlaneScene({ y: 0 });
  const cam = H.makePerspectiveCam({ pos: [0, 1.5, 0], lookAt: [0, 1.5, -1] });
  const c = H.makeControls({
    camera: cam,
    scene,
    wasd: true,
    streetLevel: true
  });

  H.mouseDown(c, { clientX: 640, clientY: 360, button: 0, shiftKey: true });
  H.mouseMove(c, { clientX: 660, clientY: 360 }); // rotating

  const pressW = () => H.keyDown(c, 'KeyW', { shiftKey: true });
  if (disableEnd) H.withInvariantDisabled(c, 'rotationEndForWasd', pressW);
  else pressW();

  const q = cam.quaternion.clone();
  H.mouseMove(c, { clientX: 700, clientY: 360 });
  return 1 - Math.abs(cam.quaternion.dot(q)); // residual rotation after the W press
}

describe('break-it — WASD hand-off ends rotation, reds when _endRotationGestureForWasd is disabled', () => {
  it('the proxy PASSES with the invariant live (the further move no longer rotates)', () => {
    expect(rotationAfterWasdEntry({ disableEnd: false })).toBeLessThan(1e-9);
  });

  it('the proxy FAILS with _endRotationGestureForWasd disabled (the further move still rotates)', () => {
    const failed = H.assertionFails(() => {
      expect(rotationAfterWasdEntry({ disableEnd: true })).toBeLessThan(1e-9);
    });
    expect(failed).toBe(true);
  });
});
