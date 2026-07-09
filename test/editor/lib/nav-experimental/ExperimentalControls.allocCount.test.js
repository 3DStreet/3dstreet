/* Allocation-count harness — proves the scratch-vector refactor is a real GC
 * win, as a committed number rather than a vibe.
 *
 * Mechanism: the nav modules read `THREE.*` as a LIVE global at call time (they
 * open with `/* global THREE *\/` and import `three` nowhere — this is how
 * A-Frame exposes THREE, and the harness's installThree() relies on it). So we
 * swap `globalThis.THREE` for a counting proxy that wraps ONLY the four pooled
 * types (Vector3 / Vector2 / Quaternion / Matrix3) in subclasses that bump a
 * counter on construction, spread over the real module for everything else
 * (Raycaster / Mesh / Plane / PerspectiveCamera / Box3 stay real, or the
 * fixtures + raycasts break). We build the controls AFTER the swap so ctor +
 * per-frame allocations route through the counters, run the shared drive
 * script, read the count, and restore `globalThis.THREE` in `finally` (the
 * harness teardown deliberately never deletes THREE).
 *
 * Module-scope scratch (`_WORLD_UP`, `_tiltFwd`, `_worldHitNormalMat3`, …)
 * allocates ONCE at SUT import, before this swap, so it is never counted — by
 * design: a former per-call `new` that becomes a module scratch simply drops
 * out of the counted total, which is exactly the win we want to measure.
 *
 * PRE_BUDGET was captured on the unconverted tree. POST_BUDGET is tightened to
 * the achieved count once the conversions land; the assertion pins that the
 * count never regresses above it.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as H from './_harness.js';
import { runAllocRefactorScript } from './_allocRefactorScript.js';

// Allocation budgets for one full run of the shared drive script.
//   PRE_BUDGET  — measured on the unconverted tree (baseline commit).
//   POST_BUDGET — the ceiling the assertion enforces. Equal to PRE on the
//                 baseline commit; tightened to the achieved count after the
//                 conversions land.
const PRE_BUDGET = 947;
// Set to the exact achieved count (zero slack), so this is a hard ratchet: a
// future legitimate allocation on these paths will trip it. That is intended —
// bump this deliberately (and note why) if you add one.
const POST_BUDGET = 174;

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

describe('scratch-vector refactor — allocation count', () => {
  it('constructs + drives the hot paths within the allocation budget', () => {
    const RealTHREE = globalThis.THREE;
    const COUNTER = { n: 0 };

    class CountingVector3 extends RealTHREE.Vector3 {
      constructor(...a) {
        super(...a);
        COUNTER.n++;
      }
    }
    class CountingVector2 extends RealTHREE.Vector2 {
      constructor(...a) {
        super(...a);
        COUNTER.n++;
      }
    }
    class CountingQuaternion extends RealTHREE.Quaternion {
      constructor(...a) {
        super(...a);
        COUNTER.n++;
      }
    }
    class CountingMatrix3 extends RealTHREE.Matrix3 {
      constructor(...a) {
        super(...a);
        COUNTER.n++;
      }
    }

    const saved = globalThis.THREE;
    try {
      // Fresh mutable object: the ESM namespace is frozen, so spread it and
      // override only the four pooled types.
      globalThis.THREE = {
        ...RealTHREE,
        Vector3: CountingVector3,
        Vector2: CountingVector2,
        Quaternion: CountingQuaternion,
        Matrix3: CountingMatrix3
      };

      // Fixtures use the real module THREE (harness imports it directly), so
      // scene + camera construction is not counted.
      const scene = H.representativeScene();
      const camera = H.makePerspectiveCam({
        pos: [0, 120, 20],
        lookAt: [0, 52, -40]
      });
      const controls = H.makeControls({
        camera,
        dom: H.makeDomElement(),
        scene,
        wasd: true,
        streetLevel: true
      });

      runAllocRefactorScript(H, controls, camera, null);

      // Visible in the vitest run output so the achieved number can be read
      // and POST_BUDGET tightened after the conversions land.
      console.log(
        `[allocCount] THREE allocations over the drive script: ${COUNTER.n} (PRE_BUDGET ${PRE_BUDGET}, POST_BUDGET ${POST_BUDGET})`
      );

      expect(COUNTER.n).toBeLessThanOrEqual(POST_BUDGET);
      expect(COUNTER.n).toBeGreaterThan(0);
    } finally {
      globalThis.THREE = saved;
    }
  });
});
