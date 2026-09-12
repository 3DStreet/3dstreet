function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

AFRAME.registerComponent('focus-animation', {
  schema: {
    speed: {
      type: 'string',
      oneOf: ['immediate', 'fast', 'slow', 'super-slow'],
      default: 'fast'
    }
  },

  init() {
    this.camera = null;
    // Those variables are set by the editor controls (ExperimentalControls)
    this.transitioning = false;
    this.transitionProgress = 0;
    this.transitionCamPosStart = new THREE.Vector3();
    this.transitionCamPosEnd = new THREE.Vector3();
    this.transitionCamQuaternionStart = new THREE.Quaternion();
    this.transitionCamQuaternionEnd = new THREE.Quaternion();
  },

  update() {
    if (this.data.speed === 'super-slow') {
      this.transitionSpeed = 0.0000625; // 4x slower than slow
    } else if (this.data.speed === 'slow') {
      this.transitionSpeed = 0.00025;
    } else {
      this.transitionSpeed = 0.001;
    }
  },

  // Called by the editor controls initially
  setCamera(camera, changeEventCallback) {
    this.camera = camera;
    this.changeEventCallback = changeEventCallback;
  },

  tick(t, delta) {
    if (!this.camera) return;
    if (this.transitioning) {
      if (this.data.speed === 'immediate') {
        this.transitioning = false;
        this.camera.position.copy(this.transitionCamPosEnd);
        this.camera.quaternion.copy(this.transitionCamQuaternionEnd);
        this.changeEventCallback();
        return;
      }
      this.transitionProgress += delta * this.transitionSpeed;
      const easeInOutTransitionProgress = easeInOutQuad(
        this.transitionProgress
      );

      // Set camera position
      this.camera.position.lerpVectors(
        this.transitionCamPosStart,
        this.transitionCamPosEnd,
        easeInOutTransitionProgress
      );

      this.camera.quaternion.slerpQuaternions(
        this.transitionCamQuaternionStart,
        this.transitionCamQuaternionEnd,
        easeInOutTransitionProgress
      );

      if (this.transitionProgress >= 1) {
        this.transitioning = false;
        this.camera.position.copy(this.transitionCamPosEnd);
        this.camera.quaternion.copy(this.transitionCamQuaternionEnd);
      }
      this.changeEventCallback();
    }
  }
});

// An author-set camera vantage for focusing this entity (Focus button
// long-press, the hotspot "Set Focus View", the AI focus tool). Consumed
// by ExperimentalControls.focus(); captured/resolved in
// src/editor/lib/focusPose.js. `lookAt: true` (the default, and every pose
// saved before rotation was stored) means "stand at relativePosition and
// aim at the entity's center"; a full capture stores orientation + fov
// and sets lookAt false so the glide lands exactly as framed.
AFRAME.registerComponent('focus-camera-pose', {
  schema: {
    relativePosition: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
    // Degrees, A-Frame YXZ order, in the entity's frame.
    relativeRotation: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
    // Vertical fov; 0 leaves the current lens alone.
    fov: { default: 0 },
    lookAt: { default: true }
  },
  init() {
    //
  },
  update() {
    //
  }
});
