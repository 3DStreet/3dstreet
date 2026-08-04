import { GizmoPointerControls } from './GizmoPointerControls';

/**
 * SimpleTransformControls — the "Simplified Move + Rotate" prototype
 * (#1674) with an optional ground-clamp behavior (#1446).
 *
 * One combined gizmo, no modes:
 *   - a translucent disc with four arrows: drag to move along the ground
 *     plane (XZ, Y preserved — or clamped to the surface below when
 *     `clampToGround` is set)
 *   - a thick ring around it: drag to rotate around Y
 *
 * Hold Shift while dragging to snap (0.5m translation grid, 15° rotation).
 *
 * Attach/detach mirror TransformControls (attach takes an Object3D with an
 * `.el`), and 'mouseDown'/'objectChange'/'mouseUp' events fire the same way
 * so viewport.js reuses its pre-drag-snapshot + entityupdate wiring.
 */

const TRANSLATE_SNAP = 0.5; // meters
const ROTATE_SNAP = THREE.MathUtils.degToRad(15);

const COLOR_MOVE = 0x8b5cf6; // purple
const COLOR_ROTATE = 0x1faaf2; // 3DStreet selection blue
const COLOR_HOVER = 0xffd633; // yellow

function roundVec3(v) {
  v.set(
    parseFloat(v.x.toFixed(3)),
    parseFloat(v.y.toFixed(3)),
    parseFloat(v.z.toFixed(3))
  );
  return v;
}

class SimpleTransformControls extends GizmoPointerControls {
  constructor(camera, domElement) {
    super(camera, domElement, 'gizmoPrototypeSimple');

    this.size = 1.5;
    // When true, horizontal drags re-seat the object on whatever surface is
    // below the drag point (#1446). Set by the viewport per prototype.
    this.clampToGround = false;
    // Root to raycast against for ground clamping (the A-Frame scene
    // object3D — editor helpers live in a separate graph so they are never
    // hit). Assigned by viewport.js after construction.
    this.groundRaycastRoot = null;

    this.dragPlane = new THREE.Plane();
    this.dragOffset = new THREE.Vector3();
    this.dragStartWorldY = 0;
    this.groundOffset = 0; // worldPos.y - bbox.min.y, so objects sit on, not in
    this.startPointerAngle = 0;
    this.startRotY = 0;
    this.groundRaycaster = new THREE.Raycaster();
    this.groundRayOrigin = new THREE.Vector3();
    this.DOWN = new THREE.Vector3(0, -1, 0);
    this.worldPos = new THREE.Vector3();
    this.parentTarget = new THREE.Vector3();
    this.bbox = new THREE.Box3();

    this.buildHandles();
  }

  buildHandles() {
    // --- move disc + arrows ---------------------------------------------
    this.moveMaterial = new THREE.MeshBasicMaterial({
      color: COLOR_MOVE,
      transparent: true,
      opacity: 0.4,
      depthTest: false,
      side: THREE.DoubleSide
    });
    this.moveArrowMaterial = new THREE.MeshBasicMaterial({
      color: COLOR_MOVE,
      transparent: true,
      opacity: 0.9,
      depthTest: false
    });

    this.moveGroup = new THREE.Group();
    this.moveGroup.name = 'gizmoPrototypeSimpleMove';
    this.moveGroup.userData.gizmoAxis = 'move';

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(0.55, 32),
      this.moveMaterial
    );
    disc.rotation.x = -Math.PI / 2;
    disc.renderOrder = 100;
    this.moveGroup.add(disc);

    // Four outward arrows on the disc edge (move-along-ground affordance).
    const coneGeom = new THREE.ConeGeometry(0.11, 0.28, 12);
    const shaftGeom = new THREE.CylinderGeometry(0.04, 0.04, 0.22, 8);
    const arrowDirs = [
      { dir: [1, 0, 0], rotZ: -Math.PI / 2, rotX: 0 },
      { dir: [-1, 0, 0], rotZ: Math.PI / 2, rotX: 0 },
      { dir: [0, 0, 1], rotZ: 0, rotX: Math.PI / 2 },
      { dir: [0, 0, -1], rotZ: 0, rotX: -Math.PI / 2 }
    ];
    arrowDirs.forEach(({ dir, rotZ, rotX }) => {
      const shaft = new THREE.Mesh(shaftGeom, this.moveArrowMaterial);
      shaft.position.set(dir[0] * 0.68, 0, dir[2] * 0.68);
      shaft.rotation.set(rotX, 0, rotZ);
      shaft.renderOrder = 101;
      this.moveGroup.add(shaft);

      const cone = new THREE.Mesh(coneGeom, this.moveArrowMaterial);
      cone.position.set(dir[0] * 0.9, 0, dir[2] * 0.9);
      cone.rotation.set(rotX, 0, rotZ);
      cone.renderOrder = 101;
      this.moveGroup.add(cone);
    });

    const movePicker = new THREE.Mesh(
      new THREE.CircleGeometry(0.95, 16),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    );
    movePicker.rotation.x = -Math.PI / 2;
    movePicker.name = 'move';
    movePicker.userData.gizmoAxis = 'move';
    this.movePicker = movePicker;

    // --- rotate ring -----------------------------------------------------
    this.rotateMaterial = new THREE.MeshBasicMaterial({
      color: COLOR_ROTATE,
      transparent: true,
      opacity: 0.9,
      depthTest: false
    });

