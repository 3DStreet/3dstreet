/* global THREE, STREET */

// Resolves a cursor position (clientX/clientY) to a world-space anchor
// point used by the wheel-zoom and LB-pan gestures.
//
// Fallback chain:
//   1. Raycast against scene meshes (excluding gizmos / helpers / animated
//      entities). If a mesh is hit, return that point.
//   2. Else intersect the ray with the y=0 ground plane. If the
//      intersection is in front of the camera and within the reach ceiling
//      (`opts.maxGroundDist`, default MAX_GROUND_DIST = 2000 m), return that.
//   3. Else fall back to a fixed 30 m forward along the camera's view
//      direction.
//
// `source` on the returned object is one of 'mesh', 'ground', 'fallback'
// for debugging.
//
// **Wheel-zoom consumer note (KD-08 / TH-22):** the wheel-zoom path
// passes `{ maxGroundDist: WHEEL_GROUND_REACH_CEILING_METRES }` (1000 km)
// so legitimate high-altitude ground (e.g. a straight-down hit thousands of
// m below) is kept rather than thrown to Step 3 — the cap on the *movement*
// (cappedDollyStep) tames the shallow-tilt lurch, not a reach reject. All
// other callers (LB-pan, the Map-orbit pivot caller) pass nothing → the
// 2000 m default reject is unchanged, and the orbit pivot still relies on
// far ground returning Step 3 'fallback'.

import { MAX_GROUND_DIST, FALLBACK_FORWARD_DIST } from './constants.js';

/**
 * The world-anchor boundary record returned by `worldPointAt`. Flat x/y/z with
 * a `source` sentinel; `normal`/`distance`/`raw` are additive siblings present
 * only on the mesh/ground branches (existing x/y/z/source callers are
 * unaffected). See the `source` sentinel table in `docs/04-glossary.md`.
 * @typedef {Object} WorldPoint
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {'mesh'|'ground'|'fallback'} source resolution provenance
 * @property {THREE.Vector3} [normal] world-space face normal (mesh/ground only)
 * @property {number} [distance] camera→point distance (mesh/ground only)
 * @property {Object} [raw] the raw THREE.Intersection (mesh branch only)
 */

// Reused normal-matrix scratch for worldHitNormal (a per-tick / per-swoop-frame
// hot path). The matrix is a pure-local temp fully consumed within one
// synchronous call — getNormalMatrix overwrites it wholesale each time, and the
// call extracts its return Vector3 before any sibling call begins — so a single
// shared instance never aliases across calls.
const _worldHitNormalMat3 = new THREE.Matrix3();

// Substring-match against object3D / DOM-element ancestors. Anchor must
// not lock onto these.
const EXCLUDE_NAME_SUBSTRINGS = [
  'TransformControls',
  'TransformControlsGizmo',
  'TransformControlsPlane',
  'helper',
  'Helper',
  'measureLine',
  'selectionBox',
  'hoverBox',
  'gridHelper',
  // The rotation-centre ring billboard (KD-30 / KD-03). depthTest is off
  // so it would otherwise be a tempting raycast hit; never let it become
  // a pivot/anchor target.
  'navRotationIndicator'
];

// Class-attribute / component substrings on the entity element.
const EXCLUDE_EL_COMPONENT_SUBSTRINGS = [
  'street-generated-clones',
  'street-generated-pedestrians'
];

function _isExcludedObject(obj) {
  let n = obj;
  while (n) {
    // Anything that looks like a helper (CameraHelper, BoxHelper,
    // GridHelper, AxesHelper, …) — these often sit near the camera or
    // wrap selected entities and would lock the anchor onto editor
    // chrome rather than the scene.
    if (n.type && n.type.endsWith('Helper')) return true;
    // TransformControls and its gizmo subtree — child meshes have terse
    // names like 'X', 'Y', 'YZ', 'XYZ', so name-substring match on the
    // child alone is unreliable. Match the type chain instead.
    if (n.type && n.type.indexOf('TransformControls') !== -1) return true;
    if (n.isTransformControls || n.isTransformControlsGizmo) return true;
    // 3DStreet's TransformControls fork doesn't override `.type`, so the
    // gizmo subtree is identifiable by constructor name only.
    const cname = n.constructor && n.constructor.name;
    if (
      cname === 'TransformControls' ||
      cname === 'TransformGizmo' ||
      cname === 'TransformGizmoTranslate' ||
      cname === 'TransformGizmoRotate' ||
      cname === 'TransformGizmoScale'
    ) {
      return true;
    }
    if (n.isLight || n.isCamera) return true;
    if (n.name) {
      for (const sub of EXCLUDE_NAME_SUBSTRINGS) {
        if (n.name.indexOf(sub) !== -1) return true;
      }
    }
    if (n.el && n.el.attributes) {
      for (const sub of EXCLUDE_EL_COMPONENT_SUBSTRINGS) {
        if (n.el.hasAttribute && n.el.hasAttribute(sub)) return true;
      }
    }
    n = n.parent;
  }
  return false;
}

