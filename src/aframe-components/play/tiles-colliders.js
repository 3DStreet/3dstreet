/* global THREE */

/**
 * tiles-colliders
 * ===============
 *
 * Physics colliders for Google 3D Tiles during play mode, shared by
 * drive-mode and fly-mode: without them the car and helicopter clip
 * straight through photogrammetry terrain and buildings (they only
 * ever collided with street segments and catalog obstacles).
 *
 * Approach: mirror the tiles the renderer is actually showing. The
 * `3d-tiles-renderer` TilesRenderer keeps a `visibleTiles` set (the
 * current LOD selection) and emits `tile-visibility-change` whenever
 * that selection changes, with `tile.engineData.scene` holding the
 * tile's Object3D. For each visible tile we bake its meshes into ONE
 * world-space Rapier trimesh (static body at the origin); when a tile
 * leaves the selection (LOD swap, frustum) its body is removed.
 *
 * Notes that keep this correct and affordable:
 *   - Vertices are read through `Vector3.fromBufferAttribute`, which
 *     transparently de-quantizes the normalized-int attributes the
 *     TileCompressionPlugin produces, then transformed by each mesh's
 *     matrixWorld — so the trimesh is exactly what's rendered,
 *     INCLUDING TileFlatteningPlugin's CPU-flattened vertices (the
 *     street area of the tile is flat in physics too).
 *   - Building trimeshes has a real cost (Rapier builds a BVH per
 *     mesh), so tiles go through a queue drained on a timer with a
 *     small per-pass budget instead of all at once on play start.
 *   - Colliders are tagged 'ground': tile geometry fuses terrain and
 *     buildings into one mesh, so a touch can't be classified as a
 *     "crash" vs "landing" — tiles stop the player physically but
 *     never fire collision markers. Catalog buildings/obstacles keep
 *     their own crash-tagged cuboids.
 *   - A tile leaving the selection keeps its body until the build
 *     queue is empty (see `retired` below) — freeing it immediately on
 *     an LOD swap opened a collider-free window before the replacement
 *     tiles' trimeshes were built, one of the "fell through the
 *     ground" playtest reports. Bounded by MAX_RETIRED_TILES so a
 *     never-empty queue can't turn that into a leak.
 *   - Per-tile and total triangle budgets guard against pathological
 *     tilesets; over-budget tiles are skipped with a console warning
 *     (the player falls back to the deep safety-net ground pad).
 *     Freed tiles RETURN their triangles to the budget — an earlier
 *     build only ever added, so a long flight exhausted the budget and
 *     silently stopped seeding colliders far from the spawn point (the
 *     other "fell through the ground far away" report).
 *
 * Lifecycle: `attachTilesColliders(sceneEl)` after the physics world is
 * active; call `.dispose()` in the play session's cleanup (before
 * `physics.deactivate()`, though disposal after is also safe).
 */

const QUEUE_INTERVAL_MS = 120; // drain cadence
const TILES_PER_PASS = 3; // trimesh builds per drain
const MAX_TILE_VERTICES = 200000; // skip absurd single tiles
// Soft cap on tiles parked in `retired` (bodies kept alive across an
// LOD swap until the queue drains). A fast flight over dense
// photogrammetry can keep the queue fed indefinitely (3 builds per
// drain), so without a cap stale trimeshes — and their share of the
// triangle budget — pile up until seeding silently stops: the same
// "fell through the ground far from spawn" failure as the budget
// leak. Past the cap the OLDEST retired bodies are freed first; the
// most recent swaps (the ones under the player) keep their cover.
const MAX_RETIRED_TILES = 40;
const MAX_TOTAL_TRIANGLES = 2000000; // stop seeding past this budget

/**
 * Bake every mesh under `sceneObj` into one world-space vertex/index
 * pair. Returns { vertices: Float32Array, indices: Uint32Array,
 * vertexCount } or null when there is no usable mesh geometry.
 */
function collectWorldGeometry(sceneObj, maxVertices) {
  const meshes = [];
  let vertexCount = 0;
  let indexCount = 0;
  sceneObj.updateMatrixWorld(true);
  sceneObj.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const pos = obj.geometry.getAttribute('position');
    if (!pos || pos.count === 0) return;
    meshes.push(obj);
    vertexCount += pos.count;
    indexCount += obj.geometry.index ? obj.geometry.index.count : pos.count;
  });
  if (!meshes.length || vertexCount === 0) return null;
  if (maxVertices && vertexCount > maxVertices) {
    return { overBudget: true, vertexCount };
  }

  const vertices = new Float32Array(vertexCount * 3);
  const indices = new Uint32Array(indexCount);
  const v = new THREE.Vector3();
  let vOffset = 0;
  let iOffset = 0;
  let baseVertex = 0;
  for (const mesh of meshes) {
    const geom = mesh.geometry;
    const pos = geom.getAttribute('position');
    const mat = mesh.matrixWorld;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mat);
      vertices[vOffset++] = v.x;
      vertices[vOffset++] = v.y;
      vertices[vOffset++] = v.z;
    }
    const index = geom.index;
    if (index) {
      for (let i = 0; i < index.count; i++) {
        indices[iOffset++] = baseVertex + index.getX(i);
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices[iOffset++] = baseVertex + i;
      }
    }
    baseVertex += pos.count;
  }
  return { vertices, indices, vertexCount };
}

