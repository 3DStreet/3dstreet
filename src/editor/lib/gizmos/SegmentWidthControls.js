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

  updateMatrixWorld(force) {
    if (this.el && this.object) {
      const data = this.getSegmentData();
      if (data) {
        this.object.updateWorldMatrix(true, false);
        const halfWidth = (data.width || 0) / 2;
        const barLen = Math.min(8, Math.max(2, (data.length || 0) * 0.5));
        ['left', 'right'].forEach((key) => {
          const handle = this.handles[key];
          const sign = key === 'right' ? 1 : -1;
          handle.position.set(sign * halfWidth, 0.3, 0);
          this.object.localToWorld(handle.position);
          this.object.getWorldQuaternion(handle.quaternion);
          const dist = handle.position.distanceTo(this.camera.position);
          const s = THREE.MathUtils.clamp(dist * 0.02, 1, 5);
          handle.scale.set(s, s, barLen);
        });
      }
    }
    super.updateMatrixWorld(force);
  }

  startDrag(axis, event) {
    const handle = this.handles[axis];
    this.dragPlane.set(Y_AXIS, -handle.position.y);
    if (!this.intersectPlane(this.dragPlane, this.tempVec)) return false;

    this.dragLocal.copy(this.tempVec);
    this.streetObject.worldToLocal(this.dragLocal);
    this.dragStartPointerX = this.dragLocal.x;
    this.dragStartWidth = this.getSegmentData()?.width || 0;
    this.dragSign = axis === 'right' ? 1 : -1;
  }

  moveDrag(event) {
    if (!this.intersectPlane(this.dragPlane, this.tempVec)) return;
    this.dragLocal.copy(this.tempVec);
    this.streetObject.worldToLocal(this.dragLocal);

    const delta = (this.dragLocal.x - this.dragStartPointerX) * this.dragSign;
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
