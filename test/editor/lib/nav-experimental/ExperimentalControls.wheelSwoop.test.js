// Characterization: the wheel swoop engine (swoop-in, wheel-out reverse,
// ctrl-bypass). Behaviour pinned as-observed. Frozen surface only: camera
// position / tilt / fov.
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

describe('wheel swoop — birds-eye → street over a building (Tier 2)', () => {
  it('descends monotonically, lands on the roof (not the footprint), tilts to horizontal', () => {
    const scene = H.representativeScene(); // ground y=12, building roof y=52
    const cam = H.makePerspectiveCam({ pos: [0, 92, -10], lookAt: [0, 52, -40] });
    const c = H.makeControls({ camera: cam, scene, streetLevel: true });

    // Real-surface gate: the swoop must probe a REAL surface, not the
    // miss/cache path (else the descent characterises the fallback).
    expect(H.floorBelow(c, cam).source).not.toBe('cache');

    const startTilt = H.tilt(cam);
    expect(startTilt).toBeGreaterThan(25); // Map regime at entry

    // Phase 1 (AGL > 20): tilt is held while the anchored dolly descends.
    let prevY = cam.position.y;
    let phase1Tilt = null;
    for (let i = 0; i < 12; i++) {
      H.wheel(c, { dy: -100 });
      H.tickInput(c, 16);
      expect(cam.position.y).toBeLessThanOrEqual(prevY + 1e-6); // monotone descent
      prevY = cam.position.y;
      if (H.aglBelow(c, cam) > 22) phase1Tilt = H.tilt(cam);
    }
    // Tilt unchanged through Phase 1 (cursor-anchored dolly, no swoop).
    if (phase1Tilt != null) expect(phase1Tilt).toBeCloseTo(startTilt, 1);

    // Drive the rest of the descent to the floor.
    for (let i = 0; i < 200; i++) {
      H.wheel(c, { dy: -100 });
      H.tickInput(c, 16);
      expect(cam.position.y).toBeLessThanOrEqual(prevY + 1e-6);
      prevY = cam.position.y;
    }

    const floor = H.floorBelow(c, cam);
    // Landed one eye-margin above the ROOF (52), not the ground (12).
    expect(floor.y).toBeCloseTo(52, 0);
    expect(cam.position.y).toBeCloseTo(52 + 1.5, 1); // roofY + EYE_MARGIN (TH-46)
    // Tilt eased to horizontal in the transition.
    expect(Math.abs(H.tilt(cam))).toBeLessThan(1);
    // Phase-3 zoom bottoms out at the FOV floor (TH-27). KNOWN-ROUGH: OI-9.
    expect(cam.fov).toBeCloseTo(15, 1);
  });
});

describe('wheel swoop — reverse from a mid-swoop excursion (Tier 2)', () => {
  it('zoom-out returns toward the tilt it dove from', () => {
    const scene = H.representativeScene();
    const cam = H.makePerspectiveCam({ pos: [0, 92, -10], lookAt: [0, 52, -40] });
    const c = H.makeControls({ camera: cam, scene, streetLevel: true });

    // Real-surface gate: the reverse path must probe a real surface too.
    expect(H.floorBelow(c, cam).source).not.toBe('cache');
    const entryTilt = H.tilt(cam); // ~53°

    // Dive into the transition band.
    H.driveSwoopIn(c, cam, 8);
    expect(H.tilt(cam)).toBeLessThan(entryTilt - 10); // genuinely transitioned

    // Reverse (zoom out) and confirm it climbs back toward the entry tilt.
    H.driveSwoopOut(c, 40);
    expect(H.tilt(cam)).toBeCloseTo(entryTilt, 0); // returns toward dove-from tilt
    expect(H.aglBelow(c, cam)).toBeGreaterThan(20); // ascended back out of the band
  });
});

describe('wheel swoop — ctrl-bypass is a fixed-tilt plain dolly (Tier 1.5, flat ground)', () => {
  it('holds tilt and fov constant while the camera dollies in', () => {
    const scene = H.groundPlaneScene({ y: 0 });
    const cam = H.makePerspectiveCam({ pos: [0, 60, 30], lookAt: [0, 0, 0] });
    const c = H.makeControls({ camera: cam, scene, streetLevel: true });
    const startTilt = H.tilt(cam);
    const startFov = cam.fov;
    const startY = cam.position.y;

    for (let i = 0; i < 8; i++) {
      H.wheel(c, { dy: -100, ctrl: true });
      H.tickInput(c, 16);
    }

    expect(H.tilt(cam)).toBeCloseTo(startTilt, 3); // no phase machinery — tilt fixed
    expect(cam.fov).toBeCloseTo(startFov, 5); // no FOV zoom
    expect(cam.position.y).toBeLessThan(startY); // dollied inward/down along the ray
  });
});
