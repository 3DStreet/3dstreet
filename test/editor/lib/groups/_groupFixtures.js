import { expect } from 'vitest';
import * as THREE from 'three';

const VEC3 = new Set(['position', 'rotation', 'scale']);
const VEC3_DEFAULT = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 }
};

/**
 * The single-property vec3 components A-Frame registers for position,
 * rotation and scale, reduced to what the commands read, for an AFRAME stub's
 * `components`. A missing value stringifies as the default, as A-Frame reads
 * one from the live object.
 */
export function vec3Components() {
  const component = (name) => ({
    isSingleProperty: true,
    schema: {
      type: 'vec3',
      default: { ...VEC3_DEFAULT[name] },
      stringify: (v) => {
        if (typeof v === 'string') return v;
        const d = VEC3_DEFAULT[name];
        return `${v?.x ?? d.x} ${v?.y ?? d.y} ${v?.z ?? d.z}`;
      }
    }
  });
  return {
    position: component('position'),
    rotation: component('rotation'),
    scale: component('scale')
  };
}

function toVec3(value) {
  if (typeof value === 'string') {
    const [x, y, z] = value.trim().split(/\s+/).map(Number);
    return { x, y, z };
  }
  return { x: value.x, y: value.y, z: value.z };
}

// What A-Frame does for position, rotation and scale that tests of the
// command layer depend on: getAttribute hands back ONE object per entity and
// name, updated in place on every write (an uncopied read changes under a
// later write); getDOMAttribute hands back the entity's own value, also one
// object updated in place, or null; removeAttribute drops the component, which
// resets the object3D and forgets a mixin's value. `mixin` ({scale, rotation})
// stands in for a mixin: its values show while the entity has none of its own.
function addVec3Behaviour(el, nativeGet, nativeRemove, mixin) {
  const shown = {};
  const own = {};
  const fromMixin = { ...(mixin || {}) };
  const stable = (store, name, v) => {
    store[name] ??= {};
    return Object.assign(store[name], v);
  };
  el.getAttribute = (name) => {
    const raw = nativeGet(name);
    if (!VEC3.has(name)) return raw;
    if (typeof raw === 'string') return stable(shown, name, toVec3(raw));
    if (fromMixin[name]) return stable(shown, name, toVec3(fromMixin[name]));
    return null;
  };
  el.getDOMAttribute = (name) => {
    const raw = nativeGet(name);
    if (!VEC3.has(name)) return raw;
    return typeof raw === 'string' ? stable(own, name, toVec3(raw)) : null;
  };
  el.removeAttribute = (name) => {
    if (VEC3.has(name)) {
      delete fromMixin[name];
      const d = VEC3_DEFAULT[name];
      if (name === 'rotation') el.object3D.rotation.set(0, 0, 0);
      else el.object3D[name].set(d.x, d.y, d.z);
    }
    return nativeRemove(name);
  };
}

// Entities for group tests: an element with an object3D wired both ways, as
// A-Frame does, without A-Frame. `parent` is an element (the scene or another
// entity) whose object3D receives this one.
export function entity(
  parent,
  { cls, position = [0, 0, 0], yaw = 0, scale = [1, 1, 1], mixin } = {}
) {
  const el = document.createElement('a-entity');
  if (cls) el.className = cls;
  el.object3D = new THREE.Group();
  el.object3D.el = el;
  el.object3D.position.set(...position);
  el.object3D.rotation.set(0, THREE.MathUtils.degToRad(yaw), 0);
  el.object3D.scale.set(...scale);
  el.components = {};
  el.isEntity = true;
  el.flushToDOM = () => {};
  el.sceneEl = parent.sceneEl || parent;
  // A-Frame hands vec3 components back as {x, y, z} and accepts either form.
  const nativeGet = el.getAttribute.bind(el);
  const nativeSet = el.setAttribute.bind(el);
  addVec3Behaviour(el, nativeGet, el.removeAttribute.bind(el), mixin);
  if (mixin) nativeSet('mixin', 'fixture-mixin');
  el.setAttribute = (name, value) => {
    // The visible component drives the object3D, which is what the layer
    // panel's eye and everything reading visibility use.
    if (name === 'visible') {
      el.object3D.visible = value !== false && value !== 'false';
    }
    return nativeSet(
      name,
      VEC3.has(name) && value && typeof value === 'object'
        ? `${value.x} ${value.y} ${value.z}`
        : value
    );
  };
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
  // A-Frame's raycaster maps a hit to its entity through this.
  mesh.el = el;
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
