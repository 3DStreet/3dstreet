import { GizmoPointerControls } from './GizmoPointerControls';

/**
 * SegmentWidthControls — "Segment Width Handles" prototype (#1218).
 *
 * A selected street-segment (inside a managed street) shows a vertical bar
 * along each long edge. Dragging a bar left/right changes
 * street-segment.width in place; the managed street's normal re-layout
 * cascade (street-align, street-ground, street-label) runs live during the
 * drag.
 *
 * The drag is measured in the *street's* local X frame, which is stable
 * while segments shuffle around during re-layout — no feedback loop between
 * handle position and pointer delta.
 *
 * Note on feel: with street-align width 'center', widening a segment grows
 * it symmetrically around the street center, so the dragged edge moves at
 * about half cursor speed. Anchoring the opposite edge would need a
 * coordinated street-position change — out of scope for this prototype.
 */

const MIN_WIDTH = 0.3;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
// Where along the segment the bars sit, as a fraction of its length
// (0 = far end / path start, 1 = near end). The near end is where focus
// (#1213) parks the camera looking outbound and where the street-label
// cross-section hangs, so the bars land next to the width readout right
// after a focus instead of far up a long street.
const BAR_STATION = 1;

class SegmentWidthControls extends GizmoPointerControls {
  constructor(camera, domElement) {
    super(camera, domElement, 'gizmoPrototypeSegmentWidth');

    this.el = undefined; // the street-segment entity
    this.streetObject = null; // parent managed-street object3D

    this.dragPlane = new THREE.Plane();
    this.dragLocal = new THREE.Vector3();
    this.dragStartPointerX = 0;
    this.dragStartWidth = 0;
    this.dragSign = 1;
    this.tempQuat = new THREE.Quaternion();
    this.barYawWorld = null;
    // Street-local lateral frame the drag is measured in: origin + unit
    // `right` (straight: the street's x axis; curved: the curve frame at the
    // bar's station).
    this.lateralOrigin = new THREE.Vector3();
    this.lateralRight = new THREE.Vector3(1, 0, 0);

    this.buildHandles();
  }

