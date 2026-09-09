// Regression (GH-1941): per-detent wheel zoom rate must be (near-)uniform
// across camera tilt. The dolly step is 5% of the camera→cursor-anchor
// distance per detent, but the KD-15 horizontal lurch cap scales the whole
// step down once it binds — and it binds when tan(tilt) <
// ZOOM_PER_WHEEL_TICK / WHEEL_ZOOM_LATERAL_CAP_AGL_COEFF. At the original
// coefficient (0.1) that knee sat at ~27° tilt, so ordinary angled views
// zoomed up to ~6× slower (as a fraction of the way to the target) than
// plan view: "works as expected in plan view but variable speed at an
// angle". The retuned coefficient (0.25) moves the knee to ~11°, below
// normal working tilts, while keeping the cap's grazing-ray lurch bound.
//
// These tests pin both halves: the flat rate through working tilts, and the
// cap still binding at a truly shallow (5°) grazing angle.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as H from './_harness.js';
import {
  ZOOM_PER_WHEEL_TICK,
  WHEEL_ZOOM_LATERAL_CAP_AGL_COEFF
} from '../../../../src/editor/lib/nav-experimental/constants.js';

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

const H0 = 50; // camera height above the ground plane (metres)

// One zoom-in detent at the given tilt, cursor on the exact view axis (the
// harness dom rect has a nonzero left/top offset — aim through it). Returns
// the movement as a fraction of the camera→anchor distance along the axis.
function rateAtTilt(tiltDeg) {
  const cam = H.makePerspectiveCam();
  const dom = H.makeDomElement();
  const rect = dom.getBoundingClientRect();
  const scene = H.groundPlaneScene({ y: 0 });
  const c = H.makeControls({ camera: cam, dom, scene });
  const rad = (tiltDeg * Math.PI) / 180;
  const fwdDist = H0 / Math.tan(rad);
  cam.position.set(0, H0, 0);
  cam.lookAt(0, 0, -fwdDist);
  cam.updateMatrixWorld(true);
  const anchorDist = Math.hypot(H0, fwdDist);
  const before = cam.position.clone();
  H.wheel(c, {
    dy: -100, // one nominal detent, zoom in
    clientX: rect.left + rect.width / 2,
    clientY: rect.top + rect.height / 2
  });
  H.tickInput(c);
  return { rate: before.distanceTo(cam.position) / anchorDist, anchorDist };
}

describe('wheel zoom rate vs tilt (GH-1941)', () => {
  it('zoom-in rate is uniform from plan view down through working tilts', () => {
    const planRate = rateAtTilt(89).rate;
    // Sanity: plan view moves ~ZOOM_PER_WHEEL_TICK of the anchor distance.
    expect(planRate).toBeGreaterThan(ZOOM_PER_WHEEL_TICK * 0.9);
    expect(planRate).toBeLessThan(ZOOM_PER_WHEEL_TICK * 1.1);
    for (const tilt of [60, 45, 30, 20, 15]) {
      const { rate } = rateAtTilt(tilt);
      // Pre-fix, 15° came in at ~0.53× the plan-view rate. Uniform ±10%.
      expect(rate).toBeGreaterThan(planRate * 0.9);
      expect(rate).toBeLessThan(planRate * 1.1);
    }
  });

  it('the lurch cap still binds on a grazing 5-degree ray', () => {
    const cam = H.makePerspectiveCam();
    const dom = H.makeDomElement();
    const rect = dom.getBoundingClientRect();
    const scene = H.groundPlaneScene({ y: 0 });
    const c = H.makeControls({ camera: cam, dom, scene });
    const rad = (5 * Math.PI) / 180;
    cam.position.set(0, H0, 0);
    cam.lookAt(0, 0, -H0 / Math.tan(rad));
    cam.updateMatrixWorld(true);
    const before = cam.position.clone();
    H.wheel(c, {
      dy: -100,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2
    });
    H.tickInput(c);
    const moved = before.distanceTo(cam.position);
    // Uncapped this step would be 5% of ~574 m ≈ 28.7 m; the cap bounds the
    // horizontal part at COEFF × AGL, i.e. the full step at ~cap/cos(5°).
    const capBound = (WHEEL_ZOOM_LATERAL_CAP_AGL_COEFF * H0) / Math.cos(rad);
    expect(moved).toBeLessThanOrEqual(capBound + 0.5);
    expect(moved).toBeGreaterThan(0); // still moves — capped, not dead
  });
});
