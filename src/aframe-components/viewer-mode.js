/* global AFRAME, THREE */

// The Viewer Mode UI was removed in panels-v2 (PR #1566) but the underlying
// component is kept so existing scenes still load. Plan is to restore a
// reworked viewer experience soon — do not delete the component or its
// save/load wiring in json-utils until that lands.

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
      oneOf: ['locomotion', 'camera-path', 'ar-webxr', 'drive']
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
    } else if (mode === 'drive') {
      // Only spawn physics + player car when the inspector is closed
      // (i.e. user is in play mode). If a saved scene comes back with
      // preset: drive baked in while the user is editing, this guard
      // keeps a chassis from falling through the editor.
      const useStoreLocal = require('../store.js').default;
      if (!useStoreLocal.getState().isInspectorEnabled) {
        this.enableDriveMode();
      }
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

    // Tear down drive mode if it was up
    if (this.driveCleanup) {
      this.driveCleanup();
      this.driveCleanup = null;
    }

    // Hide locomotion controls UI
    document.getElementById('viewer-mode-locomotion-controls').style.display =
      'none';

    // Remove event listeners if they were added
    this.el.sceneEl.removeEventListener('enter-vr', this.onEnterVR);
    this.el.sceneEl.removeEventListener('exit-vr', this.onExitVR);
  },

  /**
   * Walk the scene for entities that look like vehicles (any mixin
   * whose registered <a-mixin category="..."> starts with "vehicles")
   * and seed a static cuboid collider sized to each one's world-frame
   * bounding box. The player's own Driveable Vehicle (and its
   * descendants) is skipped — that's the dynamic chassis.
   *
   * Bounding boxes are evaluated AFTER models load: this fires inside
   * the physics.activate() .then(), but the GLBs may still be loading
   * since A-Frame loads them async. Listen for `model-loaded` on each
   * candidate and (re)apply the collider when a load lands.
   */
  addOtherVehicleColliders: function (sceneEl, driveEntity) {
    const physics = sceneEl.systems['play-mode-physics'];
    const COLLIDABLE_CATEGORIES = ['vehicles', 'cyclists'];
    const isVehicleMixin = (id) => {
      const mixin = document.getElementById(id);
      if (!mixin || mixin.tagName !== 'A-MIXIN') return false;
      const cat = mixin.getAttribute('category') || '';
      return COLLIDABLE_CATEGORIES.some((c) => cat.indexOf(c) === 0);
    };
    const isCandidate = (el) => {
      if (!el || el === driveEntity) return false;
      if (driveEntity && driveEntity.contains(el)) return false;
      const mixinAttr = el.getAttribute('mixin');
      if (!mixinAttr) return false;
      return mixinAttr.split(/\s+/).some(isVehicleMixin);
    };
    const listeners = [];
    // Bounding boxes wrap the mesh's full AABB which is generally
    // larger than the visible silhouette (especially for vehicles
    // whose body curves inward at the corners). Shrink to 80% so the
    // collider feels closer to the mesh visually.
    const COLLIDER_SHRINK = 0.8;
    const add = (el) => {
      const box = new THREE.Box3().setFromObject(el.object3D);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      // Skip degenerate boxes (no mesh loaded yet, or zero-size).
      if (size.x < 0.05 || size.y < 0.05 || size.z < 0.05) return;
      const half = COLLIDER_SHRINK / 2;
      physics.addStaticCuboid(
        { x: center.x, y: center.y, z: center.z },
        { x: size.x * half, y: size.y * half, z: size.z * half }
      );
    };

    sceneEl.querySelectorAll('[mixin]').forEach((el) => {
      if (!isCandidate(el)) return;
      // Try immediately, then retry after model-loaded if the bounding
      // box came back empty/tiny (gltf still streaming).
      add(el);
      const onLoaded = () => add(el);
      el.addEventListener('model-loaded', onLoaded);
      listeners.push({ el, fn: onLoaded });
    });

    // Bodies live on the Rapier world, which is freed by
    // physics.deactivate() on Stop — no need to track them here.
    // Just remember the model-loaded listeners so we can detach.
    this._vehicleColliderListeners = listeners;
  },

  enableDriveMode: function () {
    const sceneEl = this.el.sceneEl;

    // The user must have added a 'Driveable Vehicle' entity (an entity
    // tagged with `drive-controls`) before Play can do anything useful.
    // The Play button is disabled when no such entity exists; this
    // guard is a safety net for any other entry point.
    const driveEntity = sceneEl.querySelector('[drive-controls]');
    if (!driveEntity) {
      console.warn(
        'viewer-mode drive: no entity with `drive-controls` found in the scene. Add a Driveable Vehicle from the layers panel first.'
      );
      return;
    }

    const wp = new THREE.Vector3();
    driveEntity.object3D.getWorldPosition(wp);
    // Lift slightly so the chassis doesn't spawn intersecting ground.
    const spawnPos = { x: wp.x, y: Math.max(wp.y, 1), z: wp.z };

    const wq = new THREE.Quaternion();
    driveEntity.object3D.getWorldQuaternion(wq);
    const e = new THREE.Euler().setFromQuaternion(wq, 'YXZ');
    const spawnYawDeg = (e.y * 180) / Math.PI;

    const dcAttrs = driveEntity.getAttribute('drive-controls');

    // Hide the source entity while driving — the play-mode-vehicle
    // renders its own debug chassis. Restore on cleanup.
    this._hiddenDriveEntity = driveEntity;
    this._driveEntityVisible = driveEntity.object3D.visible;
    driveEntity.object3D.visible = false;

    // Build the play-mode-vehicle attribute string. Schema fields shared
    // with drive-controls are forwarded; everything else falls through
    // to play-mode-vehicle's own defaults.
    const parts = [
      `spawnPosition: ${spawnPos.x} ${spawnPos.y} ${spawnPos.z}`,
      `spawnYaw: ${spawnYawDeg}`,
      'cameraSelector: #camera'
    ];
    // Detect whether the user has set a custom mesh on the Driveable
    // Vehicle's child mesh slot (an entity tagged with the
    // vehicle-mesh-slot marker component). If so, hide the
    // play-mode-vehicle's red placeholder box and clone the mesh into
    // the player car.
    const meshSlot = driveEntity.querySelector('[vehicle-mesh-slot]');
    const customMixin = meshSlot && meshSlot.getAttribute('mixin');
    const hasCustomMesh = !!(customMixin && customMixin.length);

    if (dcAttrs) {
      // drive-controls.vehicleSize is in ENTITY frame (x=width, y=height,
      // z=length). play-mode-vehicle.chassisSize is in CHASSIS frame
      // (x=length, y=height, z=width). Swap X<->Z when forwarding.
      const v = dcAttrs.vehicleSize;
      parts.push(`chassisSize: ${v.z} ${v.y} ${v.x}`);
      parts.push(`accelerateForce: ${dcAttrs.accelerateForce}`);
      parts.push(`brakeForce: ${dcAttrs.brakeForce}`);
      parts.push(`steerAngle: ${dcAttrs.steerAngle}`);
      parts.push(`wheelRadius: ${dcAttrs.wheelRadius}`);
      parts.push(`wheelWidth: ${dcAttrs.wheelWidth}`);
      // Per-wheel suspension/friction live on play-mode-vehicle's wheel
      // wiring; the component reads them once at buildVehicle. Not yet
      // plumbed through — TODO when we expose wheel sliders.
    }
    if (hasCustomMesh) parts.push('showDebugBox: false');

    const car = document.createElement('a-entity');
    car.setAttribute('id', 'play-mode-player-car');
    car.setAttribute('data-no-transform', '');
    car.setAttribute('play-mode-vehicle', parts.join('; '));
    sceneEl.appendChild(car);

    // Clone the user's custom mesh onto the player car. The car's
    // body rotation is in chassis frame (forward = chassis -X), and
    // the 3DStreet vehicle catalog meshes are authored with forward =
    // +Z, so the wrapper rotates -90° around Y to align them.
    if (hasCustomMesh) {
      const wrapper = document.createElement('a-entity');
      wrapper.setAttribute('rotation', '0 -90 0');
      const meshClone = document.createElement('a-entity');
      meshClone.setAttribute('mixin', customMixin);
      meshClone.setAttribute('shadow', 'cast: true; receive: true');
      wrapper.appendChild(meshClone);
      car.appendChild(wrapper);
    }

    // Lazy-load Rapier and seed colliders: ground plane + every other
    // vehicle in the scene as a static cuboid sized to its bounding
    // box. The player can then bump into parked cars, transit, etc.
    const physics = sceneEl.systems['play-mode-physics'];
    physics.activate().then(() => {
      physics.addStaticCuboid(
        { x: 0, y: -0.05, z: 0 },
        { x: 200, y: 0.05, z: 200 }
      );
      this.addOtherVehicleColliders(sceneEl, driveEntity);
    });

    this.driveCleanup = () => {
      if (car && car.parentNode) car.parentNode.removeChild(car);
      if (this._hiddenDriveEntity) {
        this._hiddenDriveEntity.object3D.visible = this._driveEntityVisible;
        this._hiddenDriveEntity = null;
      }
      if (this._vehicleColliderListeners) {
        for (const { el, fn } of this._vehicleColliderListeners) {
          el.removeEventListener('model-loaded', fn);
        }
        this._vehicleColliderListeners = null;
      }
      physics.deactivate();
    };
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
