import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import Events from '@/editor/lib/Events.js';
import { entity, mountViewport } from './viewportHarness.js';

vi.mock('@/store', () => ({ default: { subscribe: vi.fn() } }));
vi.mock('@/editor/lib/cameras', () => ({ copyCameraPosition: vi.fn() }));
vi.mock('@/editor/lib/raycaster', () => ({
  initRaycaster: () => ({ enable() {}, disable() {} })
}));
vi.mock('@/editor/lib/entity', () => ({ isManagedStreetSegment: vi.fn() }));
vi.mock('@/editor/lib/navAnalytics.js', () => ({
  captureNavDiscovery: vi.fn()
}));
vi.mock('@/editor/lib/nav-experimental/index.js', async () => {
  const { EventDispatcher, Vector3 } = await import('three');
  return {
    isStreetLevelNav: () => false,
    ExperimentalControls: class extends EventDispatcher {
      center = new Vector3();
      setAspectRatio() {}
    }
  };
});

// The selection and hover box helpers around an entity that is removed or
// re-created under them, which is what per-object detach (#2011) does to a
// generated clone: the drag's own commit removes the clone and selects the
// plain entity created in its place (#2054).

function mount() {
  const mounted = mountViewport();
  mounted.inspector.cursor = { isPlaying: true };
  const helperByColor = (hex) =>
    mounted.inspector.sceneHelpers.children.find(
      (c) => c.material?.color?.getHex?.() === hex
    );
  mounted.selectionBox = helperByColor(0x1faaf2);
  mounted.hoverBox = helperByColor(0xff0000);
  mounted.select = (el) => {
    mounted.inspector.selectedEntity = el;
    Events.emit('objectselect', el.object3D);
  };
  return mounted;
}

function withMesh(el, size = 1) {
  el.object3D.add(new THREE.Mesh(new THREE.BoxGeometry(size, size, size)));
  return el;
}

afterEach(() => {
  Events.removeAllListeners();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('the selection box measurement', () => {
  // The box is measured with the entity parked at its parent's origin. A
  // throw while measuring used to leave it there for good: object3D at 0 0 0
  // while a batched instance still drew where the user dropped it.
  it('restores the entity pose when measuring throws', () => {
    const { sceneEl, selectionBox, select, dispose } = mount();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const el = entity(sceneEl);
      el.object3D.position.set(4, 0.15, -20);
      el.object3D.rotation.set(0, Math.PI / 2, 0);
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
      // Throws for the selection box, which measures first; the easy gizmo's
      // own box derivation runs after it in the same handler and must not
      // be what this test exercises.
      const compute = mesh.geometry.computeBoundingBox.bind(mesh.geometry);
      let thrown = false;
      mesh.geometry.computeBoundingBox = () => {
        if (!thrown) {
          thrown = true;
          throw new Error('skeleton not ready');
        }
        compute();
      };
      mesh.geometry.boundingBox = null;
      el.object3D.add(mesh);
      select(el);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0][0]).toMatch(/measurement failed/);
      expect(el.object3D.position.toArray()).toEqual([4, 0.15, -20]);
      expect(el.object3D.rotation.y).toBeCloseTo(Math.PI / 2, 6);
      // The parent's world matrix is put back too.
      const parentPos = new THREE.Vector3();
      sceneEl.object3D.matrixWorld.decompose(
        parentPos,
        new THREE.Quaternion(),
        new THREE.Vector3()
      );
      expect(parentPos.toArray()).toEqual([0, 0, 0]);
      expect(selectionBox.visible).toBe(true);
    } finally {
      error.mockRestore();
      dispose();
    }
  });

  it('measures and places the box normally when nothing throws', () => {
    const { sceneEl, selectionBox, select, dispose } = mount();
    try {
      const el = withMesh(entity(sceneEl), 2);
      el.object3D.position.set(3, 0, -7);
      select(el);
      expect(selectionBox.visible).toBe(true);
      expect(selectionBox.fatBox.visible).toBe(true);
      expect(selectionBox.position.toArray()).toEqual([3, 0, -7]);
      expect(el.object3D.position.toArray()).toEqual([3, 0, -7]);
    } finally {
      dispose();
    }
  });
});

describe('helpers for an entity that left the scene graph', () => {
  // The helper's `visible` belongs to its caller (objectselect turns it on
  // and off); for a parentless object the helper draws nothing itself, and
  // draws again on the next update once the object is parented.
  it('draws nothing for a parentless object and draws again once parented', () => {
    const { sceneEl, selectionBox, select, dispose } = mount();
    try {
      const el = withMesh(entity(sceneEl));
      el.object3D.position.set(3, 0, -7);
      select(el);
      expect(selectionBox.visible).toBe(true);
      expect(selectionBox.fatBox.visible).toBe(true);
      el.object3D.removeFromParent();
      selectionBox.update();
      expect(selectionBox.visible).toBe(true);
      expect(selectionBox.fatBox.visible).toBe(false);
      sceneEl.object3D.add(el.object3D);
      selectionBox.update();
      expect(selectionBox.fatBox.visible).toBe(true);
      expect(selectionBox.position.toArray()).toEqual([3, 0, -7]);
    } finally {
      dispose();
    }
  });

  // A generated clone is removed by the detach its own drag committed while
  // the raycaster still names it as hovered.
  it('does not draw the hover box for a removed entity', () => {
    const { sceneEl, hoverBox, inspector, dispose } = mount();
    try {
      const clone = withMesh(entity(sceneEl));
      const replacement = entity(sceneEl);
      inspector.selectedEntity = replacement;
      Events.emit('raycastermouseenter', clone);
      expect(hoverBox.visible).toBe(true);
      clone.object3D.removeFromParent();
      clone.remove();
      Events.emit('raycastermouseenter', clone);
      expect(hoverBox.visible).toBe(false);
    } finally {
      dispose();
    }
  });
});

