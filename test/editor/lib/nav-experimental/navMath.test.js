import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  cameraTiltDegrees,
  decideLbMode,
  computeRuleAB,
  tiltBlendWeight,
  latchedRotationCenter,
  computeLowTiltWheelHit,
  shiftRotateStep,
  decideSwoopPhase,
  phase2TargetTilt,
  phase2NextElevation
} from '../../../../src/editor/lib/nav-experimental/navMath.js';
import {
  TRUCK_PEDESTAL_CUTOFF_DEGREES,
  ROTATION_BLEND_LOW_DEGREES,
  ROTATION_BLEND_HIGH_DEGREES,
  ROTATION_CENTER_EYE_HEIGHT_METRES,
  SCENE_FEATHER_METRES,
  FALLBACK_FORWARD_DIST,
  SWOOP_PHASE2_ENTRY_ELEVATION_METRES,
  SWOOP_PHASE2_EXIT_ELEVATION_METRES,
  SWOOP_PHASE2_STEP
} from '../../../../src/editor/lib/nav-experimental/constants.js';

// Helper: build a square-ish bounds object centered on the origin.
function squareBounds(half) {
  return {
    bounded: true,
    center: { x: 0, y: 0, z: 0 },
    radius: half * Math.SQRT2,
    aabb: { minX: -half, maxX: half, minZ: -half, maxZ: half }
  };
}

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
  const cutoff = TRUCK_PEDESTAL_CUTOFF_DEGREES;

  it('returns pan-truck strictly above the cutoff', () => {
    expect(decideLbMode(cutoff + 0.001)).toBe('pan-truck');
    expect(decideLbMode(cutoff + 30)).toBe('pan-truck');
    expect(decideLbMode(89)).toBe('pan-truck');
  });

  it('returns pan-pedestal at or below the cutoff (inclusive)', () => {
    expect(decideLbMode(cutoff)).toBe('pan-pedestal');
    expect(decideLbMode(cutoff - 0.001)).toBe('pan-pedestal');
    expect(decideLbMode(0)).toBe('pan-pedestal');
  });

  it('returns pan-pedestal for any negative tilt (looking up)', () => {
    expect(decideLbMode(-1)).toBe('pan-pedestal');
    expect(decideLbMode(-45)).toBe('pan-pedestal');
    expect(decideLbMode(-89)).toBe('pan-pedestal');
  });
});

describe('tiltBlendWeight', () => {
  it('is 0 at the high end of the blend', () => {
    expect(tiltBlendWeight(ROTATION_BLEND_HIGH_DEGREES)).toBe(0);
    expect(tiltBlendWeight(50)).toBe(0);
  });

  it('is 1 at the low end of the blend (and below)', () => {
    expect(tiltBlendWeight(ROTATION_BLEND_LOW_DEGREES)).toBe(1);
    expect(tiltBlendWeight(0)).toBe(1);
    expect(tiltBlendWeight(-25)).toBe(1);
  });

  it('is monotone non-increasing across the blend zone', () => {
    let prev = tiltBlendWeight(ROTATION_BLEND_LOW_DEGREES);
    for (
      let t = ROTATION_BLEND_LOW_DEGREES;
      t <= ROTATION_BLEND_HIGH_DEGREES;
      t += 0.5
    ) {
      const w = tiltBlendWeight(t);
      expect(w).toBeLessThanOrEqual(prev + 1e-9);
      prev = w;
    }
  });

  it('is symmetric (smoothstep) at the midpoint = 0.5', () => {
    const mid = (ROTATION_BLEND_LOW_DEGREES + ROTATION_BLEND_HIGH_DEGREES) / 2;
    expect(tiltBlendWeight(mid)).toBeCloseTo(0.5, 6);
  });
});

