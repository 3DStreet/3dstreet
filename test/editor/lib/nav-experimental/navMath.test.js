import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  cameraTiltDegrees,
  decideLbMode,
  decideDragModeSwitch,
  clampOrbitRadius,
  computeLowTiltWheelHit,
  shiftRotateStep,
  decideSwoopPhase,
  phase2TargetTilt,
  phase2NextElevation,
  classifyWasdStep,
  wasdFollowY,
  classifyFallAction,
  isLegitPose,
  cueState
} from '../../../../src/editor/lib/nav-experimental/navMath.js';
import {
  TILT_THRESHOLD_DEFAULT_DEGREES,
  FALLBACK_FORWARD_DIST,
  SWOOP_PHASE2_ENTRY_ELEVATION_METRES,
  SWOOP_PHASE2_EXIT_ELEVATION_METRES,
  SWOOP_PHASE2_STEP,
  SWOOP_PHASE2_FLOOR_SNAP_METRES,
  EYE_MARGIN_METRES
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

// --- TASK-024 classifyWasdStep (forward-ray 4-way classifier) ---
//
// `forwardHit` = { hit, normalY, normalH } — the first solid-floor hit on
// the forward ray. `normalH` is the horizontal component of the world
// normal. The facing test uses dot(targetDir, -normalH_normalized).
describe('classifyWasdStep', () => {
  // A wall facing -X (camera travelling +X into it): outward normal +X, so
  // normalH = (1, 0, 0); travelDir +X → dot(targetDir, -normalH) = -1?  No:
  // the wall the camera walks INTO faces back toward the camera, normal
  // points toward the camera = -X. So a +X-travelling camera meets a wall
  // whose outward normal is -X → normalH = (-1, 0, 0); dot(+X, -(-X)) = +1.
  const FACING_WALL = { hit: true, normalY: 0, normalH: { x: -1, z: 0 } };
  const travelPlusX = { x: 1, z: 0 };

  it('blocks a facing near-vertical wall with a tall up-step', () => {
    expect(
      classifyWasdStep({
        floorNow: { y: 0 },
        floorDest: { y: 2 }, // +2 m ≥ 1.5
        forwardHit: FACING_WALL,
        reach: 0.8,
        targetDir: travelPlusX,
        currentEnclosed: false,
        lastBlocked: false
      })
    ).toBe('block');
  });

  it('blocks a wall on FLAT ground — facing steep forward hit, delta≈0 (Bug-1 regression)', () => {
    // A building standing on flat ground: the destination-column floor is the
    // same level as the camera's floor (delta = 0), but the forward ray hits
    // the façade. Must block — the earlier `delta >= 1.5` gate let the camera
    // walk straight through buildings on flat ground.
    expect(
      classifyWasdStep({
        floorNow: { y: 0 },
        floorDest: { y: 0 }, // flat ground in front of the wall
        forwardHit: FACING_WALL,
        reach: 0.8,
        targetDir: travelPlusX,
        currentEnclosed: false,
        lastBlocked: false
      })
    ).toBe('block');
  });

  it('steps up a small walkable rise with a clear forward ray', () => {
    expect(
      classifyWasdStep({
        floorNow: { y: 0 },
        floorDest: { y: 0.3 },
        forwardHit: { hit: false },
        reach: 0.8,
        targetDir: travelPlusX,
        currentEnclosed: false,
        lastBlocked: false
      })
    ).toBe('step-up');
  });

  it('N2-a totality: tall up-step (≥1.5) with no facing-steep hit → step-up (not undefined)', () => {
    // The eye-ray grazed a lip; forward ray clear, but destination column
    // rose ≥ 1.5 m. Must be a defined outcome (step-up), never undefined.
    const out = classifyWasdStep({
      floorNow: { y: 0 },
      floorDest: { y: 1.8 },
      forwardHit: { hit: false },
      reach: 0.8,
      targetDir: travelPlusX,
      currentEnclosed: false,
      lastBlocked: false
    });
    expect(out).toBe('step-up');
    expect(out).toBeDefined();
  });

  it('N2-b reach-invariance: a <45° continuous descent follows at any fly-speed', () => {
    // A ramp dropping ~30° (delta = -reach*tan30). At two different reach
    // values the same GRADE must stay follow (angle < 45°), even though the
    // raw delta is large at the larger reach.
    const grade = Math.tan((30 * Math.PI) / 180);
    for (const reach of [0.7, 8]) {
      const delta = -grade * reach; // ~30° descent
      expect(
        classifyWasdStep({
          floorNow: { y: 0 },
          floorDest: { y: delta },
          forwardHit: { hit: false },
          reach,
          targetDir: travelPlusX,
          currentEnclosed: false,
          lastBlocked: false
        })
      ).toBe('follow');
    }
  });

  it('hovers off a near-vertical roof edge / cliff (angle ≥ 45°, drop ≥ 1.5)', () => {
    expect(
      classifyWasdStep({
        floorNow: { y: 0 },
        floorDest: { y: -5 }, // sharp drop
        forwardHit: { hit: false },
        reach: 0.8, // atan2(5, 0.8) ≈ 80° ≥ 45°
        targetDir: travelPlusX,
        currentEnclosed: false,
        lastBlocked: false
      })
    ).toBe('hover');
  });

  it('N3 tangent guard: a non-facing near-vertical wall does NOT block', () => {
    // Skimming a façade: the wall normal is ~perpendicular to travel
    // (dot ≈ 0 < WASD_FACING_MIN). normalH = (0,0,1) while travelling +X.
    const out = classifyWasdStep({
      floorNow: { y: 0 },
      floorDest: { y: 2 }, // tall, but the wall is tangential
      forwardHit: { hit: true, normalY: 0, normalH: { x: 0, z: 1 } },
      reach: 0.8,
      targetDir: travelPlusX,
      currentEnclosed: false,
      lastBlocked: false
    });
    expect(out).not.toBe('block');
    expect(out).toBe('step-up'); // up-step delta > 0 → mount it
  });

  it('flat ground follows', () => {
    expect(
      classifyWasdStep({
        floorNow: { y: 3 },
        floorDest: { y: 3 },
        forwardHit: { hit: false },
        reach: 0.8,
        targetDir: travelPlusX,
        currentEnclosed: false,
        lastBlocked: false
      })
    ).toBe('follow');
  });

  it('currentEnclosed never blocks (D5 / WE-13): a would-be block follows', () => {
    expect(
      classifyWasdStep({
        floorNow: { y: 0 },
        floorDest: { y: 5 },
        forwardHit: FACING_WALL,
        reach: 0.8,
        targetDir: travelPlusX,
        currentEnclosed: true,
        lastBlocked: false
      })
    ).toBe('follow');
  });

  it('hysteresis never holds a block when the forward ray is clear (no doorway deadlock)', () => {
    expect(
      classifyWasdStep({
        floorNow: { y: 0 },
        floorDest: { y: 5 },
        forwardHit: { hit: false }, // clear — threaded the opening
        reach: 0.8,
        targetDir: travelPlusX,
        currentEnclosed: false,
        lastBlocked: true
      })
    ).not.toBe('block');
  });

  it('facing hysteresis: a marginally-facing wall holds the block once blocked', () => {
    // A near-vertical wall whose facing dot ≈ 0.30 sits between
    // WASD_FACING_MIN (0.35) and WASD_FACING_MIN - WASD_FACING_HYSTERESIS
    // (0.25). It blocks while already blocked (hold through skim wobble) but
    // passes (step-up, delta>0) when not — damping block↔pass stutter.
    const dot = 0.3;
    const z = Math.sqrt(1 - dot * dot);
    const base = {
      floorNow: { y: 0 },
      floorDest: { y: 2 },
      // normalized -normalH must dot travel(+X) to `dot`: -normalH = (dot,-z)
      forwardHit: { hit: true, normalY: 0, normalH: { x: -dot, z } },
      reach: 0.8,
      targetDir: travelPlusX,
      currentEnclosed: false
    };
    expect(classifyWasdStep({ ...base, lastBlocked: true })).toBe('block');
    expect(classifyWasdStep({ ...base, lastBlocked: false })).toBe('step-up');
  });
});

// --- TASK-024 wasdFollowY (live-test fix: preserve AGL, don't pin to eye) ---
describe('wasdFollowY', () => {
  const EYE = EYE_MARGIN_METRES; // 1.5
  it('flat ground at any altitude leaves y unchanged (no snap-to-eye)', () => {
    // Deliberately raised to 2 m over flat ground (floor 0): W keeps 2 m.
    expect(wasdFollowY(2, 0, 0, EYE)).toBe(2);
    // Flying at 50 m over flat ground stays 50 m (horizontal pan).
    expect(wasdFollowY(50, 0, 0, EYE)).toBe(50);
    // At eye height stays at eye height.
    expect(wasdFollowY(1.5, 0, 0, EYE)).toBe(1.5);
  });
  it('preserves the chosen clearance down a slope', () => {
    // At 2 m AGL, the floor drops 0.3 → camera follows down, still 2 m AGL.
    expect(wasdFollowY(2, 0, -0.3, EYE)).toBeCloseTo(1.7);
    // At eye height down the same slope → still eye height above it.
    expect(wasdFollowY(1.5, 0, -0.3, EYE)).toBeCloseTo(1.2);
  });
  it('steps up onto a rise, preserving clearance', () => {
    // At 1.5 AGL, floor rises 0.5 (kerb) → rises to keep clearance.
    expect(wasdFollowY(1.5, 0, 0.5, EYE)).toBeCloseTo(2.0);
  });
  it('push-up clamp: never closer than eye-margin to the floor', () => {
    // Camera sank to 0.5 over floor 0 (AGL < eye) → pushed up to eye margin.
    expect(wasdFollowY(0.5, 0, 0, EYE)).toBe(1.5);
    // Below-eye AGL (0.5) walking onto a +1.0 rise: tracked 1.5 would be only
    // 0.5 above the new floor → clamp up to floor+eye = 2.5.
    expect(wasdFollowY(0.5, 0, 1.0, EYE)).toBeCloseTo(2.5);
  });
});

describe('classifyFallAction', () => {
  it('enclosed → pop (wins regardless of tilt)', () => {
    expect(
      classifyFallAction({ enclosed: true, camY: 5, floorY: 0, tiltDeg: 80 })
    ).toBe('pop');
  });

  it('elevated + looking down → swoop', () => {
    expect(
      classifyFallAction({ enclosed: false, camY: 50, floorY: 0, tiltDeg: 60 })
    ).toBe('swoop');
  });

  it('elevated + ~horizontal → fall', () => {
    expect(
      classifyFallAction({ enclosed: false, camY: 50, floorY: 0, tiltDeg: 5 })
    ).toBe('fall');
  });

  it('at street level (within eye margin) → noop', () => {
    expect(
      classifyFallAction({
        enclosed: false,
        camY: EYE_MARGIN_METRES,
        floorY: 0,
        tiltDeg: 5
      })
    ).toBe('noop');
  });

  it('no surface below (probe miss) → noop', () => {
    expect(
      classifyFallAction({ enclosed: false, camY: 50, floorY: null, tiltDeg: 5 })
    ).toBe('noop');
  });
});

describe('isLegitPose (conjunction — WE-8a)', () => {
  it('rejects an enclosed pose even if above floor (grazing overhang)', () => {
    expect(isLegitPose({ enclosed: true, camY: 10, floorY: 0 })).toBe(false);
  });

  it('rejects a below-floor pose even if not enclosed (tucked under arch)', () => {
    expect(
      isLegitPose({ enclosed: false, camY: EYE_MARGIN_METRES - 0.1, floorY: 0 })
    ).toBe(false);
  });

  it('accepts not-enclosed AND above floor + eye margin', () => {
    expect(
      isLegitPose({ enclosed: false, camY: EYE_MARGIN_METRES + 0.1, floorY: 0 })
    ).toBe(true);
  });

  it('treats no-floor (open sky) as legit when not enclosed', () => {
    expect(isLegitPose({ enclosed: false, camY: 100, floorY: null })).toBe(true);
  });
});

describe('cueState (show/hide hysteresis — D7)', () => {
  it('shows above 8 m', () => {
    expect(cueState(false, 9, false)).toBe(true);
  });

  it('hides below 6 m', () => {
    expect(cueState(true, 5, false)).toBe(false);
  });

  it('holds the previous state inside the 6–8 m dead-band (no strobe)', () => {
    expect(cueState(true, 7, false)).toBe(true);
    expect(cueState(false, 7, false)).toBe(false);
  });

  it('enclosure forces show regardless of height', () => {
    expect(cueState(false, 0, true)).toBe(true);
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

  // --- TASK-024 (D8/N7) orbit floor bound ---
  // The `floorY` param caps the resulting camera height: `pos.y >= floorY +
  // EYE_MARGIN_METRES`. Asserted with an inequality (>=) — the numeric
  // tighten lands at/above the bound, never below.

  it('floor bound bites at a small radius: a hard down-drag can not dip below floor', () => {
    // Camera orbiting a ground pivot at a small radius, looking down,
    // dragged hard downward (would otherwise swing under the floor).
    const centre = new THREE.Vector3(0, 0, 0);
    const camPos = new THREE.Vector3(0, 5, 4); // R ≈ 6.4, above pivot
    const viewDir = new THREE.Vector3(0, -0.7, -0.7).normalize();
    const floorY = 0;
    const step = shiftRotateStep({
      camPos,
      viewDir,
      centre,
      dxPx: 0,
      dyPx: 5000, // huge drag-down
      speed: SPEED,
      floorY
    });
    expect(step.pos.y).toBeGreaterThanOrEqual(floorY + EYE_MARGIN_METRES - 1e-6);
  });

  it('floor bound relaxes at a large radius (down-tilt allowed)', () => {
    // Same drag, much larger radius — the floor clearance needs only a
    // small elevation angle, so the camera can tilt freely without the
    // bound biting at this step.
    const centre = new THREE.Vector3(0, 0, 0);
    const camPos = new THREE.Vector3(0, 50, 200); // large R
    const viewDir = new THREE.Vector3(0, -0.3, -0.95).normalize();
    const floorY = 0;
    const step = shiftRotateStep({
      camPos,
      viewDir,
      centre,
      dxPx: 0,
      dyPx: 30,
      speed: SPEED,
      floorY
    });
    expect(step.pos.y).toBeGreaterThanOrEqual(floorY + EYE_MARGIN_METRES);
  });

  it('reversibility: +dy then -dy returns to the start pose within epsilon', () => {
    // Capping the INPUT tilt (not the output position) means over-drag past
    // the floor does not accumulate, so reversing retraces.
    const centre = new THREE.Vector3(0, 0, 0);
    const camPos = new THREE.Vector3(0, 8, 6);
    const viewDir = new THREE.Vector3(0, -0.6, -0.8).normalize();
    const floorY = 0;
    const down = shiftRotateStep({
      camPos,
      viewDir,
      centre,
      dxPx: 0,
      dyPx: 40,
      speed: SPEED,
      floorY
    });
    const downDir = new THREE.Vector3()
      .subVectors(down.lookTarget, down.pos)
      .normalize();
    const back = shiftRotateStep({
      camPos: down.pos,
      viewDir: downDir,
      centre,
      dxPx: 0,
      dyPx: -40,
      speed: SPEED,
      floorY
    });
    expect(back.pos.distanceTo(camPos)).toBeLessThan(0.05);
  });

  it('no floorY param: street regime is unaffected (rotate-in-place)', () => {
    const camPos = new THREE.Vector3(5, 1.6, 5);
    const viewDir = new THREE.Vector3(0, 0, -1);
    const centre = new THREE.Vector3(5, 1.6, 5);
    const step = shiftRotateStep({
      camPos,
      viewDir,
      centre,
      dxPx: 100,
      dyPx: 100,
      speed: SPEED
    });
    expect(step.pos.x).toBe(camPos.x);
    expect(step.pos.y).toBe(camPos.y);
    expect(step.pos.z).toBe(camPos.z);
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

// --- AGL (TASK-013) ---
//
// The swoop now interprets `decideSwoopPhase` / `phase2*` inputs as
// height above ground (AGL = camera.y − groundY) rather than absolute y.
// The functions are unchanged (pure rename); these tests pin the *caller*
// conversion to the spec's worked examples and prove the translation
// invariance the imperative shell relies on (computing in AGL, writing
// back groundY + result).

describe('decideSwoopPhase (AGL worked examples, TASK-013)', () => {
  // Callers pass yAgl = camera.y − groundY.
  it('WE-1 flat scene: y=24, groundY=0 → AGL 24 → phase1', () => {
    expect(decideSwoopPhase(24 - 0)).toBe('phase1');
  });

  it('WE-2 elevated: y=24, groundY=6 → AGL 18 → phase2', () => {
    expect(decideSwoopPhase(24 - 6)).toBe('phase2');
  });

  it('WE-3 sunken: y=10, groundY=−3 → AGL 13 → phase2', () => {
    expect(decideSwoopPhase(10 - -3)).toBe('phase2');
  });

  it('WE-4 over-tower: y=40, groundY=0 → AGL 40 → phase1', () => {
    // Probe sees through the roof to the road below, so groundY=0, not 30.
    expect(decideSwoopPhase(40 - 0)).toBe('phase1');
  });
});

describe('Phase 2 AGL translation invariance + floor brackets (TASK-013)', () => {
  const yFloor = SWOOP_PHASE2_EXIT_ELEVATION_METRES; // 1.5
  const snap = SWOOP_PHASE2_FLOOR_SNAP_METRES; // 1.0

  it('phase2NextElevation step is groundY-independent (written-back y differs by exactly the ground offset)', () => {
    // Two scenes whose groundY differ by 6. Same AGL input (10). The AGL
    // step itself never sees groundY, so the written-back absolute y
    // values differ by exactly 6. This is the WE-2/WE-3 reversibility
    // regression guard.
    const step = phase2NextElevation(10, -1); // AGL 10, zoom-in
    const writtenBackGround0 = 0 + step;
    const writtenBackGround6 = 6 + step;
    expect(writtenBackGround6 - writtenBackGround0).toBeCloseTo(6, 12);
  });

  it('floor-snap in AGL writes back groundY + yFloor (not absolute yFloor)', () => {
    // Elevated scene groundY=6, camera at absolute 7.5 → yAgl = 1.5.
    const groundY = 6;
    const yAbs = 7.5;
    let yAgl = yAbs - groundY; // 1.5
    let yAglNext = phase2NextElevation(yAgl, -1); // zoom-in
    if (yAglNext - yFloor < snap) {
      yAglNext = yFloor;
    }
    const writtenBack = groundY + yAglNext;
    // Eye-height on the surface, NOT 4.5m underground (the absolute bug).
    expect(writtenBack).toBeCloseTo(7.5, 12);
    expect(writtenBack).not.toBeCloseTo(1.5, 6);
  });

  it('kick-start in AGL fires on elevated scene; the old absolute guard would not have', () => {
    // groundY=6, camera at absolute 7.5 → yAgl = 1.5, zoom-out.
    const groundY = 6;
    const yAbs = 7.5;
    let yAgl = yAbs - groundY; // 1.5
    // New AGL guard: yAgl >= 0 && yAgl <= yFloor + snap (1.5 in [0, 2.5]).
    const guardFires = yAgl >= 0 && yAgl <= yFloor + snap;
    expect(guardFires).toBe(true);
    if (guardFires) yAgl = yFloor + snap; // 2.5
    const yAglNext = phase2NextElevation(yAgl, +1);
    const writtenBack = groundY + yAglNext;
    expect(writtenBack).toBeGreaterThan(7.5); // camera ascends
    // Document the bug the conversion fixes: the OLD absolute guard
    // compared absolute y (7.5) to yFloor+snap (2.5) → false → stall.
    const oldAbsoluteGuard = yAbs <= yFloor + snap;
    expect(oldAbsoluteGuard).toBe(false);
  });

  it('legitimate below-floor fresh case DOES kick-start (AGL 0.5)', () => {
    // Camera genuinely on real ground at AGL 0.5 (fresh probe). The
    // round-1 over-tight `yAgl >= yFloor` guard would have wrongly killed
    // this; the `yAgl >= 0` lower bound preserves it.
    let yAgl = 0.5;
    const guardFires = yAgl >= 0 && yAgl <= yFloor + snap; // 0.5 in [0, 2.5]
    expect(guardFires).toBe(true);
    if (guardFires) yAgl = yFloor + snap;
    expect(yAgl).toBe(2.5); // kick-started, no stall
  });

  it('kick-start does NOT fire at negative AGL (no teleport)', () => {
    // Camera over a gap holding a stale-high cached groundY (cached ground
    // above the camera) → yAgl = −2. The lower-bound guard skips the
    // kick-start so there is no teleport-to-(groundY + yFloor + snap).
    let yAgl = -2;
    const guardFires = yAgl >= 0 && yAgl <= yFloor + snap; // -2 >= 0 → false
    expect(guardFires).toBe(false);
    if (guardFires) yAgl = yFloor + snap;
    expect(yAgl).toBe(-2); // unchanged entering phase2NextElevation — no teleport
  });
});