// Solid-floor filter (KD-16). Classifies a raycast hit as a
// *solid floor surface* the camera lands on / stops against / is enclosed
// by — i.e. a street-segment ground surface, a (catalog-known) building
// mass, or the Google 3D Tiles surface. Thin scatter (signs, plants,
// people, vehicles, fences) is excluded. `hit` is a THREE.Intersection-
// like object: { object, point, distance, face? }.
//
// The collision floor uses this wide predicate (buildings count as floor);
// the travel-height floor passes `{ acceptBuildings: false }` for
// segment-only behaviour.
//
// Coverage boundary (KD-34 / OI-29): the building branch matches only
// catalog-known building mixins (`category === 'buildings'`). A
// user-imported glTF or any non-catalog building model carries no catalog
// category, so it reads as scatter and the camera can sink through it.
// Accepted boundary for the managed-street prototype.
//
// It deliberately does NOT call `_isExcludedObject`: editor chrome carries
// no `.el`, so the owning-entity resolution returns null and rejects them
// for free, and `inspector.sceneHelpers` is a separate object3D subtree
// the downward probe never traverses.
export function isSolidFloorHit(hit, opts) {
  if (!hit || !hit.object) return false;
  const acceptBuildings = !opts || opts.acceptBuildings !== false;
  const acceptTiles = !opts || opts.acceptTiles !== false;

  // Classify by owning-entity identity (shared with the double-click
  // teleport classifier — KD-23), then apply the accept flags + visibility gate.
  const kind = classifyHitEntity(hit);
  if (kind === 'segment') return _hitSurfaceVisible(hit.object);
  if (kind === 'building') {
    return acceptBuildings && _hitSurfaceVisible(hit.object);
  }
  if (kind === 'tiles') return acceptTiles && _hitSurfaceVisible(hit.object);
  // null (no owning entity) / 'scatter' → reject (signs, plants, vehicles,
  // people, fence / seawall — verified NOT category 'buildings').
  return false;
}

// First inclusive ancestor of `object3D` carrying a truthy `.el` (the owning
// A-Frame entity), or null. A-Frame sets `.el` on an entity's root object3D,
// not on nested gltf submeshes, so a deep submesh resolves to its entity (a
// clone's submesh → the clone entity; a segment's below-box → the segment).
export function owningEntity(object3D) {
  let node = object3D;
  while (node) {
    if (node.el) return node.el;
    node = node.parent;
  }
  return null;
}

// Classify a raycast hit by owning-entity identity into one of the
// double-click navigation source types (KD-23): 'segment' | 'tiles' |
// 'building' | 'scatter' | null. Both the floor / collision probes AND the
// double-click teleport classifier read this SAME owning-entity walk (one
// resolution of segment / catalog-category / tiles, no divergence). Returns
// null when the hit has no owning A-Frame entity (editor chrome).
//
// `hit` is a THREE.Intersection-like object: { object, point, ... }.
export function classifyHitEntity(hit) {
  if (!hit || !hit.object) return null;

  const el = owningEntity(hit.object);
  if (!el || !el.hasAttribute) return null;

  // (b) Segment: the owning entity is itself a street-segment.
  if (el.hasAttribute('street-segment')) return 'segment';

  // (c) Building: a clone/standalone building entity carries a `mixin` whose
  //     catalog category is 'buildings'. Guard STREET undefined (tests).
  if (el.hasAttribute('mixin')) {
    const mixinId = el.getAttribute('mixin');
    const entry =
      typeof STREET !== 'undefined' && STREET.catalog
        ? STREET.catalog.find((e) => e.id === mixinId)
        : undefined;
    if (entry && entry.category === 'buildings') return 'building';
  }

  // (d) Tiles: climb ancestors PAST the first `.el` (the tiles
  //     `offsetEl`, carrying neither id nor layer-name) for `#google3d` /
  //     data-layer-name 'Google 3D Tiles'. Walk from `hit.object`: every node
  //     below the owning entity carries no `.el`, so it reaches the same chain.
  if (_isGoogleTilesDescendant(hit.object)) return 'tiles';

  // (e) Else scatter.
  return 'scatter';
}

