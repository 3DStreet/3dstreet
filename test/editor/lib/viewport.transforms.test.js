import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { OrientedBoxHelper, Viewport } from '@/editor/lib/viewport.js';
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

afterEach(() => {
  Events.removeAllListeners();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

describe('selection bounds transform preservation', () => {
  it('reuses the splat bounds output across movement and fresh streamed extrema', () => {
    const scene = new THREE.Scene();
    const object = new THREE.Group();
    scene.add(object);
    const el = document.createElement('a-entity');
    el.setAttribute('splat', '');
    object.el = el;
    const min = new THREE.Vector3(-1, -2, -3);
    const max = new THREE.Vector3(1, 2, 3);
    let output;
    const getBoundingBox = vi.fn((centersOnly, target) => {
      expect(centersOnly).toBe(true);
      expect(target?.isBox3).toBe(true);
      if (output) expect(target).toBe(output);
      output = target;
      return target.set(min, max);
    });
    el.components = { splat: { getBoundingBox } };
    const helper = new OrientedBoxHelper();

    for (const x of [5, 10, 20]) {
      object.position.x = x;
      min.y -= 1;
      scene.updateMatrixWorld(true);
      helper.setFromObject(object);
      const positions = helper.geometry.attributes.position;
      expect(positions.getX(0)).toBe(x + max.x);
      expect(positions.getY(7)).toBe(min.y);
    }

    expect(getBoundingBox).toHaveBeenCalledTimes(3);
    helper.dispose();
  });

  it('leaves nested mesh world matrices ready for rendering after moving a group', () => {
    const scene = new THREE.Scene();
    const parent = new THREE.Group();
    parent.position.set(8, 2, -4);
    parent.rotation.y = 0.3;
    scene.add(parent);
    const street = new THREE.Group();
    parent.add(street);
    const segment = new THREE.Group();
    segment.position.set(3, 0, 1);
    street.add(segment);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1, 5),
      new THREE.MeshBasicMaterial()
    );
    mesh.position.set(0, 0.5, 2);
    segment.add(mesh);
    const helper = new OrientedBoxHelper();

    for (const x of [12, 15, 18]) {
      street.position.set(x, 1, -6);
      street.rotation.y = 0.7;
      scene.updateMatrixWorld(true);
      const expectedParent = parent.matrixWorld.clone();
      const expectedStreet = street.matrixWorld.clone();
      const expectedSegment = segment.matrixWorld.clone();
      const expectedMesh = mesh.matrixWorld.clone();

      helper.setFromObject(street);

      // Read the matrices directly: world-position getters would refresh them
      // and hide the stale transforms a renderer or batch sync would consume.
      for (const [object, expected] of [
        [parent, expectedParent],
        [street, expectedStreet],
        [segment, expectedSegment],
        [mesh, expectedMesh]
      ]) {
        object.matrixWorld.elements.forEach((value, index) => {
          expect(value).toBeCloseTo(expected.elements[index], 10);
        });
      }
    }

    helper.dispose();
    mesh.geometry.dispose();
    mesh.material.dispose();
  });
});

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
    execute: vi.fn()
  };
  vi.stubGlobal('AFRAME', { INSPECTOR: inspector });
  Viewport(inspector);
  function dispose() {
    inspector.easyGizmoControls.dispose();
    inspector.shapeVertexControls.dispose();
    inspector.streetNodeControls.dispose();
    inspector.segmentWidthControls.dispose();
  }
  return { inspector, sceneEl, dispose };
}

function entity(parentEl) {
  const el = document.createElement('a-entity');
  parentEl.append(el);
  el.object3D = new THREE.Group();
  el.object3D.el = el;
  el.components = {};
  el.getObject3D = () => undefined;
  const nativeSet = el.setAttribute.bind(el);
  el.setAttribute = (name, value) => {
    if (name === 'position') {
      el.object3D.position.set(value.x, value.y, value.z);
    } else if (name === 'rotation') {
      el.object3D.rotation.set(
        THREE.MathUtils.degToRad(value.x),
        THREE.MathUtils.degToRad(value.y),
        THREE.MathUtils.degToRad(value.z)
      );
    } else nativeSet(name, value);
  };
  const nativeGet = el.getAttribute.bind(el);
  el.getAttribute = (name) => {
    if (name === 'position') return el.object3D.position.clone();
    if (name === 'rotation') {
      const d = THREE.MathUtils.radToDeg;
      const { x, y, z } = el.object3D.rotation;
      return { x: d(x), y: d(y), z: d(z) };
    }
    return nativeGet(name);
  };
  parentEl.object3D.add(el.object3D);
  return el;
}

