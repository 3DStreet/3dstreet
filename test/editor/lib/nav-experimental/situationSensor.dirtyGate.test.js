// SituationSensor idle-gate timing (#1853): geometry-dirty signals arrive in
// bursts while a map layer streams tiles in (one `object3dset` per merged
// tile mesh). The dirty arm of the idle gate is rate-limited so a burst
// costs at most one whole-scene raycast per 250 ms around a motionless
// camera, and the no-signal fallback re-probes at 1 Hz — not per frame.
// Motion/gesture evaluation is unaffected (separate `moved`/`busy` arms).
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi
} from 'vitest';
import * as H from './_harness.js';

let Controls;
beforeAll(async () => {
  Controls = await H.loadControls();
  H.useControlsClass(Controls);
});

// An advanceable clock on top of the harness stub (the harness freezes time;
// these tests must cross the rate-limit windows). teardownAll restores the
// real clock afterwards.
let t;
beforeEach(() => {
  H.stubClock();
  t = 1000;
  performance.now = () => t;
  Date.now = () => t;
  H.clearSceneGlobals();
});
afterEach(() => H.teardownAll());

describe('situation sensor — geometry-dirty rate limit', () => {
  function settledControls() {
    const scene = H.groundPlaneScene();
    const cam = H.makePerspectiveCam(); // static; no gesture ⇒ not busy
    const c = H.makeControls({ camera: cam, scene });
    H.tickInput(c); // first eval (no cache yet ⇒ `moved` arm) seeds the gate
    return c;
  }

  it('a dirty burst around a motionless camera costs ONE eval per window', () => {
    const c = settledControls();
    const probes = vi.spyOn(c._sensor, 'enclosureProbe');

    // Motionless + clean: no evals at all.
    H.tickInput(c, 16, 5);
    expect(probes).not.toHaveBeenCalled();

    // Streaming burst: dirty marked every frame, all inside the 250 ms
    // window since the seed eval — still no probes.
    for (let i = 0; i < 5; i++) {
      c._sensor.markGeometryDirty();
      H.tickInput(c, 16, 1);
    }
    expect(probes).not.toHaveBeenCalled();

    // Window elapses: the whole burst collapses into exactly one eval.
    t += 300;
    H.tickInput(c, 16, 5);
    expect(probes).toHaveBeenCalledTimes(1);
  });

  it('the no-signal fallback re-probes at 1 Hz, not 4 Hz', () => {
    const c = settledControls();
    const probes = vi.spyOn(c._sensor, 'enclosureProbe');

    t += 500; // 500 ms since the seed eval — under the 1000 ms fallback
    H.tickInput(c, 16, 3);
    expect(probes).not.toHaveBeenCalled();

    t += 600; // 1100 ms since the seed eval — fallback due
    H.tickInput(c, 16, 3);
    expect(probes).toHaveBeenCalledTimes(1);
  });

  it('a dirty signal after the window evaluates promptly (fresh-cue path)', () => {
    const c = settledControls();
    const probes = vi.spyOn(c._sensor, 'enclosureProbe');

    t += 300; // past the 250 ms dirty window, well under the 1 s fallback
    c._sensor.markGeometryDirty();
    H.tickInput(c, 16, 1);
    expect(probes).toHaveBeenCalledTimes(1);
  });
});
