/* Golden-trajectory guard for the per-frame scratch-vector refactor.
 *
 * Drives a deterministic five-path scripted sequence (wheel-swoop, shift-orbit,
 * WASD-hold, compass-arrow orbit, and LB truck / pedestal / screen pan) through
 * the real controls and snapshots the captured camera-pose trajectory. The
 * refactor reuses scratch vectors on these hot paths WITHOUT changing the math,
 * so the trajectory must reproduce the committed snapshot byte-for-byte. Any
 * aliasing corruption of a retained pose surfaces here as a divergence.
 *
 * LIMITATION: this covers only the scripted scenarios. An aliasing bug on a
 * path the script never reaches escapes it — the primary guarantee is the
 * aliasing-immune design of the conversions themselves (scratch that is either
 * a pure-local temp fully consumed in one call, a frozen read-only const, or an
 * optional out-param owned by the caller). This snapshot is the automated
 * backstop, not the sole proof.
 *
 * GUARD: the snapshot was generated on the UNCONVERTED tree and committed
 * before any conversion. NEVER regenerate it with `vitest -u` / `--update`
 * during this refactor — that would silently absorb a corruption and defeat the
 * whole check. If it legitimately needs to change, that is a behaviour change
 * and must be reviewed as one.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as H from './_harness.js';
import { runAllocRefactorScript } from './_allocRefactorScript.js';

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

// Round to a fixed precision so ULP jitter never flaps the snapshot while a
// gross aliasing corruption (which would be far larger than 1e-6) still shows.
function r(v) {
  return Number(v.toFixed(6));
}

describe('scratch-vector refactor — golden trajectory (behaviour unchanged)', () => {
  it('reproduces the committed camera-pose trajectory across all five paths', () => {
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

    const trajectory = [];
    runAllocRefactorScript(H, controls, camera, (cam) => {
      trajectory.push([
        r(cam.position.x),
        r(cam.position.y),
        r(cam.position.z),
        r(cam.quaternion.x),
        r(cam.quaternion.y),
        r(cam.quaternion.z),
        r(cam.quaternion.w),
        r(cam.fov)
      ]);
    });

    // Sanity: the script actually produced a non-trivial trajectory.
    expect(trajectory.length).toBeGreaterThan(100);
    expect(trajectory).toMatchSnapshot();
  });
});
