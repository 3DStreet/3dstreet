// Break-it check for the recovery-cue wake-condition proxy. Disablement
// target: let the situation sensor evaluate ONCE then go stale (skip every
// subsequent evaluation) — modelling "the sensor stops re-probing during
// motion". The proxy — "the cue fires as flight crosses the show-threshold at
// a tick > 1" — must red, because the stale sensor never re-evaluates as AGL
// climbs.
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

// Fly off the roof edge under WASD and return the first tick (>0) at which a
// 'drop' cue fired, or -1 if none fired. `disableWake` makes the sensor stale
// after its first evaluation.
function firstDropTickDuringMotion({ disableWake }) {
  const scene = H.representativeScene();
  const cam = H.makePerspectiveCam({
    pos: [0, 53.5, -40],
    lookAt: [0, 53.5, 0]
  });
  const c = H.makeControls({
    camera: cam,
    scene,
    wasd: true,
    streetLevel: true
  });
  const cue = H.onEvent(c, 'nav-experimental:recovery-cue');
  c._deriveGroundedFromPose(); // grounded on the roof
  H.keyDown(c, 'KeyW');

  let firstDropTick = -1;
  const drive = () => {
    for (let i = 1; i <= 300; i++) {
      H.tickInput(c, 16);
      if (firstDropTick < 0 && cue.events.some((e) => e.kind === 'drop')) {
        firstDropTick = i;
        break;
      }
    }
  };
  if (disableWake) H.withInvariantDisabled(c, 'idleGateStale', drive);
  else drive();
  return firstDropTick;
}

describe('break-it — recovery-cue wake proxy reds when the sensor goes stale mid-motion', () => {
  it('the proxy PASSES with the sensor live (cue fires at a tick > 1)', () => {
    expect(firstDropTickDuringMotion({ disableWake: false })).toBeGreaterThan(
      1
    );
  });

  it('the proxy FAILS with the sensor stale after the first tick (cue never fires)', () => {
    const failed = H.assertionFails(() => {
      expect(firstDropTickDuringMotion({ disableWake: true })).toBeGreaterThan(
        1
      );
    });
    expect(failed).toBe(true);
  });
});
