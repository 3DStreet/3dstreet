// Break-it check (KD-4b) for the WE13b recovery-cue wake-condition proxy.
// Disablement target (PLAN §2 table): force the situation-sensor idle gate to
// always skip (_updateLegitSnapshotAndCue no-op) so the cue goes stale during
// motion. The proxy — "the recovery cue fires during WASD motion" — must red.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as H from './_harness.js';

let Controls;
beforeAll(async () => {
  Controls = await H.loadControls();
  H.useControlsClass(Controls);
});
beforeEach(() => H.stubClock());
afterEach(() => H.teardownAll());

// Returns the number of recovery-cue events emitted while flying at high AGL
// under WASD motion. `disableWake` makes the situation sensor a no-op.
function cueCountDuringMotion({ disableWake }) {
  const scene = H.representativeScene();
  const cam = H.makePerspectiveCam({ pos: [0, 200, 100], lookAt: [0, 200, -40] });
  const c = H.makeControls({ camera: cam, scene, wasd: true, streetLevel: true });
  const cue = H.onEvent(c, 'nav-experimental:recovery-cue');
  c._deriveGroundedFromPose();
  H.keyDown(c, 'KeyW');
  const drive = () => {
    for (let i = 0; i < 10; i++) H.step(c, 16);
  };
  if (disableWake) H.withInvariantDisabled(c, 'idleGateWake', drive);
  else drive();
  return cue.count;
}

describe('break-it — WE13b wake-condition proxy reds when the situation sensor is disabled', () => {
  it('the proxy PASSES with the sensor live (cue fires during motion)', () => {
    expect(cueCountDuringMotion({ disableWake: false })).toBeGreaterThan(0);
  });

  it('the proxy FAILS with the situation sensor disabled (cue goes stale)', () => {
    const failed = H.assertionFails(() => {
      expect(cueCountDuringMotion({ disableWake: true })).toBeGreaterThan(0);
    });
    expect(failed).toBe(true);
  });
});
