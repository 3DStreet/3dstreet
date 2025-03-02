// A-Frame component for manipulating measure-line endpoints
// This component adds draggable circular handles to both endpoints

AFRAME.registerComponent('measure-line-gizmo', {
  schema: {
    active: { default: true },
    handleRadius: { default: 0.5 },
    hoveredColor: { default: '#FFFF00' }, // Solid yellow for hover
    defaultColor: { default: '#8844AA' } // Transparent purple for default
  },

  init: function () {
    // Store references to both handles
    this.handles = {
      start: null,
      end: null
    };

    // Initialize vectors for position tracking
    this.startPoint = new THREE.Vector3();
    this.endPoint = new THREE.Vector3();
    this.tempVec = new THREE.Vector3();
    this.dragOffset = new THREE.Vector3();
    this.planeNormal = new THREE.Vector3();
    this.mouse = new THREE.Vector2();

    // Create a reference to the measure-line component
    this.measureLine = this.el.components['measure-line'];
    if (!this.measureLine) {
      console.error('measure-line-gizmo requires measure-line component');
      return;
    }

    this.handleGroup = new THREE.Group();
    this.el.setObject3D('lineGizmo', this.handleGroup);

    // Create the handles
    this.createHandles();

    // Set up event listeners
    this.addEventListeners();

    // Prepare variables for dragging logic
    this.raycaster = new THREE.Raycaster();
    this.intersectedHandle = null;
    this.selectedHandle = null;
    this.dragPlane = new THREE.Plane();
    this.isDragging = false;
  },

  createHandles: function () {
    // Create handle geometry (sphere)
    const geometry = new THREE.SphereGeometry(this.data.handleRadius, 16, 16);

    // Create materials for both states
    this.defaultMaterial = new THREE.MeshBasicMaterial({
      color: this.data.defaultColor,
      transparent: true,
      opacity: 0.5,
      depthTest: false
    });

    this.hoveredMaterial = new THREE.MeshBasicMaterial({
      color: this.data.hoveredColor,
      transparent: false,
      depthTest: false
    });

    // Create start handle
    this.handles.start = new THREE.Mesh(geometry, this.defaultMaterial.clone());
    this.handles.start.name = 'start';
    this.handles.start.renderOrder = 100; // Ensure visibility
    this.handleGroup.add(this.handles.start);

    // Create end handle
    this.handles.end = new THREE.Mesh(geometry, this.defaultMaterial.clone());
    this.handles.end.name = 'end';
    this.handles.end.renderOrder = 100; // Ensure visibility
    this.handleGroup.add(this.handles.end);

    // Position handles at the line endpoints
    if (this.measureLine && this.measureLine.data) {
      this.updateHandlePositions();
    }
  },

  updateHandlePositions: function () {
    if (
      !this.measureLine ||
      !this.measureLine.data ||
      !this.handles.start ||
      !this.handles.end
    ) {
      return;
    }

    const startPos = this.measureLine.data.start;
    const endPos = this.measureLine.data.end;

    if (!startPos || !endPos) {
      return;
    }

    try {
      // Update handle positions
      this.handles.start.position.set(startPos.x, startPos.y, startPos.z);
      this.handles.end.position.set(endPos.x, endPos.y, endPos.z);

      // Store current positions for reference
      if (this.startPoint && this.endPoint) {
        this.startPoint.set(startPos.x, startPos.y, startPos.z);
        this.endPoint.set(endPos.x, endPos.y, endPos.z);
      }
    } catch (error) {
      console.error('Error updating handle positions:', error);
    }
  },

  addEventListeners: function () {
    // Get the renderer's canvas
    const canvas = document.querySelector('canvas');
    if (!canvas) {
      console.error('Could not find canvas element');
      return;
    }

    // Bind event handlers to component context
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);

    // Add event listeners
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mouseup', this.onMouseUp);

    // Add touch event listeners for mobile
    canvas.addEventListener('touchmove', this.onTouchMove.bind(this));
    canvas.addEventListener('touchstart', this.onTouchStart.bind(this));
    canvas.addEventListener('touchend', this.onTouchEnd.bind(this));
  },

  onMouseMove: function (event) {
    if (!this.data.active) return;

    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();

    // Convert mouse coordinates to normalized device coordinates (-1 to +1)
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    if (this.isDragging && this.selectedHandle) {
      this.handleDrag();
    } else {
      this.handleHover();
    }
  },

  onTouchMove: function (event) {
    if (!this.data.active || !event.touches.length) return;

    event.preventDefault();
    const touch = event.touches[0];
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();

    this.mouse.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;

    if (this.isDragging && this.selectedHandle) {
      this.handleDrag();
    }
  },

  handleHover: function () {
    // Cast a ray from the camera through the mouse position
    const camera = document.querySelector('[camera]').getObject3D('camera');
    this.raycaster.setFromCamera(this.mouse, camera);

    // Check for intersections with our handles
    const handleObjects = [this.handles.start, this.handles.end];
    const intersects = this.raycaster.intersectObjects(handleObjects);

    // Reset previously hovered handle
    if (
      this.intersectedHandle &&
      (!intersects.length || this.intersectedHandle !== intersects[0].object)
    ) {
      this.intersectedHandle.material = this.defaultMaterial.clone();
      this.intersectedHandle = null;
    }

    // Handle new hover
    if (intersects.length > 0 && !this.isDragging) {
      const handle = intersects[0].object;

      if (this.intersectedHandle !== handle) {
        this.intersectedHandle = handle;
        handle.material = this.hoveredMaterial.clone();
      }
    }
  },

  onMouseDown: function (event) {
    if (!this.data.active || !this.intersectedHandle) return;

    this.isDragging = true;
    this.selectedHandle = this.intersectedHandle;

    // Set up drag plane
    const camera = document.querySelector('[camera]').getObject3D('camera');

    // Calculate plane normal (perpendicular to view direction)
    this.planeNormal
      .copy(camera.position)
      .sub(this.selectedHandle.position)
      .normalize();

    // Create a plane perpendicular to the camera view at the handle position
    this.dragPlane.setFromNormalAndCoplanarPoint(
      this.planeNormal,
      this.selectedHandle.position
    );

    // Cast ray to find intersection with drag plane
    this.raycaster.setFromCamera(this.mouse, camera);

    // Calculate drag offset
    this.raycaster.ray.intersectPlane(this.dragPlane, this.tempVec);
    this.dragOffset.copy(this.selectedHandle.position).sub(this.tempVec);
  },

  onTouchStart: function (event) {
    if (!this.data.active || !event.touches.length) return;

    event.preventDefault();
    const touch = event.touches[0];
    const canvas = event.target;
    const rect = canvas.getBoundingClientRect();

    this.mouse.x = ((touch.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((touch.clientY - rect.top) / rect.height) * 2 + 1;

    // Run hover check first to identify the handle
    this.handleHover();

    if (this.intersectedHandle) {
      this.onMouseDown(event);
    }
  },

  handleDrag: function () {
    if (!this.selectedHandle || !this.isDragging) return;

    const camera = document.querySelector('[camera]').getObject3D('camera');

    // Cast ray from camera through mouse point
    this.raycaster.setFromCamera(this.mouse, camera);

    // Find intersection with drag plane
    if (this.raycaster.ray.intersectPlane(this.dragPlane, this.tempVec)) {
      // Apply offset to maintain grab position
      this.tempVec.add(this.dragOffset);

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
      this.el.setAttribute('measure-line', newData);
    }
  },

  onMouseUp: function (event) {
    this.isDragging = false;
    this.selectedHandle = null;
  },

  onTouchEnd: function (event) {
    this.onMouseUp(event);
  },

  update: function (oldData) {
    // Handle changes to component data
    if (this.data.active !== oldData.active) {
      if (this.data.active) {
        this.handleGroup.visible = true;
      } else {
        this.handleGroup.visible = false;
      }
    }

    // Update handle positions
    this.updateHandlePositions();
  },

  tick: function () {
    // Only update if the measure line has changed
    if (
      this.measureLine &&
      this.measureLine.data &&
      this.handles.start &&
      this.handles.end
    ) {
      const startPos = this.measureLine.data.start;
      const endPos = this.measureLine.data.end;

      if (!startPos || !endPos || !this.startPoint || !this.endPoint) return;

      try {
        // Check if positions have changed
        if (
          this.startPoint.x !== startPos.x ||
          this.startPoint.y !== startPos.y ||
          this.startPoint.z !== startPos.z ||
          this.endPoint.x !== endPos.x ||
          this.endPoint.y !== endPos.y ||
          this.endPoint.z !== endPos.z
        ) {
          this.updateHandlePositions();
        }
      } catch (error) {
        console.error('Error in tick function:', error);
      }
    }
  },

  remove: function () {
    // Remove event listeners
    const canvas = document.querySelector('canvas');
    if (canvas) {
      canvas.removeEventListener('mousemove', this.onMouseMove);
      canvas.removeEventListener('mousedown', this.onMouseDown);
      canvas.removeEventListener('mouseup', this.onMouseUp);
      canvas.removeEventListener('touchmove', this.onTouchMove);
      canvas.removeEventListener('touchstart', this.onTouchStart);
      canvas.removeEventListener('touchend', this.onTouchEnd);
    }

    // Remove objects from scene
    this.el.removeObject3D('lineGizmo');

    // Dispose of materials and geometries
    this.defaultMaterial.dispose();
    this.hoveredMaterial.dispose();
  }
});
