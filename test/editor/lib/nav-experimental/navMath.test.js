import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  cameraTiltDegrees,
  decideLbMode,
  decideDragModeSwitch,
  clampOrbitRadius,
  applyGroundFloor,
  computeLowTiltWheelHit,
  shiftRotateStep,
  decideSwoopPhase,
  phase2TargetTilt,
  phase2NextElevation
} from '../../../../src/editor/lib/nav-experimental/navMath.js';
import {
  TILT_THRESHOLD_DEFAULT_DEGREES,
  FALLBACK_FORWARD_DIST,
  SWOOP_PHASE2_ENTRY_ELEVATION_METRES,
  SWOOP_PHASE2_EXIT_ELEVATION_METRES,
  SWOOP_PHASE2_STEP
} from '../../../../src/editor/lib/nav-experimental/constants.js';

if (!globalThis.THREE) globalThis.THREE = THREE;

// Build a perspective camera looking from `from` toward `to`.
function camAt(from, to) {
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 10000);
  cam.position.set(from.x, from.y, from.z);
  cam.lookAt(to.x, to.y, to.z);
  cam.updateMatrixWorld();
  return cam;
}

describe('cameraTiltDegrees', () => {
  it('returns 0 for a horizontal camera', () => {
    const cam = camAt({ x: 0, y: 5, z: 10 }, { x: 0, y: 5, z: 0 });
    expect(cameraTiltDegrees(cam)).toBeCloseTo(0, 5);
  });

  it('returns near +90 for straight down', () => {
    // `lookAt` has a roll-singularity at the pole, so the resulting
    // forward direction is close to but not exactly straight down. Tolerance
    // is loose; the only thing that matters for the LB-mode comparator
    // is that this clamps at the upper end of the range.
    const cam = camAt({ x: 0, y: 10, z: 0 }, { x: 0, y: 0, z: 0 });
    expect(cameraTiltDegrees(cam)).toBeGreaterThan(89);
  });

  it('returns near -90 for straight up', () => {
    const cam = camAt({ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 0 });
    expect(cameraTiltDegrees(cam)).toBeLessThan(-89);
  });

  it('returns +45 for a 45° downward look', () => {
    const cam = camAt({ x: 0, y: 10, z: 10 }, { x: 0, y: 0, z: 0 });
    expect(cameraTiltDegrees(cam)).toBeCloseTo(45, 4);
  });

  it('returns -45 for a 45° upward look', () => {
    const cam = camAt({ x: 0, y: 0, z: 10 }, { x: 0, y: 10, z: 0 });
    expect(cameraTiltDegrees(cam)).toBeCloseTo(-45, 4);
  });
});

describe('decideLbMode', () => {
  it('defaults to the T constant when no threshold is passed', () => {
    const T = TILT_THRESHOLD_DEFAULT_DEGREES;
    expect(decideLbMode(T + 0.001)).toBe('pan-truck');
    expect(decideLbMode(T)).toBe('pan-pedestal');
    expect(decideLbMode(T - 0.001)).toBe('pan-pedestal');
  });

  it('honours a custom threshold (e.g. T = 18°)', () => {
    const T = 18;
    // Just above T → pan-truck.
    expect(decideLbMode(T + 0.001, T)).toBe('pan-truck');
    expect(decideLbMode(89, T)).toBe('pan-truck');
    // Exactly at T → pan-pedestal (Street side), matching the rotation
    // regime's `tilt > T → Map` convention.
    expect(decideLbMode(T, T)).toBe('pan-pedestal');
    // Just below T → pan-pedestal.
    expect(decideLbMode(T - 0.001, T)).toBe('pan-pedestal');
  });

  it('returns pan-pedestal for any negative tilt (looking up)', () => {
    expect(decideLbMode(-1, 18)).toBe('pan-pedestal');
    expect(decideLbMode(-45, 18)).toBe('pan-pedestal');
    expect(decideLbMode(-89, 18)).toBe('pan-pedestal');
  });
});