// Shared visibility gate: skip invisible (surface: none)
// surfaces. The mesh sets material.visible=false; three.js still raycasts
// it. Check the hit mesh's own material visibility (handle material-array),
// falling back to object.visible if no material.
function _hitSurfaceVisible(obj) {
  if (obj.material) {
    const mat = obj.material;
    const visible = Array.isArray(mat)
      ? mat.some((m) => m && m.visible !== false)
      : mat.visible !== false;
    if (!visible) return false;
  }
  if (obj.visible === false) return false;
  return true;
}

// Walk the object3D ancestor chain (starting from `node`, which is the
// first `.el`-bearing node found above the hit) looking for the Google 3D
// Tiles root entity. The trap: the hit's first `.el` is
// the tiles `offsetEl`, which carries no id / layer-name; the marked
// entity is `#google3d` (id + data-layer-name='Google 3D Tiles'), an
// ancestor of offsetEl. So we must climb past the first `.el`.
function _isGoogleTilesDescendant(node) {
  let n = node;
  while (n) {
    const el = n.el;
    if (el && el.getAttribute) {
      if (el.id === 'google3d') return true;
      if (el.getAttribute('data-layer-name') === 'Google 3D Tiles') {
        return true;
      }
    }
    n = n.parent;
  }
  return false;
}

// Transform a raycast hit's face normal into world space, accounting for
// non-uniform scale (KD-20). Returns a normalized THREE.Vector3, or a +Y
// fallback when no face / normal is available (e.g. tiles hits without a
// `face`). Shared by the WASD classifier and future tilt-to-slope landing.
export function worldHitNormal(hit) {
  if (!hit || !hit.face || !hit.face.normal || !hit.object) {
    return new THREE.Vector3(0, 1, 0);
  }
  const obj = hit.object;
  obj.updateWorldMatrix(true, false);
  _worldHitNormalMat3.getNormalMatrix(obj.matrixWorld);
  // The return is deliberately a fresh allocation: callers retain it as
  // `.normal` (the WASD classifier holds two normals live at once), so it must
  // never be a shared scratch. The `.clone()` also protects the mesh's
  // BufferGeometry from the in-place applyMatrix3/normalize.
  const n = hit.face.normal
    .clone()
    .applyMatrix3(_worldHitNormalMat3)
    .normalize();
  if (
    !isFinite(n.x) ||
    !isFinite(n.y) ||
    !isFinite(n.z) ||
    n.lengthSq() === 0
  ) {
    return new THREE.Vector3(0, 1, 0);
  }
  return n;
}

export class CursorAnchor {
  constructor({ camera, sceneEl, domElement }) {
    this._camera = camera;
    this._sceneEl = sceneEl;
    this._domElement = domElement;
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    // worldPointAt scratch — pure-local position temps, reused each call. None
    // escape: their values are copied out as primitive x/y/z into the return
    // object's flat fields.
    this._tmpGround = new THREE.Vector3();
    this._tmpForward = new THREE.Vector3();
    this._tmpFallbackPoint = new THREE.Vector3();
  }

  setCamera(camera) {
    this._camera = camera;
  }

  // Returns { x, y, z, source }. Always non-null.
  //
  // opts.maxGroundDist: per-caller reach ceiling for the Step-2
  // ground hit, in metres. Defaults to MAX_GROUND_DIST (2000) — LB-pan and
  // the Map-orbit pivot caller are unchanged. The wheel-zoom path raises it (to
  // WHEEL_GROUND_REACH_CEILING_METRES) so a legitimate far/straight-down
  // ground hit is kept; a degenerate Float.MAX grazing-ray hit still
  // exceeds even the raised ceiling and falls to Step 3 'fallback'.
  // NDC for a client pixel. Factored out of worldPointAt so the
  // re-aim path can resolve the cursor pixel without a full raycast
  // (one source of truth for the rect math). Fills the optional `target`
  // Vector2 and returns it (three.js out-param idiom); defaults to a fresh
  // allocation so bare callers keep getting a fresh Vector2.
  ndcFor(clientX, clientY, target) {
    const rect = this._domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    const out = target || new THREE.Vector2();
    return out.set(x, y);
  }