    // Thick tube instead of a 1px line (#1674).
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.05, 8, 64),
      this.rotateMaterial
    );
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 99;
    ring.name = 'gizmoPrototypeSimpleRotate';
    this.rotateRing = ring;

    const rotatePicker = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.22, 8, 32),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    rotatePicker.rotation.x = -Math.PI / 2;
    rotatePicker.name = 'rotate';
    rotatePicker.userData.gizmoAxis = 'rotate';
    this.rotatePicker = rotatePicker;

    this.hoverMaterial = new THREE.MeshBasicMaterial({
      color: COLOR_HOVER,
      transparent: true,
      opacity: 0.95,
      depthTest: false
    });

    this.add(this.moveGroup);
    this.add(movePicker);
    this.add(ring);
    this.add(rotatePicker);
  }

  getPickers() {
    return [this.movePicker, this.rotatePicker];
  }

  highlight(axis) {
    const moveMats = axis === 'move';
    this.moveGroup.traverse((node) => {
      if (!node.isMesh) return;
      if (node.geometry.type === 'CircleGeometry') {
        node.material = moveMats ? this.hoverMaterial : this.moveMaterial;
      } else {
        node.material = moveMats ? this.hoverMaterial : this.moveArrowMaterial;
      }
    });
    this.rotateRing.material =
      axis === 'rotate' ? this.hoverMaterial : this.rotateMaterial;
  }

  attach(object) {
    this.object = object;
    this.visible = true;
    return this;
  }

  detach() {
    this.object = undefined;
    this.visible = false;
    this.axis = null;
    return this;
  }

  // Follow the attached object and keep an approximately constant screen
  // size, like TransformControls does.
  updateMatrixWorld(force) {
    if (this.object) {
      this.object.updateWorldMatrix(true, false);
      this.object.getWorldPosition(this.position);
      let factor;
      if (this.camera.isOrthographicCamera) {
        factor = (this.camera.top - this.camera.bottom) / this.camera.zoom;
      } else {
        factor =
          this.position.distanceTo(this.camera.position) *
          Math.min(
            (1.9 * Math.tan((Math.PI * this.camera.fov) / 360)) /
              this.camera.zoom,
            7
          );
      }
      const scale = (factor * this.size) / 4;
      this.scale.set(scale, scale, scale);
    }
    super.updateMatrixWorld(force);
  }

  startDrag(axis, event) {
    const object = this.object;
    object.getWorldPosition(this.worldPos);
    this.dragStartWorldY = this.worldPos.y;
    this.dragPlane.set(new THREE.Vector3(0, 1, 0), -this.worldPos.y);

    if (!this.intersectPlane(this.dragPlane, this.tempVec)) return false;

    if (axis === 'move') {
      this.dragOffset.copy(this.worldPos).sub(this.tempVec);
      this.groundOffset = 0;
      if (this.clampToGround) {
        this.bbox.setFromObject(object);
        if (!this.bbox.isEmpty()) {
          this.groundOffset = this.worldPos.y - this.bbox.min.y;
        }
      }
    } else if (axis === 'rotate') {
      this.startPointerAngle = Math.atan2(
        this.tempVec.x - this.worldPos.x,
        this.tempVec.z - this.worldPos.z
      );
      this.startRotY = object.rotation.y;
    }
  }

  moveDrag(event) {
    if (!this.intersectPlane(this.dragPlane, this.tempVec)) return;
    const object = this.object;

    if (this.axis === 'move') {
      const target = this.tempVec.add(this.dragOffset);
      if (event.shiftKey) {
        target.x = Math.round(target.x / TRANSLATE_SNAP) * TRANSLATE_SNAP;
        target.z = Math.round(target.z / TRANSLATE_SNAP) * TRANSLATE_SNAP;
      }
      target.y = this.dragStartWorldY;
      if (this.clampToGround) {
        const groundY = this.findGroundY(target.x, target.z);
        if (groundY !== null) {
          target.y = groundY + this.groundOffset;
        }
      }
      this.parentTarget.copy(target);
      object.parent.worldToLocal(this.parentTarget);
      object.position.copy(roundVec3(this.parentTarget));
      this.objectChangeEvent.mode = 'translate';
    } else if (this.axis === 'rotate') {
      const angle = Math.atan2(
        this.tempVec.x - this.worldPos.x,
        this.tempVec.z - this.worldPos.z
      );
      let rotY = this.startRotY + (angle - this.startPointerAngle);
      if (event.shiftKey) {
        rotY = Math.round(rotY / ROTATE_SNAP) * ROTATE_SNAP;
      }
      object.rotation.y = parseFloat(rotY.toFixed(3));
      this.objectChangeEvent.mode = 'rotate';
    }

    this.dispatchEvent(this.changeEvent);
    this.dispatchEvent(this.objectChangeEvent);
  }

  /**
   * Highest surface under (x, z), excluding the dragged object itself and
   * anything invisible. Returns null when nothing is below.
   */
  findGroundY(x, z) {
    if (!this.groundRaycastRoot) return null;
    this.groundRayOrigin.set(x, this.dragStartWorldY + 500, z);
    this.groundRaycaster.set(this.groundRayOrigin, this.DOWN);
    this.groundRaycaster.far = 2000;
    const hits = this.groundRaycaster.intersectObject(
      this.groundRaycastRoot,
      true
    );
    for (const hit of hits) {
      if (this.isOwnOrHidden(hit.object)) continue;
      return hit.point.y;
    }
    return null;
  }

  isOwnOrHidden(node) {
    let n = node;
    while (n) {
      if (n === this.object || n === this) return true;
      if (n.visible === false) return true;
      n = n.parent;
    }
    return false;
  }
}

export { SimpleTransformControls };
