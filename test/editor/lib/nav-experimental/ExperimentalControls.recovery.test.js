// Characterization: recovery machinery (WE8 enclosure → context/Space
// recovery, WE13b recovery-cue wake-condition during motion). Frozen surface:
// camera position + the recovery-cue event (KD-4a).
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as H from './_harness.js';

let Controls;
beforeAll(async () => {
  Controls = await H.loadControls();
  H.useControlsClass(Controls);
});
beforeEach(() => H.stubClock());
afterEach(() => H.teardownAll());

describe('recovery — WE8 enclosure → context recovery (Tier 2, inside-solid)', () => {
  it('nothing moves on its own; a context action eases the camera out of the solid', () => {
    const scene = H.representativeScene(); // building [12,52] at (0,-40), 30×30
    const cam = H.makePerspectiveCam({ pos: [0, 30, -40], lookAt: [10, 28, -30] });
    const c = H.makeControls({ camera: cam, scene, streetLevel: true, wasd: true });

    // Refresh the context snapshot (WE8 review M3: resolveContextAction is a
    // pure read of the snapshot) and confirm the fixture reads as enclosed.
    H.run(c, 16, 1);
    expect(c._contextSnapshot.enclosed).toBe(true); // fixture confirmed enclosed
    const action = c.resolveContextAction();
    expect(action.kind).toBe('daylight');
    expect(action.enabled).toBe(true);

    // The governing invariant: idle frames add no unrequested camera motion.
    const before = cam.position.clone();
    H.run(c, 16, 4);
    expect(cam.position.distanceTo(before)).toBeCloseTo(0, 6);

    // Trigger the context action and drive the tween to completion.
    c.triggerContextAction();
    for (let i = 0; i < 60; i++) H.run(c, 16);
    expect(c._recoveryActive).toBe(false);
    // Exited the solid: at/above the roof (52) + eye margin.
    expect(cam.position.y).toBeGreaterThanOrEqual(52);
    expect(cam.position.y).toBeCloseTo(52 + 1.5, 1);
  });
});

describe('recovery — WE13b recovery-cue wake-condition (Tier 2)', () => {
  it('the recovery cue fires during WASD motion (the situation sensor stays fresh)', () => {
    const scene = H.representativeScene(); // ground y=12
    // Flying at high AGL (~188 m over the ground) — cue-worthy territory.
    const cam = H.makePerspectiveCam({ pos: [0, 200, 100], lookAt: [0, 200, -40] });
    const c = H.makeControls({ camera: cam, scene, wasd: true, streetLevel: true });
    const cue = H.onEvent(c, 'nav-experimental:recovery-cue');
    c._deriveGroundedFromPose();

    H.keyDown(c, 'KeyW');
    for (let i = 0; i < 10; i++) H.step(c, 16);

    // The 'drop' cue fired during motion (not stale).
    expect(cue.count).toBeGreaterThan(0);
    expect(cue.events.some((e) => e.kind === 'drop')).toBe(true);
  });
});
