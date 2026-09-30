import { vi } from 'vitest';
import * as THREE from 'three';
import { History } from '@/editor/lib/history.js';
import { commandsByType } from '@/editor/lib/commands/index.js';
import {
  TRANSFORM_REFUSED,
  notifyRefusal,
  refuseGuardedTransform
} from '@/editor/lib/transformGuard.js';
import useCurrentUploadStore from '@shared/assets/state/currentUploadStore.js';
import { boxMesh } from './_groupFixtures.js';
import { defineEntityElement } from './_entityElement.js';

// A scene for placement tests: real commands, guard and History behind the
// editor's execute, entities whose object3D follows their pose (see
// _entityElement.js), a camera looking down at the ground ahead of it, and the
// scope as plain state (`openGroups`), which is all placement reads of it.
//
// Every call to execute is recorded, refused or not. A created entity gets its
// `loaded` event at once, as A-Frame sends it once its components are ready.

defineEntityElement();

export function mountPlacementScene() {
  const sceneEl = document.createElement('a-scene');
  sceneEl.object3D = new THREE.Scene();
  sceneEl.isScene = true;
  const canvas = document.createElement('canvas');
  canvas.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    width: 1200,
    height: 800,
    right: 1200,
    bottom: 800
  });
  sceneEl.canvas = canvas;
  document.body.append(sceneEl);
  const root = entityIn(sceneEl, { id: 'street-container' });

  const camera = new THREE.PerspectiveCamera(60, 1.5, 0.1, 2000);
  camera.position.set(0, 30, 40);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  const executed = [];
  const inspector = {
    sceneEl,
    camera,
    config: { defaultParent: '#street-container' },
    selectedEntity: null,
    selectEntity(el) {
      this.selectedEntity = el;
    },
    // The editor's execute (index.jsx): the guard, then History.
    execute(type, payload, name, callback) {
      executed.push([type, payload]);
      const refusal = refuseGuardedTransform(type, payload);
      if (refusal) {
        notifyRefusal(payload?.entity, refusal);
        return TRANSFORM_REFUSED;
      }
      const Cmd = commandsByType.get(type);
      const cmd = new Cmd(this, payload, callback);
      this.history.execute(cmd, name);
      if (type === 'entitycreate') {
        document
          .getElementById(cmd.entityId)
          ?.dispatchEvent(new Event('loaded'));
      }
      return undefined;
    }
  };
  inspector.history = new History(inspector);
  const notify = {
    successMessage: vi.fn(),
    errorMessage: vi.fn(),
    warningMessage: vi.fn(),
    infoMessage: vi.fn()
  };
  vi.stubGlobal('AFRAME', { INSPECTOR: inspector, scenes: [sceneEl] });
  vi.stubGlobal('STREET', { notify });
  useCurrentUploadStore.getState().clear();

  return {
    sceneEl,
    root,
    camera,
    inspector,
    executed,
    notify,
    creates: () => executed.filter(([type]) => type === 'entitycreate'),
    openGroups(...ids) {
      inspector.groupScope = { openStack: Object.freeze(ids) };
    },
    closeGroups() {
      inspector.groupScope = undefined;
    },
    /** A group whose origin is far from where things are placed. */
    scopeGroups() {
      const outer = entityIn(root, {
        id: 'outer',
        cls: 'user-group',
        position: '-60 0 30',
        rotation: '0 -20 0'
      });
      const inner = entityIn(outer, {
        id: 'inner',
        cls: 'user-group',
        position: '50 0 -20',
        rotation: '0 40 0',
        scale: '2 2 2'
      });
      return { outer, inner };
    },
    /** Point the camera at the sky, so the view meets no ground. */
    lookUp() {
      camera.lookAt(0, 60, -40);
      camera.updateMatrixWorld();
    }
  };
}

export function entityIn(parent, { id, cls, position, rotation, scale } = {}) {
  const el = document.createElement('a-entity');
  if (id) el.id = id;
  if (cls) el.className = cls;
  parent.append(el);
  if (position) el.setAttribute('position', position);
  if (rotation) el.setAttribute('rotation', rotation);
  if (scale) el.setAttribute('scale', scale);
  return el;
}

/** A member of `groupEl` with box geometry from `min` to `max` in its frame. */
export function memberWithBox(groupEl, min, max, options = {}) {
  const el = entityIn(groupEl, options);
  boxMesh(el, min, max);
  return el;
}

/** File inputs created from now on, captured; clicking one opens nothing. */
export function captureFileInputs() {
  const inputs = [];
  const create = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag, options) => {
    const el = create(tag, options);
    if (tag === 'input') {
      el.click = () => {};
      inputs.push(el);
    }
    return el;
  });
  return inputs;
}

/** The world position a create's definition commits to. */
export function committedWorldPosition(root, [, payload]) {
  const parent = payload.parentEl || root;
  const probe = new THREE.Object3D();
  probe.rotation.order = 'YXZ';
  const c = payload.components || {};
  const read = (v) =>
    typeof v === 'string' ? v.trim().split(/\s+/).map(Number) : [v.x, v.y, v.z];
  if (c.position) probe.position.set(...read(c.position));
  if (c.rotation) {
    const [x, y, z] = read(c.rotation).map(THREE.MathUtils.degToRad);
    probe.rotation.set(x, y, z, 'YXZ');
  }
  if (c.scale) probe.scale.set(...read(c.scale));
  probe.updateMatrix();
  parent.object3D.updateWorldMatrix(true, false);
  const world = probe.matrix.premultiply(parent.object3D.matrixWorld);
  return new THREE.Vector3().setFromMatrixPosition(world);
}
