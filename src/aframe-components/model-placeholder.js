/* global AFRAME, THREE */
import {
  getEntityBounds,
  lookupModelBounds,
  normalizeBounds,
  onEntityBounds,
  registerEntityBounds
} from '../model-bounds.js';

// Ghost boxes for models that have not arrived yet (#2009).
//
// A street's props, people and vehicles used to pop into an empty scene as
// each GLB finished downloading. This system draws a translucent box of the
// model's known bounds where the entity is from the moment its gltf-model /
// gltf-part component initializes (that covers batching's deferred
// duplicates too, which never download on their own) until `model-loaded`
// or `model-error` for that entity, when the box is removed. Bounds come
// from src/model-bounds.json for catalog models and legacy mixins, and from
// the per-entity registry for user uploads (src/model-bounds.js). An entity
// with no known bounds shows nothing and waits for a registration. A src or
// part change while pending swaps the box; clearing the src drops it. A
// model that has already settled (loaded or errored) never gets a box, which
// covers a cached gltf-part resolving synchronously before its component is
// even announced (see show()).
//
// Every ghost is one instance of a single THREE.InstancedMesh, so a
// clone-heavy street adds one draw call while it loads instead of thousands.
// The mesh hangs off an autocreated root entity under the scene (like
// batch-models' root) so the editor's raycaster still hits it; a hit's
// `instanceId` maps back to the entity through `mesh._placeholderEls`. Each
// tick writes every instance matrix from its entity's world matrix, hides
// instances whose entity is invisible or detached, and drops entries whose
// entity left the DOM. The box's local bounds are mirrored on
// `el.object3D._placeholderBbox` so the editor's selection and hover boxes
// can size from them before the mesh exists (viewport.js). The mesh is
// tagged `userData.source = 'INSPECTOR'` so exports hide it. Nothing here
// touches the `mesh` object3D that gltf-model, gltf-part and batch-models own.
//
// Backfill: when a user asset loads whose doc has no bounds yet, the
// signed-in owner's client computes them from the mesh and writes them to
// the doc once per session, so the next viewer gets a placeholder.

const MODEL_COMPONENTS = new Set(['gltf-model', 'gltf-part']);
export const PLACEHOLDER_ROOT_ID = 'model-placeholders-root';
const FILL_COLOR = 0x8f97a3;
const EDGE_COLOR = 0xc9ced6;
const FILL_OPACITY = 0.12;
const EDGE_OPACITY = 0.45;
// Keep the box just inside the true bounds so its bottom face does not
// z-fight with the ground the model stands on.
const INSET = 0.01;
const INITIAL_CAPACITY = 256;

