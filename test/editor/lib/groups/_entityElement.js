import * as THREE from 'three';

// An `a-entity` element for jsdom, reduced to what placement reads: every
// element gets an object3D, attached to its parent's object3D while it is in
// the document (as A-Frame attaches it), and its position, rotation (degrees,
// YXZ as A-Frame) and scale attributes drive that object3D. Nothing else of
// A-Frame runs: components do not initialise and no `loaded` event is sent,
// so a test that needs one dispatches it.
//
// Defining the element is per test file (each file has its own window).

const VEC3 = new Set(['position', 'rotation', 'scale']);

function parseVec3(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    const [x = 0, y = 0, z = 0] = value.trim().split(/\s+/).map(Number);
    return { x, y, z };
  }
  return { x: value.x, y: value.y, z: value.z };
}

function applyVec3(object3D, name, v) {
  if (name === 'position') object3D.position.set(v.x, v.y, v.z);
  if (name === 'scale') object3D.scale.set(v.x, v.y, v.z);
  if (name === 'rotation') {
    const deg = THREE.MathUtils.degToRad;
    object3D.rotation.set(deg(v.x), deg(v.y), deg(v.z), 'YXZ');
  }
}

export function defineEntityElement() {
  if (customElements.get('a-entity')) return;

  class EntityElement extends HTMLElement {
    constructor() {
      super();
      this.isEntity = true;
      this.components = {};
      this.object3D = new THREE.Group();
      this.object3D.rotation.order = 'YXZ';
      this.object3D.el = this;
    }
    // A-Frame's parent entity (or scene) of this one.
    get parentEl() {
      return this.parentElement;
    }
    connectedCallback() {
      this.parentElement?.object3D?.add(this.object3D);
    }
    disconnectedCallback() {
      this.object3D.removeFromParent();
    }
    setAttribute(name, value) {
      if (VEC3.has(name)) {
        const v = parseVec3(value);
        applyVec3(this.object3D, name, v);
        return super.setAttribute(name, `${v.x} ${v.y} ${v.z}`);
      }
      if (name === 'visible') {
        this.object3D.visible = value !== false && value !== 'false';
      }
      return super.setAttribute(
        name,
        value && typeof value === 'object' ? JSON.stringify(value) : value
      );
    }
    getAttribute(name) {
      const raw = super.getAttribute(name);
      return VEC3.has(name) ? parseVec3(raw) : raw;
    }
    getObject3D() {
      return undefined;
    }
    pause() {}
    play() {}
  }

  customElements.define('a-entity', EntityElement);
  customElements.define('a-image', class extends EntityElement {});
}

/** `el`'s world matrix, current. */
export function worldOf(el) {
  el.object3D.updateWorldMatrix(true, false);
  return el.object3D.matrixWorld.clone();
}

/** The world matrix of a definition's pose placed under `parentEl`. */
export function worldOfDefinition(parentEl, components) {
  const probe = new THREE.Object3D();
  probe.rotation.order = 'YXZ';
  for (const name of VEC3) {
    const v = parseVec3(components[name]);
    if (v) applyVec3(probe, name, v);
  }
  probe.updateMatrix();
  parentEl.object3D.updateWorldMatrix(true, false);
  return probe.matrix.clone().premultiply(parentEl.object3D.matrixWorld);
}

export function expectMatrixClose(expect, actual, expected, digits = 6) {
  actual.elements.forEach((value, i) =>
    expect(value).toBeCloseTo(expected.elements[i], digits)
  );
}
