/* global THREE */
// #1993: with an entity selected and its origin in view, Map-regime rotation
// orbits the selection instead of the screen-centre / cursor ground point.
// Out of view (or nothing selected) falls back to the normal pivot scheme.
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import posthog from 'posthog-js';
import * as H from './_harness.js';
import { USER_GROUP_CLASS } from '../../../../src/editor/lib/groups/groupModel.js';

let Controls;
beforeAll(async () => {
  Controls = await H.loadControls();
  H.useControlsClass(Controls);
});
beforeEach(() => {
  H.stubClock();
  H.clearSceneGlobals();
  posthog.capture.mockClear();
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

      it('orbits a selected group about its center, not its origin', () => {
        // Origin at (0,0,-10), stored center 15 m to its +x and 5 m up.
        const el = selectAt([0, 0, -10]);
        el.classList = { contains: (c) => c === USER_GROUP_CLASS };
        el.components = {
          'group-center': { data: { pinned: true, pin: { x: 15, y: 5, z: 0 } } }
        };
        const { pivot } = latchedPivot({ streetLevel });
        expect(pivot.x).toBeCloseTo(15, 6);
        expect(pivot.y).toBeCloseTo(5, 6);
        expect(pivot.z).toBeCloseTo(-10, 6);
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

// The `nav_rotate_gesture` telemetry event (#1993): one per rotate drag that
// moved the camera, carrying why the pivot was chosen.
function rotateEvents() {
  return posthog.capture.mock.calls
    .filter(([name]) => name === 'nav_rotate_gesture')
    .map(([, props]) => props);
}

function rotateDrag({ streetLevel = false, cam, steps = 5 } = {}) {
  const scene = H.representativeScene();
  const camera =
    cam || H.makePerspectiveCam({ pos: [0, 80, 60], lookAt: [0, 12, 0] });
  const c = H.makeControls({ camera, scene, streetLevel });
  H.mouseDown(c, { clientX: 640, clientY: 360, button: 0, shiftKey: true });
  for (let i = 1; i <= steps; i++) {
    H.mouseMove(c, { clientX: 640 + i * 10, clientY: 360 + i * 2 });
  }
  return c;
}

describe('rotation — nav_rotate_gesture telemetry (#1993)', () => {
  it('reports a selection-pivot rotate once, at drag end', () => {
    selectAt([15, 5, -10]);
    const c = rotateDrag();
    expect(rotateEvents()).toHaveLength(0); // nothing per move
    H.mouseUp(c);
    const events = rotateEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      pivot_source: 'selection',
      selected_type: 'other',
      nav_mode: 'standard'
    });
    expect(events[0].yaw_deg).toBeGreaterThan(0); // dragged right
    expect(events[0].pitch_deg).toBeGreaterThan(0); // dragged down
    expect(events[0].drag_ms).toBeGreaterThanOrEqual(0);
  });

  it('labels each fallback reason', () => {
    const cases = [
      [() => {}, 'fallback_none'],
      [() => selectAt([0, 0, 5000]), 'fallback_offscreen'],
      [
        () => (selectAt([15, 5, -10]).object3D.visible = false),
        'fallback_hidden'
      ]
    ];
    for (const [setup, source] of cases) {
      H.clearSceneGlobals();
      posthog.capture.mockClear();
      setup();
      H.mouseUp(rotateDrag());
      expect(rotateEvents().map((e) => e.pivot_source)).toEqual([source]);
      H.teardownAll();
    }
  });

  it('reports street_inplace for a street-level rotate', () => {
    selectAt([15, 5, -10]);
    const cam = H.makePerspectiveCam({ pos: [0, 2, 0], lookAt: [10, 2, 0] });
    H.mouseUp(rotateDrag({ streetLevel: true, cam }));
    expect(rotateEvents().map((e) => e.pivot_source)).toEqual([
      'street_inplace'
    ]);
  });

  it('sends nothing for a Shift+click that never drags', () => {
    selectAt([15, 5, -10]);
    H.mouseUp(rotateDrag({ steps: 0 }));
    expect(rotateEvents()).toHaveLength(0);
  });

  it('reports the rotate when a drag switches to pan mid-gesture', () => {
    const c = rotateDrag();
    H.keyUp(c, 'ShiftLeft', { shiftKey: false }); // rotate → pan
    expect(rotateEvents()).toHaveLength(1);
    H.mouseMove(c, { clientX: 720, clientY: 380 });
    H.mouseUp(c);
    expect(rotateEvents()).toHaveLength(1); // the pan adds nothing
  });
});