// Fill and frame in one pass: each box face's UVs run 0..1, so the distance
// to the nearest face edge in screen pixels (via fwidth) draws a constant
// ~1.5 px frame whatever the box size or distance. The scene renders with a
// logarithmic depth buffer (index.html), so the logdepthbuf chunks are
// required: without them the box's depth is compared on a different scale
// from every built-in material and street surfaces occlude it at random.
const VERTEX_SHADER = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 transformed = position;
  #include <project_vertex>
  #include <logdepthbuf_vertex>
}
`;
const FRAGMENT_SHADER = /* glsl */ `
#include <common>
#include <logdepthbuf_pars_fragment>
uniform vec3 fillColor;
uniform vec3 edgeColor;
uniform float fillOpacity;
uniform float edgeOpacity;
varying vec2 vUv;
void main() {
  #include <logdepthbuf_fragment>
  vec2 fw = max(fwidth(vUv), vec2(1e-5));
  vec2 dist = min(vUv, 1.0 - vUv) / fw;
  float edge = 1.0 - smoothstep(0.6, 1.8, min(dist.x, dist.y));
  gl_FragColor = vec4(
    mix(fillColor, edgeColor, edge),
    mix(fillOpacity, edgeOpacity, edge)
  );
  #include <colorspace_fragment>
}
`;

/**
 * Bounds of `object` in the local space of `relativeTo` (an ancestor),
 * from the geometries' bounding boxes. Pure three.js; exported for tests.
 * @returns {{min:number[],max:number[]}|null}
 */
export function boundsFromObject3D(object, relativeTo) {
  if (!object || !relativeTo) return null;
  relativeTo.updateWorldMatrix(true, false);
  object.updateWorldMatrix(true, true);
  const inverse = relativeTo.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const tmpBox = new THREE.Box3();
  const tmpMatrix = new THREE.Matrix4();
  object.traverse((node) => {
    if (!node.isMesh || !node.geometry) return;
    const geometry = node.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox || geometry.boundingBox.isEmpty()) return;
    tmpMatrix.multiplyMatrices(inverse, node.matrixWorld);
    tmpBox.copy(geometry.boundingBox).applyMatrix4(tmpMatrix);
    box.union(tmpBox);
  });
  if (box.isEmpty()) return null;
  return normalizeBounds({ min: box.min.toArray(), max: box.max.toArray() });
}

/** Bounds for an entity: registered (user asset) first, else the table. */
export function boundsForEntity(el) {
  const registered = getEntityBounds(el);
  if (registered) return registered;
  const gltfModel = el.components && el.components['gltf-model'];
  if (gltfModel && typeof gltfModel.data === 'string' && gltfModel.data) {
    return lookupModelBounds(gltfModel.data);
  }
  const gltfPart = el.components && el.components['gltf-part'];
  if (gltfPart && gltfPart.data && gltfPart.data.src) {
    return lookupModelBounds(gltfPart.data.src, gltfPart.data.part);
  }
  return null;
}

/**
 * What the entity's model component currently points at, or null when it
 * points at nothing (empty gltf-model src, gltf-part without src or part)
 * and so will never emit model-loaded. Exported for tests.
 */
export function placeholderKey(el) {
  const components = (el && el.components) || {};
  const gltfModel = components['gltf-model'];
  if (gltfModel) {
    return typeof gltfModel.data === 'string' && gltfModel.data
      ? 'gltf-model:' + gltfModel.data
      : null;
  }
  const gltfPart = components['gltf-part'];
  if (gltfPart) {
    const data = gltfPart.data || {};
    return data.src && data.part ? `gltf-part:${data.src}#${data.part}` : null;
  }
  return null;
}

/** True when `object` and every ancestor up to the scene are visible. */
function isShownInScene(object) {
  let node = object;
  while (node) {
    if (!node.visible) return false;
    if (node.isScene) return true;
    node = node.parent;
  }
  return false; // not attached to the scene graph
}

const tmpMatrix = new THREE.Matrix4();
const ZERO_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

