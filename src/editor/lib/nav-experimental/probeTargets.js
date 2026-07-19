// Cached raycast-target list for the nav floor/enclosure probes (#1853).
//
// The legacy editor mouse raycaster excludes `[data-ignore-raycaster]`
// entities (src/editor/lib/raycaster.js), and street-geo marks every map
// layer with that attribute (Mapbox satellite plane, OSM 2D tiles, OSM 3D
// buildings, Google 3D Tiles). The nav probes were raycasting the WHOLE
// scene instead — paying a full triangle scan of the OSM buildings' merged
// tile meshes on every probe, even though those hits are then rejected by
// the floor classifier anyway (`classifyHitEntity` → 'scatter'). This
// service restores the legacy exclusion for the probe paths, with ONE
// deliberate exception: the Google 3D Tiles subtree stays included, because
// tiles ARE an accepted collision floor for nav (`classifyHitEntity` →
// 'tiles') even though mouse-picking ignores them.
//
// Shape: `targets()` returns a list of object3D subtree roots to raycast
// recursively (`raycaster.intersectObjects(targets, true)`). Included roots
// sit as HIGH in the graph as possible — a subtree containing no excluded
// entity contributes its root, not its individual meshes — so streamed
// content appearing INSIDE an included subtree (e.g. Google tiles, batched
// model groups) is picked up by the recursive raycast without a recompute.
// A scene with no excluded entities yields `[sceneEl.object3D]`, which is
// byte-identical in behavior to the previous whole-scene intersect.
//
// Exclusion test: a node is pruned when its owning `.el` (A-Frame stamps
// `.el` on entity root groups AND on setObject3D'd children) carries
// `data-ignore-raycaster` and is not the Google 3D Tiles entity. Known
// limitation (accepted): a Mesh that BOTH carries geometry itself AND has an
// excluded entity descendant would lose its own triangles — A-Frame entity
// roots are Groups, so this shape does not occur in practice.
//
// Invalidation: entity-tree changes (`child-attached` / `child-detached` /
// `newScene`) and object3D replacement (`object3dset`) null the cache; the
// next probe recomputes with one scene-graph walk — O(scene objects), far
// below a single un-BVH'd triangle scan of a buildings mesh.
//
// Cache lifetime: per-instance, owned by ExperimentalControls (constructed
// alongside SceneBounds, disposed on teardown). No module-level state.

const IGNORE_ATTR = 'data-ignore-raycaster';

// The Google 3D Tiles root entity — the one `data-ignore-raycaster` subtree
// the probes must KEEP (tiles are a legit nav collision floor). Same
// identity test as the tiles branch of `classifyHitEntity`.
function _isGoogleTilesEl(el) {
  if (!el) return false;
  if (el.id === 'google3d') return true;
  return (
    typeof el.getAttribute === 'function' &&
    el.getAttribute('data-layer-name') === 'Google 3D Tiles'
  );
}

// Should this object3D node's whole subtree be pruned from the probes?
function _isExcludedRoot(node) {
  const el = node.el;
  if (!el || typeof el.hasAttribute !== 'function') return false;
  if (!el.hasAttribute(IGNORE_ATTR)) return false;
  return !_isGoogleTilesEl(el);
}

// Depth-first collection. Appends included subtree roots to `out`; returns
// true when `node` was pruned OR contains a pruned descendant (so the
// caller cannot take its own subtree wholesale and must keep the child
// roots collected so far instead).
function _collect(node, out) {
  if (_isExcludedRoot(node)) return true;
  const childRoots = [];
  let anyExcluded = false;
  const children = node.children || [];
  for (let i = 0; i < children.length; i++) {
    if (_collect(children[i], childRoots)) anyExcluded = true;
  }
  if (anyExcluded) {
    for (let i = 0; i < childRoots.length; i++) out.push(childRoots[i]);
    return true;
  }
  out.push(node);
  return false;
}

export class ProbeTargets {
  constructor(sceneEl) {
    this.sceneEl = sceneEl || null;
    this._cache = null;
    this._invalidate = this._invalidate.bind(this);
    if (this.sceneEl && typeof this.sceneEl.addEventListener === 'function') {
      this.sceneEl.addEventListener('child-attached', this._invalidate);
      this.sceneEl.addEventListener('child-detached', this._invalidate);
      this.sceneEl.addEventListener('object3dset', this._invalidate);
      this.sceneEl.addEventListener('newScene', this._invalidate);
    }
  }

  // The cached subtree-root list. Recompute happens on the first call after
  // an invalidating event.
  targets() {
    if (this._cache !== null) return this._cache;
    this._cache = this._compute();
    return this._cache;
  }

  _compute() {
    const sceneEl = this.sceneEl;
    if (!sceneEl || !sceneEl.object3D) return [];
    const out = [];
    _collect(sceneEl.object3D, out);
    return out;
  }

  _invalidate() {
    this._cache = null;
  }

  dispose() {
    const sceneEl = this.sceneEl;
    if (sceneEl && typeof sceneEl.removeEventListener === 'function') {
      sceneEl.removeEventListener('child-attached', this._invalidate);
      sceneEl.removeEventListener('child-detached', this._invalidate);
      sceneEl.removeEventListener('object3dset', this._invalidate);
      sceneEl.removeEventListener('newScene', this._invalidate);
    }
    this._cache = null;
    this.sceneEl = null;
  }
}

// Shared probe-side intersect: raycast the curated target list when the
// service is present on the ctx, else fall back to the whole scene (keeps
// externally-constructed probe instances working unchanged). Sorted-by-
// distance semantics are identical: `intersectObjects(list, true)` merges
// and sorts exactly like `intersectObject(root, true)`.
export function intersectProbeTargets(raycaster, ctx) {
  const svc = ctx.probeTargets;
  if (svc) return raycaster.intersectObjects(svc.targets(), true);
  const sceneEl = ctx.sceneEl;
  if (!sceneEl || !sceneEl.object3D) return [];
  return raycaster.intersectObject(sceneEl.object3D, true);
}

// Test seam.
export const _internals = {
  _collect,
  _isExcludedRoot,
  _isGoogleTilesEl,
  IGNORE_ATTR
};
