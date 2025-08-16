/* global AFRAME, THREE */

/**
 * Helper function to get the scene-timer component
 * This provides a more reliable way to access the timer than using global variables
 * @returns {Object|null} The scene-timer component or null if not found
 */
function getTimerComponent() {
  return document.querySelector('a-scene')?.components['scene-timer'];
}

AFRAME.registerComponent('viewer-mode', {
  schema: {
    preset: {
      type: 'string',
      default: 'camera-path',
      oneOf: ['locomotion', 'camera-path', 'ar-webxr']
    },
    cameraPath: {
      type: 'string',
      default: 'circle',
      oneOf: ['circle', 'forward', 'strafe', 'custom'],
      if: { preset: 'camera-path' }
    },
    customPathEntity: {
      type: 'string',
      default: '',
      if: { preset: 'camera-path', cameraPath: 'custom' }
    },
    cameraStartPosition: {
      type: 'vec3',
      default: { x: 0, y: 1.6, z: 0 }
    },
    webXRVariant: {
      type: 'boolean',
      default: false,
      if: { preset: 'ar-webxr' }
    }
  },

  init: function () {
    // Store references to existing elements
    this.cameraRig = document.querySelector('#cameraRig');
    this.camera = document.querySelector('#camera');
    this.leftHand = document.querySelector('#leftHand');
    this.rightHand = document.querySelector('#rightHand');

    if (!this.cameraRig) {
      console.error(
        'viewer-mode component: No camera rig found with id "cameraRig"'
      );
      return;
    }

    // Store blink controls settings
    this.blinkControlsSettings = {
      leftHand: null,
      rightHand: null
    };

    // Check if timer component exists
    if (!getTimerComponent()) {
      console.warn(
        'viewer-mode component: No scene-timer component found, camera will not move'
      );
    }

    // Initialize basic camera path (just a simple circle for demo)
    this.initBasicCameraPath();

    // Flag to control tick execution for camera path mode
    this.cameraPathActive = false;

    // Define event handlers as properties so they can be removed later
    this.onEnterVR = this.onEnterVR.bind(this);
    this.onExitVR = this.onExitVR.bind(this);

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
    // First disable all modes
    this.disableAllModes();

    // Then enable the selected mode
    if (mode === 'locomotion') {
      this.enableLocomotionMode();
    } else if (mode === 'camera-path') {
      this.enableCameraPathMode();
    } else if (mode === 'ar-webxr') {
      this.enableARWebXRMode();
    }
    // Notify other components about the mode change
    this.el.emit('viewer-mode-changed', { mode: mode });
  },

  disableAllModes: function () {
    // Disable locomotion controls but preserve position
    this.cameraRig.setAttribute('movement-controls', 'enabled: false');
    this.cameraRig.setAttribute('cursor-teleport', 'enabled: false');
    this.camera.setAttribute('look-controls', 'enabled: false');

    // Save and remove blink-controls from hands
    if (this.leftHand && this.leftHand.hasAttribute('blink-controls')) {
      // Store current settings before removing
      this.blinkControlsSettings.leftHand = {
        ...this.leftHand.getAttribute('blink-controls')
      };
      this.leftHand.removeAttribute('blink-controls');
    }

    if (this.rightHand && this.rightHand.hasAttribute('blink-controls')) {
      // Store current settings before removing
      this.blinkControlsSettings.rightHand = {
        ...this.rightHand.getAttribute('blink-controls')
      };
      this.rightHand.removeAttribute('blink-controls');
    }

    // Disable camera path animation
    this.cameraPathActive = false;

    // Disable AR WebXR UI
    document.getElementById('viewer-mode-ar-play-button').style.display =
      'none';

    // Hide locomotion controls UI
    document.getElementById('viewer-mode-locomotion-controls').style.display =
      'none';

    // Remove event listeners if they were added
    this.el.sceneEl.removeEventListener('enter-vr', this.onEnterVR);
    this.el.sceneEl.removeEventListener('exit-vr', this.onExitVR);
  },

  enableARWebXRMode: function () {
    // the UI should be shown and the play button starts AR mode
    document.getElementById('viewer-mode-ar-play-button').style.display =
      'block';
    this.el.sceneEl.addEventListener('enter-vr', this.onEnterVR);
    this.el.sceneEl.addEventListener('exit-vr', this.onExitVR);

    if (!AFRAME.utils.device.checkHeadsetConnected()) {
      document.getElementById(
        'viewer-mode-ar-webxr-not-supported'
      ).style.display = 'block';
    }

    this.cameraRig.object3D.position.set(
      this.data.cameraStartPosition.x,
      0,
      this.data.cameraStartPosition.z
    );
  },

  enableLocomotionMode: function () {
    // Restore original locomotion controls
    this.cameraRig.setAttribute('movement-controls', 'enabled: true');
    this.cameraRig.setAttribute('cursor-teleport', 'enabled: true');
    this.camera.setAttribute('look-controls', 'enabled: true');

    // Restore blink-controls with saved settings
    if (this.leftHand) {
      if (this.blinkControlsSettings.leftHand) {
        this.leftHand.setAttribute(
          'blink-controls',
          this.blinkControlsSettings.leftHand
        );
      } else {
        // Default settings if none were saved
        this.leftHand.setAttribute('blink-controls', '');
      }
    }

    if (this.rightHand) {
      if (this.blinkControlsSettings.rightHand) {
        this.rightHand.setAttribute(
          'blink-controls',
          this.blinkControlsSettings.rightHand
        );
      } else {
        // Default settings if none were saved
        this.rightHand.setAttribute('blink-controls', '');
      }
    }

    // Show the locomotion controls UI
    document.getElementById('viewer-mode-locomotion-controls').style.display =
      'block';
  },

  enableCameraPathMode: function () {
    // Enable camera path animation
    this.cameraPathActive = true;

    // Apply the correct initial position based on current time
    // Only if timer component is available
    const timerComponent = getTimerComponent();
    if (!timerComponent) {
      return; // Don't move if no timer
    }

    const timeSeconds = timerComponent.getTime() / 1000;

    // Update position immediately based on current time
    const cameraPath = this.data.cameraPath;
    switch (cameraPath) {
      case 'circle':
        this.updateCirclePath(timeSeconds);
        break;
      case 'forward':
        this.updateForwardPath(timeSeconds);
        break;
      case 'strafe':
        this.updateStrafePath(timeSeconds);
        break;
      case 'custom':
        this.updateMeasureLinePath(timeSeconds);
        break;
      default:
        this.updateCirclePath(timeSeconds);
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
    // Define speeds in units per second (not per tick)
    this.pathSpeed = 0.1; // Radians per second for circle path

    // Forward path settings
    this.forwardSpeed = 1.0; // Units per second
    this.forwardDistance = 0;
    this.forwardMaxDistance = 100;

    // Strafe path settings
    this.strafeSpeed = 1.0; // Units per second
    this.strafeDistance = 0;
    this.strafeMaxDistance = 20;
    this.strafeDirection = 1; // 1 for right, -1 for left

    // Store the last timestamp for deltaTime calculations
    this.lastTime = 0;
  },

  tick: function (time, deltaTime) {
    // Only run animation logic if camera path mode is active
    if (!this.cameraPathActive) return;

    // Only move if timer component is available
    const timerComponent = getTimerComponent();
    if (!timerComponent) {
      return; // Don't move if no timer
    }

    // Get absolute time in seconds for deterministic positioning
    const timeSeconds = timerComponent.getTime() / 1000;

    const cameraPath = this.data.cameraPath;

    // Handle different camera paths based on the selected mode
    switch (cameraPath) {
      case 'circle':
        this.updateCirclePath(timeSeconds);
        break;
      case 'forward':
        this.updateForwardPath(timeSeconds);
        break;
      case 'strafe':
        this.updateStrafePath(timeSeconds);
        break;
      case 'custom':
        this.updateMeasureLinePath(timeSeconds);
        break;
      default:
        this.updateCirclePath(timeSeconds);
    }
  },

  // Circle path - move around the center point
  updateCirclePath: function (timeSeconds) {
    // Calculate angle based directly on absolute time and speed
    const angle = timeSeconds * this.pathSpeed;

    // Calculate position around a circle centered on pathCenter
    const x = this.pathCenter.x + this.pathRadius * Math.cos(angle);
    const z = this.pathCenter.z + this.pathRadius * Math.sin(angle);
    const y = this.pathCenter.y + this.pathHeight;

    // Move the camera rig
    this.cameraRig.object3D.position.set(x, y, z);

    // Make camera look at center
    this.lookAtCenter();
  },

  // Forward path - move slowly forward along street path (z-)
  updateForwardPath: function (timeSeconds) {
    // Calculate distance based directly on absolute time
    let distance = (timeSeconds * this.forwardSpeed) % this.forwardMaxDistance;

    // Set new position
    const x = this.cameraStartPosition.x;
    const y = this.cameraStartPosition.y + this.pathHeight;
    const z = this.cameraStartPosition.z - distance;

    this.cameraRig.object3D.position.set(x, y, z);

    // Look ahead (forward)
    const lookTarget = new THREE.Vector3(
      x,
      y,
      z - 10 // Look ahead along the street
    );

    this.lookAtPoint(lookTarget);
  },

  // Strafe path - move sideways along street path (x+)
  updateStrafePath: function (timeSeconds) {
    // Calculate position using a sine wave pattern for back-and-forth motion
    // This creates deterministic oscillation based on absolute time
    const oscillationPeriod = (this.strafeMaxDistance * 2) / this.strafeSpeed;
    const sineValue = Math.sin((timeSeconds * Math.PI * 2) / oscillationPeriod);

    // Scale the sine wave (-1 to 1) to our max strafe distance
    const strafeDistance = sineValue * this.strafeMaxDistance;

    // Set new position relative to start position
    const x = this.cameraStartPosition.x + strafeDistance;
    const y = this.cameraStartPosition.y + this.pathHeight;
    const z = this.cameraStartPosition.z;

    this.cameraRig.object3D.position.set(x, y, z);

    // Look forward along the path
    const lookTarget = new THREE.Vector3(
      x,
      y,
      z - 10 // Look ahead along the street
    );

    this.lookAtPoint(lookTarget);
  },

  // Measure line path - move along the line defined by a measure-line component
  updateMeasureLinePath: function (timeSeconds) {
    // Get the measure line entity
    const customPathEntityId = this.data.customPathEntity;
    if (!customPathEntityId) {
      console.warn('No custom path entity specified for camera path');
      return;
    }

    const customPathEntity = document.getElementById(customPathEntityId);
    if (!customPathEntity || !customPathEntity.components['measure-line']) {
      console.warn(
        `Custom path entity '${customPathEntityId}' not found or missing measure-line component`
      );
      return;
    }

    const measureLineComponent = customPathEntity.components['measure-line'];
    const start = measureLineComponent.data.start;
    const end = measureLineComponent.data.end;

    // Calculate total distance for the path
    const totalDistance = Math.sqrt(
      Math.pow(end.x - start.x, 2) +
        Math.pow(end.y - start.y, 2) +
        Math.pow(end.z - start.z, 2)
    );

    if (totalDistance === 0) {
      console.warn('Measure line has zero length, cannot create camera path');
      return;
    }

    // Calculate progress along the line (0 to 1) with looping
    const pathSpeed = this.forwardSpeed || 1.0; // Use existing forward speed
    const totalTime = totalDistance / pathSpeed;
    const progress = (timeSeconds % totalTime) / totalTime;

    // Interpolate position along the line
    const x = start.x + (end.x - start.x) * progress;
    const y = start.y + (end.y - start.y) * progress + this.pathHeight;
    const z = start.z + (end.z - start.z) * progress;

    // Set camera position
    this.cameraRig.object3D.position.set(x, y, z);

    // Look along the direction of the line
    const direction = new THREE.Vector3(
      end.x - start.x,
      end.y - start.y,
      end.z - start.z
    ).normalize();

    const lookTarget = new THREE.Vector3(
      x + direction.x * 10,
      y + direction.y * 10,
      z + direction.z * 10
    );

    this.lookAtPoint(lookTarget);
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

  // Event handler methods
  onEnterVR: function () {
    document.querySelector('#viewer-mode-ar-play-button').style.display =
      'none';
    document.querySelector('#viewer-mode-ar-overlay').style.display = 'block';
  },

  onExitVR: function () {
    document.querySelector('#viewer-mode-ar-play-button').style.display =
      'block';
    document.querySelector('#viewer-mode-ar-overlay').style.display = 'none';
  },

  remove: function () {
    // Disable camera path mode
    this.cameraPathActive = false;

    // Restore original locomotion mode
    this.enableLocomotionMode();
  }
});
