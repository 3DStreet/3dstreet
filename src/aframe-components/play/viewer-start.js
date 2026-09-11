/* global AFRAME, THREE, STREET */
import useStore from '../../store.js';

/**
 * `viewer-start`, the scene's explicit starting vantage for a visitor.
 *
 * A discrete, one-per-scene entity (Add Layer → "Viewer Start") whose
 * position/rotation/fov IS the scene's start pose: visitors open the scene
 * here (viewer launches, non-owners in the editor) and pressing Start
 * glides the shared editor/viewer camera here, so a hotspot tour (or any
 * viewer-side experience) begins from the same place every time. Setting a
 * scene thumbnail also moves this entity to the captured view, so the
 * thumbnail and the start pose stay one thing. Older scenes' default-
 * snapshot poses are migrated into one at load; a scene without one opens
 * at the autosaved editor pose (src/tested/scene-camera-pose.js). Stop
 * returns an editor-origin session to the pre-Start pose.
 *
 * The entity has no geometry: it is a camera pose, not a thing in the
 * scene. Select it from the layers list (pinned to the top); focusing it
 * (double-click, the Focus button, F) glides the camera to the pose
 * itself, the same as Preview Start (ExperimentalControls.focus routes
 * viewer-start targets to goToStart). Only position/rotation/viewer-start
 * serialize.
 *
 * Drive/fly own the camera for the whole session when present (they borrow
 * the rig, "drive wins"), so the glide is skipped in that case.
 */

AFRAME.registerComponent('viewer-start', {
  schema: {
    // Vertical field of view in degrees (camera `fov`; the saved
    // cameraState shape calls it `zoom`). Future camera controls (a look-at
    // target, an orbit radius) hang off this schema too.
    fov: { default: 60 },
    // false = fixed camera while playing: visitors can only click hotspots
    // and go Back; orbit/pan/zoom/fly input is ignored (the viewer-start
    // system locks the shared controls' user input during play in `viewer`).
    freeLook: { default: true },
    // true = a viewer-origin entry (?viewer / a non-owner landing
    // in the viewer) starts Play on arrival, no click. Off by default:
    // the visitor's press is the audio-unlock gesture browsers require and
    // the de facto "everything finished loading" gate the deterministic
    // sim relies on (see docs/focus-hotspots.md). Drive/fly never
    // auto-start regardless (they take the camera).
    autoStart: { default: false }
  },

  init() {
    // One per scene, enforced here so every creation route (paste, the
    // AI tools, hand-edited JSON) is covered, not only the clone button:
    // a second instance strips itself and stays a plain entity.
    const active = this.system?.getActive();
    if (active && active !== this.el) {
      this._duplicate = true;
      STREET.notify.warningMessage('A scene has one Starting View');
      setTimeout(() => this.el.removeAttribute('viewer-start'));
      return;
    }
    this.update();
  },

  update() {
    if (this._duplicate) return;
    this.system?.applyInputLock();
  },

  remove() {
    if (this._duplicate) return;
    this.system?.applyInputLock();
  }
});

/**
 * World-space camera state ({ position, rotation, zoom } in the snapshot
 * cameraState shape ExperimentalControls.focusCameraState consumes) for a
 * viewer-start entity: the entity's world transform, camera looking down
 * its local -Z. Only meaningful once the entity has loaded: until then
 * A-Frame's default position/rotation components report zeros (callers on
 * the scene-load path go through the system's `whenReady`).
 */
export function viewerStartCameraState(el) {
  const obj = el.object3D;
  obj.updateMatrixWorld(true);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  obj.matrixWorld.decompose(position, quaternion, scale);
  const rotation = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
    zoom: el.components?.['viewer-start']?.data?.fov || 60
  };
}

function editorCameraState() {
  const camera = window.AFRAME?.INSPECTOR?.camera;
  if (!camera) return null;
  camera.updateMatrixWorld();
  const position = new THREE.Vector3();
  camera.getWorldPosition(position);
  const rotation = new THREE.Euler().setFromRotationMatrix(
    camera.matrixWorld,
    'XYZ'
  );
  return {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z },
    zoom: camera.fov
  };
}

