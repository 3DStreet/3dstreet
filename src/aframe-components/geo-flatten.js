/* global AFRAME */

// geo-flatten marks an entity as a terrain-flattening volume for the
// geospatial tiles layer (#1476). Any number of entities may carry it — each
// active component contributes one shape to the tileset's TileFlatteningPlugin
// via the scene-level registry below, which google-maps-aerial consumes.
// Flattening only takes effect while the geo layer's master switch
// (street-geo `enableFlattening`) is on and a google3d layer exists.
//
// The component lives on the entity it flattens for, so it survives the
// serialize/recreate cycle of SceneGraph reordering (EntityReparentCommand):
// the recreated entity's component re-registers itself, where the previous
// id-reference design (street-geo `flatteningShape`) went stale.

const THREE = AFRAME.THREE;

// Debounce for auto-mode footprint recomputes: subtree mutation events arrive
// in bursts (scene load, street rebuild, async gltf loads) and every proxy
// resize triggers a full re-flatten of active tiles downstream.
const PROXY_REBUILD_DEBOUNCE_MS = 500;

const _box = new THREE.Box3();
const _meshBox = new THREE.Box3();
const _matrix = new THREE.Matrix4();
const _inverseMatrix = new THREE.Matrix4();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();

AFRAME.registerSystem('geo-flatten', {
  init: function () {
    this.components = new Set();
  },

  register: function (component) {
    this.components.add(component);
    this.notifyChanged();
  },

  unregister: function (component) {
    this.components.delete(component);
    this.notifyChanged();
  },

  // Consumers (google-maps-aerial) and UI (GeoSidebar) listen for this to
  // re-sync against the registry; it fires on register/unregister and on any
  // component schema update (e.g. `enabled` toggled).
  notifyChanged: function () {
    this.el.emit('geo-flatten-registry-changed', null, false);
  },

  getActiveComponents: function () {
    const active = [];
    this.components.forEach((component) => {
      if (component.isActive()) {
        active.push(component);
      }
    });
    return active;
  }
});

