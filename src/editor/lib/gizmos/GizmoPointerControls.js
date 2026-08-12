/**
 * GizmoPointerControls — shared pointer plumbing for the custom gizmo
 * prototypes (see constants.js). Modeled on MeasureLineControls: an
 * Object3D added to inspector.sceneHelpers that runs its own raycaster
 * against its picker meshes and dispatches TransformControls-compatible
 * events ('mouseDown', 'mouseUp', 'objectChange', 'change') so viewport.js
 * can wire camera-control locking and undoable entityupdate commands the
 * same way it does for the stock controls.
 *
 * Subclasses implement:
 *   getPickers()            -> array of meshes to hit-test (name = axis id)
 *   highlight(axis)         -> hover feedback
 *   startDrag(axis, event)  -> return false to cancel the drag
 *   moveDrag(event)
 *   endDrag(event)          -> optional
 */

const raycasterLine = { threshold: 0.5 };

class GizmoPointerControls extends THREE.Object3D {
  constructor(camera, domElement, name) {
    super();

    this.name = name;
    this.camera = camera;
    this.domElement = domElement !== undefined ? domElement : document;

    this.object = undefined; // subclass-defined attach target
    this.visible = false;
    this.enabled = true;
    this.axis = null;
    this.isDragging = false;

    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Line = raycasterLine;
    this.mouse = new THREE.Vector2();
    this.tempVec = new THREE.Vector3();

    this.changeEvent = { type: 'change' };
    this.mouseDownEvent = { type: 'mouseDown' };
    this.mouseUpEvent = { type: 'mouseUp' };
    this.objectChangeEvent = { type: 'objectChange' };

    this.onPointerHover = this.onPointerHover.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);

    this.activate();
  }

  activate() {
    this.domElement.addEventListener('mousemove', this.onPointerHover, false);
    this.domElement.addEventListener('mousedown', this.onPointerDown, false);
    this.domElement.addEventListener('mousemove', this.onPointerMove, false);
    this.domElement.addEventListener('mouseup', this.onPointerUp, false);
    this.domElement.addEventListener('mouseleave', this.onPointerUp, false);

    this.domElement.addEventListener('touchmove', this.onPointerHover, false);
    this.domElement.addEventListener('touchstart', this.onPointerDown, false);
    this.domElement.addEventListener('touchmove', this.onPointerMove, false);
    this.domElement.addEventListener('touchend', this.onPointerUp, false);
    this.domElement.addEventListener('touchcancel', this.onPointerUp, false);
  }

  dispose() {
    this.domElement.removeEventListener('mousemove', this.onPointerHover);
    this.domElement.removeEventListener('mousedown', this.onPointerDown);
    this.domElement.removeEventListener('mousemove', this.onPointerMove);
    this.domElement.removeEventListener('mouseup', this.onPointerUp);
    this.domElement.removeEventListener('mouseleave', this.onPointerUp);

    this.domElement.removeEventListener('touchmove', this.onPointerHover);
    this.domElement.removeEventListener('touchstart', this.onPointerDown);
    this.domElement.removeEventListener('touchmove', this.onPointerMove);
    this.domElement.removeEventListener('touchend', this.onPointerUp);
    this.domElement.removeEventListener('touchcancel', this.onPointerUp);
  }

  updateMouse(event) {
    const pointer = event.changedTouches ? event.changedTouches[0] : event;
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((pointer.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((pointer.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.mouse, this.camera);
  }

  /** Intersect the current pointer ray with a THREE.Plane. */
  intersectPlane(plane, out) {
    return this.raycaster.ray.intersectPlane(plane, out);
  }

  onPointerHover(event) {
    if (!this.object || !this.visible || !this.enabled || this.isDragging) {
      return;
    }
    this.updateMouse(event);
    const intersects = this.raycaster.intersectObjects(this.getPickers(), true);

    let axis = null;
    if (intersects.length > 0) {
      // Pickers may be groups; the axis id lives on the named ancestor.
      let node = intersects[0].object;
      while (node && !node.userData.gizmoAxis) node = node.parent;
      axis = node ? node.userData.gizmoAxis : intersects[0].object.name;
      event.preventDefault();
      this.domElement.style.cursor = 'pointer';
    } else if (this.axis) {
      this.domElement.style.cursor = null;
    }

    if (this.axis !== axis) {
      this.axis = axis;
      this.highlight(axis);
      this.dispatchEvent(this.changeEvent);
    }
  }

  onPointerDown(event) {
    if (!this.object || !this.visible || !this.enabled || this.isDragging) {
      return;
    }
    const pointer = event.changedTouches ? event.changedTouches[0] : event;
    if (pointer.button !== 0 && pointer.button !== undefined) return;
    if (!this.axis) return;

    this.updateMouse(event);
    if (this.startDrag(this.axis, event) === false) return;

    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
    this.dispatchEvent(this.mouseDownEvent);
  }

  onPointerMove(event) {
    if (!this.object || !this.isDragging) return;
    event.preventDefault();
    event.stopPropagation();
    this.updateMouse(event);
    this.moveDrag(event);
  }

  onPointerUp(event) {
    if (!this.isDragging) return;
    this.isDragging = false;
    this.endDrag(event);
    this.dispatchEvent(this.mouseUpEvent);

    event.preventDefault();
    event.stopPropagation();

    if ('TouchEvent' in window && event instanceof TouchEvent) {
      this.axis = null;
      this.highlight(null);
    } else {
      this.onPointerHover(event);
    }
    this.dispatchEvent(this.changeEvent);
  }

  // --- subclass hooks -------------------------------------------------
  getPickers() {
    return [];
  }

  highlight(axis) {}

  startDrag(axis, event) {}

  moveDrag(event) {}

  endDrag(event) {}
}

export { GizmoPointerControls };
