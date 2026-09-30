import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  localPoseFromWorld,
  positionForRotationAboutCenter,
  rayHitsGroupBox
} from '@/editor/lib/groups/groupTransformMath.js';

const deg = THREE.MathUtils.degToRad;

function matrix({
  position = [0, 0, 0],
  yaw = 0,
  pitch = 0,
  scale = [1, 1, 1]
}) {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(deg(pitch), deg(yaw), 0, 'YXZ')
    ),
    new THREE.Vector3(...scale)
  );
}

function pose() {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: new THREE.Vector3()
  };
}

describe('rotation about a center', () => {
  it('keeps the pivot fixed and moves the origin around it', () => {
    const posStart = new THREE.Vector3(0, 0, 0);
    const pivot = new THREE.Vector3(10, 0, 0);
    const qStart = new THREE.Quaternion();
    const qNow = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 2
    );
    const out = positionForRotationAboutCenter(
      posStart,
      qStart,
      qNow,
      pivot,
      new THREE.Vector3()
    );
    // The origin sat 10 m from the pivot along -X; a quarter turn about +Y
    // carries it to 10 m along +Z from the pivot.
    expect(out.x).toBeCloseTo(10, 9);
    expect(out.z).toBeCloseTo(10, 9);
    expect(out.y).toBeCloseTo(0, 9);
  });

  it('takes the total turn from the gesture start, not a per-call increment', () => {
    const qStart = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 1, 0),
      Math.PI / 4
    );
    const posStart = new THREE.Vector3(1, 2, 3);
    const pivot = new THREE.Vector3(4, 2, 0);
    const out = new THREE.Vector3();
    positionForRotationAboutCenter(posStart, qStart, qStart, pivot, out);
    expect(out.distanceTo(posStart)).toBeLessThan(1e-12);
  });
});

describe('local pose under a new parent', () => {
  it('reproduces the world matrix when the pose is representable', () => {
    const parent = matrix({ position: [5, 0, 2], yaw: 60, scale: [2, 2, 2] });
    const world = matrix({ position: [1, 1, 1], yaw: 35 });
    const out = pose();
    expect(localPoseFromWorld(parent, world, out)).toBe(true);
    const rebuilt = new THREE.Matrix4()
      .compose(out.position, out.quaternion, out.scale)
      .premultiply(parent);
    rebuilt.elements.forEach((value, i) =>
      expect(value).toBeCloseTo(world.elements[i], 9)
    );
  });

  it('refuses a child turned against an unevenly scaled parent, which would need a shear', () => {
    const parent = matrix({ scale: [2, 1, 1] });
    expect(localPoseFromWorld(parent, matrix({ yaw: 30 }), pose())).toBe(false);
    expect(
      localPoseFromWorld(
        matrix({ scale: [1, 2, 1] }),
        matrix({ pitch: 30 }),
        pose()
      )
    ).toBe(false);
  });

  it('accepts an unevenly scaled parent when the turn keeps the scaled axis (not a blanket refusal)', () => {
    expect(
      localPoseFromWorld(matrix({ scale: [2, 1, 1] }), matrix({}), pose())
    ).toBe(true);
    // Scaling along Y commutes with a turn about Y.
    expect(
      localPoseFromWorld(
        matrix({ scale: [1, 2, 1] }),
        matrix({ yaw: 30 }),
        pose()
      )
    ).toBe(true);
  });

  it('refuses a parent with no volume', () => {
    expect(
      localPoseFromWorld(matrix({ scale: [0, 1, 1] }), matrix({}), pose())
    ).toBe(false);
  });
});

describe('picking a group by its box', () => {
  it('hits a zero-height box from above and leaves the drawn box flat (fails if a flat group cannot be picked, or if picking thickens its box)', () => {
    const flat = new THREE.Box3(
      new THREE.Vector3(-1, 0, -1),
      new THREE.Vector3(1, 0, 1)
    );
    const ray = new THREE.Ray(
      new THREE.Vector3(0.25, 10, 0.25),
      new THREE.Vector3(0, -1, 0)
    );
    const distance = rayHitsGroupBox(ray, flat, new THREE.Matrix4());
    expect(distance).toBeCloseTo(10, 2);
    expect(flat.min.y).toBe(0);
    expect(flat.max.y).toBe(0);
  });

  it('picks by the rotated box, not a world-aligned stand-in', () => {
    // A long thin box turned 45 degrees: a ray through the world-aligned
    // bounding square's corner misses the box itself.
    const box = new THREE.Box3(
      new THREE.Vector3(-5, 0, -0.5),
      new THREE.Vector3(5, 1, 0.5)
    );
    const turned = matrix({ yaw: 45 });
    const down = new THREE.Vector3(0, -1, 0);
    const alongBox = new THREE.Vector3(3, 10, -3);
    const cornerOfSquare = new THREE.Vector3(3, 10, 3);
    expect(
      rayHitsGroupBox(new THREE.Ray(alongBox, down), box, turned)
    ).not.toBe(null);
    expect(
      rayHitsGroupBox(new THREE.Ray(cornerOfSquare, down), box, turned)
    ).toBe(null);
  });

  it('reports world distance under a scaled group, and null for an empty box', () => {
    const box = new THREE.Box3(
      new THREE.Vector3(-1, 0, -1),
      new THREE.Vector3(1, 1, 1)
    );
    const ray = new THREE.Ray(
      new THREE.Vector3(0, 20, 0),
      new THREE.Vector3(0, -1, 0)
    );
    expect(rayHitsGroupBox(ray, box, matrix({ scale: [2, 2, 2] }))).toBeCloseTo(
      18,
      9
    );
    expect(rayHitsGroupBox(ray, new THREE.Box3(), new THREE.Matrix4())).toBe(
      null
    );
  });
});
