// Characterization: recovery machinery (enclosure → context/Space recovery;
// recovery-cue wake-condition during motion). Frozen surface: camera position
// + the recovery-cue event.
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

describe('recovery — enclosure → context recovery (Tier 2, inside-solid)', () => {
  it('nothing moves on its own; a context action eases the camera out of the solid', () => {
    const scene = H.representativeScene(); // building [12,52] at (0,-40), 30×30
    const cam = H.makePerspectiveCam({ pos: [0, 30, -40], lookAt: [10, 28, -30] });
    const c = H.makeControls({ camera: cam, scene, streetLevel: true, wasd: true });
    expect(H.floorBelow(c, cam).source).not.toBe('cache'); // real surface, not the miss/cache path

    // Refresh the context snapshot (resolveContextAction is a pure read of it),
    // then confirm the enclosure via the RESOLVER'S answer (an observable):
    // 'daylight' is the action offered only from inside a solid.
    H.tickAll(c, 16, 1);
    const action = c.resolveContextAction();
    expect(action.kind).toBe('daylight');
    expect(action.enabled).toBe(true);

    // The governing invariant: idle frames add no unrequested camera motion.
    const before = cam.position.clone();
    H.tickAll(c, 16, 4);
    expect(cam.position.distanceTo(before)).toBeCloseTo(0, 6);

    // Trigger the context action and drive the tween to completion.
    c.triggerContextAction();
    for (let i = 0; i < 60; i++) H.tickAll(c, 16);
    // Exited the solid: settled one eye-margin above the roof (52) — the
    // observable that recovery ran to completion.
    expect(cam.position.y).toBeGreaterThanOrEqual(52);
    expect(cam.position.y).toBeCloseTo(52 + 1.5, 1);
  });
});

describe('recovery — cue wakes during motion, not just on the first frame (Tier 2)', () => {
  it('the recovery cue fires as WASD flight crosses the show-threshold mid-run', () => {
    const scene = H.representativeScene(); // ground y=12, building roof y=52
    // Start GROUNDED on the building roof at low AGL (~1.5 m, below the
    // hide-threshold of 6 m) so the cue is hidden at rest. Face along +Z so
    // WASD-forward flies OFF the near roof edge (z=-25) out over the ground,
    // where AGL jumps past the show-threshold (8 m) — the cue must fire from
    // that motion, at a tick > 1, not from a first-frame evaluation.
    const cam = H.makePerspectiveCam({ pos: [0, 53.5, -40], lookAt: [0, 53.5, 0] });
    const c = H.makeControls({ camera: cam, scene, wasd: true, streetLevel: true });
    const cue = H.onEvent(c, 'nav-experimental:recovery-cue');
    c._deriveGroundedFromPose(); // grounded on the roof

    H.keyDown(c, 'KeyW');
    let firstDropTick = -1;
    for (let i = 1; i <= 300; i++) {
      H.tickInput(c, 16);
      if (firstDropTick < 0 && cue.events.some((e) => e.kind === 'drop')) {
        firstDropTick = i;
        break;
      }
    }

    // The 'drop' cue fired, and it fired from motion crossing the threshold —
    // a tick AFTER the first frame (a first-tick fire would be the tautology).
    expect(firstDropTick).toBeGreaterThan(1);
  });
});