describe('the easy gizmo as the default transform control', () => {
  it('is constructed with the viewport and is the starting mode', () => {
    const { inspector, dispose } = mountViewport();
    try {
      expect(inspector.easyGizmoControls).toBeDefined();
      expect(inspector.transformMode).toBe('easy');
    } finally {
      dispose();
    }
  });

  it('attaches to a new selection in place of the stock gizmo', () => {
    const { inspector, sceneEl, dispose } = mountViewport();
    inspector.cursor = { isPlaying: true };
    const stockRoot = inspector.sceneHelpers.children.find(
      (child) => child.isTransformControlsRoot
    );
    try {
      const el = entity(sceneEl);
      inspector.selectedEntity = el;
      Events.emit('objectselect', el.object3D);
      expect(inspector.easyGizmoControls.el).toBe(el);
      expect(stockRoot.controls.object).toBeUndefined();

      Events.emit('transformmodechange', 'translate');
      expect(inspector.transformMode).toBe('translate');
      expect(stockRoot.controls.object).toBe(el.object3D);
    } finally {
      dispose();
    }
  });
});

describe('the advanced rotate gizmo', () => {
  function mountWithStock() {
    const mounted = mountViewport();
    mounted.inspector.cursor = { isPlaying: true };
    mounted.stock = mounted.inspector.sceneHelpers.children.find(
      (child) => child.isTransformControlsRoot
    ).controls;
    return mounted;
  }
  const axes = (stock) => [stock.showX, stock.showY, stock.showZ];
  const select = (inspector, el) => {
    inspector.selectedEntity = el;
    Events.emit('objectselect', el.object3D);
  };

  // Yaw-only rotation is the easy gizmo's; the stock rotate gizmo is where
  // pitch and roll live, so it offers every ring.
  it('shows all three rings on an ordinary entity', () => {
    const { inspector, sceneEl, stock, dispose } = mountWithStock();
    try {
      const el = entity(sceneEl);
      select(inspector, el);
      Events.emit('transformmodechange', 'rotate');
      expect(stock.object).toBe(el.object3D);
      expect(stock.mode).toBe('rotate');
      expect(axes(stock)).toEqual([true, true, true]);
    } finally {
      dispose();
    }
  });

  it('keeps the Y ring alone for a yaw-only entity, per selection', () => {
    const { inspector, sceneEl, stock, dispose } = mountWithStock();
    try {
      const shape = entity(sceneEl);
      shape.setAttribute('data-transform-yaw-only', '');
      const plain = entity(sceneEl);
      select(inspector, shape);
      Events.emit('transformmodechange', 'rotate');
      expect(axes(stock)).toEqual([false, true, false]);
      // The restriction is about rotation, not the entity.
      Events.emit('transformmodechange', 'translate');
      expect(axes(stock)).toEqual([true, true, true]);
      // And about the entity under the gizmo, not the mode alone.
      Events.emit('transformmodechange', 'rotate');
      expect(axes(stock)).toEqual([false, true, false]);
      select(inspector, plain);
      expect(stock.object).toBe(plain.object3D);
      expect(axes(stock)).toEqual([true, true, true]);
      select(inspector, shape);
      expect(axes(stock)).toEqual([false, true, false]);
    } finally {
      dispose();
    }
  });
});

