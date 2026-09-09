// Regression (GH-1858): wheel-zoom speed must not depend on frame rate.
// The continuous drain applies every tick accumulated since the last frame
// as ONE step, and the per-tick lateral lurch cap (KD-15) must scale its
// budget with that tick count — a flat per-frame cap makes the max zoom
// rate `cap × fps` (glacial on low-fps scenes). Default tier (street-level
// OFF): the wheel is always the plain cursor-anchored dolly.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as H from './_harness.js';
import {
  WHEEL_ZOOM_LATERAL_CAP_LOWER_BOUND_METRES,
  WHEEL_ZOOM_LATERAL_CAP_AGL_COEFF,
  WHEEL_ZOOM_BOOST_MAX,
  WHEEL_ZOOM_BOOST_DEADBAND_TICKS,
  WHEEL_ZOOM_BOOST_RAMP_TICKS
} from '../../../../src/editor/lib/nav-experimental/constants.js';
import { zoomBoostTicks } from '../../../../src/editor/lib/nav-experimental/navMath.js';

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

// Drive `total` zoom-in ticks in batches of `perFrame` ticks per frame
// (perFrame 1 ≈ a 60 fps stream; perFrame 6 ≈ the same scroll at ~10 fps,
// where events pile up between drains). Returns the camera.
function zoomIn(controls, cam, { total, perFrame, frameMs }) {
  for (let applied = 0; applied < total; applied += perFrame) {
    for (let i = 0; i < perFrame; i++) H.wheel(controls, { dy: -100 });
    H.tickInput(controls, frameMs);
  }
  return cam;
}

describe('wheel zoom — frame-rate independence (GH-1858)', () => {
  it('12 ticks at 1 tick/frame and at 6 ticks/frame land the camera in the same place', () => {
    // Steep-ish view (tilt ≈ 59°): a single tick's step is under the lurch
    // cap, so the 1-tick/frame run is uncapped. Pre-fix, the 6-tick frames
    // were clamped to ONE tick's cap and fell far short.
    const sceneA = H.groundPlaneScene({ y: 0 });
    const camA = H.makePerspectiveCam({ pos: [0, 100, 60], lookAt: [0, 0, 0] });
    const cA = H.makeControls({ camera: camA, scene: sceneA });
    zoomIn(cA, camA, { total: 12, perFrame: 1, frameMs: 16 });

    const sceneB = H.groundPlaneScene({ y: 0 });
    const camB = H.makePerspectiveCam({ pos: [0, 100, 60], lookAt: [0, 0, 0] });
    const cB = H.makeControls({ camera: camB, scene: sceneB });
    zoomIn(cB, camB, { total: 12, perFrame: 6, frameMs: 100 });

    // Both descended substantially (0.95^12 of the anchor distance).
    expect(camA.position.y).toBeLessThan(60);
    // Same input → same pose, regardless of how many frames carried it.
    expect(camB.position.distanceTo(camA.position)).toBeLessThan(0.5);
  });

  it('a multi-tick frame at shallow tilt gets a per-tick cap budget, not one flat cap', () => {
    // Shallow view (tilt ≈ 5.7°, anchor ~300 m out): every tick's step
    // (~5% × 300 m ≈ 15 m) exceeds the lurch cap (max(lowerBound,
    // coeff×AGL) at AGL 30), so the cap binds. A 6-tick frame must be
    // allowed ~6 caps of horizontal travel — pre-fix (GH-1858) it was
    // clamped to a single cap for the whole frame. The cap is derived from
    // the live constants so a coefficient retune (GH-1941) can't silently
    // break this test's arithmetic.
    const scene = H.groundPlaneScene({ y: 0 });
    const cam = H.makePerspectiveCam({ pos: [0, 30, 0], lookAt: [0, 0, 300] });
    const c = H.makeControls({ camera: cam, scene });
    const start = cam.position.clone();
    const capPerTick = Math.max(
      WHEEL_ZOOM_LATERAL_CAP_LOWER_BOUND_METRES,
      WHEEL_ZOOM_LATERAL_CAP_AGL_COEFF * 30
    );

    for (let i = 0; i < 6; i++) H.wheel(c, { dy: -100 });
    H.tickInput(c, 100);

    const horiz = Math.hypot(
      cam.position.x - start.x,
      cam.position.z - start.z
    );
    // Strictly more than one flat cap…
    expect(horiz).toBeGreaterThan(capPerTick * 2);
    // …but still bounded by the scaled budget: the ticks actually applied
    // (6 raw ticks, sustained-scroll boosted per GH-1966/1967) × cap.
    const appliedTicks = zoomBoostTicks(
      0,
      6,
      WHEEL_ZOOM_BOOST_DEADBAND_TICKS,
      WHEEL_ZOOM_BOOST_RAMP_TICKS,
      WHEEL_ZOOM_BOOST_MAX
    );
    expect(horiz).toBeLessThanOrEqual(capPerTick * appliedTicks + 1e-6);
  });
});
