import * as THREE from 'three';

// An `a-entity` element for jsdom, reduced to what placement reads: every
// element gets an object3D, attached to its parent's object3D while it is in
// the document (as A-Frame attaches it), and its position, rotation (degrees,
// YXZ as A-Frame) and scale attributes drive that object3D. Nothing else of
// A-Frame runs: components do not initialise and no `loaded` event is sent,
// so a test that needs one dispatches it.
//
// As A-Frame does, getAttribute hands back one object per entity and name,
// updated in place on every write; getDOMAttribute the entity's own value (also
// one object, or null); and removeAttribute resets the object3D and forgets a
// mixin's value. A fixture mixin ({scale, rotation}, see setFixtureMixin)
// shows while the entity has no value of its own.
//
// Defining the element is per test file (each file has its own window).

const VEC3_DEFAULT = {
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 }
};

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
      this._shown = {};
      this._own = {};
      this._mixin = {};
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
        super.setAttribute(name, `${v.x} ${v.y} ${v.z}`);
        Object.assign((this._own[name] ??= {}), v);
        Object.assign((this._shown[name] ??= {}), v);
        return;
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
      if (!VEC3.has(name)) return super.getAttribute(name);
      const raw = super.getAttribute(name);
      const v = raw !== null ? parseVec3(raw) : this._mixin[name];
      if (!v) return null;
      return Object.assign((this._shown[name] ??= {}), v);
    }
    getDOMAttribute(name) {
      if (!VEC3.has(name)) return super.getAttribute(name);
      if (!super.hasAttribute(name)) return null;
      return Object.assign(
        (this._own[name] ??= {}),
        parseVec3(super.getAttribute(name))
      );
    }
    removeAttribute(name) {
      if (VEC3.has(name)) {
        delete this._mixin[name];
        applyVec3(this.object3D, name, VEC3_DEFAULT[name]);
      }
      return super.removeAttribute(name);
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

/**
 * Give `el` a stand-in mixin: `values` ({scale, rotation} as "x y z" strings)
 * show, and drive its object3D, while it has no value of its own. Also sets a
 * `mixin` attribute, as an entity with a mixin carries one.
 */
export function setFixtureMixin(el, values, name = 'fixture-mixin') {
  for (const [component, value] of Object.entries(values)) {
    const v = parseVec3(value);
    el._mixin[component] = v;
    if (!el.hasAttribute(component)) applyVec3(el.object3D, component, v);
  }
  el.setAttribute('mixin', name);
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
