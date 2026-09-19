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
// model's known bounds under the entity from the moment its gltf-model /
// gltf-part component initializes (that covers batching's deferred
// duplicates too, which never download on their own) until `model-loaded`
// or `model-error` for that entity, when the box is removed. Bounds come
// from src/model-bounds.json for catalog models and legacy mixins, and from
// the per-entity registry for user uploads (src/model-bounds.js). An entity
// with no known bounds shows nothing and waits for a registration.
//
// The box lives under the entity as the `placeholder` object3D, so it
// inherits the entity's transform and visibility, sizes the editor's
// selection/hover box before the mesh exists, and never touches the `mesh`
// object3D that gltf-model, gltf-part and batch-models own. It is tagged
// `userData.source = 'INSPECTOR'` so exports hide it like other helpers.
// Geometry and materials are shared across every placeholder.
//
// Backfill: when a user asset loads whose doc has no bounds yet, the
// signed-in owner's client computes them from the mesh and writes them to
// the doc once per session, so the next viewer gets a placeholder.

const MODEL_COMPONENTS = new Set(['gltf-model', 'gltf-part']);
const FILL_COLOR = 0x8f97a3;
const EDGE_COLOR = 0xc9ced6;
const FILL_OPACITY = 0.12;
const EDGE_OPACITY = 0.45;
// Keep the fill just inside the true box so its bottom face does not
// z-fight with the ground the model stands on.
const FILL_INSET = 0.01;

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

AFRAME.registerSystem('model-placeholder', {
  init: function () {
    const sceneEl = this.el;
    this.unitBox = new THREE.BoxGeometry(1, 1, 1);
    this.unitEdges = new THREE.EdgesGeometry(this.unitBox);
    this.fillMaterial = new THREE.MeshBasicMaterial({
      color: FILL_COLOR,
      transparent: true,
      opacity: FILL_OPACITY,
      depthWrite: false,
      toneMapped: false
    });
    this.edgeMaterial = new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      transparent: true,
      opacity: EDGE_OPACITY,
      depthWrite: false,
      toneMapped: false
    });
    // Entities whose model is pending but whose bounds are not known yet.
    this.awaitingBounds = new Set();
    // Asset ids this session already backfilled (or checked).
    this.backfillChecked = new Set();

    this.onComponentInitialized = (e) => {
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
    // componentinitialized / componentremoved do not bubble: capture phase.
    sceneEl.addEventListener(
      'componentinitialized',
      this.onComponentInitialized,
      true
    );
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
      'componentremoved',
      this.onComponentRemoved,
      true
    );
    sceneEl.removeEventListener('model-loading', this.onModelLoading);
    sceneEl.removeEventListener('model-loaded', this.onModelLoaded);
    sceneEl.removeEventListener('model-error', this.onModelError);
    if (this.unsubscribeBounds) this.unsubscribeBounds();
    this.unitBox.dispose();
    this.unitEdges.dispose();
    this.fillMaterial.dispose();
    this.edgeMaterial.dispose();
  },

  /** Show a ghost box for `el` if its model is pending and bounds are known. */
  show: function (el) {
    if (!el || !el.object3D || typeof el.getObject3D !== 'function') return;
    if (el.getObject3D('mesh') || el.getObject3D('placeholder')) return;
    const bounds = boundsForEntity(el);
    if (!bounds) {
      this.awaitingBounds.add(el);
      return;
    }
    this.awaitingBounds.delete(el);
    el.setObject3D('placeholder', this.buildBox(el, bounds));
  },

  hide: function (el) {
    if (!el) return;
    this.awaitingBounds.delete(el);
    if (typeof el.getObject3D === 'function' && el.getObject3D('placeholder')) {
      el.removeObject3D('placeholder');
    }
  },

  buildBox: function (el, bounds) {
    const size = [0, 1, 2].map((i) => bounds.max[i] - bounds.min[i]);
    const center = [0, 1, 2].map((i) => (bounds.max[i] + bounds.min[i]) / 2);
    const group = new THREE.Group();
    group.name = 'model-placeholder';
    // Hidden from GLB export like the editor's own helpers (exportUtils).
    group.userData.source = 'INSPECTOR';

    const fill = new THREE.Mesh(this.unitBox, this.fillMaterial);
    fill.scale.set(
      Math.max(size[0] - FILL_INSET * 2, 0.001),
      Math.max(size[1] - FILL_INSET * 2, 0.001),
      Math.max(size[2] - FILL_INSET * 2, 0.001)
    );
    fill.position.set(center[0], center[1], center[2]);
    fill.renderOrder = 1;

    const edges = new THREE.LineSegments(this.unitEdges, this.edgeMaterial);
    edges.scale.set(size[0], size[1], size[2]);
    edges.position.set(center[0], center[1], center[2]);
    edges.renderOrder = 2;

    // A ghost must never cast or receive shadows, but the entity's `shadow`
    // component re-tags every new object3D on `object3dset`. Pin the flags
    // with no-op setters so that pass leaves the ghost alone.
    for (const obj of [fill, edges]) {
      for (const flag of ['castShadow', 'receiveShadow']) {
        Object.defineProperty(obj, flag, {
          get: () => false,
          set: () => {},
          configurable: true
        });
      }
    }

    // A-Frame's raycaster keeps an intersection only when the object has an
    // .el, so hovering or clicking the ghost selects its entity.
    fill.el = el;
    edges.el = el;
    group.add(fill, edges);
    return group;
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
