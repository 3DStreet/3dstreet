/* global THREE */

// Resolves a cursor position (clientX/clientY) to a world-space anchor
// point used by Phase 1 wheel zoom and LB-pan gestures. See
// claude/specs/001-phase-1-plan.md.
//
// Fallback chain:
//   1. Raycast against scene meshes (excluding gizmos / helpers / animated
//      entities). If a mesh is hit, return that point.
//   2. Else intersect the ray with the y=0 ground plane. If the
//      intersection is in front of the camera and within MAX_GROUND_DIST,
//      return that.
//   3. Else fall back to a fixed 30 m forward along the camera's view
//      direction.
//
// `source` on the returned object is one of 'mesh', 'ground', 'fallback'
// for debugging.
//
// **Wheel-zoom consumer note (2026-05-11):** `_applyWheelTick` in
// `ExperimentalControls` now branches on the 30° tilt cut *before*
// calling `worldPointAt`, so Step 3 only fires for wheel zoom at high
// tilt (per `claude/specs/001-tilt-conditional-zoom.md`). LB-pan still
// calls `worldPointAt` unconditionally and gets the full chain.

import { MAX_GROUND_DIST, FALLBACK_FORWARD_DIST } from './constants.js';

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
  'gridHelper'
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

export class CursorAnchor {
  constructor({ camera, sceneEl, domElement }) {
    this._camera = camera;
    this._sceneEl = sceneEl;
    this._domElement = domElement;
    this._raycaster = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }

  setCamera(camera) {
    this._camera = camera;
  }

  // Returns { x, y, z, source }. Always non-null.
  worldPointAt(clientX, clientY) {
    const camera = this._camera;
    const rect = this._domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._ndc.set(x, y);
    this._raycaster.setFromCamera(this._ndc, camera);

    // Step 1: scene mesh raycast.
    const meshHit = this._raycastScene();
    if (meshHit) {
      return {
        x: meshHit.x,
        y: meshHit.y,
        z: meshHit.z,
        source: 'mesh'
      };
    }

    // Step 2: ground plane intersection.
    const groundHit = new THREE.Vector3();
    const ok = this._raycaster.ray.intersectPlane(this._groundPlane, groundHit);
    if (ok) {
      const dist = camera.position.distanceTo(groundHit);
      // intersectPlane returns null if the ray is parallel to the plane;
      // also reject points behind the camera (intersectPlane already does
      // this for forward rays, but we double-check for very-shallow rays).
      const forward = new THREE.Vector3()
        .subVectors(groundHit, camera.position)
        .dot(this._raycaster.ray.direction);
      if (forward > 0 && dist <= MAX_GROUND_DIST) {
        return {
          x: groundHit.x,
          y: groundHit.y,
          z: groundHit.z,
          source: 'ground'
        };
      }
    }

    // Step 3: fixed forward fallback.
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const fp = new THREE.Vector3()
      .copy(camera.position)
      .addScaledVector(fwd, FALLBACK_FORWARD_DIST);
    return {
      x: fp.x,
      y: fp.y,
      z: fp.z,
      source: 'fallback'
    };
  }

  _raycastScene() {
    if (!this._sceneEl || !this._sceneEl.object3D) return null;
    const intersects = this._raycaster.intersectObject(
      this._sceneEl.object3D,
      true
    );
    for (const hit of intersects) {
      if (!_isExcludedObject(hit.object)) {
        return hit.point;
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
  MAX_GROUND_DIST,
  FALLBACK_FORWARD_DIST,
  EXCLUDE_NAME_SUBSTRINGS,
  EXCLUDE_EL_COMPONENT_SUBSTRINGS
};
