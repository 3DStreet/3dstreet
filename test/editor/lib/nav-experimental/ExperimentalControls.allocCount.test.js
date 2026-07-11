/* Allocation-count ratchet — guards the nav hot paths against per-frame THREE
 * allocation regressions (GC pressure). Its original one-shot job — proving the
 * scratch-vector refactor was a real win (947 down to a fraction) — is done; the
 * standing purpose is to ratchet the most probable regression vector: an added
 * temp of a pooled scratch type on an exercised hot path.
 *
 * Mechanism: the nav modules read `THREE.*` as a LIVE global at call time (they
 * open with `/* global THREE *\/` and import `three` nowhere — this is how
 * A-Frame exposes THREE, and the harness's installThree() relies on it). So we
 * swap `globalThis.THREE` for counting subclasses of the four pooled scratch
 * types (Vector3 / Vector2 / Quaternion / Matrix3) that bump a counter on
 * construction; every other type spreads through as the real ctor. THREE's own
 * internals use their lexical module THREE, never the global, so only nav's
 * constructions are counted — never library or fixture allocations. Restore in
 * `finally` (the harness teardown deliberately never deletes THREE).
 *
 * We ratchet the STEADY-STATE (second-run) count: run the drive script three
 * times on one controls instance and pin run 2's delta. Run 1 absorbs
 * construction AND every first-call lazy init (navMath's closure-private scratch,
 * first-anchor caches, anything future code adds); runs 2 and 3 are pure
 * recurring per-run allocation — exactly the GC-pressure class. Asserting
 * run-3 == run-2 proves the drive script is re-entrant, so run 2 is genuine
 * steady state and not a decaying transient.
 *
 * WHAT THIS COUNTS: recurring `new THREE.Vector3/Vector2/Quaternion/Matrix3()` in
 * nav code over one steady-state run of the five driven paths.
 *
 * WHAT IT DELIBERATELY DOES NOT COUNT (structural — do not "fix" these):
 *   (i)   `.clone()` of live objects (camera.position, hit.point, pose fields).
 *         Uncountable at the THREE prototype without ALSO counting THREE's own
 *         internal clones — e.g. Mesh.raycast returns `point.clone()` of a real
 *         module-internal Vector3 on every hit — which would make the number
 *         three-version- and fixture-coupled and bury the nav signal. A blanket
 *         `.clone()`-prototype patch was tried and rejected for exactly this.
 *   (ii)  hit-conditional / one-time ctors of OTHER THREE types (Box3, Raycaster,
 *         PerspectiveCamera, Plane, Sphere). Their count is FP-hit-count- and
 *         fixture-dependent, so a zero-slack ratchet over them flakes cross-
 *         platform. Wrapping every THREE type was tried and rejected for this.
 *   (iii) coverage: only the FIVE paths the drive script drives are guarded at
 *         all (wheel-swoop, shift-orbit, WASD, compass-rotate, 3x LB pan). This
 *         is NOT "all nav code": e.g. doubleClickNav allocates counted types but
 *         has no drive phase, so a regression there is invisible. A new hot path
 *         must gain a phase here to be guarded — independent of whether it ships
 *         on by default (the script force-sets flags, so flag-gated code is
 *         drivable). Extending the drive script to the undriven allocators (e.g.
 *         doubleClickNav, the compass plan-view/body-click entries, the regime-
 *         transition swoop) is tracked separately.
 *
 * Do NOT combine this file with `it.concurrent` / parallel-in-file execution: the
 * ctor swap mutates the shared `globalThis.THREE` singleton for the it block's
 * duration.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as H from './_harness.js';
import { runAllocRefactorScript } from './_allocRefactorScript.js';

// PRE_BUDGET — total allocations for ONE drive run on the unconverted tree, kept
// as the historical marker of where the scratch-vector refactor started.
const PRE_BUDGET = 947;
// POST_BUDGET — the STEADY-STATE (run-2) delta, pinned to the exact achieved
// count (zero slack) so this is a hard ratchet: a future legitimate allocation on
// the driven paths trips it. Bump deliberately (and note why) when you add one. A
// *drop* also trips the exact-match assertion — intended: it surfaces wins ("did
// you mean to remove an allocation?"). On the current tree run-1 (setup +
// first-call lazy init) is 223 — the number the old single-run budget conflated —
// of which 47 is one-time; the recurring per-run steady state is 176.
const POST_BUDGET = 176;

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
  it('holds the steady-state per-run allocation budget on the hot paths', () => {
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

      // Run 1 absorbs construction + every first-call lazy init.
      runAllocRefactorScript(H, controls, camera, null);
      const afterRun1 = COUNTER.n;
      // Run 2 = steady-state recurring allocation (the ratcheted number).
      runAllocRefactorScript(H, controls, camera, null);
      const run2Delta = COUNTER.n - afterRun1;
      // Run 3 confirms the drive script is re-entrant (run-2 is true steady state).
      const beforeRun3 = COUNTER.n;
      runAllocRefactorScript(H, controls, camera, null);
      const run3Delta = COUNTER.n - beforeRun3;

      // Visible in the vitest output so the achieved number can be read + pinned.
      console.log(
        `[allocCount] run1(setup+lazy)=${afterRun1} run2Δ=${run2Delta} run3Δ=${run3Delta} ` +
          `(PRE_BUDGET ${PRE_BUDGET}, POST_BUDGET ${POST_BUDGET})`
      );

      // Steady state must be stable: run 2 == run 3 (drive script re-entrant).
      expect(run3Delta).toBe(run2Delta);
      // Hard ratchet on the steady-state per-run allocation (exact, zero slack).
      expect(run2Delta).toBe(POST_BUDGET);
      expect(run2Delta).toBeGreaterThan(0);
    } finally {
      globalThis.THREE = saved;
    }
  });
});