describe('the properties panel during an easy gizmo drag', () => {
  function startDrag() {
    const { inspector, sceneEl, dispose } = mountViewport();
    const controls = inspector.easyGizmoControls;
    const el = entity(sceneEl);
    inspector.selectedEntity = el;
    controls.el = el;
    controls.object = el.object3D;
    controls.dragEl = el;
    controls.dragObject = el.object3D;
    controls.dragSnapshot = { position: '0 0 0', rotation: '0 0 0' };
    controls.isDragging = true;
    controls.axis = 'move';
    const updates = [];
    Events.on('entityupdate', (detail) => {
      if (detail.entity === el) updates.push(detail);
    });
    return { inspector, sceneEl, controls, el, updates, dispose };
  }

  it('reports each step of a move or rotation, without a command', () => {
    const { inspector, controls, el, updates, dispose } = startDrag();
    try {
      el.object3D.position.set(1, 0, 2);
      controls.dispatchEvent({ type: 'objectChange' });
      el.object3D.position.set(2, 0, 3);
      controls.dispatchEvent({ type: 'objectChange' });
      controls.axis = 'rotate';
      el.object3D.rotation.y = Math.PI / 2;
      controls.dispatchEvent({ type: 'objectChange' });
      expect(
        updates.map(({ component, value }) => ({ component, value }))
      ).toEqual([
        { component: 'position', value: '1 0 2' },
        { component: 'position', value: '2 0 3' },
        { component: 'rotation', value: '0 90 0' }
      ]);
      expect(inspector.execute).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('commits the whole drag once, as one command', () => {
    const { inspector, controls, el, dispose } = startDrag();
    try {
      el.object3D.position.set(1, 0, 2);
      controls.dispatchEvent({ type: 'objectChange' });
      el.object3D.position.set(2, 0, 3);
      controls.dispatchEvent({ type: 'objectChange' });
      controls.endGesture('pointerup');
      expect(inspector.execute).toHaveBeenCalledTimes(1);
      expect(inspector.execute.mock.calls[0][0]).toBe('multi');
    } finally {
      dispose();
    }
  });

  it('shows the restored pose once when the drag is cancelled', () => {
    const { inspector, controls, el, updates, dispose } = startDrag();
    try {
      el.object3D.position.set(4, 0, 5);
      controls.dispatchEvent({ type: 'objectChange' });
      updates.length = 0;
      controls.endGesture('escape');
      expect(updates).toHaveLength(1);
      expect(updates[0]).toMatchObject({
        component: 'position',
        value: '0 0 0'
      });
      expect(inspector.execute).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('says nothing about the dragged entity once the selection has moved on', () => {
    const { inspector, sceneEl, controls, el, updates, dispose } = startDrag();
    try {
      el.object3D.position.set(4, 0, 5);
      updates.length = 0;
      inspector.selectedEntity = entity(sceneEl);
      controls.detach();
      expect(updates).toEqual([]);
      expect(el.object3D.position.x).toBe(0);
    } finally {
      dispose();
    }
  });
});

describe('easy gizmo viewport batch synchronization', () => {
  it.each(['batched model', 'group with mixed children'])(
    'updates rendered poses immediately for a %s, including cancellation',
    (kind) => {
      const { inspector, sceneEl, dispose } = mountViewport();
      const controls = inspector.easyGizmoControls;

      const selected = entity(sceneEl);
      const batched = kind === 'batched model' ? selected : entity(selected);
      batched.setAttribute('gltf-model', 'fixture.glb');
      if (batched !== selected) batched.object3D.position.set(3, 0, 2);
      const geometry = new THREE.BoxGeometry(2, 1, 4);
      const material = new THREE.MeshBasicMaterial();
      const batch = new THREE.BatchedMesh(1, 24, 36, material);
      const geometryId = batch.addGeometry(geometry);
      const instanceId = batch.addInstance(geometryId);
      const localMatrix = new THREE.Matrix4().makeTranslation(0, 0.5, 1);
      batched.object3D._batchSlots = [
        { batchedMesh: batch, instanceId, localMatrix }
      ];
      batched.object3D._batchLocalBbox =
        new THREE.Box3().setFromBufferAttribute(geometry.attributes.position);
      sceneEl.object3D.add(batch);
      const ordinary = new THREE.Mesh(geometry, material);
      ordinary.position.set(-3, 1, 2);
      if (batched !== selected) selected.object3D.add(ordinary);
      controls.el = selected;
      controls.object = selected.object3D;
      controls.dragEl = selected;
      controls.dragObject = selected.object3D;
      controls.dragSnapshot = { position: '0 0 0', rotation: '0 0 0' };

      function expectRenderedPose() {
        const rootMatrix = new THREE.Matrix4().compose(
          selected.object3D.position,
          selected.object3D.quaternion,
          selected.object3D.scale
        );
        const expectedBatch = rootMatrix.clone();
        if (batched !== selected) {
          expectedBatch.multiply(new THREE.Matrix4().makeTranslation(3, 0, 2));
        }
        expectedBatch.multiply(localMatrix);
        const actualBatch = batch.getMatrixAt(instanceId, new THREE.Matrix4());
        actualBatch.elements.forEach((value, index) => {
          expect(value).toBeCloseTo(expectedBatch.elements[index], 5);
        });
        if (batched !== selected) {
          const expectedOrdinary = rootMatrix.multiply(
            new THREE.Matrix4().makeTranslation(-3, 1, 2)
          );
          ordinary.matrixWorld.elements.forEach((value, index) => {
            expect(value).toBeCloseTo(expectedOrdinary.elements[index], 10);
          });
        }
      }

      try {
        selected.object3D.position.set(12, 2, -5);
        controls.dispatchEvent({ type: 'objectChange' });
        expectRenderedPose();
        selected.object3D.rotation.y = Math.PI / 3;
        controls.dispatchEvent({ type: 'objectChange' });
        expectRenderedPose();
        controls.endGesture('pointercancel');
        expectRenderedPose();
        expect(inspector.execute).not.toHaveBeenCalled();
      } finally {
        dispose();
        batch.dispose();
        geometry.dispose();
        material.dispose();
      }
    },
    15000
  );
});