/** Collider bookkeeping for one TilesRenderer instance. */
class TilesColliderSet {
  constructor(physics, tiles) {
    this.physics = physics;
    this.tiles = tiles;
    this.bodies = new Map(); // tile -> { body, triangles }
    this.queue = new Set(); // tiles awaiting a trimesh build
    // Tiles that left the LOD selection keep their body here until the
    // build queue is empty: an LOD swap retires the parent tile and
    // enqueues its children in the same event batch, and freeing the
    // parent's trimesh before the children's are built leaves a
    // collider-free window a fast helicopter falls straight through.
    // The stale mesh is near-coincident with its replacement, so
    // physics against it is fine for the few passes it lingers.
    this.retired = new Map(); // tile -> { body, triangles }
    this.totalTriangles = 0;
    this.warnedBudget = false;

    this.onVisibilityChange = ({ tile, visible }) => {
      if (visible) {
        this.enqueue(tile);
      } else {
        this.removeTile(tile);
      }
    };
    tiles.addEventListener('tile-visibility-change', this.onVisibilityChange);

    // Everything already on screen when the play session starts.
    if (tiles.visibleTiles) {
      for (const tile of tiles.visibleTiles) this.enqueue(tile);
    }

    this.interval = setInterval(() => this.drainQueue(), QUEUE_INTERVAL_MS);
  }

  enqueue(tile) {
    if (this.bodies.has(tile)) return;
    // Back in the selection before its retired body was freed — just
    // restore it, no rebuild.
    const kept = this.retired.get(tile);
    if (kept) {
      this.retired.delete(tile);
      this.bodies.set(tile, kept);
      return;
    }
    this.queue.add(tile);
  }

  removeTile(tile) {
    this.queue.delete(tile);
    const entry = this.bodies.get(tile);
    if (entry) {
      this.bodies.delete(tile);
      this.retired.set(tile, entry);
      // Map preserves insertion order — oldest first.
      while (this.retired.size > MAX_RETIRED_TILES) {
        const [oldTile, oldEntry] = this.retired.entries().next().value;
        this.retired.delete(oldTile);
        this._freeEntry(oldEntry);
      }
    }
  }

  /** Free one bookkept body and return its triangles to the budget. */
  _freeEntry(entry) {
    this.physics.removeBody(entry.body);
    this.totalTriangles -= entry.triangles;
  }

  drainQueue() {
    // Session over (Stop pressed) — the play component's cleanup calls
    // dispose(), but guard anyway so a straggling timer can't touch a
    // freed world.
    if (!this.physics.active || !this.physics.world) return;
    let built = 0;
    for (const tile of this.queue) {
      if (built >= TILES_PER_PASS) break;
      this.queue.delete(tile);
      const scene = tile.engineData && tile.engineData.scene;
      if (!scene) continue;
      if (this.totalTriangles > MAX_TOTAL_TRIANGLES) {
        if (!this.warnedBudget) {
          this.warnedBudget = true;
          console.warn(
            '[tiles-colliders] triangle budget reached — skipping further tiles'
          );
        }
        continue;
      }
      const geo = collectWorldGeometry(scene, MAX_TILE_VERTICES);
      if (!geo) continue;
      if (geo.overBudget) {
        console.warn(
          '[tiles-colliders] skipping oversized tile (' +
            geo.vertexCount +
            ' vertices)'
        );
        continue;
      }
      const body = this.physics.addStaticTrimesh(
        geo.vertices,
        geo.indices,
        // 'ground' — tile contact is landing/driving, never a crash.
        'ground'
      );
      if (body) {
        const triangles = geo.indices.length / 3;
        this.bodies.set(tile, { body, triangles });
        this.totalTriangles += triangles;
        built++;
      }
    }
    // Only once every pending replacement is built do the retired
    // bodies (and their triangle budget) go away — see the field note.
    if (this.queue.size === 0 && this.retired.size > 0) {
      for (const entry of this.retired.values()) this._freeEntry(entry);
      this.retired.clear();
    }
  }

  dispose() {
    clearInterval(this.interval);
    this.tiles.removeEventListener(
      'tile-visibility-change',
      this.onVisibilityChange
    );
    for (const entry of this.bodies.values()) this._freeEntry(entry);
    for (const entry of this.retired.values()) this._freeEntry(entry);
    this.bodies.clear();
    this.retired.clear();
    this.queue.clear();
  }
}

/**
 * Attach tile colliders for every active [google-maps-aerial] tileset
 * in the scene. Call AFTER `play-mode-physics` is active.
 *
 * @returns {{ dispose: Function }|null} handle, or null when the scene
 *   has no tileset (callers use that to keep the normal ground pad).
 */
function attachTilesColliders(sceneEl) {
  const physics = sceneEl.systems['play-mode-physics'];
  if (!physics || !physics.active) return null;
  const sets = [];
  sceneEl.querySelectorAll('[google-maps-aerial]').forEach((el) => {
    const comp = el.components && el.components['google-maps-aerial'];
    if (comp && comp.tiles) {
      sets.push(new TilesColliderSet(physics, comp.tiles));
    }
  });
  if (!sets.length) return null;
  return {
    dispose() {
      for (const s of sets) s.dispose();
      sets.length = 0;
    }
  };
}

module.exports = {
  attachTilesColliders,
  collectWorldGeometry,
  MAX_RETIRED_TILES,
  // Exported for unit tests (budget/retirement bookkeeping).
  TilesColliderSet
};