AFRAME.registerSystem('model-placeholder', {
  init: function () {
    const sceneEl = this.el;
    this.geometry = new THREE.BoxGeometry(1, 1, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        fillColor: { value: new THREE.Color(FILL_COLOR) },
        edgeColor: { value: new THREE.Color(EDGE_COLOR) },
        fillOpacity: { value: FILL_OPACITY },
        edgeOpacity: { value: EDGE_OPACITY }
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false
    });
    this.material.name = 'model-placeholder';
    this.rootEl = null;
    this.mesh = null;
    // el -> { index, key, local: Matrix4, fresh }
    this.entries = new Map();
    // Entity per instance slot; also exposed as mesh._placeholderEls.
    this.order = [];
    // Entities whose model is pending but whose bounds are not known yet.
    this.awaitingBounds = new Set();
    // Asset ids this session already backfilled (or checked).
    this.backfillChecked = new Set();

    this.onComponentInitialized = (e) => {
      if (MODEL_COMPONENTS.has(e.detail && e.detail.name)) this.show(e.target);
    };
    this.onComponentChanged = (e) => {
      // A src / part swap while pending re-sizes the box; an emptied src
      // removes the mesh without any model event, so drop the box here.
      if (MODEL_COMPONENTS.has(e.detail && e.detail.name)) this.show(e.target);
    };
    this.onComponentRemoved = (e) => {
      if (MODEL_COMPONENTS.has(e.detail && e.detail.name)) this.hide(e.target);
    };
    this.onModelLoading = (e) => this.show(e.target);
    this.onModelLoaded = (e) => {
      this.hide(e.target);
      this.maybeBackfill(e.target);
    };
    this.onModelError = (e) => this.hide(e.target);
    // componentinitialized / componentchanged / componentremoved do not
    // bubble: capture phase.
    sceneEl.addEventListener(
      'componentinitialized',
      this.onComponentInitialized,
      true
    );
    sceneEl.addEventListener('componentchanged', this.onComponentChanged, true);
    sceneEl.addEventListener('componentremoved', this.onComponentRemoved, true);
    sceneEl.addEventListener('model-loading', this.onModelLoading);
    sceneEl.addEventListener('model-loaded', this.onModelLoaded);
    sceneEl.addEventListener('model-error', this.onModelError);
    this.unsubscribeBounds = onEntityBounds((el) => {
      if (this.awaitingBounds.has(el)) this.show(el);
    });
  },

  remove: function () {
    const sceneEl = this.el;
    sceneEl.removeEventListener(
      'componentinitialized',
      this.onComponentInitialized,
      true
    );
    sceneEl.removeEventListener(
      'componentchanged',
      this.onComponentChanged,
      true
    );
    sceneEl.removeEventListener(
      'componentremoved',
      this.onComponentRemoved,
      true
    );
    sceneEl.removeEventListener('model-loading', this.onModelLoading);
    sceneEl.removeEventListener('model-loaded', this.onModelLoaded);
    sceneEl.removeEventListener('model-error', this.onModelError);
    if (this.unsubscribeBounds) this.unsubscribeBounds();
    for (const el of Array.from(this.entries.keys())) this.hide(el);
    if (this.mesh) {
      this.mesh.dispose();
      this.mesh = null;
    }
    if (this.rootEl && this.rootEl.parentNode) {
      this.rootEl.parentNode.removeChild(this.rootEl);
    }
    this.rootEl = null;
    this.geometry.dispose();
    this.material.dispose();
  },

  /** True while `el` shows a ghost box. */
  has: function (el) {
    return this.entries.has(el);
  },

  /**
   * Show (or re-size) the ghost box for `el` if its model is pending and its
   * bounds are known; drop it when the entity no longer points at a model.
   */
  show: function (el) {
    if (!el || !el.object3D || typeof el.getObject3D !== 'function') return;
    const key = placeholderKey(el);
    // A model whose load already settled needs no box even when it has no
    // `mesh`: a gltf-part whose parent GLB is cached resolves synchronously
    // inside its own update(), so model-loading and model-loaded both fire
    // before A-Frame emits componentinitialized, and batch-models' late
    // listener has stripped the mesh into a BatchedMesh on that very
    // model-loaded. Without this check the componentinitialized that follows
    // would open a box nothing ever closes (a street redraw re-creates every
    // clone this way). `_loadSettled` is the flag gltf-model / gltf-part keep
    // for batch-models: false from the start of a load, true once loaded or
    // errored; batching's deferred duplicates never set it, so they still get
    // a box until the batch pass re-emits model-loaded for them.
    const model = el.components['gltf-model'] || el.components['gltf-part'];
    if (!key || el.getObject3D('mesh') || (model && model._loadSettled)) {
      this.hide(el);
      return;
    }
    const entry = this.entries.get(el);
    if (entry && entry.key === key) return;
    const bounds = boundsForEntity(el);
    if (!bounds) {
      this.hide(el);
      this.awaitingBounds.add(el);
      return;
    }
    this.awaitingBounds.delete(el);
    if (entry) {
      entry.key = key;
      this.setBounds(el, entry, bounds);
      return;
    }
    this.ensureMesh(this.order.length + 1);
    const created = {
      index: this.order.length,
      key,
      local: new THREE.Matrix4(),
      fresh: true
    };
    this.setBounds(el, created, bounds);
    this.entries.set(el, created);
    this.order.push(el);
    this.mesh.count = this.order.length;
  },

  hide: function (el) {
    if (!el) return;
    this.awaitingBounds.delete(el);
    const entry = this.entries.get(el);
    if (!entry) return;
    this.entries.delete(el);
    if (el.object3D) delete el.object3D._placeholderBbox;
    // Swap-remove the slot; tick rewrites every matrix anyway.
    const last = this.order.pop();
    if (last !== el) {
      this.order[entry.index] = last;
      this.entries.get(last).index = entry.index;
    }
    if (this.mesh) {
      this.mesh.count = this.order.length;
      this.mesh.boundingSphere = null;
    }
  },

  setBounds: function (el, entry, bounds) {
    const size = [0, 1, 2].map((i) =>
      Math.max(bounds.max[i] - bounds.min[i] - INSET * 2, 0.001)
    );
    const center = [0, 1, 2].map((i) => (bounds.max[i] + bounds.min[i]) / 2);
    entry.local.makeScale(size[0], size[1], size[2]);
    entry.local.setPosition(center[0], center[1], center[2]);
    el.object3D._placeholderBbox = new THREE.Box3(
      new THREE.Vector3().fromArray(bounds.min),
      new THREE.Vector3().fromArray(bounds.max)
    );
  },

  /** Create the root entity and mesh on first use; grow the mesh as needed. */
  ensureMesh: function (needed) {
    if (this.mesh && needed <= this.mesh.instanceMatrix.count) return;
    let capacity = this.mesh
      ? this.mesh.instanceMatrix.count
      : INITIAL_CAPACITY;
    while (capacity < needed) capacity *= 2;
    if (!this.rootEl) {
      const rootEl = document.createElement('a-entity');
      rootEl.id = PLACEHOLDER_ROOT_ID;
      // Hidden from the scene graph panel; never serialized (the scene
      // serializer only walks #street-container and friends).
      rootEl.className = 'hideFromSceneGraph';
      this.el.appendChild(rootEl);
      this.rootEl = rootEl;
    }
    const mesh = new THREE.InstancedMesh(
      this.geometry,
      this.material,
      capacity
    );
    mesh.name = 'model-placeholders';
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Instances span the whole street: skip culling rather than keep a
    // bounding sphere current every tick.
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.renderOrder = 1;
    // Hidden from GLB export like the editor's own helpers (exportUtils).
    mesh.userData.source = 'INSPECTOR';
    // Editor raycaster: an intersection's instanceId indexes this array.
    mesh._placeholderEls = this.order;
    const previous = this.mesh;
    this.mesh = mesh;
    this.rootEl.setObject3D('placeholders', mesh);
    if (previous) previous.dispose();
  },

  tick: function () {
    const mesh = this.mesh;
    if (!mesh || this.order.length === 0) return;
    // Entities that left the DOM without a componentremoved for us. Reverse
    // order: hide() swap-removes with the last slot, already visited.
    for (let i = this.order.length - 1; i >= 0; i--) {
      if (this.order[i].isConnected === false) this.hide(this.order[i]);
    }
    const order = this.order;
    const count = order.length;
    for (let i = 0; i < count; i++) {
      const el = order[i];
      const entry = this.entries.get(el);
      const object = el.object3D;
      if (!object || !isShownInScene(object)) {
        mesh.setMatrixAt(i, ZERO_MATRIX);
        continue;
      }
      if (entry.fresh) {
        // First frame: the entity's world matrix may not be computed yet.
        object.updateWorldMatrix(true, false);
        entry.fresh = false;
      }
      tmpMatrix.multiplyMatrices(object.matrixWorld, entry.local);
      mesh.setMatrixAt(i, tmpMatrix);
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    // Raycasting recomputes the sphere lazily from the current matrices.
    mesh.boundingSphere = null;
  },

  /**
   * A user asset just loaded: if its doc has no bounds and this client is
   * the owner, compute them from the mesh and store them. Fire-and-forget.
   */
  maybeBackfill: function (el) {
    if (!el || typeof el.getAttribute !== 'function') return;
    const assetId = el.getAttribute('data-asset-id');
    const ownerUid = el.getAttribute('data-asset-owner-uid');
    if (!assetId || !ownerUid) return;
    if (getEntityBounds(el) || this.backfillChecked.has(assetId)) return;
    const mesh = el.getObject3D('mesh');
    if (!mesh) return;
    const bounds = boundsFromObject3D(mesh, el.object3D);
    if (!bounds) return;
    // Register locally so a reload of this entity gets a placeholder even
    // when the write below is skipped.
    registerEntityBounds(el, bounds);
    this.backfillChecked.add(assetId);
    Promise.all([import('@shared/services/firebase'), import('@shared/assets')])
      .then(async ([{ auth }, { assetsService }]) => {
        if (!auth.currentUser || auth.currentUser.uid !== ownerUid) return;
        const asset = await assetsService.getAsset(assetId, ownerUid);
        if (!asset || asset.deleted || normalizeBounds(asset.bounds)) return;
        await assetsService.updateAsset(assetId, ownerUid, { bounds });
        console.log(`[model-placeholder] stored bounds for asset ${assetId}`);
      })
      .catch((err) => {
        console.warn(
          `[model-placeholder] could not backfill bounds for ${assetId}:`,
          err
        );
      });
  }
});
