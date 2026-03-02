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
    // Those variables are set by EditorControls
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

  // Called by EditorControls initially
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

AFRAME.registerComponent('focus-camera-pose', {
  schema: {
    relativePosition: { type: 'vec3', default: { x: 0, y: 0, z: 0 } }
  },
  init() {
    //
  },
  update() {
    //
  }
});
