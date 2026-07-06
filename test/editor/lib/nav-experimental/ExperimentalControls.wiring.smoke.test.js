// Characterization: real synthetic-DOM event wiring (attach/detach, the
// window-level move/up added mid-drag, live-Shift switch via real key events).
// Small smoke set per KD-3 — drives through dispatchEvent, not the bound
// handlers directly.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as H from './_harness.js';

let Controls;
beforeAll(async () => {
  Controls = await H.loadControls();
  H.useControlsClass(Controls);
});
beforeEach(() => H.stubClock());
afterEach(() => H.teardownAll());

describe('wiring smoke — attach / detach', () => {
  it('a real wheel event on the element drives the camera; after dispose it does not', () => {
    const scene = H.groundPlaneScene({ y: 0 });
    const cam = H.makePerspectiveCam({ pos: [0, 50, 40], lookAt: [0, 0, 0] });
    const c = H.makeControls({ camera: cam, dom: H.makeDomElement(), scene, streetLevel: true });

    const y0 = cam.position.y;
    H.dispatchWheel(c, { dy: -300, ctrl: true });
    H.step(c, 16);
    expect(cam.position.y).toBeLessThan(y0); // wheel wired → camera moved

    c.dispose();
    const y1 = cam.position.y;
    H.dispatchWheel(c, { dy: -300, ctrl: true });
    H.step(c, 16);
    expect(cam.position.y).toBeCloseTo(y1, 6); // detached → no effect
  });
});

describe('wiring smoke — window-level drag + live-Shift switch', () => {
  it('mousedown adds window move/up listeners that drive the drag; Shift toggles the sub-mode', () => {
    const scene = H.representativeScene();
    const cam = H.makePerspectiveCam({ pos: [0, 80, 60], lookAt: [0, 12, 0] });
    const c = H.makeControls({ camera: cam, dom: H.makeDomElement(), scene, streetLevel: true });

    // Real mousedown on the element; move/up dispatched on window (the
    // listeners are added at mousedown time).
    H.dispatchMouseDown(c, { clientX: 640, clientY: 360, button: 0, shiftKey: true });
    expect(c._latch.isActive()).toBe(true);
    expect(c._latch.get('mode')).toBe('rotate');

    const q0 = cam.quaternion.clone();
    H.dispatchWindowMouseMove({ clientX: 680, clientY: 360 });
    expect(1 - Math.abs(cam.quaternion.dot(q0))).toBeGreaterThan(1e-6); // rotated

    // Live-Shift release via a real keyup → switch to pan.
    H.dispatchKey('keyup', 'ShiftLeft', { shiftKey: false });
    expect(c._latch.get('mode')).toBe('pan');

    // Real mouseup on window ends the gesture (window listener removed).
    H.dispatchWindowMouseUp();
    expect(c._latch.isActive()).toBe(false);
  });
});
