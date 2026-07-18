// Characterization: the letterbox indicator (pan-truck / pan-pedestal /
// pan-screen) is driven by the camera-write funnel (TASK-037 Q4). Every camera
// write resolves the sub-mode — exact T for real-time writes and settles,
// hysteresis (δ) only for a committed-motion-runner tween — so the indicator
// tracks tilt live and is never stale after a programmatic motion. Frozen
// surface: the `nav-experimental:modechange` sub-mode stream + getCurrentLbMode().
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

// The letterbox sub-modes carried on the modechange stream (the coarse
// pan/rotate/null values share the channel; filter to the LB set).
const LB = new Set(['pan-truck', 'pan-pedestal', 'pan-screen']);
const lbSeq = (rec) => rec.events.map((e) => e.mode).filter((m) => LB.has(m));

describe('letterbox — funnel-driven resolution (TASK-037 Q4)', () => {
  it('a wheel swoop across T drives the sub-mode Map→Street through the funnel', () => {
    // Birds-eye looking down (tilt > T = Map = pan-truck), street-level enabled.
    const scene = H.representativeScene();
    const cam = H.makePerspectiveCam({
      pos: [0, 92, -10],
      lookAt: [0, 52, -40]
    });
    const c = H.makeControls({ camera: cam, scene, streetLevel: true });
    expect(H.tilt(cam)).toBeGreaterThan(25); // Map regime at entry
    expect(c.getCurrentLbMode()).toBe('pan-truck'); // seeds from the live tilt

    const modes = H.onEvent(c, 'nav-experimental:modechange');
    // Swoop down to street level: tilt eases toward horizontal, crossing T.
    // No hand-placed emit remains in the wheel engine — the drain's terminal
    // commitMove('wheel') resolves the letterbox at exact T once per frame.
    H.driveSwoopIn(c, cam, 1.5);
    for (let i = 0; i < 200; i++) {
      H.wheel(c, { dy: -100 });
      H.tickInput(c, 16);
    }
    expect(Math.abs(H.tilt(cam))).toBeLessThan(25); // Street regime now
    // The funnel emitted the Map→Street sub-mode transition during the swoop.
    expect(lbSeq(modes)).toContain('pan-pedestal');
    expect(c.getCurrentLbMode()).toBe('pan-pedestal');
    modes.stop();
  });

  it('a drone rise resolves the letterbox at settle — no stale-after-tween (Q3+Q4)', () => {
    // Street-level pose (near-horizontal tilt < T = Street = pan-pedestal) from
    // which the context resolver offers a drone RISE. The rise ends at the ~60°
    // overview tilt (> T = Map = pan-truck). Before TASK-037 the rise-to-drone
    // settle SKIPPED the letterbox re-eval (Q3), so the indicator stayed stale
    // until the next interaction; now the settle's funnel.dispatch() resolves it.
    const scene = H.representativeScene();
    const cam = H.makePerspectiveCam({
      pos: [80, 13.5, 80],
      lookAt: [70, 13, 70]
    });
    const c = H.makeControls({
      camera: cam,
      scene,
      streetLevel: true,
      wasd: true
    });
    H.tickAll(c, 16, 1); // refresh the context snapshot
    expect(H.tilt(cam)).toBeLessThan(25); // Street at start
    expect(c.getCurrentLbMode()).toBe('pan-pedestal');
    expect(c.resolveContextAction().kind).toBe('drone');

    const modes = H.onEvent(c, 'nav-experimental:modechange');
    c.triggerContextAction(); // start the drone rise (a committed-motion tween)
    for (let i = 0; i < 120; i++) H.tickAll(c, 16); // run to settle
    expect(H.tilt(cam)).toBeGreaterThan(25); // Map after the rise

    // The letterbox is correct immediately at settle, WITHOUT any further
    // interaction — the stale-after-tween glitch is gone.
    expect(c.getCurrentLbMode()).toBe('pan-truck');
    expect(lbSeq(modes)).toContain('pan-truck');
    modes.stop();
  });

  it('a compass plan-view (non-runner tween) resolves the letterbox at settle', () => {
    // A plan-view is a NON-runner programmatic tween (exact-T per frame, no
    // hysteresis). From a street-level pose (< T = pan-pedestal) it tilts to
    // top-down 90° (> T = pan-truck). Before TASK-037 the compass onDone had an
    // explicit hand-call; now its terminal funnel.dispatch() resolves the
    // letterbox exact-T, so the removed hand-call loses no coverage and the
    // indicator is correct at settle without further interaction.
    const scene = H.representativeScene();
    const cam = H.makePerspectiveCam({
      pos: [80, 13.5, 80],
      lookAt: [70, 13, 70]
    });
    const c = H.makeControls({ camera: cam, scene, streetLevel: true });
    expect(H.tilt(cam)).toBeLessThan(25); // Street at start
    expect(c.getCurrentLbMode()).toBe('pan-pedestal');

    const modes = H.onEvent(c, 'nav-experimental:modechange');
    c.handlePlanViewRequest();
    for (let i = 0; i < 120; i++) H.tickAll(c, 16); // run to settle
    expect(H.tilt(cam)).toBeCloseTo(90, 0); // top-down after plan-view

    expect(c.getCurrentLbMode()).toBe('pan-truck');
    expect(lbSeq(modes)).toContain('pan-truck');
    modes.stop();
  });

  it('street-level OFF keeps the sub-mode pinned to pan-screen (Stage-1 short-circuit)', () => {
    // With street-level disabled the comparator short-circuits: every write
    // resolves to pan-screen regardless of tilt — no Map/Street split.
    const scene = H.representativeScene();
    const cam = H.makePerspectiveCam({
      pos: [0, 92, -10],
      lookAt: [0, 52, -40]
    });
    const c = H.makeControls({ camera: cam, scene, streetLevel: false });
    expect(c.getCurrentLbMode()).toBe('pan-screen');

    const modes = H.onEvent(c, 'nav-experimental:modechange');
    for (let i = 0; i < 40; i++) {
      H.wheel(c, { dy: -100 });
      H.tickInput(c, 16);
    }
    // No truck/pedestal transitions ever emit while street-level is off.
    expect(lbSeq(modes).every((m) => m === 'pan-screen')).toBe(true);
    expect(c.getCurrentLbMode()).toBe('pan-screen');
    modes.stop();
  });
});
