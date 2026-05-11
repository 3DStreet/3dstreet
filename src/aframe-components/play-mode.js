/* global AFRAME, THREE */

/**
 * play-mode
 * =========
 *
 * Lightweight lifecycle system for "the user pressed Play."
 *
 * Play mode is intentionally decoupled from any single feature (drive
 * mode, traffic animation, future first-person walk, etc.). This
 * system owns one boolean and two events:
 *
 *   sceneEl.systems['play-mode'].start()  -> emits 'play-mode-start'
 *   sceneEl.systems['play-mode'].stop()   -> emits 'play-mode-stop'
 *
 * Features that want to do something during play register a listener
 * on the scene for those events and do their own setup/teardown. The
 * Play and Stop buttons in the editor toolbar just call start()/stop()
 * — they don't know what features will respond.
 *
 * The current isPlaying boolean is also mirrored into the zustand
 * store so React components can render off it without listening to
 * scene events directly.
 */
import useStore from '../store.js';

AFRAME.registerSystem('play-mode', {
  init: function () {
    this.isPlaying = false;
    // Escape stops play mode and reopens the inspector. Attached only
    // while playing so it doesn't shadow Escape elsewhere in the
    // editor (modal close, etc.).
    this.onEscape = (e) => {
      if (e.code !== 'Escape') return;
      // Don't intercept if the user is typing in a field (in case
      // some play-mode UI ever has text input).
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
      e.preventDefault();
      useStore.getState().setIsInspectorEnabled(true);
    };
  },

  start: function () {
    if (this.isPlaying) return;
    this.isPlaying = true;
    useStore.setState({ isPlaying: true });
    // Reset and start the scene-timer so subscribers can derive
    // deterministic positions from a known t=0. scene-timer responds
    // to events; we use them rather than calling methods directly so
    // the same lifecycle works whether or not scene-timer is attached.
    const timer = this.sceneEl.components['scene-timer'];
    if (timer) {
      timer.elapsedTime = 0;
      timer.startTime = null;
    }
    // Match the play camera to the editor (inspector) camera pose so
    // entering play mode doesn't jump the view. Drive-mode may then
    // take the camera over for chase/fpv/top-down if a driveable
    // vehicle is present — that's expected. Without a driveable, the
    // camera stays where the user was looking in the editor.
    this.copyEditorCameraToScene();
    this.sceneEl.emit('timer-start');
    this.sceneEl.emit('play-mode-start', {}, false);
    window.addEventListener('keydown', this.onEscape);
  },

  copyEditorCameraToScene: function () {
    const inspector = AFRAME.INSPECTOR;
    const editorCam = inspector?.camera;
    if (!editorCam) {
      console.log(
        '[play-mode] no inspector camera available; leaving scene camera as-is'
      );
      return;
    }
    const cameraRig = document.getElementById('cameraRig');
    const cameraEl = document.getElementById('camera');
    if (!cameraRig || !cameraEl) return;

    editorCam.updateMatrixWorld();
    cameraRig.object3D.updateMatrixWorld();

    // Convert the editor camera's WORLD matrix into the cameraRig's
    // local frame, then apply to #camera. Result: #camera ends up at
    // the exact same world pose the user was looking from.
    const rigWorldInv = new THREE.Matrix4()
      .copy(cameraRig.object3D.matrixWorld)
      .invert();
    const local = new THREE.Matrix4()
      .copy(editorCam.matrixWorld)
      .premultiply(rigWorldInv);

    cameraEl.object3D.position.setFromMatrixPosition(local);
    cameraEl.object3D.quaternion.setFromRotationMatrix(local);

    // Copy FOV so wide/narrow views in the editor carry over.
    const playCam = cameraEl.getObject3D('camera');
    if (playCam && playCam.isPerspectiveCamera && editorCam.fov) {
      playCam.fov = editorCam.fov;
      playCam.updateProjectionMatrix();
    }
    console.log(
      '[play-mode] copied editor camera pose to scene camera; pos=',
      cameraEl.object3D.position.toArray()
    );
  },

  stop: function () {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    useStore.setState({ isPlaying: false });
    window.removeEventListener('keydown', this.onEscape);
    this.sceneEl.emit('timer-pause');
    this.sceneEl.emit('play-mode-stop', {}, false);
  }
});