describe('decideDragModeSwitch', () => {
  // The full 4-row truth table for LB gestures: a held Shift wants
  // 'rotate', released wants 'pan'; null when already in the desired mode.
  it('switches pan → rotate when Shift goes held', () => {
    expect(decideDragModeSwitch('pan', true)).toBe('rotate');
  });

  it('switches rotate → pan when Shift is released', () => {
    expect(decideDragModeSwitch('rotate', false)).toBe('pan');
  });

  it('is a no-op when already in the desired mode (idempotent)', () => {
    expect(decideDragModeSwitch('pan', false)).toBe(null);
    expect(decideDragModeSwitch('rotate', true)).toBe(null);
  });

  it('ignores non-LB latch modes', () => {
    expect(decideDragModeSwitch('wheel', true)).toBe(null);
    expect(decideDragModeSwitch('wheel', false)).toBe(null);
    expect(decideDragModeSwitch(null, true)).toBe(null);
    expect(decideDragModeSwitch(undefined, false)).toBe(null);
  });
});

describe('clampOrbitRadius', () => {
  const MIN = 2;
  const MAX = 100;
  const fwd = new THREE.Vector3(0, 0, -1);

  it('leaves an in-range pivot unchanged', () => {
    const cam = new THREE.Vector3(0, 0, 0);
    const pivot = new THREE.Vector3(0, 0, -50); // 50m away, in range
    const out = clampOrbitRadius(cam, pivot, MIN, MAX, fwd);
    expect(out.x).toBeCloseTo(0, 6);
    expect(out.y).toBeCloseTo(0, 6);
    expect(out.z).toBeCloseTo(-50, 6);
  });

  it('pushes a too-close pivot OUT to minR along the camera→pivot ray', () => {
    const cam = new THREE.Vector3(0, 0, 0);
    const pivot = new THREE.Vector3(0, 0, -1); // 1m away (< minR)
    const out = clampOrbitRadius(cam, pivot, MIN, MAX, fwd);
    // Same direction (−Z), distance now minR.
    expect(out.distanceTo(cam)).toBeCloseTo(MIN, 6);
    expect(out.z).toBeCloseTo(-MIN, 6);
  });

  it('pulls a too-far pivot IN to maxR along the same ray', () => {
    const cam = new THREE.Vector3(0, 0, 0);
    const pivot = new THREE.Vector3(0, 0, -2000); // 2000m away (> maxR)
    const out = clampOrbitRadius(cam, pivot, MIN, MAX, fwd);
    expect(out.distanceTo(cam)).toBeCloseTo(MAX, 6);
    expect(out.z).toBeCloseTo(-MAX, 6);
  });

  it('uses the fallback direction × minR for a degenerate (coincident) pivot', () => {
    const cam = new THREE.Vector3(3, 4, 5);
    const pivot = new THREE.Vector3(3, 4, 5); // r === 0
    const dir = new THREE.Vector3(0, 0, -1);
    const out = clampOrbitRadius(cam, pivot, MIN, MAX, dir);
    expect(out.distanceTo(cam)).toBeCloseTo(MIN, 6);
    expect(out.x).toBeCloseTo(3, 6);
    expect(out.y).toBeCloseTo(4, 6);
    expect(out.z).toBeCloseTo(5 - MIN, 6);
  });

  it('moves the pivot, never the camera position argument', () => {
    const cam = new THREE.Vector3(0, 0, 0);
    const pivot = new THREE.Vector3(0, 0, -1);
    clampOrbitRadius(cam, pivot, MIN, MAX, fwd);
    // cam unchanged.
    expect(cam.x).toBe(0);
    expect(cam.y).toBe(0);
    expect(cam.z).toBe(0);
  });
});

