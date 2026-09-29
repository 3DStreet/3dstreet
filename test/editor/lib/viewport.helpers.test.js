import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Viewport } from '@/editor/lib/viewport.js';
import Events from '@/editor/lib/Events.js';

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

function mountViewport() {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const sceneEl = document.createElement('a-scene');
  document.body.append(sceneEl);
  sceneEl.object3D = new THREE.Scene();
  sceneEl.renderer = { render: vi.fn() };
  sceneEl.canvas = canvas;
  sceneEl.systems = {};
  const inspector = {
    sceneEl,
    container: canvas,
    sceneHelpers: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    helpers: {},
    opened: true,
    cursor: { isPlaying: true },
    execute: vi.fn()
  };
  vi.stubGlobal('AFRAME', { INSPECTOR: inspector });
  Viewport(inspector);
  const helperByColor = (hex) =>
    inspector.sceneHelpers.children.find(
      (c) => c.material?.color?.getHex?.() === hex
    );
  return {
    inspector,
    sceneEl,
    selectionBox: helperByColor(0x1faaf2),
    hoverBox: helperByColor(0xff0000),
    dispose: () => {
      inspector.easyGizmoControls.dispose();
      inspector.shapeVertexControls.dispose();
      inspector.streetNodeControls.dispose();
      inspector.segmentWidthControls.dispose();
    }
  };
}

function entity(parentEl) {
  const el = document.createElement('a-entity');
  parentEl.append(el);
  el.object3D = new THREE.Group();
  el.object3D.el = el;
  el.components = {};
  el.getObject3D = () => undefined;
  parentEl.object3D.add(el.object3D);
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
    const { inspector, sceneEl, selectionBox, dispose } = mountViewport();
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
      inspector.selectedEntity = el;
      Events.emit('objectselect', el.object3D);
      expect(error).toHaveBeenCalledTimes(1);
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
    const { inspector, sceneEl, selectionBox, dispose } = mountViewport();
    try {
      const el = entity(sceneEl);
      el.object3D.position.set(3, 0, -7);
      el.object3D.add(new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2)));
      inspector.selectedEntity = el;
      Events.emit('objectselect', el.object3D);
      expect(selectionBox.visible).toBe(true);
      expect(selectionBox.position.toArray()).toEqual([3, 0, -7]);
      expect(el.object3D.position.toArray()).toEqual([3, 0, -7]);
    } finally {
      dispose();
    }
  });
});

describe('helpers for an entity that left the scene graph', () => {
  it('hides a box helper for a parentless object and shows it again once parented', () => {
    const { inspector, sceneEl, selectionBox, dispose } = mountViewport();
    try {
      const el = entity(sceneEl);
      el.object3D.position.set(3, 0, -7);
      el.object3D.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
      inspector.selectedEntity = el;
      Events.emit('objectselect', el.object3D);
      expect(selectionBox.visible).toBe(true);
      el.object3D.removeFromParent();
      selectionBox.update();
      expect(selectionBox.visible).toBe(false);
      sceneEl.object3D.add(el.object3D);
      selectionBox.update();
      expect(selectionBox.visible).toBe(true);
      expect(selectionBox.position.toArray()).toEqual([3, 0, -7]);
    } finally {
      dispose();
    }
  });

  // A generated clone is removed by the detach its own drag committed while
  // the raycaster still names it as hovered.
  it('does not draw the hover box for a removed entity', () => {
    const { inspector, sceneEl, hoverBox, dispose } = mountViewport();
    try {
      const clone = entity(sceneEl);
      clone.object3D.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)));
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
