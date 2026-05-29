/* global THREE */

// TASK-010 (D3): a single reusable billboarded ring mesh marking the
// rotation pivot during a Map-mode Shift+LB rotate. The user sees what
// they're orbiting around. Built once and toggled via `.visible` (B9 —
// rapid Shift chatter re-latches cheaply, no per-toggle create/destroy).
//
// Shown only in Map mode (a Street-mode rotate pivots the camera itself,
// so there is no world point to mark — per D6 it stays hidden).
//
// The mesh is added to `sceneEl.object3D` and excluded from cursor-anchor
// raycasts (`.name = 'navRotationIndicator'`, also added to cursorAnchor's
// EXCLUDE_NAME_SUBSTRINGS) so it can never become a pivot/anchor target.

import { RING_SCREEN_FRACTION } from './constants.js';

export class RotationIndicator {
  constructor(sceneEl) {
    this._sceneEl = sceneEl || null;
    this._mesh = null;
  }

  // Lazily build the ring mesh on first show. Deferred so a session that
  // never rotates in Map mode pays nothing, and so THREE/sceneEl are
  // ready.
  _ensureMesh() {
    if (this._mesh) return this._mesh;
    if (typeof THREE === 'undefined') return null;
    // Thin ring in the XY plane (normal +Z). Unit-ish radius; the
    // per-frame scale sets the real apparent size.
    const geometry = new THREE.RingGeometry(0.9, 1.0, 48);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      // Marks a pivot, not a surface decal — keep it visible through
      // geometry by disabling depth test and rendering on top.
      depthTest: false,
      depthWrite: false
    });
    const mesh = new THREE.Mesh(geometry, material);
    // A bare RingGeometry mesh has no name; set it so cursorAnchor's
    // `_isExcludedObject` (which walks obj.name up the parent chain)
    // skips it.
    mesh.name = 'navRotationIndicator';
    mesh.renderOrder = 9999;
    mesh.visible = false;
    if (this._sceneEl && this._sceneEl.object3D) {
      this._sceneEl.object3D.add(mesh);
    }
    this._mesh = mesh;
    return mesh;
  }

  show(worldPos) {
    const mesh = this._ensureMesh();
    if (!mesh) return;
    mesh.position.set(worldPos.x, worldPos.y, worldPos.z);
    mesh.visible = true;
  }

  hide() {
    if (this._mesh) this._mesh.visible = false;
  }

  // Billboard the ring to face the camera and hold a roughly constant
  // on-screen size. Cheap (a quaternion copy + one distance); called from
  // `_shiftRotate` while a Map-mode rotate is active.
  update(camera) {
    const mesh = this._mesh;
    if (!mesh || !mesh.visible || !camera) return;
    // Copy the camera's world quaternion onto the mesh's local
    // quaternion. Faces the ring (XY plane, normal +Z) at the camera as
    // long as the parent (sceneEl.object3D) is identity, which it is for
    // A-Frame's scene object3D.
    mesh.quaternion.copy(camera.quaternion);
    const d = camera.position.distanceTo(mesh.position);
    mesh.scale.setScalar(Math.max(d * RING_SCREEN_FRACTION, 1e-3));
  }

  dispose() {
    const mesh = this._mesh;
    if (mesh) {
      if (mesh.parent) mesh.parent.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
    }
    this._mesh = null;
    this._sceneEl = null;
  }
}