describe('applyGroundFloor', () => {
  it('leaves a camera above the floor unchanged', () => {
    const pos = new THREE.Vector3(10, 5, 0);
    const lookTarget = new THREE.Vector3(0, 5, 0);
    const centre = new THREE.Vector3(0, 0, 0);
    const out = applyGroundFloor(pos, lookTarget, centre, 0.5);
    expect(out.pos.x).toBeCloseTo(10, 6);
    expect(out.pos.y).toBeCloseTo(5, 6);
    expect(out.pos.z).toBeCloseTo(0, 6);
    expect(out.lookTarget.x).toBeCloseTo(0, 6);
  });

  it('re-projects below-floor pos onto the orbit sphere preserving radius', () => {
    // Camera dipped below the floor while orbiting a ground-level pivot.
    const centre = new THREE.Vector3(0, 0, 0);
    const R = 10;
    // Pos on the sphere, below floor: pick a point at y = -3, on the
    // sphere of radius 10 about origin. rho_old = sqrt(100 - 9) ≈ 9.539.
    const yPos = -3;
    const rhoOld = Math.sqrt(R * R - yPos * yPos);
    const pos = new THREE.Vector3(rhoOld, yPos, 0);
    const lookTarget = new THREE.Vector3(0, yPos, 0); // view dir = -X
    const floorY = 0.5;
    const out = applyGroundFloor(pos, lookTarget, centre, floorY);
    // Radius preserved.
    expect(out.pos.distanceTo(centre)).toBeCloseTo(R, 5);
    // Pinned to the floor.
    expect(out.pos.y).toBeCloseTo(floorY, 5);
    // View direction preserved (lookTarget - pos identical).
    const dOld = new THREE.Vector3().subVectors(lookTarget, pos);
    const dNew = new THREE.Vector3().subVectors(out.lookTarget, out.pos);
    expect(dNew.x).toBeCloseTo(dOld.x, 6);
    expect(dNew.y).toBeCloseTo(dOld.y, 6);
    expect(dNew.z).toBeCloseTo(dOld.z, 6);
  });

  it('is idempotent (feeding the output back in is a no-op)', () => {
    const centre = new THREE.Vector3(0, 0, 0);
    const R = 10;
    const yPos = -3;
    const rhoOld = Math.sqrt(R * R - yPos * yPos);
    const pos = new THREE.Vector3(rhoOld, yPos, 0);
    const lookTarget = new THREE.Vector3(0, yPos, 0);
    const floorY = 0.5;
    const once = applyGroundFloor(pos, lookTarget, centre, floorY);
    const twice = applyGroundFloor(once.pos, once.lookTarget, centre, floorY);
    expect(twice.pos.x).toBeCloseTo(once.pos.x, 6);
    expect(twice.pos.y).toBeCloseTo(once.pos.y, 6);
    expect(twice.pos.z).toBeCloseTo(once.pos.z, 6);
    expect(twice.lookTarget.x).toBeCloseTo(once.lookTarget.x, 6);
  });

  it('falls back to a plain y-clamp when the sphere never reaches the floor', () => {
    // Degenerate guard: pos.y < floorY (so the clamp engages) AND
    // R < |floorY − centre.y| (the orbit sphere never reaches the floor
    // height). Reachable only with a high floor / low pivot and a tiny
    // radius. Construct it directly: centre at ground, floorY well above
    // pos, pos a short distance from centre.
    //   centre.y = 0, floorY = 5, pos = (0.2, 3, 0):
    //   pos.y (3) < floorY (5) ✓;  dy = 5;  R = hypot(0.2, 3) ≈ 3.007 < 5 ✓
    const centre = new THREE.Vector3(0, 0, 0);
    const floorY = 5;
    const pos = new THREE.Vector3(0.2, 3, 0);
    const lookTarget = new THREE.Vector3(0.2 - 1, 3, 0); // view dir = -X
    const out = applyGroundFloor(pos, lookTarget, centre, floorY);
    // Degenerate branch: plain y-clamp, x/z preserved.
    expect(out.pos.x).toBeCloseTo(0.2, 6);
    expect(out.pos.y).toBeCloseTo(floorY, 6);
    expect(out.pos.z).toBeCloseTo(0, 6);
    // View direction still preserved via the equal lookTarget delta.
    const dOld = new THREE.Vector3().subVectors(lookTarget, pos);
    const dNew = new THREE.Vector3().subVectors(out.lookTarget, out.pos);
    expect(dNew.y).toBeCloseTo(dOld.y, 6);
  });

  it('composes with a max-clamped pivot (radius 100, centre at ground)', () => {
    // B5: a far-cap pivot (R = 100, centre at ground) swung below floor
    // still re-projects on the sphere (non-degenerate), ending at floorY
    // with radius ≈ 100.
    const centre = new THREE.Vector3(0, 0, 0);
    const R = 100;
    const yPos = -20;
    const rhoOld = Math.sqrt(R * R - yPos * yPos);
    const pos = new THREE.Vector3(rhoOld, yPos, 0);
    const lookTarget = new THREE.Vector3(rhoOld - 1, yPos, 0);
    const floorY = 0.5;
    const out = applyGroundFloor(pos, lookTarget, centre, floorY);
    expect(out.pos.y).toBeCloseTo(floorY, 5);
    expect(out.pos.distanceTo(centre)).toBeCloseTo(R, 4);
  });
});

