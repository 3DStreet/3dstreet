import { expect } from 'vitest';
import * as THREE from 'three';

const VEC3 = new Set(['position', 'rotation', 'scale']);

// Entities for group tests: an element with an object3D wired both ways, as
// A-Frame does, without A-Frame. `parent` is an element (the scene or another
// entity) whose object3D receives this one.
export function entity(
  parent,
  { cls, position = [0, 0, 0], yaw = 0, scale = [1, 1, 1] } = {}
) {
  const el = document.createElement('a-entity');
  if (cls) el.className = cls;
  el.object3D = new THREE.Group();
  el.object3D.el = el;
  el.object3D.position.set(...position);
  el.object3D.rotation.set(0, THREE.MathUtils.degToRad(yaw), 0);
  el.object3D.scale.set(...scale);
  el.components = {};
  el.sceneEl = parent.sceneEl || parent;
  // A-Frame hands vec3 components back as {x, y, z} and accepts either form.
  const nativeGet = el.getAttribute.bind(el);
  const nativeSet = el.setAttribute.bind(el);
  el.getAttribute = (name) => {
    const raw = nativeGet(name);
    if (VEC3.has(name) && typeof raw === 'string') {
      const [x, y, z] = raw.trim().split(/\s+/).map(Number);
      return { x, y, z };
    }
    return raw;
  };
  el.setAttribute = (name, value) =>
    nativeSet(
      name,
      VEC3.has(name) && value && typeof value === 'object'
        ? `${value.x} ${value.y} ${value.z}`
        : value
    );
  parent.append(el);
  parent.object3D.add(el.object3D);
  return el;
}

export function group(parent, options) {
  return entity(parent, { ...options, cls: 'user-group' });
}

// A box mesh inside `el` spanning `min`..`max` in el's local frame. The mesh
// origin is at the box's min corner, so an entity origin is never its center.
export function boxMesh(el, min, max) {
  const size = new THREE.Vector3(...max).sub(new THREE.Vector3(...min));
  const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
  geometry.translate(size.x / 2, size.y / 2, size.z / 2);
  const mesh = new THREE.Mesh(geometry);
  mesh.position.set(...min);
  el.object3D.add(mesh);
  return mesh;
}

export function scene() {
  const sceneEl = document.createElement('a-scene');
  sceneEl.object3D = new THREE.Scene();
  sceneEl.time = 0;
  document.body.append(sceneEl);
  return sceneEl;
}

export function expectBox(box, min, max, digits = 9) {
  expect(box).not.toBe(null);
  ['x', 'y', 'z'].forEach((axis, i) => {
    expect(box.min[axis]).toBeCloseTo(min[i], digits);
    expect(box.max[axis]).toBeCloseTo(max[i], digits);
  });
}
