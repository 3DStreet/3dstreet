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
 *   - `editor`     — inspector open; no scene-side input controls.
 *   - `locomotion` — the Viewer's default: WASD/arrows movement
 *                    (movement-controls) + click-drag look
 *                    (look-controls) on the existing cameraRig.
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
import useStore from '../store.js';

AFRAME.registerSystem('mode-manager', {
  init: function () {
    this.modes = {};
    this.playableChecks = {};
    this.registerMode('editor', {
      enter: () => {},
      exit: () => {}
    });
    this.registerMode('locomotion', {
      enter: () => this.setLocomotionEnabled(true),
      exit: () => this.setLocomotionEnabled(false)
    });
    // The editor opens on boot (store default isInspectorEnabled: true),
    // so `editor` is the initial mode. index.html ships the locomotion
    // components with enabled: false to match.
    this.currentMode = 'editor';
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

  /* ---------------- locomotion (viewer default) ---------------- */

  setLocomotionEnabled: function (enabled) {
    const rig = document.getElementById('cameraRig');
    const cameraEl = document.getElementById('camera');
    if (rig) rig.setAttribute('movement-controls', 'enabled', enabled);
    if (cameraEl) cameraEl.setAttribute('look-controls', 'enabled', enabled);
    // Mirror into the store so React (e.g. the controls hint) can react.
    useStore.setState({ isLocomotionEnabled: enabled });
  },

  /**
   * Place the viewer camera rig at a saved camera vantage. Accepts the
   * cameraState shape used everywhere else (memory.cameraState,
   * snapshots[].cameraState, ?camera= deep links, and the editor camera
   * pose handed over by viewport.js): position + rotation in radians
   * (+ optional rotationOrder, default XYZ — the order of a THREE
   * camera.rotation, which is what all saved states came from) and
   * zoom (= fov).
   *
   * Position goes on the rig (so movement-controls moves from there);
   * rotation goes into look-controls' pitch/yaw objects (so the first
   * mouse drag continues from the vantage instead of snapping to 0,0).
   */
  applyViewerVantage: function (cameraState) {
    if (!cameraState || !cameraState.position) return;
    const rig = document.getElementById('cameraRig');
    const cameraEl = document.getElementById('camera');
    if (!rig || !cameraEl) return;

    // #camera sits at a local offset inside the rig (0 1.6 0 —
    // eye height); place the rig so the camera lands exactly on the
    // saved position.
    const camLocal = cameraEl.object3D.position;
    rig.object3D.position.set(
      cameraState.position.x - camLocal.x,
      cameraState.position.y - camLocal.y,
      cameraState.position.z - camLocal.z
    );
    // look-controls yaw is only world-aligned if the rig isn't rotated.
    rig.object3D.rotation.set(0, 0, 0);

    const rot = cameraState.rotation || { x: 0, y: 0, z: 0 };
    const order = cameraState.rotationOrder || 'XYZ';
    // Convert the saved euler to YXZ (yaw-then-pitch), the decomposition
    // look-controls uses. Roll is dropped — free-look has none.
    const yxz = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion().setFromEuler(
        new THREE.Euler(rot.x, rot.y, rot.z, order)
      ),
      'YXZ'
    );
    const lookControls = cameraEl.components['look-controls'];
    if (lookControls && lookControls.pitchObject && lookControls.yawObject) {
      lookControls.pitchObject.rotation.x = yxz.x;
      lookControls.yawObject.rotation.y = yxz.y;
    }
    // Apply directly too, so the pose is right even before look-controls
    // is enabled (or if it's ever absent).
    cameraEl.object3D.rotation.order = 'YXZ';
    cameraEl.object3D.rotation.set(yxz.x, yxz.y, 0);

    const cam = cameraEl.getObject3D('camera');
    if (cam && cam.isPerspectiveCamera && Number.isFinite(cameraState.zoom)) {
      cam.fov = cameraState.zoom;
      cam.updateProjectionMatrix();
    }
  }
});