describe('computeLowTiltWheelHit', () => {
  it('returns camera position + cameraForward * FALLBACK_FORWARD_DIST for a horizontal camera', () => {
    // Camera at (0, 1.6, 10) looking toward origin. Forward direction
    // is (0, 0, -1) (camera-Z), so the synthetic hit is at
    // (0, 1.6, 10) + (0, 0, -1) * 30 = (0, 1.6, -20).
    const cam = camAt({ x: 0, y: 1.6, z: 10 }, { x: 0, y: 1.6, z: 0 });
    const hit = computeLowTiltWheelHit(cam);
    expect(hit.x).toBeCloseTo(0, 5);
    expect(hit.y).toBeCloseTo(1.6, 5);
    expect(hit.z).toBeCloseTo(10 - FALLBACK_FORWARD_DIST, 4);
  });

  it('returned point lies at FALLBACK_FORWARD_DIST from the camera', () => {
    const cam = camAt({ x: 5, y: 8, z: -2 }, { x: 0, y: 1, z: 0 });
    const hit = computeLowTiltWheelHit(cam);
    const dist = Math.hypot(hit.x - 5, hit.y - 8, hit.z - -2);
    expect(dist).toBeCloseTo(FALLBACK_FORWARD_DIST, 4);
  });

  it('drifts upward when the camera is pitched up (looking-up case)', () => {
    // Camera at (0, 1.6, 5) pitched up 45° → looking at (0, 6.6, 0).
    // forward.y > 0; synthetic hit's y > camera.y.
    const cam = camAt({ x: 0, y: 1.6, z: 5 }, { x: 0, y: 6.6, z: 0 });
    const hit = computeLowTiltWheelHit(cam);
    expect(hit.y).toBeGreaterThan(1.6);
  });

  it('drifts downward when the camera is pitched down', () => {
    // Camera at (0, 10, 5) pitched down → looking at (0, 5, 0).
    // forward.y < 0; synthetic hit's y < camera.y.
    const cam = camAt({ x: 0, y: 10, z: 5 }, { x: 0, y: 5, z: 0 });
    const hit = computeLowTiltWheelHit(cam);
    expect(hit.y).toBeLessThan(10);
  });

  it('vertical drift at near-extreme looking-up matches the risk-table quantification', () => {
    // Camera at street level (y=1.6), pitched up close to the
    // MIN_TILT_DEGREES = -89° clamp. forward.y ≈ sin(89°) ≈ 0.9998.
    // Synthetic hit y ≈ camera.y + 30 * 0.9998 ≈ 31.6.
    // (Tilt = -89° means camera looks at (0, camY + Δy, 0) where
    // Δy/distance ≈ tan(89°). We aim from y=1.6 at a target nearly
    // straight up: y=101.6 puts a ~89.05° angle, close enough.)
    const cam = camAt({ x: 0, y: 1.6, z: 5 }, { x: 0, y: 101.6, z: 5 - 0.01 });
    const hit = computeLowTiltWheelHit(cam);
    expect(hit.y - 1.6).toBeGreaterThan(29); // ≥29m of the ~30m expected
  });
});

