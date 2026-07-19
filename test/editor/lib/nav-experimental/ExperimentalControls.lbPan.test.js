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
