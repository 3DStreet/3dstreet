import { GizmoPointerControls } from './GizmoPointerControls';
import { getTravelledWaySegments } from '../../../aframe-components/street-layout-utils';

/**
 * StreetNodeControls — "Street Endpoint Nodes" prototype (#1096).
 *
 * A managed street is presented as a line with a draggable circle at each
 * end. Dragging a circle moves that endpoint while the other stays fixed;
 * the street's position, Y rotation, and managed-street.length are updated
 * so the two circles always sit at the street's ends.
 *
 * Works only on entities with a `managed-street` component (legacy
 * streetmix streets are intentionally unsupported). All math happens in the
 * street's parent space, so nested/offset layer containers behave.
 *
 * Endpoint local coordinates depend on street-align:
 *   length 'start'  -> street spans local z in [-L, 0]
 *   length 'middle' -> [-L/2, +L/2]
 *   length 'end'    -> [0, +L]
 *   width 'center'|'left'|'right' -> centerline x offset 0 | +W/2 | -W/2
 *
 * Nothing is written to the entity while the pointer is down (#1942): the
 * dragged circle follows the cursor and a footprint outline previews the
 * resulting street; position, rotation and length are applied once on
 * release. On a heavy scene the per-frame re-layout cascade (segments,
 * clones, terrain flattening, batching) used to freeze the UI mid-drag.
 */

const MIN_LENGTH = 1;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const PREVIEW_LIFT = 0.15;

class StreetNodeControls extends GizmoPointerControls {
  constructor(camera, domElement) {
    super(camera, domElement, 'gizmoPrototypeStreetNodes');

    this.el = undefined; // the managed-street entity

    this.centerlineX = 0;
    this.refreshLayoutCache = this.refreshLayoutCache.bind(this);

    this.dragPlane = new THREE.Plane();
    this.fixedWorld = new THREE.Vector3();
    this.fixedParent = new THREE.Vector3();
    this.movingParent = new THREE.Vector3();
    this.originParent = new THREE.Vector3();
    this.tmpDir = new THREE.Vector3();
    this.tmpLocal = new THREE.Vector3();
    this.tmpCorner = new THREE.Vector3();
    this.xExtent = { min: 0, max: 0 };
    // Set while dragging: the pose the street will take on release, in the
    // parent's space. Null when idle.
    this.pendingPose = null;
    this.dragStartSnapshot = null;

    this.buildHandles();
    this.buildPreview();
  }

  buildPreview() {
    this.previewMaterial = new THREE.LineBasicMaterial({
      color: 0xffd633,
      depthTest: false,
      transparent: true,
      opacity: 0.9
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(4 * 3), 3)
    );
    this.preview = new THREE.LineLoop(geom, this.previewMaterial);
    this.preview.name = 'gizmoPrototypeStreetNode-preview';
    this.preview.renderOrder = 99;
    this.preview.frustumCulled = false;
    this.preview.visible = false;
    this.add(this.preview);
  }

  buildHandles() {
    // Flat circles similar in feel to the gizmo's ground-plane square:
    // transparent purple, solid yellow on hover (#1096).
    this.idleMaterial = new THREE.MeshBasicMaterial({
      color: 0x8b5cf6,
      transparent: true,
      opacity: 0.45,
      depthTest: false
    });
    this.hoverMaterial = new THREE.MeshBasicMaterial({
      color: 0xffd633,
      transparent: false,
      depthTest: false
    });

    const discGeom = new THREE.CylinderGeometry(1.6, 1.6, 0.12, 40);
    const rimGeom = new THREE.TorusGeometry(1.6, 0.08, 8, 40);

    this.handles = {};
    ['start', 'end'].forEach((key) => {
      const group = new THREE.Group();
      group.name = 'gizmoPrototypeStreetNode-' + key;
      group.userData.gizmoAxis = key;

      const disc = new THREE.Mesh(discGeom, this.idleMaterial);
      disc.renderOrder = 100;
      group.add(disc);

      const rim = new THREE.Mesh(rimGeom, this.idleMaterial);
      rim.rotation.x = -Math.PI / 2;
      rim.renderOrder = 101;
      group.add(rim);

      this.handles[key] = group;
      this.add(group);
    });
  }

  getPickers() {
    return [this.handles.start, this.handles.end];
  }

  highlight(axis) {
    ['start', 'end'].forEach((key) => {
      const mat = key === axis ? this.hoverMaterial : this.idleMaterial;
      this.handles[key].traverse((node) => {
        if (node.isMesh) node.material = mat;
      });
    });
  }