describe('shiftRotateStep', () => {
  const SPEED = 0.0035; // ROTATION_SPEED_RAD_PER_PX

  // Helper: extract the view direction from a `lookTarget` and `pos`.
  function dirFrom(step) {
    return new THREE.Vector3()
      .subVectors(step.lookTarget, step.pos)
      .normalize();
  }

  it('zero deltas with camera aimed at centre: pos and view unchanged (no snap)', () => {
    const camPos = new THREE.Vector3(10, 0, 0);
    const viewDir = new THREE.Vector3(-1, 0, 0); // looking toward origin
    const centre = new THREE.Vector3(0, 0, 0);
    const step = shiftRotateStep({
      camPos,
      viewDir,
      centre,
      dxPx: 0,
      dyPx: 0,
      speed: SPEED
    });
    expect(step.pos.distanceTo(camPos)).toBeLessThan(1e-6);
    expect(dirFrom(step).distanceTo(viewDir)).toBeLessThan(1e-6);
  });

  it('zero deltas with camera NOT aimed at centre: pos and view unchanged (the regression check)', () => {
    // This is the bug case. Camera at (10, 0, 0) looking 30° off from
    // the centre at origin. View direction is rotated 30° around +Y
    // from the direction-to-origin (-X).
    const camPos = new THREE.Vector3(10, 0, 0);
    const viewDir = new THREE.Vector3(
      -Math.cos(Math.PI / 6), // -cos(30°)
      0,
      -Math.sin(Math.PI / 6) // -sin(30°)
    ); // looking 30° off from origin
    const centre = new THREE.Vector3(0, 0, 0);
    const step = shiftRotateStep({
      camPos,
      viewDir,
      centre,
      dxPx: 0,
      dyPx: 0,
      speed: SPEED
    });
    expect(step.pos.distanceTo(camPos)).toBeLessThan(1e-6);
    expect(dirFrom(step).distanceTo(viewDir)).toBeLessThan(1e-6);
  });

  it('yaw delta with camera aimed at centre: orbit and view both track centre', () => {
    // Camera at (10, 0, 0) looking at origin. Apply yaw such that
    // dxPx * speed = 90° (i.e. dxPx = π/2 / speed).
    const camPos = new THREE.Vector3(10, 0, 0);
    const viewDir = new THREE.Vector3(-1, 0, 0);
    const centre = new THREE.Vector3(0, 0, 0);
    const dxPx = Math.PI / 2 / SPEED;
    const step = shiftRotateStep({
      camPos,
      viewDir,
      centre,
      dxPx,
      dyPx: 0,
      speed: SPEED
    });
    // After 90° yaw, position rotated 90° around centre.
    expect(step.pos.length()).toBeCloseTo(10, 4); // still 10m from centre
    // View direction should still point toward centre from the new position.
    const expectedView = new THREE.Vector3()
      .subVectors(centre, step.pos)
      .normalize();
    expect(dirFrom(step).distanceTo(expectedView)).toBeLessThan(0.01);
  });

  it('yaw delta with camera NOT aimed at centre: angular offset to centre is preserved', () => {
    // Rigid orbit, pure yaw. Camera at (10, 0, 0) looking 30° off from
    // origin. Apply 90° yaw. After the rotation, the angle between
    // view direction and direction-to-centre should still be 30°
    // (position offset and view both rotate by the same yaw).
    const camPos = new THREE.Vector3(10, 0, 0);
    const viewDir = new THREE.Vector3(
      -Math.cos(Math.PI / 6),
      0,
      -Math.sin(Math.PI / 6)
    );
    const centre = new THREE.Vector3(0, 0, 0);
    const dxPx = Math.PI / 2 / SPEED;
    const step = shiftRotateStep({
      camPos,
      viewDir,
      centre,
      dxPx,
      dyPx: 0,
      speed: SPEED
    });
    // Angular relationship preserved.
    const newDir = dirFrom(step);
    const dirToCentre = new THREE.Vector3()
      .subVectors(centre, step.pos)
      .normalize();
    const angleAfter = Math.acos(
      THREE.MathUtils.clamp(newDir.dot(dirToCentre), -1, 1)
    );
    expect((angleAfter * 180) / Math.PI).toBeCloseTo(30, 1);
  });

  it('tilt delta hits clamp: view tilt clamps at the limit', () => {
    // Camera looking horizontal; tilt up hard (negative dyPx → tilt up).
    const camPos = new THREE.Vector3(10, 0, 0);
    const viewDir = new THREE.Vector3(-1, 0, 0); // horizontal
    const centre = new THREE.Vector3(0, 0, 0);
    // Huge tilt-up delta — should clamp at -89° (MIN_TILT_DEGREES).
    const dyPx = -1000;
    const step = shiftRotateStep({
      camPos,
      viewDir,
      centre,
      dxPx: 0,
      dyPx,
      speed: SPEED
    });
    const newDir = dirFrom(step);
    // view tilt = asin(-dir.y). Clamped at -89° → -dir.y = sin(-89°) ≈ -0.9998
    // i.e. dir.y ≈ +0.9998.
    expect(newDir.y).toBeGreaterThan(0.999);
  });

  it('rotate-in-place (centre coincides with camera): pos unchanged; view rotates', () => {
    const camPos = new THREE.Vector3(5, 1.6, 5);
    const viewDir = new THREE.Vector3(0, 0, -1);
    const centre = new THREE.Vector3(5, 1.6, 5); // same as camPos
    const dxPx = Math.PI / 4 / SPEED; // 45° yaw
    const step = shiftRotateStep({
      camPos,
      viewDir,
      centre,
      dxPx,
      dyPx: 0,
      speed: SPEED
    });
    // Position is an exact copy of camPos (the spec contract — when
    // offset.lengthSq < 1e-6, the helper returns `pos = camPos.clone()`,
    // not a lerped or recomputed value).
    expect(step.pos.x).toBe(camPos.x);
    expect(step.pos.y).toBe(camPos.y);
    expect(step.pos.z).toBe(camPos.z);
    // View direction rotated 45° around +Y.
    const newDir = dirFrom(step);
    // Original viewDir = (0, 0, -1). After +45° yaw around +Y in the
    // convention used by setFromSpherical/setFromVector3, the new
    // direction should differ from the original by ~45° (regardless of
    // exact sign).
    const angle = Math.acos(THREE.MathUtils.clamp(newDir.dot(viewDir), -1, 1));
    expect((angle * 180) / Math.PI).toBeCloseTo(45, 1);
  });

  // --- Rigid-orbit invariant (reports/010-testing.md #1) ---
  // The defining property of "orbit about the cursor pivot": the pivot's
  // position in the camera's own frame is invariant across the step, so
  // it stays pinned on screen. This is what the old museum-diorama math
  // violated under any tilt. The earlier tests only exercised pure yaw
  // (where the broken and correct math agree); these exercise pitch and
  // mixed deltas from a *tilted* camera, which is where the drift was.

  // Express a world point in the camera's local frame, built exactly the
  // way `camera.lookAt` does (forward = view, up = world +Y, no roll).
  function cameraLocal(worldPoint, pos, viewDir) {
    const fwd = viewDir.clone().normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(fwd, worldUp).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd).normalize();
    const rel = new THREE.Vector3().subVectors(worldPoint, pos);
    // Camera looks down -Z, so local z = -(rel·fwd); x = rel·right;
    // y = rel·up. Screen x/y track local x/y.
    return new THREE.Vector3(rel.dot(right), rel.dot(up), -rel.dot(fwd));
  }

  it('pitch from a tilted camera: pivot stays fixed in the camera frame (no on-screen drift)', () => {
    // Camera 50m up, 50m back, tilted ~45° down, orbiting a pivot at the
    // origin that it is NOT aimed straight at. This is the exact regime
    // (tilted + offset pivot) where the diorama math drifted the pivot.
    const camPos = new THREE.Vector3(0, 50, 50);
    const centre = new THREE.Vector3(0, 0, 0);
    // View aimed below the pivot and yawed off-axis, so view dir and the
    // camera→centre vector do not share a meridian.
    const viewDir = new THREE.Vector3(0.2, -0.8, -0.6).normalize();

    const before = cameraLocal(centre, camPos, viewDir);

    // A pure pitch (vertical drag) of a few degrees.
    const dyPx = 20;
    const step = shiftRotateStep({
      camPos,
      viewDir,
      centre,
      dxPx: 0,
      dyPx,
      speed: SPEED
    });
    const after = cameraLocal(centre, step.pos, dirFrom(step));

    // Orbit radius preserved (rigid rotation about the centre).
    expect(step.pos.distanceTo(centre)).toBeCloseTo(
      camPos.distanceTo(centre),
      4
    );
    // The pivot's camera-local coordinates are unchanged → it sits at the
    // same screen position. (The old math moved `after` by metres here.)
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    expect(after.z).toBeCloseTo(before.z, 3);
    // Sanity: the step did something (camera actually moved).
    expect(step.pos.distanceTo(camPos)).toBeGreaterThan(0.1);
  });

  it('mixed yaw+pitch from a tilted camera: pivot stays fixed in the camera frame', () => {
    const camPos = new THREE.Vector3(-30, 40, 20);
    const centre = new THREE.Vector3(0, 0, 0);
    const viewDir = new THREE.Vector3(0.5, -0.7, -0.5).normalize();

    const before = cameraLocal(centre, camPos, viewDir);
    const step = shiftRotateStep({
      camPos,
      viewDir,
      centre,
      dxPx: 35,
      dyPx: -15,
      speed: SPEED
    });
    const after = cameraLocal(centre, step.pos, dirFrom(step));

    expect(step.pos.distanceTo(centre)).toBeCloseTo(
      camPos.distanceTo(centre),
      4
    );
    expect(after.x).toBeCloseTo(before.x, 3);
    expect(after.y).toBeCloseTo(before.y, 3);
    expect(after.z).toBeCloseTo(before.z, 3);
  });
});

