// Regression (GH-1865): wheel zoom-out must escape a near-zero anchor
// distance. Focusing (double-click / F) an entity with no measurable
// geometry — e.g. a geojson data layer whose bbox is empty — flies the
// camera to ~0.25 m from the entity origin. The dolly step is multiplicative
// in the camera→anchor distance, so without the TH-79 escape floor a
// zoom-out tick moved ~1 cm and the wheel read as dead (the ActionBar
// zoom-out button and Plan View were the only ways out). Legacy
// EditorControls always allowed ≥ minSpeedFactor × zoomSpeed = 0.8 m/detent.
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

describe('wheel zoom-out — near-anchor escape floor (GH-1865)', () => {
  it('one zoom-out tick from ~1.7 m off the anchor moves ≥ 0.5 m (not 5% of 1.7 m)', () => {
    const scene = H.groundPlaneScene({ y: 0 });
    // The post-focus pose class: camera nearly on top of its anchor (the
    // ground point under the cursor), steep down-look → 'high' regime dolly.
    const cam = H.makePerspectiveCam({ pos: [0, 1.6, 0.5], lookAt: [0, 0, 0] });
    const c = H.makeControls({ camera: cam, scene });
    const start = cam.position.clone();

    H.wheel(c, { dy: +100 }); // one zoom-out detent
    H.tickInput(c, 16);

    const moved = cam.position.distanceTo(start);
    // Pre-fix: 5% of the ~1.7 m anchor distance ≈ 0.08 m. Post-fix the step
    // is sized for a ≥16 m anchor: ~0.84 m (bounded above by the lurch cap).
    expect(moved).toBeGreaterThan(0.5);
    // Zoom-out moves AWAY from the anchor — up and back, never down.
    expect(cam.position.y).toBeGreaterThan(start.y);
  });

  it('sustained zoom-out escapes to a normal working distance', () => {
    const scene = H.groundPlaneScene({ y: 0 });
    const cam = H.makePerspectiveCam({ pos: [0, 1.6, 0.5], lookAt: [0, 0, 0] });
    const c = H.makeControls({ camera: cam, scene });

    // 25 frames × 1 detent. Pre-fix this compounds 1.7 m × 1.0526^25 ≈ 6 m
    // — still trapped near the origin. With the floor it clears 16 m and
    // resumes the normal multiplicative zoom-out.
    for (let i = 0; i < 25; i++) {
      H.wheel(c, { dy: +100 });
      H.tickInput(c, 16);
    }
    expect(cam.position.length()).toBeGreaterThan(16);
  });

  it('zoom-IN close to the anchor keeps the asymptotic approach (no floor)', () => {
    const scene = H.groundPlaneScene({ y: 0 });
    const cam = H.makePerspectiveCam({ pos: [0, 1.6, 0.5], lookAt: [0, 0, 0] });
    const c = H.makeControls({ camera: cam, scene });
    const start = cam.position.clone();

    H.wheel(c, { dy: -100 }); // one zoom-in detent
    H.tickInput(c, 16);

    // A single in-tick from ~1.7 m must stay a ~5% step — the escape floor
    // applies to zoom-out only.
    expect(cam.position.distanceTo(start)).toBeLessThan(0.2);
  });
});

describe('focus on an empty-bbox target — usable standoff (GH-1865)', () => {
  it('frames the entity origin from ~25 m, not 0.25 m', () => {
    // The root anomaly behind #1865: an entity with no measurable geometry
    // (geojson data layer, light) focused with distance 0.1 parked the
    // camera 0.25 m from the origin — and over a collision floor that pose
    // lands in the swoop's Phase-3 FOV regime, where zoom-out visibly does
    // nothing for several detents.
    const scene = H.groundPlaneScene({ y: 0 });
    const cam = H.makePerspectiveCam({ pos: [0, 50, 80], lookAt: [0, 0, 0] });
    const c = H.makeControls({ camera: cam, scene });
    // Minimal focus-animation stub (the harness scene has no A-Frame
    // component host; focus() only writes these fields).
    c._focusAnimation = {
      transitionCamPosStart: new H.THREE.Vector3(),
      transitionCamQuaternionStart: new H.THREE.Quaternion(),
      transitionCamPosEnd: new H.THREE.Vector3(),
      transitionCamQuaternionEnd: new H.THREE.Quaternion(),
      transitionProgress: 0,
      transitioning: false
    };

    const target = new H.THREE.Group(); // empty bounding box, at 0,0,0
    target.updateMatrixWorld(true);
    c.focus(target);

    expect(c._focusAnimation.transitioning).toBe(true);
    const end = c._focusAnimation.transitionCamPosEnd;
    // Standard framing offset (0, d·0.5, d·2.5) at d = 10 → (0, 5, 25).
    expect(end.x).toBeCloseTo(0, 6);
    expect(end.y).toBeCloseTo(5, 6);
    expect(end.z).toBeCloseTo(25, 6);
    // Center tracks the focused origin.
    expect(c.center.length()).toBeCloseTo(0, 6);
  });
});
