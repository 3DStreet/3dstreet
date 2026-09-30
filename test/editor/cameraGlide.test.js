import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  createLookAtGlide,
  headingPreservingFocusPosition,
  lookAtQuaternion,
  targetOnAxis
} from '@/editor/lib/cameraGlide';

const near = (a, b) => expect(a).toBeCloseTo(b, 5);

function poseLookingAt(position, target) {
  const p = new THREE.Vector3(...position);
  return {
    position: p,
    quaternion: lookAtQuaternion(p, new THREE.Vector3(...target))
  };
}

function expectQuat(actual, expected) {
  // q and -q are the same rotation.
  expect(Math.abs(actual.dot(expected))).toBeCloseTo(1, 5);
}

function forward(q) {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(q);
}

function roll(q) {
  return new THREE.Vector3(1, 0, 0).applyQuaternion(q).y;
}

describe('cameraGlide', () => {
  it('lands exactly on both endpoint poses', () => {
    const start = poseLookingAt([0, 15, 30], [0, 1.6, 0]);
    const end = poseLookingAt([20, 4, -10], [25, 1, -20]);
    const glide = createLookAtGlide({
      startPosition: start.position,
      startQuaternion: start.quaternion,
      startTarget: new THREE.Vector3(0, 1.6, 0),
      endPosition: end.position,
      endTarget: new THREE.Vector3(25, 1, -20)
    });
    const camera = new THREE.PerspectiveCamera();
    glide.apply(camera, 0);
    expect(camera.position.distanceTo(start.position)).toBeLessThan(1e-9);
    expectQuat(camera.quaternion, start.quaternion);
    glide.apply(camera, 1);
    expect(camera.position.distanceTo(end.position)).toBeLessThan(1e-9);
    expectQuat(camera.quaternion, end.quaternion);
    // Just inside the ends the derived rotation is continuous with them.
    glide.apply(camera, 1e-6);
    expectQuat(camera.quaternion, start.quaternion);
    glide.apply(camera, 1 - 1e-6);
    expectQuat(camera.quaternion, end.quaternion);
  });

  it('keeps the horizon level between level poses', () => {
    const start = poseLookingAt([0, 15, 30], [0, 0, 0]);
    const end = poseLookingAt([-30, 2, 5], [10, 1, 5]);
    const glide = createLookAtGlide({
      startPosition: start.position,
      startQuaternion: start.quaternion,
      endPosition: end.position,
      endTarget: new THREE.Vector3(10, 1, 5)
    });
    const camera = new THREE.PerspectiveCamera();
    for (let t = 0; t <= 1; t += 0.1) {
      glide.apply(camera, t);
      near(roll(camera.quaternion), 0);
    }
  });

  it('aims at the tweened target mid-flight', () => {
    const start = poseLookingAt([0, 10, 20], [0, 0, 0]);
    const endTarget = new THREE.Vector3(10, 0, 0);
    const glide = createLookAtGlide({
      startPosition: start.position,
      startQuaternion: start.quaternion,
      startTarget: new THREE.Vector3(0, 0, 0),
      endPosition: new THREE.Vector3(10, 5, 10),
      endTarget
    });
    const camera = new THREE.PerspectiveCamera();
    glide.apply(camera, 0.5);
    const expectedTarget = new THREE.Vector3(5, 0, 0);
    const toTarget = expectedTarget.sub(camera.position).normalize();
    near(forward(camera.quaternion).dot(toTarget), 1);
  });

  it('holds the heading for a glide that keeps its orientation', () => {
    const start = poseLookingAt([0, 20, 40], [0, 0, 0]);
    const center = new THREE.Vector3(8, 1, -3);
    const endPosition = headingPreservingFocusPosition(
      start.quaternion,
      center,
      6
    );
    const glide = createLookAtGlide({
      startPosition: start.position,
      startQuaternion: start.quaternion,
      startTarget: new THREE.Vector3(0, 0, 0),
      endPosition,
      endQuaternion: start.quaternion,
      endTarget: center
    });
    const camera = new THREE.PerspectiveCamera();
    for (let t = 0; t <= 1; t += 0.125) {
      glide.apply(camera, t);
      expectQuat(camera.quaternion, start.quaternion);
    }
    // The center ends up on the view axis at the framing distance.
    near(endPosition.distanceTo(center), 6);
    const toCenter = center.clone().sub(endPosition).normalize();
    near(forward(start.quaternion).dot(toCenter), 1);
  });

  it('refuses a heading-preserving step that would drop below the floor', () => {
    const lookingUp = poseLookingAt([0, 1, 10], [0, 30, 0]);
    expect(
      headingPreservingFocusPosition(
        lookingUp.quaternion,
        new THREE.Vector3(0, 1, 0),
        10,
        0
      )
    ).toBeNull();
  });

  it('glides from a straight-down plan view without flipping', () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 100, 0);
    camera.rotation.set(-Math.PI / 2, 0, 0); // top-down, north-up
    camera.updateMatrixWorld();
    const startQuat = camera.quaternion.clone();
    const end = poseLookingAt([5, 10, 25], [5, 0, 0]);
    const glide = createLookAtGlide({
      startPosition: camera.position,
      startQuaternion: startQuat,
      endPosition: end.position,
      endTarget: new THREE.Vector3(5, 0, 0)
    });
    glide.apply(camera, 0.001);
    expectQuat(camera.quaternion, startQuat);
    let prev = camera.quaternion.clone();
    for (let t = 0.05; t <= 1.0001; t += 0.05) {
      glide.apply(camera, Math.min(t, 1));
      // No per-step jump bigger than a smooth sweep would make.
      expect(camera.quaternion.angleTo(prev)).toBeLessThan(0.25);
      prev = camera.quaternion.clone();
    }
    expectQuat(camera.quaternion, end.quaternion);
  });

  it('targetOnAxis projects a hint onto the forward axis, else uses the fallback depth', () => {
    const pose = poseLookingAt([0, 0, 10], [0, 0, 0]);
    const onAxis = targetOnAxis(
      pose.position,
      pose.quaternion,
      new THREE.Vector3(3, 0, 0),
      99
    );
    near(onAxis.x, 0);
    near(onAxis.z, 0);
    const behind = targetOnAxis(
      pose.position,
      pose.quaternion,
      new THREE.Vector3(0, 0, 20),
      4
    );
    near(behind.z, 6);
  });
});