AFRAME.registerSystem('viewer-start', {
  init() {
    this._restoreState = null;
    this._onPlayStart = this._onPlayStart.bind(this);
    this._onPlayStop = this._onPlayStop.bind(this);
    this._onPlayReset = this._onPlayReset.bind(this);
    // Auto-start arms per scene load and fires once the scene is presented
    // (control mode viewer, editor closed). Both orders happen: ?viewer=
    // sets viewer mode before the scene loads; a non-owner is switched to
    // the viewer after auth resolves, i.e. after newScene.
    this._autoStartPending = false;
    this._autoStarting = false;
    this.sceneEl.addEventListener('newScene', () => {
      this._autoStartPending = true;
      setTimeout(() => this._tryAutoStart(), 0);
    });
    this.sceneEl.addEventListener('mode-changed', (evt) => {
      if (evt.detail.to === 'viewer') setTimeout(() => this._tryAutoStart(), 0);
    });
    this.sceneEl.addEventListener('play-mode-start', this._onPlayStart);
    this.sceneEl.addEventListener('play-mode-stop', this._onPlayStop);
    this.sceneEl.addEventListener('play-mode-reset', this._onPlayReset);
    // The fixed-camera lock is a Play feature: re-evaluated on every play
    // boundary and on mode changes (an editor reopen mid-play unlocks).
    const relock = () => this.applyInputLock();
    this.sceneEl.addEventListener('play-mode-start', relock);
    this.sceneEl.addEventListener('play-mode-stop', relock);
    this.sceneEl.addEventListener('mode-changed', relock);

    // Deliberately NOT a playable capability: set-thumbnail creates a
    // Starting View implicitly, so counting it would give every scene with
    // a thumbnail a Start button that does nothing visible. Hotspots,
    // traffic and vehicles surface Start; when they do, Start still glides
    // here.
  },

  // The scene's Viewer Start (one per scene by design; first in DOM order
  // if a hand-edited scene carries more). Deleting it is the off switch.
  getActive() {
    return this.sceneEl.querySelector('[viewer-start]');
  },

  // Fixed camera: lock the shared controls' user input while a play
  // session is active in control mode `viewer` and the Starting View says
  // freeLook: false. Idle viewer mode and the editor are always unlocked.
  // Idempotent; also re-run on any viewer-start update/removal.
  applyInputLock() {
    const controls = window.AFRAME?.INSPECTOR?.controls;
    if (!controls) return;
    const el = this.getActive();
    const fixed =
      !!this.sceneEl.systems['play-mode']?.isPlaying &&
      this.sceneEl.systems['mode-manager']?.getMode() === 'viewer' &&
      !!el &&
      el.components?.['viewer-start']?.data?.freeLook === false;
    controls.inputLocked = fixed;
  },

  // Run `cb` once the Starting View entity (if any) has loaded, so its
  // transform is real. On scene load the newScene event fires right after
  // the entities are appended, before A-Frame has applied their
  // position/rotation; reading the pose then yields the origin (the
  // "camera at 0 0 0 facing -Z" bug). Synchronous when there is nothing
  // to wait for.
  whenReady(cb) {
    const el = this.getActive();
    if (el && !el.hasLoaded) {
      el.addEventListener('loaded', () => cb(), { once: true });
      return;
    }
    cb();
  },

  // The scene's start pose: the Starting View entity's, or null. One
  // accessor for the load fly-in, Start and Reset. (Legacy default-snapshot
  // poses are migrated into an entity at load, so there is no other source.)
  getStartCameraState() {
    const el = this.getActive();
    return el ? viewerStartCameraState(el) : null;
  },

  // Glide the shared camera to the start pose. Public so the sidebar's
  // Preview button and Play share one path.
  goToStart(el = null) {
    const controls = window.AFRAME?.INSPECTOR?.controls;
    if (!controls?.focusCameraState) return false;
    const state = el ? viewerStartCameraState(el) : this.getStartCameraState();
    if (!state) return false;
    controls.focusCameraState(state);
    return true;
  },

  // Drive/fly borrow the rig camera for the whole session; the start
  // vantage only applies to sessions that keep the shared viewer camera.
  // Ask the playable registry rather than the DOM so a hidden/disabled
  // vehicle (which drive-mode itself ignores) doesn't suppress the glide.
  _sessionKeepsViewerCamera() {
    const caps =
      this.sceneEl.systems['mode-manager']?.getPlayableCapabilities() || [];
    return !caps.includes('drive-controls') && !caps.includes('fly-controls');
  },

  _tryAutoStart() {
    if (!this._autoStartPending) return;
    const el = this.getActive();
    if (!el?.components?.['viewer-start']?.data?.autoStart) return;
    const playMode = this.sceneEl.systems['play-mode'];
    if (!playMode || playMode.isPlaying) return;
    if (this.sceneEl.systems['mode-manager']?.getMode() !== 'viewer') return;
    if (useStore.getState().isInspectorEnabled) return;
    if (!this._sessionKeepsViewerCamera()) return; // never into a vehicle
    this._autoStartPending = false;
    // Skip Start's glide: the scene-load fly-in is already heading to the
    // Starting View and should finish on its own.
    this._autoStarting = true;
    try {
      playMode.start({ origin: 'viewer' });
    } finally {
      this._autoStarting = false;
    }
  },

  _onPlayStart() {
    this._restoreState = null;
    // Any Start (manual or auto) consumes the arm for this scene load.
    this._autoStartPending = false;
    if (this._autoStarting) return;
    if (!this.getStartCameraState() || !this._sessionKeepsViewerCamera()) {
      return;
    }
    const origin = useStore.getState().playEntryOrigin;
    if (origin === 'editor') this._restoreState = editorCameraState();
    this.goToStart();
  },

  // Reset = a fresh run from the start pose (the same "put actors back at
  // spawn" contract vehicles honor). The hotspot system clears its own
  // focus/overview state on the same event; this only moves the camera.
  _onPlayReset() {
    if (!this._sessionKeepsViewerCamera()) return;
    this.goToStart();
  },

  _onPlayStop() {
    const state = this._restoreState;
    this._restoreState = null;
    if (!state) return;
    const controls = window.AFRAME?.INSPECTOR?.controls;
    controls?.focusCameraState?.(state);
  }
});
