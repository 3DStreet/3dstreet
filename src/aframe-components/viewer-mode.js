/* global AFRAME */

// Viewer Mode UI was removed in panels-v2 (PR #1566). The component is
// kept because saved scenes still carry `viewer-mode` attributes on
// the camera rig — most just configure locomotion / AR-WebXR. Old
// scenes saved with `preset: camera-path` are migrated to locomotion
// on load (see setupMode).

AFRAME.registerComponent('viewer-mode', {
  schema: {
    preset: {
      type: 'string',
      default: 'locomotion',
      oneOf: ['locomotion', 'ar-webxr']
    },
    // Used by AR-WebXR mode to seat the rig in front of the marker.
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

    // Store blink controls settings for restore on mode switch.
    this.blinkControlsSettings = {
      leftHand: null,
      rightHand: null
    };

    this.onEnterVR = this.onEnterVR.bind(this);
    this.onExitVR = this.onExitVR.bind(this);

    this.setupMode(this.data.preset);
  },

  update: function (oldData) {
    if (oldData.preset !== this.data.preset) {
      this.setupMode(this.data.preset);
    }
  },

  setupMode: function (mode) {
    // Migrate legacy camera-path scenes silently — that mode was
    // removed when its UI went away; treat as locomotion.
    if (mode !== 'locomotion' && mode !== 'ar-webxr') {
      mode = 'locomotion';
    }
    this.disableAllModes();
    if (mode === 'locomotion') {
      this.enableLocomotionMode();
    } else if (mode === 'ar-webxr') {
      this.enableARWebXRMode();
    }
    this.el.emit('viewer-mode-changed', { mode: mode });
  },

  disableAllModes: function () {
    this.cameraRig.setAttribute('movement-controls', 'enabled: false');
    this.cameraRig.setAttribute('cursor-teleport', 'enabled: false');
    this.camera.setAttribute('look-controls', 'enabled: false');

    if (this.leftHand && this.leftHand.hasAttribute('blink-controls')) {
      this.blinkControlsSettings.leftHand = {
        ...this.leftHand.getAttribute('blink-controls')
      };
      this.leftHand.removeAttribute('blink-controls');
    }
    if (this.rightHand && this.rightHand.hasAttribute('blink-controls')) {
      this.blinkControlsSettings.rightHand = {
        ...this.rightHand.getAttribute('blink-controls')
      };
      this.rightHand.removeAttribute('blink-controls');
    }

    document.getElementById('viewer-mode-ar-play-button').style.display =
      'none';

    this.el.sceneEl.removeEventListener('enter-vr', this.onEnterVR);
    this.el.sceneEl.removeEventListener('exit-vr', this.onExitVR);
  },

  enableARWebXRMode: function () {
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
    this.cameraRig.setAttribute('movement-controls', 'enabled: true');
    this.cameraRig.setAttribute('cursor-teleport', 'enabled: true');
    this.camera.setAttribute('look-controls', 'enabled: true');

    if (this.leftHand) {
      if (this.blinkControlsSettings.leftHand) {
        this.leftHand.setAttribute(
          'blink-controls',
          this.blinkControlsSettings.leftHand
        );
      } else {
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
        this.rightHand.setAttribute('blink-controls', '');
      }
    }
  },

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
    this.enableLocomotionMode();
  }
});
