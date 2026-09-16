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
vi.mock('@/editor/lib/gizmos/easyGizmoFlag.js', () => ({
  isEasyGizmo: () => true
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

describe('easy gizmo viewport batch synchronization', () => {
  it.each(['batched model', 'group with mixed children'])(
    'updates rendered poses immediately for a %s, including cancellation',
    async (kind) => {
      const canvas = document.createElement('canvas');
      document.body.append(canvas);
      const sceneEl = document.createElement('a-scene');
      document.body.append(sceneEl);
      sceneEl.object3D = new THREE.Scene();
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
      await vi.waitFor(
        () => expect(inspector.easyGizmoControls).toBeDefined(),
        {
          timeout: 10000
        }
      );
      const controls = inspector.easyGizmoControls;

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
        parentEl.object3D.add(el.object3D);
        return el;
      }

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
        controls.dispose();
        inspector.shapeVertexControls.dispose();
        inspector.streetNodeControls.dispose();
        inspector.segmentWidthControls.dispose();
        batch.dispose();
        geometry.dispose();
        material.dispose();
      }
    },
    15000
  );
});
