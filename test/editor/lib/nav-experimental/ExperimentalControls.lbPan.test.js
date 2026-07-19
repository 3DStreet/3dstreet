// Characterization: LB pan / truck. Frozen surface: camera position + the
// grabbed world point's on-screen projection. Non-square, offset DOM rect so a
// width/height transposition or dropped offset shows.
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

describe('LB pan — truck (Tier 1.5, non-square rect)', () => {
  it('the grabbed world point tracks the cursor; camera height is unchanged', () => {
    const scene = H.groundPlaneScene({ y: 0 });
    const cam = H.makePerspectiveCam({ pos: [0, 50, 40], lookAt: [0, 0, 0] });
    const dom = H.makeDomElement({
      width: 1280,
      height: 720,
      left: 37,
      top: 19
    });
    const c = H.makeControls({ camera: cam, dom, scene, streetLevel: true });
    expect(H.tilt(cam)).toBeGreaterThan(25); // Map regime → truck sub-mode

    const startY = cam.position.y;
    H.mouseDown(c, { clientX: 640, clientY: 360, button: 0 });
    // The world point grabbed under the cursor at gesture start.
    const g = c._cursorAnchor.worldPointAt(640, 360);
    expect(g.source).toBe('mesh'); // real ground hit, not fallback
    const grabbed = new H.THREE.Vector3(g.x, g.y, g.z);

    // Drag the cursor to a new pixel; the grabbed point must follow it.
    H.mouseMove(c, { clientX: 740, clientY: 400 });
    const proj = H.screenOf(cam, dom, grabbed);
    expect(proj.x).toBeCloseTo(740, 0);
    expect(proj.y).toBeCloseTo(400, 0);

    // Truck sub-mode keeps the horizontal-plane anchor — height unchanged.
    expect(cam.position.y).toBeCloseTo(startY, 4);
    H.mouseUp(c);
  });
});

describe('LB pan — sky grab at the horizon (GH-1867)', () => {
  it('grabbing the top half over sky pans up without a spurious first-move lurch', () => {
    // Looking straight out at the horizon; the cursor in the top half casts
    // an upward ray that misses the ground mesh AND the y=0 plane, so the
    // pan anchors on the Step-3 fallback. Pre-fix that fallback sat 30 m
    // along the camera's CENTRE-forward, so the first move applied the
    // cursor↔screen-centre offset as a downward camera jump that cancelled
    // the pan-up (net ≈ 0 over a top-half→centre drag). Post-fix the
    // fallback lies on the cursor ray and the drag is pure pan.
    const scene = H.groundPlaneScene({ y: 0 });
    const cam = H.makePerspectiveCam({ pos: [0, 10, 40], lookAt: [0, 10, 0] });
    const dom = H.makeDomElement({
      width: 1280,
      height: 720,
      left: 37,
      top: 19
    });
    const c = H.makeControls({ camera: cam, dom, scene }); // street-level off → pan-screen
    expect(Math.abs(H.tilt(cam))).toBeLessThan(1); // at the horizon

    const start = cam.position.clone();
    // Grab in the TOP quarter (screen centre is at clientY 379), pure sky.
    H.mouseDown(c, { clientX: 677, clientY: 199, button: 0 });
    const g = c._cursorAnchor.worldPointAt(677, 199);
    expect(g.source).toBe('fallback'); // nothing under the cursor but sky

    // Drag DOWN 90 px — the world follows the cursor, the camera pans UP.
    H.mouseMove(c, { clientX: 677, clientY: 289 });

    const dy = cam.position.y - start.y;
    // ~4.2 m up for 90 px at the ~29 m fallback depth (fov 60, 720 px tall).
    // Pre-fix the first move NETS DOWNWARD (jump ≈ −8.7 m + drag ≈ +4.2 m).
    expect(dy).toBeGreaterThan(2);
    expect(dy).toBeLessThan(7);
    // A vertical drag while looking down -Z never trucks sideways or dollies.
    expect(cam.position.x).toBeCloseTo(start.x, 4);
    expect(cam.position.z).toBeCloseTo(start.z, 4);
    H.mouseUp(c);
  });

  it('a shallow grab on DISTANT ground pans at the working-distance rate, not the hit distance (no catapult)', () => {
    // TH-81. Just below the horizon the cursor ray grazes the ground mesh
    // ~300 m out. Anchoring the pan plane THERE makes each pixel worth
    // ~0.5 m of world (fov 60 / 720 px) — a drag "catapults" the camera.
    // The anchor reach cap pulls the anchor in to
    // max(30, 2 × camera→center distance) ≈ 82 m, so the same drag pans at
    // the working-distance rate, like legacy's distance-to-center pan speed.
    const scene = H.groundPlaneScene({ y: 0 });
    const cam = H.makePerspectiveCam({ pos: [0, 10, 40], lookAt: [0, 10, 0] });
    const dom = H.makeDomElement({
      width: 1280,
      height: 720,
      left: 37,
      top: 19
    });
    const c = H.makeControls({ camera: cam, dom, scene });

    // 20 px below the screen centre (379): a ~1.8°-declined ray → ground
    // hit ~300 m out. Confirm the raw anchor really is that far.
    const raw = c._cursorAnchor.worldPointAt(677, 399);
    expect(raw.source).toBe('mesh');
    expect(raw.distance).toBeGreaterThan(200);

    const start = cam.position.clone();
    H.mouseDown(c, { clientX: 677, clientY: 399, button: 0 });
    H.mouseMove(c, { clientX: 677, clientY: 499 }); // drag down 100 px

    const moved = cam.position.distanceTo(start);
    // Uncapped (plane ~300 m out): ~50 m for 100 px. Capped (~82 m): ~13 m.
    expect(moved).toBeGreaterThan(5);
    expect(moved).toBeLessThan(25);
    H.mouseUp(c);
  });
});
