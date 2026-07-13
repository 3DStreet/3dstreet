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
 *   - `orbit`      — the Viewer's default: the same THREE.EditorControls
 *                    the editor uses (left-drag pan, right-drag orbit,
 *                    scroll zoom), driving the runtime THREE camera.
 *   - `locomotion` — WASD/arrows movement (movement-controls) +
 *                    click-drag look (look-controls) on the existing
 *                    cameraRig. Registered but currently unreachable
 *                    from the Viewer UI (kept for the in-progress
 *                    nav-scheme-selection work).
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
// Side-effect import: defines THREE.EditorControls (already in the main
// bundle via the editor — this adds no weight, just guarantees load order).
import '../editor/lib/EditorControls.js';

AFRAME.registerSystem('mode-manager', {
  init: function () {
    this.modes = {};
    this.playableChecks = {};
    this.registerMode('editor', {
      enter: () => {},
      exit: () => {}
    });
    this.registerMode('orbit', {
      enter: () => this.enterOrbit(),
      exit: () => this.exitOrbit()
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

  /* ---------------- orbit (viewer default) ---------------- */

  /**
   * Hand the runtime camera to THREE.EditorControls so the Viewer's
   * mouse behaves exactly like the editor (left-drag pan, right-drag
   * orbit, scroll zoom).
   *
   * EditorControls assumes the object it drives has its WORLD transform
   * on its LOCAL transform, but the runtime camera is nested:
   * #cameraRig > #camera el (eye-height offset + look-controls) > THREE
   * camera via getObject3D('camera'). So on enter we flatten the chain:
   * decompose the camera's current world pose, zero the rig and the
   * #camera el, and put the world pose directly on the THREE camera.
   * (It must be the THREE camera, never the el's plain object3D —
   * lookAt points +Z for plain objects and -Z for cameras.)
   */
  enterOrbit: function () {
    const rig = document.getElementById('cameraRig');
    const cameraEl = document.getElementById('camera');
    const cam = cameraEl && cameraEl.getObject3D('camera');
    if (!rig || !cam) return;

    // Capture the neutral eye offset once — the first viewer entry
    // always happens with the hierarchy still neutral (0 1.6 0).
    if (!this._orbitEyeOffset) {
      this._orbitEyeOffset = cameraEl.object3D.position.clone();
    }

    cam.updateWorldMatrix(true, false);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    cam.matrixWorld.decompose(pos, quat, scale);

    rig.object3D.position.set(0, 0, 0);
    rig.object3D.rotation.set(0, 0, 0);
    cameraEl.object3D.position.set(0, 0, 0);
    cameraEl.object3D.rotation.set(0, 0, 0);
    cam.position.copy(pos);
    cam.quaternion.copy(quat);
    cam.updateMatrixWorld();

    // EditorControls' constructor re-points the singleton
    // focus-animation component at the camera it's given. Remember the
    // editor's binding so exitOrbit can hand it back — otherwise
    // focus-to-entity in the editor animates the runtime camera after
    // the first viewer visit.
    const faEl = document.querySelector('[focus-animation]');
    const fa = faEl && faEl.components['focus-animation'];
    if (fa) {
      this._prevFocusCamera = fa.camera;
      this._prevFocusCallback = fa.changeEventCallback;
    }

    const controls = new THREE.EditorControls(cam, this.sceneEl.canvas);
    // Same feel overrides the editor viewport applies.
    controls.rotationSpeed = 0.0035;
    controls.zoomSpeed = 0.05;
    this._orbitControls = controls;
    this.syncOrbitCenter();
    // Mirror into the store so React (the viewer controls hint) can react.
    useStore.setState({ isOrbitEnabled: true });
  },

  exitOrbit: function () {
    if (this._orbitControls) {
      this._orbitControls.dispose();
      this._orbitControls = null;
    }
    // Give focus-animation back to the editor's EditorControls instance.
    const faEl = document.querySelector('[focus-animation]');
    const fa = faEl && faEl.components['focus-animation'];
    if (fa && this._prevFocusCamera) {
      fa.setCamera(this._prevFocusCamera, this._prevFocusCallback);
    }
    this._prevFocusCamera = null;
    this._prevFocusCallback = null;

    // Un-flatten: THREE camera back to local identity, #camera el back
    // to its neutral eye offset. (Anything that needs the vantage —
    // the editor handoff, drive's pose restore — reads it BEFORE the
    // mode switch via getViewerCameraPose/copyCameraPosition.)
    const cameraEl = document.getElementById('camera');
    const cam = cameraEl && cameraEl.getObject3D('camera');
    if (cam) {
      cam.position.set(0, 0, 0);
      cam.quaternion.identity();
      cam.updateMatrix();
    }
    if (cameraEl && this._orbitEyeOffset) {
      cameraEl.object3D.position.copy(this._orbitEyeOffset);
      cameraEl.object3D.rotation.set(0, 0, 0);
    }
    useStore.setState({ isOrbitEnabled: false });
  },

  /**
   * Point the orbit pivot at what the camera is likely looking at: the
   * ground hit of the view ray when looking down (distance clamped to
   * [2, 100]), else a point 20 m ahead. Called on orbit enter and every
   * time a vantage is applied.
   */
  syncOrbitCenter: function () {
    const controls = this._orbitControls;
    const cameraEl = document.getElementById('camera');
    const cam = cameraEl && cameraEl.getObject3D('camera');
    if (!controls || !cam) return;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    let distance = 20;
    if (forward.y < -0.05 && cam.position.y > 0) {
      distance = THREE.MathUtils.clamp(-cam.position.y / forward.y, 2, 100);
    }
    controls.center.copy(cam.position).addScaledVector(forward, distance);
  },

  /**
   * Current viewer camera world pose in the cameraState shape used by
   * saved vantages (same shape viewport.js's getEditorCameraPose
   * returns). Valid in any mode — it decomposes the runtime camera's
   * matrixWorld, so it works whether the pose lives on the THREE camera
   * (orbit), the #camera el (drive), or the rig chain (locomotion).
   */
  getViewerCameraPose: function () {
    const cameraEl = document.getElementById('camera');
    const cam = cameraEl && cameraEl.getObject3D('camera');
    if (!cam) return null;
    cam.updateWorldMatrix(true, false);
    const position = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const euler = new THREE.Euler().setFromRotationMatrix(
      cam.matrixWorld,
      'YXZ'
    );
    return {
      position: { x: position.x, y: position.y, z: position.z },
      rotation: { x: euler.x, y: euler.y, z: euler.z },
      rotationOrder: 'YXZ',
      zoom: cam.isPerspectiveCamera ? cam.fov : 60
    };
  },

  /* ---------------- locomotion (dormant pending nav-selection) ---------------- */

  setLocomotionEnabled: function (enabled) {
    const rig = document.getElementById('cameraRig');
    const cameraEl = document.getElementById('camera');
    if (rig) rig.setAttribute('movement-controls', 'enabled', enabled);
    if (cameraEl) cameraEl.setAttribute('look-controls', 'enabled', enabled);
    // Mirror into the store so React (e.g. the controls hint) can react.
    useStore.setState({ isLocomotionEnabled: enabled });
  },

  /**
   * Place the viewer camera at a saved camera vantage. Accepts the
   * cameraState shape used everywhere else (memory.cameraState,
   * snapshots[].cameraState, ?camera= deep links, and the editor camera
   * pose handed over by viewport.js): position + rotation in radians
   * (+ optional rotationOrder, default XYZ — the order of a THREE
   * camera.rotation, which is what all saved states came from) and
   * zoom (= fov).
   *
   * In orbit mode the pose goes straight onto the flattened THREE
   * camera and the orbit pivot re-syncs. In locomotion mode, position
   * goes on the rig (so movement-controls moves from there) and
   * rotation into look-controls' pitch/yaw objects (so the first mouse
   * drag continues from the vantage instead of snapping to 0,0).
   */
  applyViewerVantage: function (cameraState) {
    if (!cameraState || !cameraState.position) return;
    const rig = document.getElementById('cameraRig');
    const cameraEl = document.getElementById('camera');
    if (!rig || !cameraEl) return;

    if (this.currentMode === 'orbit' && this._orbitControls) {
      const orbitCam = cameraEl.getObject3D('camera');
      if (!orbitCam) return;
      const p = cameraState.position;
      orbitCam.position.set(p.x, p.y, p.z);
      const r = cameraState.rotation || { x: 0, y: 0, z: 0 };
      orbitCam.quaternion.setFromEuler(
        new THREE.Euler(r.x, r.y, r.z, cameraState.rotationOrder || 'XYZ')
      );
      if (orbitCam.isPerspectiveCamera && Number.isFinite(cameraState.zoom)) {
        orbitCam.fov = cameraState.zoom;
        orbitCam.updateProjectionMatrix();
      }
      orbitCam.updateMatrixWorld();
      this.syncOrbitCenter();
      return;
    }

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
