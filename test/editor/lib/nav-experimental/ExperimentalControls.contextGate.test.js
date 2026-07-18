// Default-tier gate: with street-level nav OFF (the default build), the whole
// context-action system is inert — the resolver answers 'none' from every
// pose (street-level, elevated, even enclosed), Space/trigger is a no-op,
// and no recovery cue is emitted (a cue would advertise a dead Space key).
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

describe('context action — street-level mode off (default tier)', () => {
  it("resolves 'none' at street level (the pose that used to leak 'drone')", () => {
    const scene = H.representativeScene(); // ground y=12
    // Eye-height above the ground plane, looking level — street-level pose.
    const cam = H.makePerspectiveCam({
      pos: [0, 13.5, 20],
      lookAt: [0, 13.5, 40]
    });
    const c = H.makeControls({ camera: cam, scene, streetLevel: false });
    H.tickAll(c, 16, 1); // refresh the context snapshot
    const action = c.resolveContextAction();
    expect(action.kind).toBe('none');
    expect(action.enabled).toBe(false);
  });

  it("resolves 'none' before the first snapshot refresh (load-time frames)", () => {
    const scene = H.representativeScene();
    const cam = H.makePerspectiveCam({
      pos: [0, 13.5, 20],
      lookAt: [0, 13.5, 40]
    });
    const c = H.makeControls({ camera: cam, scene, streetLevel: false });
    // No tick: the sensor still holds its constructor-default snapshot and the
    // busy-hold seed. The gate must answer 'none' regardless.
    expect(c.resolveContextAction().kind).toBe('none');
  });

  it("resolves 'none' even when enclosed, and Space/trigger moves nothing", () => {
    const scene = H.representativeScene(); // building [12,52] at (0,-40), 30×30
    const cam = H.makePerspectiveCam({
      pos: [0, 30, -40],
      lookAt: [10, 28, -30]
    });
    const c = H.makeControls({ camera: cam, scene, streetLevel: false });
    const cue = H.onEvent(c, 'nav-experimental:recovery-cue');
    H.tickAll(c, 16, 1);
    const action = c.resolveContextAction();
    expect(action.kind).toBe('none');
    expect(action.enabled).toBe(false);

    // The shared dispatch (button click and Space both funnel here) no-ops.
    const before = cam.position.clone();
    c.triggerContextAction();
    for (let i = 0; i < 60; i++) H.tickAll(c, 16);
    expect(cam.position.distanceTo(before)).toBeCloseTo(0, 6);

    // No recovery cue fired for the enclosed pose with the flag off.
    expect(cue.events.filter((e) => e.kind != null)).toHaveLength(0);
  });
});
