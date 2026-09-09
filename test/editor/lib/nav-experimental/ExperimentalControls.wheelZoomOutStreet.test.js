// Regression (GH-1966): wheel zoom-OUT from street level toward a wide
// overview must make real progress.
//
// Two fixes under test:
//  1. Sky-fallback anchor split: with no real hit under the cursor (at/above
//     the horizon — mid-screen in any street-level view), zoom-out used the
//     level-forward synthetic anchor, rebuilt 30 m ahead AT THE CAMERA'S OWN
//     HEIGHT every step — a constant ~1.6 m/detent horizontal slide with
//     ZERO altitude gain, forever. Zoom-out now anchors that fallback at
//     ground height (navMath.groundForwardAnchor), so it rises as it recedes
//     and the growing anchor distance restores exponential acceleration.
//     Zoom-IN keeps the level anchor (forward at constant height).
//  2. Sustained wheel-zoom acceleration (zoomBoost, #1967 made it
//     direction-agnostic): a continuous scroll in either direction ramps the
//     per-detent rate from the flat 5% up to BOOST_MAX × 5% after a
//     deadband, cutting street-level ↔ km-scale overview from ~150+ detents
//     to a fraction. The streak resets on a direction flip, a non-wheel
//     move, or an idle gap.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as H from './_harness.js';
import {
  ZOOM_PER_WHEEL_TICK,
  WHEEL_ZOOM_BOOST_MAX,
  WHEEL_ZOOM_BOOST_DEADBAND_TICKS,
  WHEEL_ZOOM_BOOST_RAMP_TICKS,
  WHEEL_ZOOM_BOOST_RESET_MS
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

function centreOf(dom) {
  const r = dom.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
}

// Street-level rig: camera 1.6 m over a ground plane, gaze level along -z,
// cursor at screen centre — the cursor ray runs parallel to the ground and
// hits nothing, so the wheel is on the sky-fallback anchor path.
function streetLevelRig() {
  const cam = H.makePerspectiveCam();
  const dom = H.makeDomElement();
  const scene = H.groundPlaneScene({ y: 0 });
  const controls = H.makeControls({ camera: cam, dom, scene });
  cam.position.set(0, 1.6, 0);
  cam.lookAt(0, 1.6, -100);
  cam.updateMatrixWorld(true);
  return { cam, controls, ...centreOf(dom) };
}

// Plan-view rig: near-top-down from 50 m, cursor at centre (real ground
// hit) — pure vertical zoom, no lurch cap, isolates the boost ramp.
function planViewRig() {
  const cam = H.makePerspectiveCam();
  const dom = H.makeDomElement();
  const scene = H.groundPlaneScene({ y: 0 });
  const controls = H.makeControls({ camera: cam, dom, scene });
  cam.position.set(0, 50, 0);
  cam.lookAt(0, 0, -1);
  cam.updateMatrixWorld(true);
  return { cam, controls, ...centreOf(dom) };
}

function detentOut({ controls, cx, cy }, frameMs = 16) {
  H.wheel(controls, { dy: 100, clientX: cx, clientY: cy });
  H.tickInput(controls, frameMs);
}

function detentIn({ controls, cx, cy }, frameMs = 16) {
  H.wheel(controls, { dy: -100, clientX: cx, clientY: cy });
  H.tickInput(controls, frameMs);
}

describe('sky-fallback anchor on zoom-out (GH-1966)', () => {
  it('zoom-out with the cursor at the horizon gains altitude', () => {
    const rig = streetLevelRig();
    // Pre-fix: 200 detents gained exactly 0 m of altitude (level anchor).
    for (let i = 0; i < 60; i++) detentOut(rig);
    expect(rig.cam.position.y).toBeGreaterThan(10);
  });

  it('zoom-out against the sky accelerates as it recedes', () => {
    const rig = streetLevelRig();
    for (let i = 0; i < 30; i++) detentOut(rig);
    const yMid = rig.cam.position.y;
    const gainFirst30 = yMid - 1.6;
    for (let i = 0; i < 30; i++) detentOut(rig);
    const gainSecond30 = rig.cam.position.y - yMid;
    // Exponential-ish growth: the second 30 detents cover far more altitude
    // than the first 30 (pre-fix both were exactly 0).
    expect(gainSecond30).toBeGreaterThan(gainFirst30 * 2);
  });

  it('zoom-IN toward the sky keeps the level-forward anchor (no climb/dive)', () => {
    const rig = streetLevelRig();
    for (let i = 0; i < 10; i++) {
      H.wheel(rig.controls, { dy: -100, clientX: rig.cx, clientY: rig.cy });
      H.tickInput(rig.controls);
    }
    // Level anchor: pure forward flight at constant height.
    expect(Math.abs(rig.cam.position.y - 1.6)).toBeLessThan(1e-6);
    expect(rig.cam.position.z).toBeLessThan(-5); // did advance forward
  });
});

describe('sustained wheel-zoom acceleration (GH-1966, GH-1967)', () => {
  // Per-detent altitude ratio in plan view (vertical dolly: y multiplies by
  // the step factor each detent, so the ratio reads the effective rate).
  function nextDetentRatio(rig) {
    const before = rig.cam.position.y;
    detentOut(rig);
    return rig.cam.position.y / before;
  }

  const BASE_RATIO = 1 / (1 - ZOOM_PER_WHEEL_TICK); // ≈ 1.0526 unboosted
  const FULL_RATIO = Math.pow(BASE_RATIO, WHEEL_ZOOM_BOOST_MAX);

  it('ramps from the base rate to the boosted rate over a continuous scroll', () => {
    const rig = planViewRig();
    // Inside the deadband: exactly the base rate.
    const first = nextDetentRatio(rig);
    expect(first).toBeGreaterThan(BASE_RATIO * 0.995);
    expect(first).toBeLessThan(BASE_RATIO * 1.005);
    // Past deadband + ramp: the full boosted rate.
    const past = WHEEL_ZOOM_BOOST_DEADBAND_TICKS + WHEEL_ZOOM_BOOST_RAMP_TICKS;
    for (let i = 1; i < past + 2; i++) detentOut(rig);
    const late = nextDetentRatio(rig);
    expect(late).toBeGreaterThan(FULL_RATIO * 0.99);
    expect(late).toBeLessThan(FULL_RATIO * 1.01);
  });

  it('a direction flip resets the streak to the base rate', () => {
    const rig = planViewRig();
    for (let i = 0; i < 30; i++) detentOut(rig);
    // The flip tick itself is unboosted (streak restarts at 1 tick)...
    const before = rig.cam.position.y;
    detentIn(rig);
    expect(rig.cam.position.y / before).toBeGreaterThan(
      (1 - ZOOM_PER_WHEEL_TICK) * 0.995
    );
    // ...and flipping back out is unboosted too.
    const after = nextDetentRatio(rig);
    expect(after).toBeLessThan(BASE_RATIO * 1.005);
  });

  it('an idle gap resets the streak to the base rate', () => {
    const rig = planViewRig();
    for (let i = 0; i < 30; i++) detentOut(rig);
    // Idle frames (no wheel input) totalling more than the reset window.
    const frames = Math.ceil(WHEEL_ZOOM_BOOST_RESET_MS / 16) + 2;
    H.tickInput(rig.controls, 16, frames);
    const after = nextDetentRatio(rig);
    expect(after).toBeLessThan(BASE_RATIO * 1.005);
  });

  it('zoom-IN ramps to the boosted rate too (GH-1967)', () => {
    // Start high in plan view so the descent stays in the dolly regime.
    const rig = planViewRig();
    rig.cam.position.y = 5000;
    rig.cam.updateMatrixWorld(true);
    const inRatio = () => {
      const before = rig.cam.position.y;
      detentIn(rig);
      return before / rig.cam.position.y;
    };
    const first = inRatio();
    expect(first).toBeGreaterThan(BASE_RATIO * 0.995);
    expect(first).toBeLessThan(BASE_RATIO * 1.005);
    const past = WHEEL_ZOOM_BOOST_DEADBAND_TICKS + WHEEL_ZOOM_BOOST_RAMP_TICKS;
    for (let i = 1; i < past + 2; i++) detentIn(rig);
    const late = inRatio();
    expect(late).toBeGreaterThan(FULL_RATIO * 0.99);
    expect(late).toBeLessThan(FULL_RATIO * 1.01);
  });

  it('headline: overview back down toward street level in far fewer detents', () => {
    // Mirror of the zoom-out headline: 2500 m AGL plan view, cursor on the
    // ground, scroll in continuously. Unboosted this is ~130 detents to
    // reach 50 m AGL.
    const rig = planViewRig();
    rig.cam.position.y = 2500;
    rig.cam.updateMatrixWorld(true);
    let detents = 0;
    while (rig.cam.position.y > 50 && detents < 200) {
      detentIn(rig);
      detents++;
    }
    expect(rig.cam.position.y).toBeLessThanOrEqual(50);
    expect(detents).toBeLessThan(50);
  });

  it('headline: street level to a 4-sq-mi overview in far fewer detents', () => {
    // 10° downward street gaze, cursor on the road ahead — the GH-1966
    // scenario. Pre-fix this took 163 detents to reach 2500 m AGL.
    const cam = H.makePerspectiveCam();
    const dom = H.makeDomElement();
    const scene = H.groundPlaneScene({ y: 0 });
    const controls = H.makeControls({ camera: cam, dom, scene });
    cam.position.set(0, 1.6, 0);
    cam.lookAt(0, 0, -1.6 / Math.tan((10 * Math.PI) / 180));
    cam.updateMatrixWorld(true);
    const rig = { cam, controls, ...centreOf(dom) };
    let detents = 0;
    while (cam.position.y < 2500 && detents < 200) {
      detentOut(rig);
      detents++;
    }
    expect(cam.position.y).toBeGreaterThanOrEqual(2500);
    expect(detents).toBeLessThan(60);
  });
});