describe('the hover box across an easy-gizmo commit', () => {
  const gizmoHover = (inspector, axis) =>
    inspector.easyGizmoControls.dispatchEvent({
      type: 'axisHoverChange',
      axis
    });
  const commit = (inspector, el) =>
    inspector.easyGizmoControls.dispatchEvent({
      type: 'commitDrag',
      entity: el,
      name: 'move',
      changes: [{ component: 'position', value: '1 0 0', oldValue: '0 0 0' }]
    });
  const pointerMove = (inspector) =>
    inspector.container.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 5, clientY: 5 })
    );

  // Leaving a control with the gizmo still on its entity re-arms the hover
  // box on the last raycaster target, as before.
  it('re-applies the last hovered entity when the cursor leaves a control', () => {
    const { sceneEl, hoverBox, inspector, select, dispose } = mount();
    try {
      const selected = entity(sceneEl);
      const segment = withMesh(entity(sceneEl));
      select(selected);
      Events.emit('raycastermouseenter', segment);
      expect(hoverBox.visible).toBe(true);
      gizmoHover(inspector, 'move');
      expect(hoverBox.visible).toBe(false);
      gizmoHover(inspector, null);
      expect(hoverBox.visible).toBe(true);
    } finally {
      dispose();
    }
  });

  // A drag-to-detach commit removes the clone and selects the entity created
  // in its place. The gizmo's detach() lifts its hover suppression with the
  // selection changing under it, and until the pointer moves the re-attached
  // gizmo does not know the cursor is still on the control that was released:
  // neither the lift nor a raycaster poll in that gap may draw the segment
  // under the handle.
  it('holds the hover box from a commit until the pointer moves', () => {
    const { sceneEl, hoverBox, inspector, select, dispose } = mount();
    try {
      const clone = withMesh(entity(sceneEl));
      const segment = withMesh(entity(sceneEl));
      select(clone);
      expect(inspector.easyGizmoControls.el).toBe(clone);
      Events.emit('raycastermouseenter', segment);
      gizmoHover(inspector, 'move');
      commit(inspector, clone);
      expect(inspector.execute).toHaveBeenCalledWith(
        'multi',
        expect.any(Array),
        expect.any(String)
      );
      // The detach: the clone is gone, its replacement selected.
      clone.object3D.removeFromParent();
      clone.remove();
      const detached = withMesh(entity(sceneEl));
      select(detached);
      expect(inspector.easyGizmoControls.el).toBe(detached);
      expect(hoverBox.visible).toBe(false);
      // A raycaster poll in the gap names the segment under the handle.
      Events.emit('raycastermouseenter', segment);
      expect(hoverBox.visible).toBe(false);
      // The pointer moves off the handle: hover resolves to the segment.
      pointerMove(inspector);
      expect(hoverBox.visible).toBe(true);
      expect(hoverBox.object).toBe(segment.object3D);
    } finally {
      dispose();
    }
  });

  it('keeps the hover box hidden when that pointer move lands on a control', () => {
    const { sceneEl, hoverBox, inspector, select, dispose } = mount();
    try {
      const clone = withMesh(entity(sceneEl));
      const segment = withMesh(entity(sceneEl));
      select(clone);
      gizmoHover(inspector, 'move');
      commit(inspector, clone);
      clone.object3D.removeFromParent();
      clone.remove();
      const detached = withMesh(entity(sceneEl));
      select(detached);
      Events.emit('raycastermouseenter', segment);
      // The gizmo picks its control on the same pointer move, ahead of the
      // canvas listener (window capture).
      gizmoHover(inspector, 'move');
      pointerMove(inspector);
      expect(hoverBox.visible).toBe(false);
      // Leaving the control later re-arms the segment.
      gizmoHover(inspector, null);
      expect(hoverBox.visible).toBe(true);
      expect(hoverBox.object).toBe(segment.object3D);
    } finally {
      dispose();
    }
  });

  // A selection change that is not a commit (a scene graph click) lifts the
  // gizmo the same way; the box it re-armed before is hidden by objectselect
  // and comes back with the next raycaster target, not from the lift.
  it('does not re-apply hover from the lift a detach dispatches', () => {
    const { sceneEl, hoverBox, inspector, select, dispose } = mount();
    try {
      const first = entity(sceneEl);
      const segment = withMesh(entity(sceneEl));
      const second = withMesh(entity(sceneEl));
      select(first);
      Events.emit('raycastermouseenter', segment);
      gizmoHover(inspector, 'move');
      select(second);
      expect(inspector.easyGizmoControls.el).toBe(second);
      expect(hoverBox.visible).toBe(false);
      Events.emit('raycastermouseenter', segment);
      expect(hoverBox.visible).toBe(true);
    } finally {
      dispose();
    }
  });
});
