import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { captureFocusPose, resolveFocusPose } from '@/editor/lib/focusPose';

const near = (a, b) => expect(a).toBeCloseTo(b, 4);

function makeEntity({ position, rotationYDeg = 0, scale = 1 }) {
  const obj = new THREE.Object3D();
  obj.position.set(...position);
  obj.rotation.set(0, THREE.MathUtils.degToRad(rotationYDeg), 0);
  obj.scale.setScalar(scale);
  obj.updateMatrixWorld(true);
  return obj;
}

describe('focusPose', () => {
  it('capture → resolve round-trips the camera pose on a rotated, scaled entity', () => {
    const entity = makeEntity({
      position: [10, 0, -5],
      rotationYDeg: 37,
      scale: 3
    });
    const camera = new THREE.PerspectiveCamera(42);
    camera.position.set(14, 3, 2);
    camera.lookAt(9, 1, -7);
    camera.rotateZ(0.1); // a little roll, so orientation isn't just a look-at
    camera.updateMatrixWorld();

    const data = captureFocusPose(entity, camera);
    expect(data.lookAt).toBe(false);
    expect(data.fov).toBe(42);

    const state = resolveFocusPose(entity, data);
    near(state.position.x, 14);
    near(state.position.y, 3);
    near(state.position.z, 2);
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        state.rotation.x,
        state.rotation.y,
        state.rotation.z,
        'XYZ'
      )
    );
    near(Math.abs(q.dot(camera.quaternion)), 1);
    expect(state.zoom).toBe(42);
  });

  it('relative pose follows the entity when it moves', () => {
    const a = makeEntity({ position: [0, 0, 0] });
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 2, 5);
    camera.lookAt(0, 0, 0);
    const data = captureFocusPose(a, camera);

    const b = makeEntity({ position: [100, 0, 0], rotationYDeg: 90 });
    const state = resolveFocusPose(b, data);
    // (0, 2, 5) in the entity frame, rotated 90° about Y → (5, 2, 0)
    near(state.position.x, 105);
    near(state.position.y, 2);
    near(state.position.z, 0);
  });

  it('a legacy position-only pose resolves without rotation data', () => {
    const entity = makeEntity({ position: [1, 1, 1] });
    const state = resolveFocusPose(entity, {
      relativePosition: { x: 0, y: 5, z: 0 }
    });
    near(state.position.y, 6);
    expect(state.zoom).toBeUndefined();
  });
});
