import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  cameraTiltDegrees,
  decideLbMode,
  computeRuleAB,
  tiltBlendWeight,
  latchedRotationCenter
} from '../../../../src/editor/lib/nav-experimental/navMath.js';
import {
  TRUCK_PEDESTAL_CUTOFF_DEGREES,
  ROTATION_BLEND_LOW_DEGREES,
  ROTATION_BLEND_HIGH_DEGREES,
  ROTATION_CENTER_EYE_HEIGHT_METRES,
  CYLINDER_FEATHER_FRACTION
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

  it('returns diorama center @ eye height when far outside the cylinder', () => {
    const bounds = {
      bounded: true,
      center: { x: 0, y: 0, z: 0 },
      radius: 10
    };
    // Camera 50m east — well outside, well past the feather zone.
    const v = computeRuleAB({ x: 50, y: 5, z: 0 }, bounds);
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.y).toBeCloseTo(ROTATION_CENTER_EYE_HEIGHT_METRES, 5);
    expect(v.z).toBeCloseTo(0, 5);
  });

  it('returns camera position when fully inside the cylinder', () => {
    const bounds = {
      bounded: true,
      center: { x: 0, y: 0, z: 0 },
      radius: 100
    };
    // Way inside (well past the inner edge of the feather zone).
    const camPos = { x: 5, y: 2, z: 5 };
    const v = computeRuleAB(camPos, bounds);
    expect(v.x).toBeCloseTo(5, 5);
    expect(v.y).toBeCloseTo(2, 5);
    expect(v.z).toBeCloseTo(5, 5);
  });

  it('feathers smoothly across the cylinder edge', () => {
    const bounds = {
      bounded: true,
      center: { x: 0, y: 0, z: 0 },
      radius: 10
    };
    const featherWidth = 10 * CYLINDER_FEATHER_FRACTION; // 1m
    // Just inside the inner edge of the feather (still mostly Rule 3):
    // result should be close to the camera position, not the diorama
    // center.
    const innerCam = { x: 10 - featherWidth * 0.8, y: 5, z: 0 };
    const inner = computeRuleAB(innerCam, bounds);
    expect(inner.x).toBeGreaterThan(5);
    expect(inner.y).toBeGreaterThan(ROTATION_CENTER_EYE_HEIGHT_METRES);
    // At the cylinder edge: fully outside = diorama center.
    const edge = computeRuleAB({ x: 10, y: 5, z: 0 }, bounds);
    expect(edge.x).toBeCloseTo(0, 5);
    expect(edge.y).toBeCloseTo(ROTATION_CENTER_EYE_HEIGHT_METRES, 5);
    // Halfway across the feather: must be strictly between the two
    // anchors on x.
    const midCam = { x: 10 - featherWidth * 0.5, y: 5, z: 0 };
    const mid = computeRuleAB(midCam, bounds);
    expect(mid.x).toBeGreaterThan(0);
    expect(mid.x).toBeLessThan(midCam.x);
  });
});

describe('latchedRotationCenter', () => {
  const bounded = {
    bounded: true,
    center: { x: 0, y: 0, z: 0 },
    radius: 10
  };
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
    // Tilt 0° (horizontal). Camera outside cylinder -> diorama center.
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

  it('liveRuleAB is true for bounded scenes, false for unbounded', () => {
    const cam = camAt({ x: 0, y: 5, z: 5 }, { x: 0, y: 5, z: 0 });
    expect(latchedRotationCenter(cam, bounded, null).liveRuleAB).toBe(true);
    expect(latchedRotationCenter(cam, unbounded, null).liveRuleAB).toBe(false);
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
