/* Shared deterministic drive script for the scratch-vector refactor guards.
 *
 * Leading underscore => not collected as a `*.test.js` suite. Imported by
 * ExperimentalControls.allocRefactor.golden.test.js (captures the camera-pose
 * trajectory into a snapshot) and ExperimentalControls.allocCount.test.js
 * (counts THREE allocations while running the same sequence).
 *
 * The script drives every hot handler the refactor touches, from a KNOWN
 * camera pose set at the start of each phase (so each handler is reliably
 * reached regardless of where the previous phase left the camera):
 *   1. wheel-swoop-in  — cursorAnchor worldPointAt/ndcFor + navMath dolly path
 *   2. shift-orbit     — navMath.shiftRotateStep via dragGestureController
 *   3. WASD-hold       — wasdFlight.drain
 *   4. compass orbit   — compassController orbit onTick
 *   5. LB truck / pedestal / screen pan — the three drag pan handlers
 *
 * Determinism: no Math.random / rAF; wall-clock reads are frozen by the
 * caller's stubClock(); tweens advance only by the explicit dt passed to
 * tickAll. So the captured trajectory is stable across runs.
 */

function setPose(camera, pos, look, up = [0, 1, 0]) {
  camera.up.set(up[0], up[1], up[2]);
  camera.position.set(pos[0], pos[1], pos[2]);
  camera.lookAt(look[0], look[1], look[2]);
  camera.updateMatrixWorld(true);
}

// Drives the full five-path sequence. `capture` (optional) is called with the
// live camera after every frame / gesture step so a caller can record the
// trajectory; pass null to run the sequence purely for its allocation cost.
export function runAllocRefactorScript(H, controls, camera, capture) {
  const rec = capture || (() => {});
  const CX = 677;
  const CY = 379; // ~centre of the harness 1280x720 rect (left 37, top 19)

  // --- Phase 1: wheel-swoop-in (Map regime, looking down at the building) ---
  setPose(camera, [0, 120, 20], [0, 52, -40]);
  for (let i = 0; i < 24; i++) {
    H.wheel(controls, { dy: -100, clientX: CX, clientY: CY });
    H.tickInput(controls, 16);
    rec(camera);
  }

  // --- Phase 2: shift-orbit (Map regime) ---
  setPose(camera, [0, 80, 60], [0, 12, 0]);
  H.mouseDown(controls, {
    clientX: 700,
    clientY: 300,
    button: 0,
    shiftKey: true
  });
  for (let i = 0; i < 14; i++) {
    H.mouseMove(controls, { clientX: 700 + i * 5, clientY: 300 + (i % 3) });
    rec(camera);
  }
  H.mouseUp(controls);

  // --- Phase 3: WASD-hold (flying above the roof, near-horizontal) ---
  setPose(camera, [0, 70, 20], [0, 70, -40]);
  controls._deriveGroundedFromPose(); // settle grounded from the flying pose
  H.keyDown(controls, 'KeyW');
  for (let i = 0; i < 24; i++) {
    H.tickInput(controls, 16);
    rec(camera);
  }
  H.keyUp(controls, 'KeyW');
  H.tickInput(controls, 16);
  rec(camera);

  // --- Phase 4: compass rotate-arrow orbit (Map regime, looking down) ---
  setPose(camera, [40, 150, 40], [0, 12, 0]);
  controls.handleCompassRotate(1);
  // Advance the tween to completion (PLAN_VIEW_DURATION_MS = 1000 ms).
  for (let i = 0; i < 70; i++) {
    H.tickAll(controls, 16);
    rec(camera);
  }

  // --- Phase 5a: LB truck pan (street-level on, tilt > T) ---
  setPose(camera, [0, 50, 40], [0, 0, 0]);
  H.mouseDown(controls, { clientX: 640, clientY: 360, button: 0 });
  for (let i = 0; i < 10; i++) {
    H.mouseMove(controls, { clientX: 640 + i * 8, clientY: 360 + i * 4 });
    rec(camera);
  }
  H.mouseUp(controls);

  // --- Phase 5b: LB pedestal pan (street-level on, tilt <= T) ---
  setPose(camera, [0, 20, 40], [0, 19, -40]);
  H.mouseDown(controls, { clientX: 640, clientY: 360, button: 0 });
  for (let i = 0; i < 10; i++) {
    H.mouseMove(controls, { clientX: 640 + i * 6, clientY: 360 - i * 5 });
    rec(camera);
  }
  H.mouseUp(controls);

  // --- Phase 5c: LB screen pan (street-level off) ---
  controls.setStreetLevelEnabled(false);
  setPose(camera, [0, 40, 40], [0, 0, 0]);
  H.mouseDown(controls, { clientX: 640, clientY: 360, button: 0 });
  for (let i = 0; i < 10; i++) {
    H.mouseMove(controls, { clientX: 640 + i * 7, clientY: 360 + i * 3 });
    rec(camera);
  }
  H.mouseUp(controls);
  controls.setStreetLevelEnabled(true);
}
