// Characterization: WASD flight (forward flight at altitude over a building
// edge, street-level flat off-axis yaw). Frozen surface: camera position.
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

describe('WASD — forward flight at altitude over a building edge (Tier 2)', () => {
  it('holds absolute height flying above the roof (no ground-snap, no ratchet-up)', () => {
    const scene = H.representativeScene(); // building roof y=52
    const cam = H.makePerspectiveCam({ pos: [0, 70, 20], lookAt: [0, 70, -40] });
    const c = H.makeControls({ camera: cam, scene, wasd: true, streetLevel: true });
    c._deriveGroundedFromPose(); // settle grounded from the (flying) pose

    H.keyDown(c, 'KeyW');
    for (let i = 0; i < 40; i++) {
      H.tickInput(c, 16);
      // Absolute-height hold across the edge is the observable of "flying":
      // a ground-snap or ratchet-up would move y off 70.
      expect(cam.position.y).toBeCloseTo(70, 3);
    }
    expect(cam.position.z).toBeLessThan(20); // made forward progress
  });

  it('forward collision blocks at a taller obstacle (stops before the wall)', () => {
    const scene = H.representativeScene(); // building near face at z=-25, height [12,52]
    const cam = H.makePerspectiveCam({ pos: [0, 40, -10], lookAt: [0, 40, -40] });
    const c = H.makeControls({ camera: cam, scene, wasd: true, streetLevel: true });
    c._deriveGroundedFromPose();

    H.keyDown(c, 'KeyW');
    for (let i = 0; i < 200; i++) {
      H.tickInput(c, 16);
      expect(cam.position.y).toBeCloseTo(40, 3); // altitude still held
    }
    // Halted at the wall standoff — never penetrates the footprint (z > -25).
    expect(cam.position.z).toBeGreaterThan(-25);
    expect(cam.position.z).toBeLessThan(-23); // and got right up to it
  });
});

describe('WASD — street-level flat ground, non-axis-aligned yaw (Tier 1.5)', () => {
  it('moves along the camera heading, ramps over dt, snaps to zero on release', () => {
    const scene = H.groundPlaneScene({ y: 0 });
    const yawRad = (35 * Math.PI) / 180;
    const cam = H.makePerspectiveCam({
      pos: [0, 1.6, 0],
      lookAt: [Math.sin(yawRad), 1.6, -Math.cos(yawRad)]
    });
    const c = H.makeControls({ camera: cam, scene, wasd: true, streetLevel: true });

    H.keyDown(c, 'KeyW');
    const p0 = cam.position.clone();
    H.tickInput(c, 16);
    const d1 = cam.position.distanceTo(p0);
    for (let i = 0; i < 20; i++) H.tickInput(c, 16);
    const pMid = cam.position.clone();
    H.tickInput(c, 16);
    const dLate = cam.position.distanceTo(pMid);
    // At street level the speed pins to the MIN_SPEED floor (TH-38 = 10 m/s):
    // 10 m/s × 16 ms ≈ 0.16 m/frame, reached immediately and held steady (the
    // ramp is not separately observable at the floor — pinned as-observed).
    expect(d1).toBeCloseTo(0.16, 2);
    expect(dLate).toBeCloseTo(d1, 3); // steady

    // Motion is along the heading (x and z both move; ratio ≈ tan(yaw)).
    const dx = cam.position.x - p0.x;
    const dz = cam.position.z - p0.z;
    expect(Math.abs(dx)).toBeGreaterThan(0.01);
    expect(Math.abs(dz)).toBeGreaterThan(0.01);
    expect(Math.abs(dx / -dz)).toBeCloseTo(Math.tan(yawRad), 2);
    expect(cam.position.y).toBeCloseTo(1.6, 5); // horizontal plane, y untouched

    // Release snaps velocity to zero — the next frame produces no motion.
    H.keyUp(c, 'KeyW');
    const pRel = cam.position.clone();
    H.tickInput(c, 16);
    expect(cam.position.distanceTo(pRel)).toBeCloseTo(0, 6);
  });
});
