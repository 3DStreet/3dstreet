/* global THREE */
// #1993: with an entity selected and its origin in view, Map-regime rotation
// orbits the selection instead of the screen-centre / cursor ground point.
// Out of view (or nothing selected) falls back to the normal pivot scheme.
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

function selectAt([x, y, z]) {
  const object3D = new THREE.Object3D();
  object3D.position.set(x, y, z);
  object3D.updateMatrixWorld();
  const el = {
    object3D,
    isConnected: true,
    hasAttribute: () => false
  };
  globalThis.AFRAME = { INSPECTOR: { selectedEntity: el } };
  return el;
}

function latchedPivot({ streetLevel }) {
  const scene = H.representativeScene();
  const cam = H.makePerspectiveCam({ pos: [0, 80, 60], lookAt: [0, 12, 0] });
  const c = H.makeControls({ camera: cam, scene, streetLevel });
  H.mouseDown(c, { clientX: 640, clientY: 360, button: 0, shiftKey: true });
  const pivot = c._latch.get('center').clone();
  return { c, cam, pivot };
}

describe('rotation — selection pivot (#1993)', () => {
  for (const streetLevel of [true, false]) {
    describe(`street-level ${streetLevel ? 'on' : 'off'}`, () => {
      it('orbits the selected entity when its origin is in view', () => {
        selectAt([15, 5, -10]);
        const { c, cam, pivot } = latchedPivot({ streetLevel });
        expect(pivot.x).toBeCloseTo(15, 6);
        expect(pivot.y).toBeCloseTo(5, 6);
        expect(pivot.z).toBeCloseTo(-10, 6);

        // The selection stays pinned on screen through the orbit.
        const before = H.screenOf(cam, c._domElement, pivot);
        for (let i = 0; i < 12; i++) {
          H.mouseMove(c, { clientX: 640 + i * 6, clientY: 360 + (i % 3) });
          const now = H.screenOf(cam, c._domElement, pivot);
          expect(Math.hypot(now.x - before.x, now.y - before.y)).toBeLessThan(
            1.5
          );
        }
        H.mouseUp(c);
      });

      it('falls back to the normal pivot when the selection is out of view', () => {
        const { pivot: normal } = latchedPivot({ streetLevel });
        H.teardownAll();
        selectAt([0, 0, 5000]); // far behind the camera
        const { pivot } = latchedPivot({ streetLevel });
        expect(pivot.distanceTo(normal)).toBeLessThan(1e-6);
      });

      it('ignores a hidden selection', () => {
        const { pivot: normal } = latchedPivot({ streetLevel });
        H.teardownAll();
        selectAt([15, 5, -10]).object3D.visible = false;
        const { pivot } = latchedPivot({ streetLevel });
        expect(pivot.distanceTo(normal)).toBeLessThan(1e-6);
      });
    });
  }
});