  attach(el) {
    if (!el || !el.components || !el.components['managed-street']) return this;
    // A street following a path has no straight endpoints to drag — its
    // length and heading come from the path shape (edit that instead), so
    // the endpoint/width handles stay off.
    if (el.components['managed-street'].data?.path) return this;
    this.el = el;
    this.object = el.object3D;
    this.visible = true;
    this.refreshLayoutCache();
    el.addEventListener('segments-changed', this.refreshLayoutCache);
    el.addEventListener('alignment-changed', this.refreshLayoutCache);
    return this;
  }

  detach() {
    if (this.el) {
      this.el.removeEventListener('segments-changed', this.refreshLayoutCache);
      this.el.removeEventListener('alignment-changed', this.refreshLayoutCache);
    }
    this.el = undefined;
    this.object = undefined;
    this.visible = false;
    this.axis = null;
    this.clearDragState();
    return this;
  }

  /**
   * Cached travelled-way centerline offset and the local x extent of every
   * segment (the footprint the drag preview outlines). Recomputed on layout
   * changes.
   */
  refreshLayoutCache() {
    if (!this.el) return;
    const widthAlign = this.el.components['street-align']?.data?.width;
    if (widthAlign === 'center' || widthAlign === undefined) {
      this.centerlineX = 0;
    } else {
      const totalWidth = getTravelledWaySegments(this.el).reduce(
        (sum, seg) => sum + (seg.getAttribute('street-segment')?.width || 0),
        0
      );
      this.centerlineX =
        widthAlign === 'left' ? totalWidth / 2 : -totalWidth / 2;
    }
    this.refreshXExtent();
  }

  refreshXExtent() {
    let min = Infinity;
    let max = -Infinity;
    this.el.querySelectorAll('[street-segment]').forEach((seg) => {
      const width = seg.getAttribute('street-segment')?.width || 0;
      const x = seg.getAttribute('position')?.x || 0;
      min = Math.min(min, x - width / 2);
      max = Math.max(max, x + width / 2);
    });
    if (min === Infinity) {
      min = max = this.centerlineX;
    }
    this.xExtent = { min, max };
  }

  getStreetLength() {
    return this.el?.components['managed-street']?.data?.length || 0;
  }

  getLengthAlign() {
    return this.el?.components['street-align']?.data?.length || 'start';
  }

  /** Local-space z of both endpoints for a given length + alignment. */
  endpointLocalZ(length, align) {
    if (align === 'middle') return { start: -length / 2, end: length / 2 };
    if (align === 'end') return { start: 0, end: length };
    return { start: -length, end: 0 }; // 'start' (default)
  }

  endpointLocal(key, length, align) {
    const z = this.endpointLocalZ(length, align);
    return this.tmpLocal.set(this.centerlineX, 0, z[key]);
  }

  updateMatrixWorld(force) {
    if (this.el && this.object) {
      this.object.updateWorldMatrix(true, false);
      const length = this.getStreetLength();
      const align = this.getLengthAlign();
      const pose = this.pendingPose;
      ['start', 'end'].forEach((key) => {
        const handle = this.handles[key];
        if (pose && key === this.axis) {
          // Mid-drag: the circle previews where the endpoint will land.
          this.endpointLocal(key, pose.length, align);
          this.pendingToWorld(this.tmpLocal, handle.position);
          handle.position.y = this.fixedWorld.y;
        } else {
          handle.position.copy(this.endpointLocal(key, length, align));
          this.object.localToWorld(handle.position);
          handle.position.y += 0.2;
        }
        // Mild distance scaling so handles stay usable when zoomed out.
        const dist = handle.position.distanceTo(this.camera.position);
        const s = THREE.MathUtils.clamp(dist * 0.015, 1, 6);
        handle.scale.set(s, s, s);
      });
    }
    super.updateMatrixWorld(force);
  }

  startDrag(axis, event) {
    const handle = this.handles[axis];
    this.dragPlane.set(Y_AXIS, -handle.position.y);
    if (!this.intersectPlane(this.dragPlane, this.tempVec)) return false;

    // street-align emits 'alignment-changed' before it repositions the
    // segments, so the cached x extent can be stale; once per drag is cheap.
    this.refreshLayoutCache();

    const other = axis === 'start' ? 'end' : 'start';
    this.fixedWorld.copy(this.handles[other].position);

    const pos = this.el.getAttribute('position');
    const rot = this.el.getAttribute('rotation');
    this.dragStartSnapshot = {
      position: `${pos.x} ${pos.y} ${pos.z}`,
      rotation: `${rot.x} ${rot.y} ${rot.z}`,
      rotationXZ: { x: rot.x, z: rot.z },
      positionY: pos.y,
      length: this.getStreetLength()
    };
    this.pendingPose = null;
  }

