/* global AFRAME, THREE */

// bvh-geometry — compute three-mesh-bvh bounds trees for meshes streamed
// into this entity's subtree (#1853).
//
// Why: `src/three-bvh.js` patches `THREE.Mesh.prototype.raycast` with the
// accelerated raycast, but the acceleration only applies to geometries that
// have a computed `boundsTree` — without one it silently falls back to
// three.js's linear scan of every triangle inside the bounding sphere. The
// OSM 2.5D buildings layer (osm4vr's `osm-geojson`) merges each tile's
// buildings into one large mesh, so every editor-nav probe and cursor
// raycast was paying a full triangle scan per tile mesh. With a BVH the same
// query is O(log n).
//
// How: listens for `object3dset` (fired by A-Frame's setObject3D on this
// entity AND bubbled from descendants — osm4vr sets tile meshes as they
// stream in), collects meshes whose geometry has enough triangles and no
// boundsTree yet, and builds ONE bounds tree per idle callback so the
// builds never stack into a single long frame. Geometries are tracked in a
// WeakSet so replacements are picked up but nothing is ever built twice;
// a failed build is remembered and not retried. Bounds trees need no
// explicit teardown — a boundsTree dies with its geometry.
//
// Usage: set `bvh-geometry` on a container entity whose subtree streams
// heavy meshes (street-geo sets it on the OSM layers). Not used on the
// Google 3D Tiles layer: its tiles are comparatively small, short-lived
// meshes managed by 3d-tiles-renderer, where per-tile build churn would
// outweigh the raycast savings.

// Below this many triangles a linear scan is already sub-0.1 ms — building
// a BVH would add memory and idle work for no measurable win.
const MIN_TRIANGLES = 1000;

function triangleCount(geometry) {
  if (geometry.index) return geometry.index.count / 3;
  const pos = geometry.attributes && geometry.attributes.position;
  return pos ? pos.count / 3 : 0;
}

AFRAME.registerComponent('bvh-geometry', {
  init: function () {
    // Geometries already built, queued, or failed — never touched again.
    this.seen = new WeakSet();
    // FIFO of geometries awaiting an idle-callback build.
    this.queue = [];
    this.idleHandle = null;
    this.onObject3DSet = this.onObject3DSet.bind(this);
    this.processQueue = this.processQueue.bind(this);
    this.el.addEventListener('object3dset', this.onObject3DSet);
    // Meshes that attached before this component initialized.
    this.scan();
  },

  remove: function () {
    this.el.removeEventListener('object3dset', this.onObject3DSet);
    this.cancelScheduled();
    this.queue.length = 0;
  },

  onObject3DSet: function () {
    this.scan();
  },

  // Walk the subtree and queue any mesh geometry that qualifies.
  scan: function () {
    const root = this.el.object3D;
    if (!root) return;
    // The prototype patch from src/three-bvh.js; absent in tests that load
    // components without the bundle entry — then there is nothing to build.
    if (
      typeof THREE.BufferGeometry.prototype.computeBoundsTree !== 'function'
    ) {
      return;
    }
    const queue = this.queue;
    const seen = this.seen;
    root.traverse(function (node) {
      if (!node.isMesh || !node.geometry) return;
      const geometry = node.geometry;
      if (seen.has(geometry) || geometry.boundsTree) return;
      if (triangleCount(geometry) < MIN_TRIANGLES) return;
      seen.add(geometry);
      queue.push(geometry);
    });
    if (this.queue.length) this.schedule();
  },

  schedule: function () {
    if (this.idleHandle !== null) return;
    if (typeof window.requestIdleCallback === 'function') {
      this.idleHandle = window.requestIdleCallback(this.processQueue, {
        timeout: 1000
      });
      this.idleIsRic = true;
    } else {
      this.idleHandle = window.setTimeout(this.processQueue, 50);
      this.idleIsRic = false;
    }
  },

  cancelScheduled: function () {
    if (this.idleHandle === null) return;
    if (this.idleIsRic && typeof window.cancelIdleCallback === 'function') {
      window.cancelIdleCallback(this.idleHandle);
    } else if (!this.idleIsRic) {
      window.clearTimeout(this.idleHandle);
    }
    this.idleHandle = null;
  },

  // Build ONE bounds tree per idle slot; re-arm while work remains. A large
  // merged tile mesh can take tens of ms to index — one per slot keeps the
  // cost off the frame budget instead of stacking builds.
  processQueue: function () {
    this.idleHandle = null;
    const geometry = this.queue.shift();
    if (geometry) {
      try {
        // Skip geometries disposed while queued (attributes emptied) and
        // ones another consumer built in the meantime.
        if (!geometry.boundsTree && geometry.attributes.position) {
          geometry.computeBoundsTree();
        }
      } catch (err) {
        console.warn('[bvh-geometry] computeBoundsTree failed', err);
      }
    }
    if (this.queue.length) this.schedule();
  }
});
