/* global AFRAME, THREE */

AFRAME.registerComponent('viewer-mode', {
  schema: {
    preset: {
      type: 'string',
      default: 'camera-path',
      oneOf: ['locomotion', 'camera-path']
    },
    cameraPath: {
      type: 'string',
      default: 'circle',
      oneOf: ['circle', 'forward', 'strafe', 'zoom'],
      if: { preset: 'camera-path' }
    },
    cameraStartPosition: {
      type: 'vec3',
      default: { x: 0, y: 1.6, z: 0 }
    }
  },

  init: function () {
    // Store references to existing elements
    this.cameraRig = document.querySelector('#cameraRig');
    this.camera = document.querySelector('#camera');

    if (!this.cameraRig) {
      console.error(
        'viewer-mode component: No camera rig found with id "cameraRig"'
      );
      return;
    }

    // Store original attributes for locomotion mode
    this.originalRigAttributes = {
      cursorTeleport: this.cameraRig.getAttribute('cursor-teleport')
    };

    // Initialize basic camera path (just a simple circle for demo)
    this.initBasicCameraPath();

    // Flag to control tick execution for camera path mode
    this.cameraPathActive = false;

    // Set up the initial mode
    this.setupMode(this.data.preset);
  },

  update: function (oldData) {
    // If preset has changed, update the mode
    if (oldData.preset !== this.data.preset) {
      this.setupMode(this.data.preset);
    }
  },

  setupMode: function (mode) {
    console.log('Switching to viewer mode:', mode);

    // First disable all modes
    this.disableAllModes();

    // Then enable the selected mode
    if (mode === 'locomotion') {
      this.enableLocomotionMode();
    } else if (mode === 'camera-path') {
      this.enableCameraPathMode();
    }

    // Notify other components about the mode change
    this.el.emit('viewer-mode-changed', { mode: mode });
  },

  disableAllModes: function () {
    // Disable locomotion controls but preserve position
    this.cameraRig.setAttribute('movement-controls', 'enabled: false');
    this.cameraRig.removeAttribute('cursor-teleport');
    this.camera.setAttribute('look-controls', 'enabled: false');

    // Disable camera path animation
    this.cameraPathActive = false;
  },

  enableLocomotionMode: function () {
    // Restore original locomotion controls
    this.cameraRig.setAttribute('movement-controls', 'enabled: true');
    this.camera.setAttribute('look-controls', 'enabled: true');

    if (this.originalRigAttributes.cursorTeleport) {
      this.cameraRig.setAttribute(
        'cursor-teleport',
        this.originalRigAttributes.cursorTeleport
      );
    }
  },

  enableCameraPathMode: function () {
    // Reset path position and enable camera path animation
    this.pathPosition = 0;
    this.cameraPathActive = true;

    // Reset all path-specific counters
    this.forwardDistance = 0;
    this.strafeDistance = 0;
    this.zoomCycleTime = 0;

    // For certain paths, set the initial camera position to the start position
    const cameraPath = this.data.cameraPath;
    if (cameraPath === 'forward' || cameraPath === 'strafe') {
      // Position the camera rig at the start position
      this.cameraRig.object3D.position.copy(this.cameraStartPosition);
    }
  },

  // Initialize camera path settings for different modes
  initBasicCameraPath: function () {
    // Use the provided start position or default to a standard position
    const startPos = this.data.cameraStartPosition;
    this.cameraStartPosition = new THREE.Vector3(
      startPos.x,
      startPos.y,
      startPos.z
    );

    // Center of the path - use the camera start position as a reference
    this.pathCenter = new THREE.Vector3(
      this.cameraStartPosition.x,
      this.cameraStartPosition.y,
      this.cameraStartPosition.z
    );

    // Circular path settings
    this.pathRadius = 10;
    this.pathHeight = 3;
    this.pathSpeed = 0.002;

    // Forward path settings
    this.forwardSpeed = 0.02;
    this.forwardDistance = 0;
    this.forwardMaxDistance = 100;

    // Strafe path settings
    this.strafeSpeed = 0.02;
    this.strafeDistance = 0;
    this.strafeMaxDistance = 20;
    this.strafeDirection = 1; // 1 for right, -1 for left

    // Zoom path settings
    this.zoomSpeed = 0.01;
    this.zoomDirection = -1; // -1 for zoom out, 1 for zoom in
    this.zoomMinDistance = 3;
    this.zoomMaxDistance = 15;
    this.zoomDistance = 8; // Starting distance
    this.zoomCycleTime = 0; // Time tracker for zoom cycles
  },

  // A-Frame tick lifecycle method - called on every frame
  tick: function (time, deltaTime) {
    // Only run animation logic if camera path mode is active
    if (!this.cameraPathActive) return;

    const cameraPath = this.data.cameraPath;

    // Handle different camera paths based on the selected mode
    switch (cameraPath) {
      case 'circle':
        this.updateCirclePath();
        break;
      case 'forward':
        this.updateForwardPath();
        break;
      case 'strafe':
        this.updateStrafePath();
        break;
      case 'zoom':
        this.updateZoomPath(time);
        break;
      default:
        this.updateCirclePath();
    }
  },

  // Circle path - move around the center point
  updateCirclePath: function () {
    // Calculate position around a circle centered on pathCenter
    const x = this.pathCenter.x + this.pathRadius * Math.cos(this.pathPosition);
    const z = this.pathCenter.z + this.pathRadius * Math.sin(this.pathPosition);
    const y = this.pathCenter.y + this.pathHeight;

    // Move the camera rig
    this.cameraRig.object3D.position.set(x, y, z);

    // Make camera look at center
    this.lookAtCenter();

    // Update position for next frame
    this.pathPosition += this.pathSpeed;
  },

  // Forward path - move slowly forward along street path (z-)
  updateForwardPath: function () {
    // Get current position
    const currentPos = this.cameraRig.object3D.position;

    // Move forward (z-)
    this.forwardDistance += this.forwardSpeed;

    // Reset if we've gone too far
    if (this.forwardDistance > this.forwardMaxDistance) {
      this.forwardDistance = 0;
      // Reset to start position when we loop
      this.cameraRig.object3D.position.copy(this.cameraStartPosition);
      return;
    }

    // Set new position
    const x = currentPos.x;
    const y = this.cameraStartPosition.y + this.pathHeight;
    const z = this.cameraStartPosition.z - this.forwardDistance;

    this.cameraRig.object3D.position.set(x, y, z);

    // Look forward along the path
    const lookTarget = new THREE.Vector3(
      x,
      y,
      z - 5 // Look ahead in the direction of movement
    );

    this.lookAtPoint(lookTarget);
  },

  // Strafe path - move sideways along street path (x+)
  updateStrafePath: function () {
    // Get current position
    const currentPos = this.cameraRig.object3D.position;

    // Move sideways (x+)
    this.strafeDistance += this.strafeSpeed * this.strafeDirection;

    // Reverse direction if we've gone too far in either direction
    if (Math.abs(this.strafeDistance) > this.strafeMaxDistance) {
      this.strafeDirection *= -1;
    }

    // Set new position relative to start position
    const x = this.cameraStartPosition.x + this.strafeDistance;
    const y = this.cameraStartPosition.y + this.pathHeight;
    const z = currentPos.z;

    this.cameraRig.object3D.position.set(x, y, z);

    // Look forward along the path
    const lookTarget = new THREE.Vector3(
      x,
      y,
      z - 10 // Look ahead along the street
    );

    this.lookAtPoint(lookTarget);
  },

  // Zoom path - gradually zoom in and out
  updateZoomPath: function (time) {
    // Calculate zoom cycle (oscillate between min and max)
    this.zoomCycleTime += this.zoomSpeed;

    // Use sine wave to create smooth zoom in/out effect
    this.zoomDistance =
      this.zoomMinDistance +
      ((this.zoomMaxDistance - this.zoomMinDistance) / 2) *
        (Math.sin(this.zoomCycleTime) + 1);

    // Calculate position based on zoom distance
    // Use the start position as the point to zoom toward/away from
    const x = this.cameraStartPosition.x;
    const y = this.cameraStartPosition.y + this.pathHeight;
    const z = this.cameraStartPosition.z + this.zoomDistance;

    this.cameraRig.object3D.position.set(x, y, z);

    // Look at the center (which is now based on start position)
    this.lookAtCenter();
  },

  // Helper method to look at the center point
  lookAtCenter: function () {
    const lookAtMatrix = new THREE.Matrix4();

    // Set camera to look at center with consistent up vector (0,1,0)
    lookAtMatrix.lookAt(
      this.cameraRig.object3D.position, // Camera position
      this.pathCenter, // Target to look at
      new THREE.Vector3(0, 1, 0) // Up vector (keep this consistent)
    );

    // Extract the quaternion from our matrix
    const lookQuaternion = new THREE.Quaternion().setFromRotationMatrix(
      lookAtMatrix
    );

    // Apply the quaternion to the camera
    this.camera.object3D.quaternion.copy(lookQuaternion);
  },

  // Helper method to look at a specific point
  lookAtPoint: function (target) {
    const lookAtMatrix = new THREE.Matrix4();

    // Set camera to look at the target with consistent up vector
    lookAtMatrix.lookAt(
      this.cameraRig.object3D.position, // Camera position
      target, // Target to look at
      new THREE.Vector3(0, 1, 0) // Up vector (keep this consistent)
    );

    // Extract the quaternion from our matrix
    const lookQuaternion = new THREE.Quaternion().setFromRotationMatrix(
      lookAtMatrix
    );

    // Apply the quaternion to the camera
    this.camera.object3D.quaternion.copy(lookQuaternion);
  },

  remove: function () {
    // Disable camera path mode
    this.cameraPathActive = false;

    // Restore original locomotion mode
    this.enableLocomotionMode();
  }
});