describe('computeRuleAB', () => {
  it('returns camera position for unbounded scenes', () => {
    const camPos = { x: 7, y: 3, z: -2 };
    const v = computeRuleAB(camPos, {
      bounded: false,
      center: { x: 0, y: 0, z: 0 },
      radius: 0
    });
    expect(v.x).toBe(7);
    expect(v.y).toBe(3);
    expect(v.z).toBe(-2);
  });

  it('returns diorama center @ eye height far outside the AABB', () => {
    const bounds = squareBounds(10);
    // Camera 50m east — well outside, well past the feather zone.
    const v = computeRuleAB({ x: 50, y: 5, z: 0 }, bounds);
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.y).toBeCloseTo(ROTATION_CENTER_EYE_HEIGHT_METRES, 5);
    expect(v.z).toBeCloseTo(0, 5);
  });

  it('returns camera position when fully inside the AABB', () => {
    const bounds = squareBounds(100);
    const camPos = { x: 5, y: 2, z: 5 };
    const v = computeRuleAB(camPos, bounds);
    expect(v.x).toBeCloseTo(5, 5);
    expect(v.y).toBeCloseTo(2, 5);
    expect(v.z).toBeCloseTo(5, 5);
  });

  it('feathers smoothly outward from the AABB edge', () => {
    const bounds = squareBounds(10); // 20×20 box centered on origin
    const fw = SCENE_FEATHER_METRES;
    // Inside the AABB (strictly < edge): fully Rule 3 (camera pos).
    const innerCam = { x: 10 - 1, y: 5, z: 0 };
    const inner = computeRuleAB(innerCam, bounds);
    expect(inner.x).toBeCloseTo(innerCam.x, 5);
    expect(inner.y).toBeCloseTo(5, 5);
    // Exactly at the AABB edge: still fully Rule 3.
    const edge = computeRuleAB({ x: 10, y: 5, z: 0 }, bounds);
    expect(edge.x).toBeCloseTo(10, 5);
    expect(edge.y).toBeCloseTo(5, 5);
    // Halfway through the feather (just outside): strictly between cam
    // pos and diorama center.
    const midCam = { x: 10 + fw * 0.5, y: 5, z: 0 };
    const mid = computeRuleAB(midCam, bounds);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(midCam.x);
    expect(mid.y).toBeLessThan(5);
    expect(mid.y).toBeGreaterThan(ROTATION_CENTER_EYE_HEIGHT_METRES);
    // Past the feather (well outside): fully Rule 2 (diorama center).
    const outerCam = { x: 10 + fw * 1.5, y: 5, z: 0 };
    const outer = computeRuleAB(outerCam, bounds);
    expect(outer.x).toBeCloseTo(0, 5);
    expect(outer.y).toBeCloseTo(ROTATION_CENTER_EYE_HEIGHT_METRES, 5);
  });

  it('treats long-thin scenes by their AABB, not their cylinder', () => {
    // 100m × 5m street centered on origin: half-extents (50, 2.5).
    // The legacy cylinder radius would be 50m, so a camera 10m off the
    // side (x=0, z=12.5) would be deemed "inside" — wrong.
    const bounds = {
      bounded: true,
      center: { x: 0, y: 0, z: 0 },
      radius: 50,
      aabb: { minX: -50, maxX: 50, minZ: -2.5, maxZ: 2.5 }
    };
    // 10m off the side = well past the feather (5m). Should be full
    // Rule 2 (diorama center @ eye height), not Rule 3.
    const v = computeRuleAB({ x: 0, y: 5, z: 12.5 }, bounds);
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.y).toBeCloseTo(ROTATION_CENTER_EYE_HEIGHT_METRES, 5);
    expect(v.z).toBeCloseTo(0, 5);
    // On the long-axis at z = 0, x = 25 (25m from center, on the
    // street): inside the AABB → Rule 3.
    const onStreet = computeRuleAB({ x: 25, y: 1.6, z: 0 }, bounds);
    expect(onStreet.x).toBeCloseTo(25, 5);
    expect(onStreet.y).toBeCloseTo(1.6, 5);
    expect(onStreet.z).toBeCloseTo(0, 5);
  });

  // Live-feather behavioural check: as a Shift+LB camera trucks across
  // the cylinder edge mid-gesture, `_updateLiveRuleAB` calls
  // `computeRuleAB` each frame and should smoothly slide the rotation
  // center from camera-pos toward diorama-center. Walk a sample path
  // across the edge and verify the centre's x-coordinate is monotone
  // non-increasing (Rule 3 inside → Rule 2 outside) and continuous
  // (no jump > 1m between adjacent samples).
  it('produces a continuous slide as the camera crosses the edge', () => {
    const bounds = squareBounds(10); // AABB edge at x = 10
    const fw = SCENE_FEATHER_METRES;
    // Walk x from the AABB edge outward through the feather and well
    // beyond. Endpoints: at the edge result == camera pos (10); past
    // the feather result == diorama center (0). Across the walk the
    // per-step jump must stay bounded by a smoothstep-derived constant
    // — the main thing this catches is a discontinuous (broken)
    // transition function. Note: result.x is NOT monotone across the
    // whole walk — just inside the feather the camera-position drift
    // (linear in x) dominates the smoothstep pull-toward-center, so
    // result.x can briefly rise above the start before turning down.
    //   lerp(cam, diorama, smoothstep(dist/fw))
    //   |d/dx| max ≈ |cam-diorama| * 1.5 / fw + 1
    const stepSize = 0.05;
    const maxJump = ((10 * 1.5) / fw) * stepSize + stepSize + 1e-6;
    const start = computeRuleAB({ x: 10, y: 5, z: 0 }, bounds);
    expect(start.x).toBeCloseTo(10, 5);
    let prev = start;
    for (let x = 10 + stepSize; x <= 10 + fw + 5 + 1e-4; x += stepSize) {
      const v = computeRuleAB({ x, y: 5, z: 0 }, bounds);
      expect(Math.abs(v.x - prev.x)).toBeLessThan(maxJump);
      prev = v;
    }
    // End-state: well past the feather, fully diorama center.
    expect(prev.x).toBeCloseTo(0, 5);
    expect(prev.y).toBeCloseTo(ROTATION_CENTER_EYE_HEIGHT_METRES, 5);
  });
});

