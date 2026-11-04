import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';

let definition;
let allocations = 0;
const countedThree = { ...THREE };
for (const type of [
  'Vector2',
  'Vector3',
  'Vector4',
  'Matrix3',
  'Matrix4',
  'Box3'
]) {
  countedThree[type] = new Proxy(THREE[type], {
    construct(target, args, constructor) {
      allocations++;
      return Reflect.construct(target, args, constructor);
    }
  });
}

beforeAll(async () => {
  vi.stubGlobal('THREE', countedThree);
  vi.stubGlobal('AFRAME', {
    THREE: countedThree,
    registerComponent: (name, component) => {
      if (name === 'splat') definition = component;
    },
    registerSystem: () => {}
  });
  await import('@/aframe-components/splat.js');
});

afterAll(() => vi.unstubAllGlobals());

function component(points = []) {
  const instance = Object.create(definition);
  instance.init();
  // Decoders reuse these values, including while pages are still arriving.
  const center = new THREE.Vector3();
  const scales = new THREE.Vector3(3, 1, 2);
  const quaternion = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0, 0, 1),
    Math.PI / 2
  );
  instance.splatMesh = {
    initialized: Promise.resolve(),
    isInitialized: false,
    forEachSplat: (callback) => {
      points.forEach((point, index) => {
        center.fromArray(point);
        callback(index, center, scales, quaternion);
      });
    }
  };
  return { instance, center, scales, quaternion };
}

describe('splat decoded bounds', () => {
  it('writes center bounds into the caller output without changing decoded values', () => {
    const { instance, center, scales, quaternion } = component([
      [-2, 4, 6],
      [3, -5, 8]
    ]);
    const target = new THREE.Box3();
    expect(instance.getBoundingBox(true, target)).toBe(target);
    expect(target.min.toArray()).toEqual([-2, -5, 6]);
    expect(target.max.toArray()).toEqual([3, 4, 8]);
    expect(center.toArray()).toEqual([3, -5, 8]);
    expect(scales.toArray()).toEqual([3, 1, 2]);
    expect(quaternion.z).toBeCloseTo(Math.SQRT1_2);
  });

  it('includes rotated anisotropic extents when centersOnly is false', () => {
    const { instance, center, scales } = component([[10, 20, 30]]);
    const target = instance.getBoundingBox(false, new THREE.Box3());
    [9, 17, 28].forEach((value, axis) => {
      expect(target.min.getComponent(axis)).toBeCloseTo(value);
    });
    [11, 23, 32].forEach((value, axis) => {
      expect(target.max.getComponent(axis)).toBeCloseTo(value);
    });
    expect(center.toArray()).toEqual([10, 20, 30]);
    expect(scales.toArray()).toEqual([3, 1, 2]);
  });

  it('revisits progressively available pages and clears previous extrema', () => {
    const points = [];
    const { instance } = component(points);
    const target = new THREE.Box3();
    expect(instance.getBoundingBox(true, target).isEmpty()).toBe(true);
    points.push([4, 5, 6]);
    expect(instance.getBoundingBox(true, target).min.toArray()).toEqual([
      4, 5, 6
    ]);
    points.push([-7, 10, 1]);
    expect(instance.getBoundingBox(true, target).min.toArray()).toEqual([
      -7, 5, 1
    ]);
    points.splice(0, points.length, [2, 3, 4]);
    expect(instance.getBoundingBox(true, target).max.toArray()).toEqual([
      2, 3, 4
    ]);
  });

  it('preserves independently owned default outputs', () => {
    const points = [[1, 2, 3]];
    const { instance } = component(points);
    const first = instance.getBoundingBox();
    points[0] = [8, 9, 10];
    const second = instance.getBoundingBox();
    expect(second).not.toBe(first);
    expect(first.min.toArray()).toEqual([1, 2, 3]);
    expect(second.min.toArray()).toEqual([8, 9, 10]);
  });

  it('allocates no recurring THREE objects for either caller-output mode', () => {
    const { instance } = component([[10, 20, 30]]);
    const target = new THREE.Box3();
    const vectorClone = vi.spyOn(THREE.Vector3.prototype, 'clone');
    const boxClone = vi.spyOn(THREE.Box3.prototype, 'clone');
    allocations = 0;
    for (let index = 0; index < 20; index++) {
      expect(instance.getBoundingBox(index % 2 === 0, target)).toBe(target);
    }
    expect(allocations).toBe(0);
    expect(vectorClone).not.toHaveBeenCalled();
    expect(boxClone).not.toHaveBeenCalled();
    vectorClone.mockRestore();
    boxClone.mockRestore();
  });

  it('releases scratch after decoding errors and rejects unloaded reads', () => {
    const { instance } = component([[1, 2, 3]]);
    const decode = instance.splatMesh.forEachSplat;
    instance.splatMesh.forEachSplat = () => {
      throw new Error('page unavailable');
    };
    expect(instance.getBoundingBox(true, new THREE.Box3())).toBeNull();
    instance.splatMesh.forEachSplat = decode;
    expect(instance.getBoundingBox().min.toArray()).toEqual([1, 2, 3]);
    instance.splatMesh = null;
    expect(instance.getBoundingBox()).toBeNull();
  });

  it('guards reentrant reads without overwriting either output', () => {
    const { instance } = component([[1, 2, 3]]);
    const decode = instance.splatMesh.forEachSplat;
    const nested = new THREE.Box3(
      new THREE.Vector3(7, 8, 9),
      new THREE.Vector3(7, 8, 9)
    );
    instance.splatMesh.forEachSplat = (callback) => {
      expect(instance.getBoundingBox(false, nested)).toBeNull();
      decode(callback);
    };
    expect(instance.getBoundingBox().min.toArray()).toEqual([1, 2, 3]);
    expect(nested.min.toArray()).toEqual([7, 8, 9]);
    expect(instance._boundsTarget).toBeNull();
  });
});