  /** Street-local point -> world, under the pending (not yet applied) pose. */
  pendingToWorld(local, out) {
    const pose = this.pendingPose;
    out.copy(local).applyAxisAngle(Y_AXIS, pose.rotY).add(pose.origin);
    out.y = pose.origin.y;
    return this.object.parent.localToWorld(out);
  }

  updatePreview() {
    const pose = this.pendingPose;
    const z = this.endpointLocalZ(pose.length, this.getLengthAlign());
    const { min, max } = this.xExtent;
    const corners = [
      [min, z.start],
      [max, z.start],
      [max, z.end],
      [min, z.end]
    ];
    const attr = this.preview.geometry.getAttribute('position');
    corners.forEach(([x, cz], i) => {
      this.tmpCorner.set(x, 0, cz);
      this.pendingToWorld(this.tmpCorner, this.tmpCorner);
      attr.setXYZ(
        i,
        this.tmpCorner.x,
        this.fixedWorld.y - PREVIEW_LIFT,
        this.tmpCorner.z
      );
    });
    attr.needsUpdate = true;
    this.preview.visible = true;
  }

  moveDrag(event) {
    if (!this.intersectPlane(this.dragPlane, this.tempVec)) return;
    const parent = this.object.parent;
    const align = this.getLengthAlign();

    // Work in the street's parent space (XZ only).
    this.movingParent.copy(this.tempVec);
    parent.worldToLocal(this.movingParent);
    this.fixedParent.copy(this.fixedWorld);
    parent.worldToLocal(this.fixedParent);
    this.movingParent.y = 0;
    this.fixedParent.y = 0;

    let newLength = this.movingParent.distanceTo(this.fixedParent);
    newLength = Math.max(MIN_LENGTH, parseFloat(newLength.toFixed(2)));

    // Street local +Z runs start -> end.
    if (this.axis === 'end') {
      this.tmpDir.subVectors(this.movingParent, this.fixedParent);
    } else {
      this.tmpDir.subVectors(this.fixedParent, this.movingParent);
    }
    if (this.tmpDir.lengthSq() < 1e-6) return;
    this.tmpDir.normalize();
    const rotY = Math.atan2(this.tmpDir.x, this.tmpDir.z);

    // Re-derive the origin so the fixed endpoint stays exactly put:
    // origin = fixed - R(rotY) * fixedLocal(newLength)
    const fixedKey = this.axis === 'start' ? 'end' : 'start';
    const fixedLocal = this.endpointLocal(fixedKey, newLength, align).clone();
    fixedLocal.applyAxisAngle(Y_AXIS, rotY);
    this.originParent.copy(this.fixedParent).sub(fixedLocal);

    const snap = this.dragStartSnapshot;
    this.pendingPose = this.pendingPose || {
      origin: new THREE.Vector3(),
      rotY: 0,
      length: 0
    };
    this.pendingPose.origin.set(
      parseFloat(this.originParent.x.toFixed(3)),
      snap.positionY,
      parseFloat(this.originParent.z.toFixed(3))
    );
    this.pendingPose.rotY = rotY;
    this.pendingPose.length = newLength;
    this.updatePreview();

    this.dispatchEvent(this.changeEvent);
  }

  clearDragState() {
    this.pendingPose = null;
    this.dragStartSnapshot = null;
    this.preview.visible = false;
  }

  endDrag(event) {
    const snap = this.dragStartSnapshot;
    const pose = this.pendingPose;
    this.clearDragState();
    // A mid-drag detach (Escape deselects) leaves no target to commit to.
    if (!snap || !pose || !this.el) return;

    this.el.setAttribute('position', {
      x: pose.origin.x,
      y: snap.positionY,
      z: pose.origin.z
    });
    this.el.setAttribute('rotation', {
      x: snap.rotationXZ.x,
      y: parseFloat(THREE.MathUtils.radToDeg(pose.rotY).toFixed(2)),
      z: snap.rotationXZ.z
    });
    if (pose.length !== this.getStreetLength()) {
      this.el.setAttribute('managed-street', 'length', pose.length);
    }
    this.dispatchEvent(this.objectChangeEvent);

    const pos = this.el.getAttribute('position');
    const rot = this.el.getAttribute('rotation');
    this.dispatchEvent({
      type: 'commitDrag',
      entity: this.el,
      changes: [
        {
          component: 'position',
          value: `${pos.x} ${pos.y} ${pos.z}`,
          oldValue: snap.position
        },
        {
          component: 'rotation',
          value: `${rot.x} ${rot.y} ${rot.z}`,
          oldValue: snap.rotation
        },
        {
          component: 'managed-street',
          property: 'length',
          value: this.getStreetLength(),
          oldValue: snap.length
        }
      ]
    });
  }
}

export { StreetNodeControls };
