/* global AFRAME, THREE */

/**
 * mode-manager
 * ============
 *
 * Owns transitions between top-level scene control modes — which
 * subsystem gets the camera and input while the scene is running.
 * Each mode is registered with `enter(prevMode)` / `exit(nextMode)`
 * hooks that attach/detach the components the mode needs on the
 * cameraRig and camera. The point is: when a mode isn't selected, its
 * components shouldn't be active on the entity at all — same pattern
 * as `street-geo` swapping map providers.
 *
 * Built-in modes:
 *   - `editor` — inspector open; selection + transform tools active.
 *   - `viewer` — presentation without the editor UI. The camera stays
 *                on the inspector's EditorControls camera so viewing
 *                feels identical to editing (#1848) — no scene-side
 *                input controls. Alternate control schemes will come
 *                back later behind an explicit input-scheme system.
 *
 * Future modes (drive, replay-follow, ar-webxr, ...) are registered
 * externally by their own feature file:
 *   sceneEl.systems['mode-manager'].registerMode('drive', { enter, exit });
 * Callers don't need to know what other modes exist — exit() of the
 * outgoing mode is responsible for cleaning up after itself.
 *
 * The system also keeps a registry of "playable capability" checks so
 * UI can ask whether the Play button has anything to do in the current
 * scene. Feature PRs register a named predicate:
 *   sceneEl.systems['mode-manager'].registerPlayableCheck(
 *     'street-traffic',
 *     () => !!sceneEl.querySelector('[managed-street]')
 *   );
 * With no checks registered (the foundation state), hasPlayable() is
 * always false and play controls stay hidden.
 */
AFRAME.registerSystem('mode-manager', {
  init: function () {
    this.modes = {};
    this.playableChecks = {};
    this.registerMode('editor', {
      enter: () => {},
      exit: () => {}
    });
    // Viewer idle needs no scene-side setup: the render camera simply
    // stays on the editor's EditorControls camera (see viewport.js).
    this.registerMode('viewer', {
      enter: () => {},
      exit: () => {}
    });
    // The editor opens on boot (store default isInspectorEnabled: true),
    // so `editor` is the initial mode.
    this.currentMode = 'editor';

    // WebXR needs a scene-driven camera (the rig's #camera gets its pose
    // from the headset) — the editor's THREE camera can't provide that.
    // Borrow the rig for the immersive session, starting where the
    // viewer was looking, and hand back on exit. Only from viewer idle:
    // the editor exits VR on open, and drive already owns the camera.
    this.onEnterVR = () => {
      if (this.currentMode !== 'viewer') return;
      this.placeRigAtEditorCamera();
      this.activateSceneCamera();
    };
    this.onExitVR = () => {
      if (this.currentMode !== 'viewer') return;
      this.activateEditorCamera();
    };
    this.sceneEl.addEventListener('enter-vr', this.onEnterVR);
    this.sceneEl.addEventListener('exit-vr', this.onExitVR);
  },

  registerMode: function (name, hooks) {
    this.modes[name] = hooks;
  },

  setMode: function (next) {
    if (next === this.currentMode) return;
    const prev = this.currentMode;
    const prevMode = this.modes[prev];
    const nextMode = this.modes[next];
    if (!nextMode) {
      console.warn(`[mode-manager] unknown mode "${next}"`);
      return;
    }
    if (prevMode && prevMode.exit) prevMode.exit(next);
    this.currentMode = next;
    if (nextMode.enter) nextMode.enter(prev);
    this.sceneEl.emit('mode-changed', { from: prev, to: next }, false);
  },

  getMode: function () {
    return this.currentMode;
  },

  /* ---------------- playable capability registry ---------------- */

  registerPlayableCheck: function (name, checkFn) {
    this.playableChecks[name] = checkFn;
  },

  getPlayableCapabilities: function () {
    return Object.keys(this.playableChecks).filter((name) => {
      try {
        return !!this.playableChecks[name]();
      } catch (err) {
        console.warn(`[mode-manager] playable check "${name}" threw`, err);
        return false;
      }
    });
  },

  hasPlayable: function () {
    return this.getPlayableCapabilities().length > 0;
  },

  /* ---------------- render-camera ownership ----------------
   *
   * These two helpers are the seam between the shared editor/viewer
   * camera (EditorControls on AFRAME.INSPECTOR.camera — how both edit
   * and view render today, #1848) and a scene-driven camera on the
   * rig's #camera. Right now only drive mode borrows the rig.
   *
   * This seam is also the intended path for restoring scene-native
   * viewer control schemes later: when explicit, user-selectable
   * input/control schemes exist (and/or viewing without the editor
   * bundle becomes a requirement), a scheme registers itself as a mode
   * whose enter() calls activateSceneCamera() and attaches its own
   * control components, and whose exit() detaches them and calls
   * activateEditorCamera() — exactly the pattern drive mode uses. The
   * old WASD locomotion mode was removed rather than kept as a hidden
   * second scheme; see #1848.
   */

  /**
   * Hand the render camera to the scene rig's #camera — for features
   * that need a scene-driven camera (drive mode, WebXR). The rig entity
   * survives save/load (json-utils reuses the static #cameraRig), so
   * this is always safe to call.
   */
  activateSceneCamera: function () {
    const cameraEl = document.getElementById('camera');
    if (!cameraEl) return;
    cameraEl.setAttribute('camera', 'active', true);
    // setAttribute is a no-op if the camera was already active from a
    // previous session — assert the render camera explicitly.
    const cam = cameraEl.getObject3D('camera');
    if (cam) this.sceneEl.camera = cam;
  },

  /**
   * Give the render camera back to the editor/viewer EditorControls
   * camera (the same object edit mode renders through).
   */
  activateEditorCamera: function () {
    const inspectorCam = AFRAME.INSPECTOR && AFRAME.INSPECTOR.camera;
    if (inspectorCam) this.sceneEl.camera = inspectorCam;
  },

  /**
   * Place the camera rig at the editor camera's current vantage so a
   * feature borrowing the rig (WebXR) starts where the viewer was
   * looking. Rig gets yaw only — the headset supplies pitch/roll — and
   * sits one eye-height (#camera's local offset) below the vantage.
   */
  placeRigAtEditorCamera: function () {
    const editorCam = AFRAME.INSPECTOR && AFRAME.INSPECTOR.camera;
    const rig = document.getElementById('cameraRig');
    const cameraEl = document.getElementById('camera');
    if (!rig || !cameraEl || !editorCam || !editorCam.isPerspectiveCamera) {
      return;
    }
    editorCam.updateMatrixWorld();
    const pos = new THREE.Vector3().setFromMatrixPosition(
      editorCam.matrixWorld
    );
    const yaw = new THREE.Euler().setFromRotationMatrix(
      editorCam.matrixWorld,
      'YXZ'
    ).y;
    const camLocal = cameraEl.object3D.position;
    rig.object3D.position.set(
      pos.x - camLocal.x,
      pos.y - camLocal.y,
      pos.z - camLocal.z
    );
    rig.object3D.rotation.set(0, yaw, 0);
  }
});