  worldPointAt(clientX, clientY, opts = {}) {
    const maxGroundDist =
      opts.maxGroundDist != null ? opts.maxGroundDist : MAX_GROUND_DIST;
    const camera = this._camera;
    const rect = this._domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._ndc.set(x, y);
    this._raycaster.setFromCamera(this._ndc, camera);

    // Step 1: scene mesh raycast. `_raycastScene` returns the
    // full THREE.Intersection, so the swoop break-out classifier (KD-14) can
    // read the face normal, and the surface `source` provenance is available
    // for the re-aim and other consumers. The returned object stays
    // FLAT { x, y, z, source, ... } — `normal`/`distance`/`raw` are additive
    // siblings; existing callers (LB-pan, orbit-pivot, the dolly) read only
    // x/y/z/source and are unaffected.
    const meshHit = this._raycastScene();
    if (meshHit) {
      return {
        x: meshHit.point.x,
        y: meshHit.point.y,
        z: meshHit.point.z,
        source: 'mesh',
        normal: worldHitNormal(meshHit), // world-space face normal, +Y fallback
        distance: meshHit.distance,
        raw: meshHit // THREE.Intersection — for isSolidFloorHit (swoop break-out, KD-14)
      };
    }

    // Step 2: ground plane intersection.
    const groundHit = this._tmpGround;
    const ok = this._raycaster.ray.intersectPlane(this._groundPlane, groundHit);
    if (ok) {
      const dist = camera.position.distanceTo(groundHit);
      // intersectPlane returns null if the ray is parallel to the plane;
      // also reject points behind the camera (intersectPlane already does
      // this for forward rays, but we double-check for very-shallow rays).
      const forward = this._tmpForward
        .subVectors(groundHit, camera.position)
        .dot(this._raycaster.ray.direction);
      if (forward > 0 && dist <= maxGroundDist) {
        return {
          x: groundHit.x,
          y: groundHit.y,
          z: groundHit.z,
          source: 'ground',
          normal: new THREE.Vector3(0, 1, 0), // horizontal by construction
          distance: dist
        };
      }
    }

    // Step 3: fixed forward fallback. Reuses _tmpForward: the Step-2 value it
    // held was reduced to the scalar `forward` (a .dot()) and is never read
    // again once the ground branch falls through, so the slot is dead here.
    // (If a future edit needs the Step-2 direction past that gate, give it a
    // distinct scratch — do not read _tmpForward after this point.)
    const fwd = this._tmpForward;
    camera.getWorldDirection(fwd);
    const fp = this._tmpFallbackPoint
      .copy(camera.position)
      .addScaledVector(fwd, FALLBACK_FORWARD_DIST);
    return {
      x: fp.x,
      y: fp.y,
      z: fp.z,
      source: 'fallback',
      distance: FALLBACK_FORWARD_DIST
    };
  }

  // Returns the full THREE.Intersection of the nearest non-excluded
  // scene mesh hit, or null. The extra fields (face, object,
  // distance) feed worldHitNormal + isSolidFloorHit for the swoop
  // break-out classifier (KD-14).
  _raycastScene() {
    if (!this._sceneEl || !this._sceneEl.object3D) return null;
    const intersects = this._raycaster.intersectObject(
      this._sceneEl.object3D,
      true
    );
    for (const hit of intersects) {
      if (!_isExcludedObject(hit.object)) {
        return hit;
      }
    }
    return null;
  }

  dispose() {
    this._sceneEl = null;
    this._domElement = null;
    this._camera = null;
  }
}

// Test seam.
export const _internals = {
  _isExcludedObject,
  isSolidFloorHit,
  owningEntity,
  classifyHitEntity,
  worldHitNormal,
  MAX_GROUND_DIST,
  FALLBACK_FORWARD_DIST,
  EXCLUDE_NAME_SUBSTRINGS,
  EXCLUDE_EL_COMPONENT_SUBSTRINGS
};