describe('decideSwoopPhase', () => {
  it('returns phase1 above the upper boundary', () => {
    expect(decideSwoopPhase(SWOOP_PHASE2_ENTRY_ELEVATION_METRES + 0.01)).toBe(
      'phase1'
    );
    expect(decideSwoopPhase(100)).toBe('phase1');
  });

  it('returns phase2 at the upper boundary (inclusive on phase1 side)', () => {
    // y == 10m exactly: per the table in §Mechanics, "y > 10m" → phase1;
    // "1.5m < y ≤ 10m" → phase2.
    expect(decideSwoopPhase(SWOOP_PHASE2_ENTRY_ELEVATION_METRES)).toBe(
      'phase2'
    );
  });

  it('returns phase2 inside the band', () => {
    expect(decideSwoopPhase(5)).toBe('phase2');
    expect(decideSwoopPhase(SWOOP_PHASE2_EXIT_ELEVATION_METRES + 0.01)).toBe(
      'phase2'
    );
  });

  it('returns phase3 at and below the lower boundary', () => {
    // y == 1.5m exactly: per the table, "y ≤ 1.5m" → phase3.
    expect(decideSwoopPhase(SWOOP_PHASE2_EXIT_ELEVATION_METRES)).toBe('phase3');
    expect(decideSwoopPhase(0.5)).toBe('phase3');
    expect(decideSwoopPhase(0)).toBe('phase3');
  });
});

