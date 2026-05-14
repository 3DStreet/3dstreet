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
import useStore from '../../store.js';

AFRAME.registerSystem('play-mode', {
  init: function () {
    this.isPlaying = false;
    this.isPaused = false;
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
    this.onCollision = this.onCollision.bind(this);
    this.onRaceFinish = this.onRaceFinish.bind(this);
    this.sceneEl.addEventListener('play-mode-collision', this.onCollision);
    this.sceneEl.addEventListener('race-finish', this.onRaceFinish);
  },

  formatSimTime: function (ms) {
    const totalMs = Math.max(0, ms);
    const minutes = Math.floor(totalMs / 60000);
    const seconds = (totalMs % 60000) / 1000;
    return `${minutes}:${seconds.toFixed(2).padStart(5, '0')}`;
  },

  onCollision: function (e) {
    // v1: arcade-style — record a persistent marker, fire a toast,
    // flash the toolbar pill red. The player keeps driving. A future
    // "strict" mode could auto-pause here instead.
    const { simulationTime, position } = e.detail || {};
    this.spawnCollisionMarker(position, simulationTime);
    const label = this.formatSimTime(simulationTime);
    if (window.STREET && STREET.notify) {
      STREET.notify.errorMessage(`Collision at ${label}`);
    }
    useStore.setState({
      playOutcome: 'crash',
      playOutcomeTimeMs: simulationTime
    });
    // Auto-clear the red pill after 1.5s so the timer goes back to its
    // running state. The marker stays in the scene.
    if (this._crashFlashTimeout) clearTimeout(this._crashFlashTimeout);
    this._crashFlashTimeout = setTimeout(() => {
      if (useStore.getState().playOutcome === 'crash') {
        useStore.setState({ playOutcome: null });
      }
    }, 1500);
  },

  onRaceFinish: function (e) {
    const { simulationTime } = e.detail || {};
    const label = this.formatSimTime(simulationTime);
    if (window.STREET && STREET.notify) {
      STREET.notify.infoMessage(`Finished in ${label}`);
    }
    useStore.setState({
      playOutcome: 'finish',
      playOutcomeTimeMs: simulationTime
    });
    // Pause so the player can savor the moment + line up a snapshot.
    this.pause();
  },

  spawnCollisionMarker: function (pos, simMs) {
    if (!pos) return;
    const el = document.createElement('a-entity');
    el.setAttribute('collision-marker', `timeMs: ${simMs || 0}`);
    el.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
    el.setAttribute(
      'data-layer-name',
      `Collision (${this.formatSimTime(simMs || 0)})`
    );
    // Lives at scene root so json-utils picks it up at save time the
    // same way it picks up any other top-level layer.
    this.sceneEl.appendChild(el);
  },

  start: function () {
    if (this.isPlaying) return;
    this.isPlaying = true;
    // Authoritative wall-clock anchor. The toolbar reads this so its
    // wall-time display zeros when scene-timer's simulationTime zeros
    this.playStartedAt = performance.now();
    this.playStartedAt = performance.now();
    useStore.setState({
      isPlaying: true,
      playOutcome: null,
      playOutcomeTimeMs: 0
    });
    // Reset both clocks on the scene-timer at t=0. elapsedTime tracks
    // wall-clock; simulationTime is the passive counter that physics + traffic +
    // any other deterministic play feature reads from. Pausing on
    // stop, advancing on tick — see tick() and play-mode-physics.
    const timer = this.sceneEl.components['scene-timer'];
    if (timer) {
      timer.elapsedTime = 0;
      timer.startTime = null;
      timer.resetSimulation();
    }
    // Snapshot the inspector camera pose before play swaps the view
    // around. We restore it on Stop so the editor resumes exactly
    // where the user was looking — even though they may have driven
    // around in play mode.
    this.saveEditorCameraPose();
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

  saveEditorCameraPose: function () {
    const inspector = AFRAME.INSPECTOR;
    const cam = inspector?.camera;
    if (!cam) {
      this._savedEditorPose = null;
      return;
    }
    this._savedEditorPose = {
      position: cam.position.clone(),
      quaternion: cam.quaternion.clone(),
      zoom: cam.zoom,
      fov: cam.fov,
      // EditorControls' orbit pivot — restoring this is what makes
      // subsequent rotate/pan feel like the play session never happened.
      center: inspector.controls?.center
        ? inspector.controls.center.clone()
        : null
    };
  },

  restoreEditorCameraPose: function () {
    const inspector = AFRAME.INSPECTOR;
    const cam = inspector?.camera;
    const pose = this._savedEditorPose;
    if (!cam || !pose) return;
    cam.position.copy(pose.position);
    cam.quaternion.copy(pose.quaternion);
    if (typeof pose.zoom === 'number') cam.zoom = pose.zoom;
    if (typeof pose.fov === 'number' && cam.isPerspectiveCamera) {
      cam.fov = pose.fov;
    }
    cam.updateProjectionMatrix();
    if (pose.center && inspector.controls?.center) {
      inspector.controls.center.copy(pose.center);
    }
    this._savedEditorPose = null;
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
    this.isPaused = false;
    this.playStartedAt = null;
    useStore.setState({
      isPlaying: false,
      isPlayPaused: false,
      playOutcome: null,
      playOutcomeTimeMs: 0
    });
    window.removeEventListener('keydown', this.onEscape);
    this.sceneEl.emit('timer-pause');
    this.sceneEl.emit('play-mode-stop', {}, false);
    // Restore the editor camera so the inspector resumes exactly
    // where the user was looking when they pressed Play. Drive-mode
    // is responsible for the scene #camera during play; this is the
    // separate inspector-editor camera owned by AFRAME.INSPECTOR.
    this.restoreEditorCameraPose();
  },

  pause: function () {
    if (!this.isPlaying || this.isPaused) return;
    this.isPaused = true;
    useStore.setState({ isPlayPaused: true });
    this.sceneEl.emit('timer-pause');
  },

  resume: function () {
    if (!this.isPlaying || !this.isPaused) return;
    this.isPaused = false;
    useStore.setState({ isPlayPaused: false });
    this.sceneEl.emit('timer-start');
  },

  togglePause: function () {
    if (this.isPaused) this.resume();
    else this.pause();
  },

  tick: function (time, deltaMs) {
    if (!this.isPlaying || this.isPaused) return;
    // simulationTime ownership:
    //   - When play-mode-physics is active, IT advances simulationTime
    //     by exactly `timestep` per completed sub-step. On slow CPUs
    //     this naturally lags wall-time (true slow-motion).
    //   - Otherwise (traffic-only play, no driveable), nobody else
    //     advances it — so do it here at wall-clock rate so traffic
    //     still animates.
    const physics = this.sceneEl.systems['play-mode-physics'];
    if (physics && physics.active) return;
    const timer = this.sceneEl.components['scene-timer'];
    if (timer && timer.timerActive) {
      timer.advanceSimulation(Math.min(deltaMs, 100));
    }
  }
});
