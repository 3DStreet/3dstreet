import Events from './Events';

/**
 * MeasureLineControls - A class for manipulating measure line endpoints
 * Similar to TransformControls but specialized for measure lines
 */

class MeasureLineControls extends THREE.Object3D {
  constructor(camera, domElement) {
    super();

    this.domElement = domElement !== undefined ? domElement : document;
    this.camera = camera;

    // Properties
    this.object = undefined;
    this.visible = false;
    this.active = true;
    this.handleRadius = 0.5;
    this.hoveredColor = '#FFFF00'; // Solid yellow for hover
    this.defaultColor = '#8844AA'; // Purple for default
    this.axis = null; // 'start' or 'end'

    // Initialize vectors for position tracking
    this.startPoint = new THREE.Vector3();
    this.endPoint = new THREE.Vector3();
    this.tempVec = new THREE.Vector3();
    this.dragOffset = new THREE.Vector3();
    this.planeNormal = new THREE.Vector3();
    this.mouse = new THREE.Vector2();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // XZ plane (y=0)

    // Prepare variables for dragging logic
    this.raycaster = new THREE.Raycaster();
    this.intersectedHandle = null;
    this.selectedHandle = null;
    this.dragPlane = new THREE.Plane();
    this.isDragging = false;

    // Create handles group
    this.handleGroup = new THREE.Group();
    this.add(this.handleGroup);

    // Create the handles
    this.createHandles();

    // Define events
    this.changeEvent = { type: 'change' };
    this.mouseDownEvent = { type: 'mouseDown' };
    this.mouseUpEvent = { type: 'mouseUp' };
    this.objectChangeEvent = { type: 'objectChange' };

    // Event state
    this.enabled = true;

    // Bind methods
    this.onPointerHover = this.onPointerHover.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);

    // Listen for transform mode changes
    Events.on('transformmodechange', (mode) => {
      this.enabled = mode !== 'off';
      if (!this.enabled) {
        this.visible = false;
        this.axis = null;
      }
    });

