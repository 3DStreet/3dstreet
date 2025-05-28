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
      oneOf: ['circle', 'spiral', 'figure-eight'],
      if: { preset: 'camera-path' }
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
  },

  // Create a basic circular camera path for demonstration
  initBasicCameraPath: function () {
    // Center of the path - get from the camera's current position
    this.pathCenter = new THREE.Vector3(0, 1.6, 0);
    this.pathRadius = 10;
    this.pathHeight = 3;
    this.pathSpeed = 0.002;
  },

  // A-Frame tick lifecycle method - called on every frame
  tick: function (time, deltaTime) {
    // Only run animation logic if camera path mode is active
    if (!this.cameraPathActive) return;

    // Simple circular path around the center point
    const x = this.pathCenter.x + this.pathRadius * Math.cos(this.pathPosition);
    const z = this.pathCenter.z + this.pathRadius * Math.sin(this.pathPosition);
    const y = this.pathCenter.y + this.pathHeight;

    // Move the camera rig
    this.cameraRig.object3D.position.set(x, y, z);

    // We'll use a proper lookAt matrix to ensure consistent up vector
    // This prevents the camera from flipping

    // Create a temporary matrix for our desired camera orientation
    const lookAtMatrix = new THREE.Matrix4();

    // Set camera to look at center with consistent up vector (0,1,0)
    // This is the key to preventing the camera from flipping at 180 degrees
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

    // Update position for next frame
    this.pathPosition += this.pathSpeed;
  },

  remove: function () {
    // Disable camera path mode
    this.cameraPathActive = false;

    // Restore original locomotion mode
    this.enableLocomotionMode();
  }
});