describe('latchedRotationCenter', () => {
  const bounded = squareBounds(10);
  const unbounded = { bounded: false, center: { x: 0, y: 0, z: 0 }, radius: 0 };

  it('above the blend zone, picks Rule 1 (screen hit)', () => {
    // Tilt +60° down.
    const cam = camAt({ x: 0, y: 10, z: 5.77 }, { x: 0, y: 0, z: 0 });
    const screenHit = { x: 1, y: 2, z: 3 };
    const r = latchedRotationCenter(cam, bounded, screenHit);
    expect(r.center.x).toBeCloseTo(1, 5);
    expect(r.center.y).toBeCloseTo(2, 5);
    expect(r.center.z).toBeCloseTo(3, 5);
    expect(r.blend).toBe(0);
  });

  it('below the blend zone, picks Rule 2/3 (ignores screen hit)', () => {
    // Tilt 0° (horizontal). Camera well outside AABB -> diorama center.
    const cam = camAt({ x: 50, y: 5, z: 0 }, { x: 0, y: 5, z: 0 });
    const r = latchedRotationCenter(cam, bounded, { x: 999, y: 999, z: 999 });
    expect(r.center.x).toBeCloseTo(0, 5);
    expect(r.center.y).toBeCloseTo(ROTATION_CENTER_EYE_HEIGHT_METRES, 5);
    expect(r.center.z).toBeCloseTo(0, 5);
    expect(r.blend).toBe(1);
  });

  it('looking up never enters the blend (always Rule 2/3)', () => {
    // Tilt -25° (looking up by 25°).
    const cam = camAt({ x: 0, y: 0, z: 10 }, { x: 0, y: 4.66, z: 0 });
    const r = latchedRotationCenter(cam, unbounded, { x: 99, y: 99, z: 99 });
    expect(r.blend).toBe(1);
    // unbounded -> rule 3 = camera position
    expect(r.center.x).toBeCloseTo(0, 5);
    expect(r.center.z).toBeCloseTo(10, 5);
  });

  it('null screen hit collapses to ruleAB regardless of blend', () => {
    // Tilt +25° (mid blend, would normally split between screen-hit and
    // ruleAB), but screen hit is null (sky raycast miss).
    const cam = camAt({ x: 50, y: 23.3, z: 0 }, { x: 0, y: 0, z: 0 });
    const r = latchedRotationCenter(cam, bounded, null);
    // Should equal ruleAB = diorama center @ eye height.
    expect(r.center.x).toBeCloseTo(0, 5);
    expect(r.center.y).toBeCloseTo(ROTATION_CENTER_EYE_HEIGHT_METRES, 5);
    expect(r.center.z).toBeCloseTo(0, 5);
  });

  it('returns the latched fields the gesture handler stores', () => {
    const cam = camAt({ x: 0, y: 5, z: 5 }, { x: 0, y: 5, z: 0 });
    const r = latchedRotationCenter(cam, bounded, { x: 1, y: 2, z: 3 });
    expect(r.center).toBeDefined();
    expect(r.screenHit).toBeDefined();
    expect(typeof r.blend).toBe('number');
    // No `liveRuleAB`: center is fully latched at gesture start.
    expect(r.liveRuleAB).toBeUndefined();
  });

  it('mid-blend at +25° produces an intermediate center', () => {
    // Camera high enough that 25° down is achievable.
    const cam = camAt({ x: 50, y: 23.3, z: 0 }, { x: 0, y: 0, z: 0 });
    const screenHit = { x: 50, y: 0, z: 0 }; // somewhere distinct from diorama
    const r = latchedRotationCenter(cam, bounded, screenHit);
    expect(r.blend).toBeGreaterThan(0);
    expect(r.blend).toBeLessThan(1);
    // x should be strictly between screenHit.x (50) and diorama.x (0).
    expect(r.center.x).toBeGreaterThan(0);
    expect(r.center.x).toBeLessThan(50);
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
    // Museum diorama test. Camera at (10, 0, 0) looking 30° off from
    // origin. Apply 90° yaw. After the rotation, the angle between
    // view direction and direction-to-centre should still be 30°.
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