    // Activate controls
    this.activate();
  }

  createHandles() {
    // Create handle geometry (sphere)
    const geometry = new THREE.SphereGeometry(this.handleRadius, 16, 16);

    // Create materials for both states
    this.defaultMaterial = new THREE.MeshBasicMaterial({
      color: this.defaultColor,
      transparent: true,
      opacity: 0.5,
      depthTest: false
    });

    this.hoveredMaterial = new THREE.MeshBasicMaterial({
      color: this.hoveredColor,
      transparent: false,
      depthTest: false
    });

    // Create handles container
    this.handles = {};

    // Create start handle
    this.handles.start = new THREE.Mesh(geometry, this.defaultMaterial);
    this.handles.start.name = 'start';
    this.handles.start.renderOrder = 100; // Ensure visibility
    this.handleGroup.add(this.handles.start);

    // Create end handle
    this.handles.end = new THREE.Mesh(geometry, this.defaultMaterial);
    this.handles.end.name = 'end';
    this.handles.end.renderOrder = 100; // Ensure visibility
    this.handleGroup.add(this.handles.end);
  }

  activate() {
    this.domElement.addEventListener('mousemove', this.onPointerHover, false);
    this.domElement.addEventListener('mousedown', this.onPointerDown, false);
    this.domElement.addEventListener('mousemove', this.onPointerMove, false);
    this.domElement.addEventListener('mouseup', this.onPointerUp, false);
    this.domElement.addEventListener('mouseleave', this.onPointerUp, false);

    // Touch events
    this.domElement.addEventListener('touchmove', this.onPointerHover, false);
    this.domElement.addEventListener('touchstart', this.onPointerDown, false);
    this.domElement.addEventListener('touchmove', this.onPointerMove, false);
    this.domElement.addEventListener('touchend', this.onPointerUp, false);
    this.domElement.addEventListener('touchcancel', this.onPointerUp, false);
    this.domElement.addEventListener('touchleave', this.onPointerUp, false);
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
    this.domElement.removeEventListener('touchleave', this.onPointerUp);
  }

  attach(object) {
    if (object && object.components && object.components['measure-line']) {
      this.object = object;
      this.visible = true;
      this.enabled = true;

      // Ensure the measure-line component has valid data
      const measureLine = object.components['measure-line'];
      if (!measureLine.data) {
        measureLine.data = {
          start: { x: 0, y: 0, z: 0 },
          end: { x: 0, y: 0, z: 0 }
        };
      }

      // Parse string values if necessary
      if (typeof measureLine.data.start === 'string') {
        const [x, y, z] = measureLine.data.start.split(' ').map(Number);
        measureLine.data.start = { x, y, z };
      }
      if (typeof measureLine.data.end === 'string') {
        const [x, y, z] = measureLine.data.end.split(' ').map(Number);
        measureLine.data.end = { x, y, z };
      }

      this.update();
      Events.emit('transformcontrols-attach', object);
    }
  }

  detach() {
    if (this.object) {
      Events.emit('transformcontrols-detach', this.object);
      this.object = undefined;
      this.visible = false;
      this.axis = null;
    }
  }

  update() {
    if (!this.object) return;

    // Get positions from the measure-line component
    const measureLine = this.object.components['measure-line'];
    if (!measureLine || !measureLine.data) return;

    const startPos = measureLine.data.start;
    const endPos = measureLine.data.end;

    if (!startPos || !endPos) return;

    try {
      // Update handle positions
      this.handles.start.position.set(startPos.x, startPos.y, startPos.z);
      this.handles.end.position.set(endPos.x, endPos.y, endPos.z);

      // Store current positions for reference
      this.startPoint.set(startPos.x, startPos.y, startPos.z);
      this.endPoint.set(endPos.x, endPos.y, endPos.z);

      // Update handle visibility based on control state
      this.handles.start.visible = this.visible && this.enabled;
      this.handles.end.visible = this.visible && this.enabled;

      // Update handle materials
      this.handles.start.material =
        this.axis === 'start' ? this.hoveredMaterial : this.defaultMaterial;
      this.handles.end.material =
        this.axis === 'end' ? this.hoveredMaterial : this.defaultMaterial;

      // Emit change event
      this.dispatchEvent(this.changeEvent);
    } catch (error) {
      console.error('Error updating handle positions:', error);
    }
  }

  highlight(axis) {
    // Reset all handles to default material
    Object.values(this.handles).forEach((handle) => {
      handle.material = this.defaultMaterial;
    });

    // Highlight the specified handle
    if (axis && this.handles[axis]) {
      this.handles[axis].material = this.hoveredMaterial;
    }
  }

  onPointerHover(event) {
    if (!this.object || !this.visible || !this.enabled || this.isDragging) {
      return;
    }

    // Get pointer position
    const pointer = event.changedTouches ? event.changedTouches[0] : event;
    const rect = this.domElement.getBoundingClientRect();

    // Convert to normalized device coordinates (-1 to +1)
    this.mouse.x = ((pointer.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((pointer.clientY - rect.top) / rect.height) * 2 + 1;

    // Cast ray
    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Check for intersections with handles
    const handleObjects = Object.values(this.handles);
    const intersects = this.raycaster.intersectObjects(handleObjects, true);

    let axis = null;
    if (intersects.length > 0) {
      axis = intersects[0].object.name;
      event.preventDefault();
    }

    // Update highlight if axis changed
    if (this.axis !== axis) {
      this.axis = axis;
      this.highlight(axis);
      this.dispatchEvent(this.changeEvent);
    }
  }

  onPointerDown(event) {
    if (!this.object || !this.visible || this.isDragging) return;

    const pointer = event.changedTouches ? event.changedTouches[0] : event;

    // Only proceed if left mouse button or touch
    if (pointer.button === 0 || pointer.button === undefined) {
      // If we have a selected axis (handle)
      if (this.axis) {
        event.preventDefault();
        event.stopPropagation();

        this.selectedHandle = this.handles[this.axis];
        this.dispatchEvent(this.mouseDownEvent);

        // Set up drag plane - use XZ ground plane for constrained movement
        this.dragPlane = this.groundPlane;

        // Cast ray to find intersection with drag plane
        const rect = this.domElement.getBoundingClientRect();
        this.mouse.x = ((pointer.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((pointer.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);

        // Calculate drag offset
        if (this.raycaster.ray.intersectPlane(this.dragPlane, this.tempVec)) {
          // Save the y-position of the handle to maintain it during dragging
          const handleY = this.selectedHandle.position.y;
          this.tempVec.y = handleY; // Constrain to original Y position

          this.dragOffset.copy(this.selectedHandle.position).sub(this.tempVec);
        }

        this.isDragging = true;
      }
    }
  }

  onPointerMove(event) {
    if (!this.object || !this.selectedHandle || !this.isDragging) return;

    const pointer = event.changedTouches ? event.changedTouches[0] : event;

    // Prevent default browser behavior
    event.preventDefault();
    event.stopPropagation();

    // Update mouse position
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((pointer.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((pointer.clientY - rect.top) / rect.height) * 2 + 1;

    // Cast ray and find intersection with ground plane
    this.raycaster.setFromCamera(this.mouse, this.camera);

    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.tempVec)) {
      // Apply offset to maintain grab position
      this.tempVec.add(this.dragOffset);

      // Preserve the original Y position
      const handleY = this.selectedHandle.position.y;
      this.tempVec.y = handleY;

      // Update handle position
      this.selectedHandle.position.copy(this.tempVec);

      // Update measure line data based on which handle is being dragged
      const newData = {};

      if (this.selectedHandle.name === 'start') {
        newData.start = {
          x: this.tempVec.x,
          y: this.tempVec.y,
          z: this.tempVec.z
        };
      } else if (this.selectedHandle.name === 'end') {
        newData.end = {
          x: this.tempVec.x,
          y: this.tempVec.y,
          z: this.tempVec.z
        };
      }

      // Update measure-line component
      if (this.object.setAttribute) {
        this.object.setAttribute('measure-line', newData);
      }

      this.dispatchEvent(this.changeEvent);
      this.dispatchEvent(this.objectChangeEvent);
    }
  }

  onPointerUp(event) {
    if (this.isDragging) {
      // Reset state
      this.isDragging = false;
      this.selectedHandle = null;

      // Dispatch mouseUp event
      this.dispatchEvent(this.mouseUpEvent);

      // Prevent event propagation
      event.preventDefault();
      event.stopPropagation();

      // If it's a touch event, reset the axis to force a new hover check
      if ('TouchEvent' in window && event instanceof TouchEvent) {
        this.axis = null;
        this.highlight(null);
      } else {
        // For mouse events, update hover state
        this.onPointerHover(event);
      }

      this.dispatchEvent(this.changeEvent);
    }
  }
}

// Make available in THREE namespace
THREE.MeasureLineControls = MeasureLineControls;

// Export the class
export { MeasureLineControls };