  buildHandles() {
    this.idleMaterial = new THREE.MeshBasicMaterial({
      color: 0x1faaf2,
      transparent: true,
      opacity: 0.65,
      depthTest: false
    });
    this.hoverMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd633,
      transparent: false,
      depthTest: false
    });

    // Unit-depth bar; z is scaled per-frame to a fraction of segment length.
    const barGeom = new THREE.BoxGeometry(0.18, 0.5, 1);

    this.handles = {};
    ['left', 'right'].forEach((key) => {
      const bar = new THREE.Mesh(barGeom, this.idleMaterial);
      bar.name = 'gizmoPrototypeSegmentWidth-' + key;
      bar.userData.gizmoAxis = key;
      bar.renderOrder = 100;
      this.handles[key] = bar;
      this.add(bar);
    });
  }

  getPickers() {
    return [this.handles.left, this.handles.right];
  }

  highlight(axis) {
    ['left', 'right'].forEach((key) => {
      this.handles[key].material =
        key === axis ? this.hoverMaterial : this.idleMaterial;
    });
  }

  attach(el) {
    if (!el || !el.components || !el.components['street-segment']) return this;
    const streetEl = el.parentElement;
    if (!streetEl || !streetEl.components?.['managed-street']) return this;
    this.el = el;
    this.object = el.object3D;
    this.streetObject = streetEl.object3D;
    this.visible = true;
    return this;
  }

  detach() {
    this.el = undefined;
    this.object = undefined;
    this.streetObject = null;
    this.visible = false;
    this.axis = null;
    return this;
  }

  getSegmentData() {
    return this.el?.components['street-segment']?.data;
  }

  // Street-local lateral frame at the bars' station. A path-following
  // street keeps its segments' object3D at their straight-space position
  // and bends only the ribbon geometry (street-path.js), so the bars must go
  // through the same straight→curved mapping instead of the segment's own
  // transform.
  updateLateralFrame(data) {
    const streetEl = this.el.parentElement;
    const curve = streetEl?.components?.['managed-street']?.streetCurve;
    const seg = this.object.position;
    const length = data.length || 0;
    this.barLen = Math.min(8, Math.max(2, length * 0.5));
    // arc length of the bars' center, kept fully inboard of the segment
    const s = THREE.MathUtils.clamp(
      length * BAR_STATION,
      this.barLen / 2,
      Math.max(this.barLen / 2, length - this.barLen / 2)
    );
    if (!curve) {
      // straight: segments are centered on their z, spanning ± length/2
      this.lateralOrigin.set(seg.x, seg.y, seg.z + s - length / 2);
      this.lateralRight.set(1, 0, 0);
      this.barYawWorld = null;
      return;
    }
    const frame = curve.sampler.frameAtS(s);
    this.lateralOrigin.set(
      frame.position.x + frame.right.x * seg.x,
      frame.position.y + seg.y,
      frame.position.z + frame.right.z * seg.x
    );
    this.lateralRight.copy(frame.right);
    this.barYawWorld = THREE.MathUtils.degToRad(frame.yawDeg);
  }

  updateMatrixWorld(force) {
    if (this.el && this.object) {
      const data = this.getSegmentData();
      if (data) {
        this.streetObject.updateWorldMatrix(true, false);
        this.updateLateralFrame(data);
        const halfWidth = (data.width || 0) / 2;
        ['left', 'right'].forEach((key) => {
          const handle = this.handles[key];
          const sign = key === 'right' ? 1 : -1;
          handle.position
            .copy(this.lateralOrigin)
            .addScaledVector(this.lateralRight, sign * halfWidth);
          handle.position.y += 0.3;
          this.streetObject.localToWorld(handle.position);
          this.streetObject.getWorldQuaternion(handle.quaternion);
          if (this.barYawWorld !== null) {
            handle.quaternion.multiply(
              this.tempQuat.setFromAxisAngle(Y_AXIS, this.barYawWorld)
            );
          }
          const dist = handle.position.distanceTo(this.camera.position);
          const s = THREE.MathUtils.clamp(dist * 0.02, 1, 5);
          handle.scale.set(s, s, this.barLen);
        });
      }
    }
    super.updateMatrixWorld(force);
  }

  startDrag(axis, event) {
    const handle = this.handles[axis];
    this.dragPlane.set(Y_AXIS, -handle.position.y);
    if (!this.intersectPlane(this.dragPlane, this.tempVec)) return false;

    this.dragStartPointerX = this.pointerLateral();
    this.dragStartWidth = this.getSegmentData()?.width || 0;
    this.dragSign = axis === 'right' ? 1 : -1;
  }

  // The plane hit (tempVec, world) as a lateral coordinate in the street's
  // local frame, along the bars' `right` vector.
  pointerLateral() {
    this.dragLocal.copy(this.tempVec);
    this.streetObject.worldToLocal(this.dragLocal);
    return this.dragLocal.sub(this.lateralOrigin).dot(this.lateralRight);
  }

  moveDrag(event) {
    if (!this.intersectPlane(this.dragPlane, this.tempVec)) return;
    const delta =
      (this.pointerLateral() - this.dragStartPointerX) * this.dragSign;
    let newWidth = this.dragStartWidth + delta;
    if (event.shiftKey) {
      newWidth = Math.round(newWidth * 2) / 2; // 0.5m snap
    }
    newWidth = Math.max(MIN_WIDTH, parseFloat(newWidth.toFixed(2)));
    if (newWidth === this.getSegmentData()?.width) return;

    this.el.setAttribute('street-segment', 'width', newWidth);
    this.dispatchEvent(this.changeEvent);
    this.dispatchEvent(this.objectChangeEvent);
  }

  endDrag(event) {
    if (!this.el) return;
    const finalWidth = this.getSegmentData()?.width;
    if (finalWidth === undefined || finalWidth === this.dragStartWidth) return;
    this.dispatchEvent({
      type: 'commitDrag',
      entity: this.el,
      changes: [
        {
          component: 'street-segment',
          property: 'width',
          value: finalWidth,
          oldValue: this.dragStartWidth
        }
      ]
    });
  }
}

export { SegmentWidthControls };
