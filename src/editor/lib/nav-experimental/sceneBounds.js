// Cylindrical scene-bounds derivation with caching, per the navigation
// proposal (`/claude/reference/3D Street Navigation Proposal.md`).
//
// Detection rule:
//   A scene is UNBOUNDED if it contains a `street-geo` or
//   `google-maps-aerial` entity. Otherwise BOUNDED.
//
// Computation (when bounded):
//   Union AABB of all `managed-street`, `street`, and `intersection`
//   entities. Cylinder = XZ center of AABB, radius = max horizontal
//   half-extent (so e.g. a long thin street segment doesn't produce a
//   pathologically far rotation center if the camera is just off the
//   side; see the long/narrow-scene risk in the adversarial review).
//
// Invalidation policy (mirrors the docs in
// claude/specs/001-phase-0-plan.md):
//   INVALIDATES on:
//     - scene-level `child-attached` / `child-detached` (catches
//       managed-street rebuilds that detach and reattach segments,
//       and any add/remove of bounded entities)
//     - `componentchanged` at scene level when the changed component
//       belongs to a known list of dimension-affecting components on
//       `street-segment`, or to any of the bounded/unbounded
//       container types
//     - `newScene` (saved-scene loads — broad fallback)
//   DOES NOT invalidate on:
//     - position changes to non-segment entities
//     - rotation of any entity (cylindrical bounds are
//       rotation-invariant)
//     - component changes outside the known list
//
// Cache lifetime: per-instance. The owner (typically an
// `ExperimentalControls` instance) constructs a `SceneBounds` and
// disposes it on teardown. No module-level state.

const STREET_CONTAINER_TYPES = ['managed-street', 'street', 'intersection'];
const UNBOUNDED_MARKERS = ['street-geo', 'google-maps-aerial'];
const SEGMENT_DIMENSION_COMPONENTS = ['width', 'length', 'position'];

const EMPTY_BOUNDS = Object.freeze({
  bounded: false,
  center: Object.freeze({ x: 0, y: 0, z: 0 }),
  radius: 0
});

// Pure: derive a cylinder ({center, radius}) from an AABB given as
// {min:{x,y,z}, max:{x,y,z}}. Center is the AABB center; radius is half
// the largest horizontal extent (max(width, depth)).
export function cylinderFromAABB(min, max) {
  const center = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2
  };
  const sizeX = max.x - min.x;
  const sizeZ = max.z - min.z;
  const radius = Math.max(sizeX, sizeZ) / 2;
  return { center, radius };
}

// Pure: detect unbounded scene by presence of marker entities. Accepts
// any object with a `querySelector` method (jsdom element, A-Frame
// scene, etc.).
export function detectUnbounded(sceneEl) {
  if (!sceneEl || typeof sceneEl.querySelector !== 'function') return false;
  for (const marker of UNBOUNDED_MARKERS) {
    if (sceneEl.querySelector(`[${marker}]`)) return true;
  }
  return false;
}

export class SceneBounds {
  constructor(sceneEl) {
    this.sceneEl = sceneEl || null;
    this._cache = null;

    this._invalidate = this._invalidate.bind(this);
    this._onComponentChanged = this._onComponentChanged.bind(this);

    if (this.sceneEl && typeof this.sceneEl.addEventListener === 'function') {
      this.sceneEl.addEventListener('child-attached', this._invalidate);
      this.sceneEl.addEventListener('child-detached', this._invalidate);
      this.sceneEl.addEventListener(
        'componentchanged',
        this._onComponentChanged
      );
      this.sceneEl.addEventListener('newScene', this._invalidate);
    }
  }

  // Returns { bounded, center: {x,y,z}, radius }. Cached; recompute
  // happens on the next call after an invalidating event.
  getBounds() {
    if (this._cache !== null) return this._cache;
    this._cache = this._compute();
    return this._cache;
  }

  _compute() {
    const sceneEl = this.sceneEl;
    if (!sceneEl) return EMPTY_BOUNDS;

    if (detectUnbounded(sceneEl)) {
      return { bounded: false, center: { x: 0, y: 0, z: 0 }, radius: 0 };
    }

    // Walk all street-container entities and union their world-space
    // AABBs. Skip entities without a usable object3D (test-time stubs,
    // entities still loading, etc.).
    let min = null;
    let max = null;
    for (const type of STREET_CONTAINER_TYPES) {
      const entities = sceneEl.querySelectorAll
        ? sceneEl.querySelectorAll(`[${type}]`)
        : [];
      for (const ent of entities) {
        const entBox = entityWorldAABB(ent);
        if (!entBox) continue;
        if (!min) {
          min = { ...entBox.min };
          max = { ...entBox.max };
        } else {
          if (entBox.min.x < min.x) min.x = entBox.min.x;
          if (entBox.min.y < min.y) min.y = entBox.min.y;
          if (entBox.min.z < min.z) min.z = entBox.min.z;
          if (entBox.max.x > max.x) max.x = entBox.max.x;
          if (entBox.max.y > max.y) max.y = entBox.max.y;
          if (entBox.max.z > max.z) max.z = entBox.max.z;
        }
      }
    }

    if (!min) return EMPTY_BOUNDS;

    const { center, radius } = cylinderFromAABB(min, max);
    return { bounded: true, center, radius };
  }

  _invalidate() {
    this._cache = null;
  }

  _onComponentChanged(event) {
    const target = event.target;
    if (!target || typeof target.hasAttribute !== 'function') return;
    const name = event.detail && event.detail.name;
    if (!name) return;

    // Container type added/removed/changed → recompute.
    for (const t of STREET_CONTAINER_TYPES) {
      if (name === t || target.hasAttribute(t)) {
        this._invalidate();
        return;
      }
    }

    // Dimension-affecting component change on a street-segment → recompute.
    if (
      target.hasAttribute('street-segment') &&
      SEGMENT_DIMENSION_COMPONENTS.indexOf(name) !== -1
    ) {
      this._invalidate();
      return;
    }

    // Unbounded marker added/removed → recompute (changes bounded vs
    // unbounded classification).
    for (const m of UNBOUNDED_MARKERS) {
      if (name === m || target.hasAttribute(m)) {
        this._invalidate();
        return;
      }
    }
  }

  dispose() {
    const sceneEl = this.sceneEl;
    if (sceneEl && typeof sceneEl.removeEventListener === 'function') {
      sceneEl.removeEventListener('child-attached', this._invalidate);
      sceneEl.removeEventListener('child-detached', this._invalidate);
      sceneEl.removeEventListener('componentchanged', this._onComponentChanged);
      sceneEl.removeEventListener('newScene', this._invalidate);
    }
    this._cache = null;
    this.sceneEl = null;
  }
}

// Best-effort world-space AABB extraction for an A-Frame entity.
// Returns null if the entity has no usable Object3D yet (e.g. still
// loading, or in a test stub). Uses THREE off the global to match the
// rest of the editor lib.
function entityWorldAABB(entity) {
  /* global THREE */
  if (typeof THREE === 'undefined') return null;
  const obj3D = entity.object3D;
  if (!obj3D) return null;
  const box = new THREE.Box3();
  box.setFromObject(obj3D);
  if (
    box.isEmpty() ||
    isNaN(box.min.x) ||
    isNaN(box.max.x) ||
    !isFinite(box.min.x) ||
    !isFinite(box.max.x)
  ) {
    return null;
  }
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z },
    max: { x: box.max.x, y: box.max.y, z: box.max.z }
  };
}