AFRAME.registerComponent('geo-flatten', {
  schema: {
    enabled: { type: 'boolean', default: true },
    // mesh: flatten onto the entity's own (first) mesh — right for simple
    //   primitives like the purple flattening box, and preserves the legacy
    //   single-shape semantics (terrain snaps to the box's lower surface).
    // auto: flatten onto an invisible ground-level plane sized to the
    //   entity subtree's footprint — right for complex entities like managed
    //   streets, whose real meshes would be slow raycast targets and
    //   semantically wrong (terrain would snap to the tops of vehicles).
    mode: { type: 'string', default: 'mesh', oneOf: ['mesh', 'auto'] }
  },

  init: function () {
    this.proxyMesh = null;
    this.proxyDirty = true;
    this.proxyRebuildTimeout = null;
    this.cachedSourceMesh = null;
    this.markSubtreeDirty = this.markSubtreeDirty.bind(this);
    // Subtree growth/shrink invalidates the auto footprint and the cached
    // mesh-mode source. All of these bubble from descendants (segment
    // add/remove, async model loads).
    this.el.addEventListener('child-attached', this.markSubtreeDirty);
    this.el.addEventListener('child-detached', this.markSubtreeDirty);
    this.el.addEventListener('model-loaded', this.markSubtreeDirty);
    this.el.addEventListener('object3dset', this.markSubtreeDirty);
    this.el.addEventListener('object3dremove', this.markSubtreeDirty);
    this.system.register(this);
  },

  update: function () {
    // Mode may have changed; recompute the footprint / source on next read.
    this.proxyDirty = true;
    this.cachedSourceMesh = null;
    this.system.notifyChanged();
  },

  remove: function () {
    this.el.removeEventListener('child-attached', this.markSubtreeDirty);
    this.el.removeEventListener('child-detached', this.markSubtreeDirty);
    this.el.removeEventListener('model-loaded', this.markSubtreeDirty);
    this.el.removeEventListener('object3dset', this.markSubtreeDirty);
    this.el.removeEventListener('object3dremove', this.markSubtreeDirty);
    if (this.proxyRebuildTimeout) {
      clearTimeout(this.proxyRebuildTimeout);
      this.proxyRebuildTimeout = null;
    }
    if (this.proxyMesh) {
      this.proxyMesh.geometry.dispose();
      this.proxyMesh.material.dispose();
      this.proxyMesh = null;
    }
    this.system.unregister(this);
  },

  isActive: function () {
    return this.data.enabled && this.el.isConnected;
  },

  markSubtreeDirty: function () {
    // Consumers poll getFlattenMesh() per tick, so keep the invalidation
    // cheap here and re-resolve lazily.
    this.cachedSourceMesh = null;
    if (this.data.mode !== 'auto') {
      return;
    }
    clearTimeout(this.proxyRebuildTimeout);
    this.proxyRebuildTimeout = setTimeout(() => {
      this.proxyRebuildTimeout = null;
      this.proxyDirty = true;
    }, PROXY_REBUILD_DEBOUNCE_MS);
  },

  // The mesh consumers should flatten against, with a current matrixWorld,
  // or null when none is available (yet).
  getFlattenMesh: function () {
    if (this.data.mode === 'auto') {
      return this.getProxyMesh();
    }
    // Cached between subtree mutations so per-tick polling stays O(1); a
    // geometry-only edit mutates the same mesh object, which consumers
    // detect via the geometry reference.
    let mesh = this.cachedSourceMesh;
    if (!mesh || !mesh.parent) {
      mesh = null;
      this.el.object3D.traverse((node) => {
        if (!mesh && node.isMesh && node.geometry) {
          mesh = node;
        }
      });
      this.cachedSourceMesh = mesh;
    }
    if (mesh) {
      mesh.updateMatrixWorld(true);
    }
    return mesh;
  },

  getProxyMesh: function () {
    if (!this.proxyMesh) {
      // Deliberately never added to the scene graph: it must not render, must
      // not catch editor raycasts, and must not affect scene bounds. Its
      // matrixWorld is composed manually below. Consumers only raycast
      // against a clone of it (TileFlatteningPlugin swaps the material).
      const geometry = new THREE.PlaneGeometry(1, 1);
      geometry.rotateX(-Math.PI / 2); // lie flat in XZ, facing up
      this.proxyMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
      this.proxyDirty = true;
    }
    if (this.proxyDirty) {
      this.proxyDirty = false;
      this.updateProxyBounds();
    }
    const proxy = this.proxyMesh;
    if (proxy.scale.x === 0 || proxy.scale.z === 0) {
      // Empty subtree (e.g. a street still loading) — nothing to flatten yet.
      // Leave proxyDirty set so the next read retries the bounds.
      this.proxyDirty = true;
      return null;
    }
    proxy.updateMatrix();
    proxy.matrixWorld.multiplyMatrices(
      this.el.object3D.matrixWorld,
      proxy.matrix
    );
    return proxy;
  },

  // Size the proxy plane to the local-frame footprint (x/z bounds) of every
  // mesh in the subtree, at the entity's own ground level (local y = 0) —
  // for a managed street that is the plane its segments sit on.
  updateProxyBounds: function () {
    const root = this.el.object3D;
    _box.makeEmpty();
    _inverseMatrix.copy(root.matrixWorld).invert();
    root.traverse((node) => {
      if (!node.isMesh || !node.geometry) {
        return;
      }
      if (node.geometry.boundingBox === null) {
        node.geometry.computeBoundingBox();
      }
      if (node.geometry.boundingBox.isEmpty()) {
        return;
      }
      _meshBox
        .copy(node.geometry.boundingBox)
        .applyMatrix4(
          _matrix.multiplyMatrices(_inverseMatrix, node.matrixWorld)
        );
      _box.union(_meshBox);
    });
    const proxy = this.proxyMesh;
    if (_box.isEmpty()) {
      proxy.scale.set(0, 1, 0);
      return;
    }
    _box.getCenter(_center);
    _box.getSize(_size);
    proxy.position.set(_center.x, 0, _center.z);
    proxy.scale.set(Math.max(_size.x, 0), 1, Math.max(_size.z, 0));
  }
});