describe('phase2TargetTilt', () => {
  it('returns θ_stored at the upper boundary', () => {
    expect(
      phase2TargetTilt(SWOOP_PHASE2_ENTRY_ELEVATION_METRES, 60)
    ).toBeCloseTo(60, 6);
  });

  it('returns 0 at the lower boundary', () => {
    expect(phase2TargetTilt(SWOOP_PHASE2_EXIT_ELEVATION_METRES, 60)).toBe(0);
  });

  it('returns θ_stored above the band (clamped)', () => {
    expect(phase2TargetTilt(20, 60)).toBe(60);
  });

  it('returns 0 below the band (clamped)', () => {
    expect(phase2TargetTilt(0.5, 60)).toBe(0);
  });

  it('lerps linearly in y', () => {
    // Midpoint of the band: y = (10 + 1.5)/2 = 5.75. Expect θ_stored/2.
    const yMid =
      (SWOOP_PHASE2_ENTRY_ELEVATION_METRES +
        SWOOP_PHASE2_EXIT_ELEVATION_METRES) /
      2;
    expect(phase2TargetTilt(yMid, 60)).toBeCloseTo(30, 6);
  });

  it('handles θ_stored = 0 (low-tilt Phase 2 entry path)', () => {
    expect(phase2TargetTilt(5, 0)).toBe(0);
    expect(phase2TargetTilt(10, 0)).toBe(0);
  });
});

describe('phase2NextElevation', () => {
  it('zoom-in: y_next = y - α(y - 1.5)', () => {
    // Uses the default SWOOP_PHASE2_STEP from constants (0.20 as of
    // 2026-05-11 feel-test). Asserted via the formula directly so the
    // test tracks the constant.
    const alpha = SWOOP_PHASE2_STEP;
    const expectedAt10 = 10 - alpha * (10 - 1.5);
    expect(phase2NextElevation(10, -1)).toBeCloseTo(expectedAt10, 6);
    const expectedAt5 = 5 - alpha * (5 - 1.5);
    expect(phase2NextElevation(5, -1)).toBeCloseTo(expectedAt5, 6);
  });

  it('zoom-out: y_next = 1.5 + (y - 1.5)/(1 - α) — exact inverse of zoom-in', () => {
    // Zoom-in from y=10 to 9.15; zoom-out from 9.15 should return to 10.
    const yIn = phase2NextElevation(10, -1);
    const yOut = phase2NextElevation(yIn, +1);
    expect(yOut).toBeCloseTo(10, 6);
  });

  it('round-trips 5 ticks in/out to floating-point precision', () => {
    // R1/R2 smoke test, isolated to the math.
    let y = 10;
    for (let i = 0; i < 5; i++) y = phase2NextElevation(y, -1);
    for (let i = 0; i < 5; i++) y = phase2NextElevation(y, +1);
    expect(y).toBeCloseTo(10, 6);
  });

  it('zoom-out from y < 1.5 produces y_next < y (caller must clamp)', () => {
    // Per H2: with α=0.20 the formula at y=0.5 gives
    //   1.5 + (0.5 - 1.5)/(1 - 0.20) = 1.5 - 1.25 = 0.25
    // i.e. *further down*. This is by design — the caller must kick-start
    // y up to (floor + snap) before invoking zoom-out when at or below the
    // floor (see `_applyPhase2WheelTick`). Test the math directly so a
    // future "helpful fix" doesn't silently change the formula without
    // addressing the caller.
    const out = phase2NextElevation(0.5, +1);
    expect(out).toBeLessThan(0.5);
  });

  it('respects custom alpha', () => {
    // Zoom-in with α=0.2: y_next = 10 - 0.2×8.5 = 8.3
    expect(phase2NextElevation(10, -1, 0.2)).toBeCloseTo(8.3, 6);
  });
});
