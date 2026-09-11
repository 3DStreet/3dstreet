/* global AFRAME, THREE */
import useStore from '../../store.js';

/**
 * `viewer-start` — the scene's explicit starting vantage for a visitor.
 *
 * A discrete, one-per-scene entity (Add Layer → "Viewer Start") whose
 * position/rotation/fov IS the scene's start pose: visitors open the scene
 * here (viewer/embed launches, non-owners in the editor) and pressing Start
 * glides the shared editor/viewer camera here, so a hotspot tour (or any
 * viewer-side experience) begins from the same place every time. Setting a
 * scene thumbnail also moves this entity to the captured view, so the
 * thumbnail and the start pose stay one thing. Scenes without one fall
 * back to the legacy default-snapshot pose (`setFallbackStartPose`). The
 * owner's own editor session lands on their autosaved editor pose instead
 * (src/tested/scene-camera-pose.js). Stop returns an editor-origin session
 * to the pre-Start pose.
 *
 * The component draws a procedural camera-body + frustum marker that only
 * shows in editor control mode (never in view/play/drive, never saved —
 * only position/rotation/viewer-start serialize). The system registers a
 * playable capability so a scene with just a start point still lights up
 * the Play UI (an FPS-style look-around, a hotspot tour with no traffic).
 *
 * Drive/fly own the camera for the whole session when present (they borrow
 * the rig, "drive wins"), so the glide is skipped in that case.
 */

const MARKER_COLOR = '#7c4dff';

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
    // true = a viewer-origin entry (?viewer / ?embed / a non-owner landing
    // in the viewer) starts Play on arrival, no click. Off by default:
    // the visitor's press is the audio-unlock gesture browsers require and
    // the de facto "everything finished loading" gate the deterministic
    // sim relies on (see docs/focus-hotspots.md). Drive/fly never
    // auto-start regardless (they take the camera).
    autoStart: { default: false }
  },

  init() {
    this._onModeChanged = this._onModeChanged.bind(this);
    this._buildMarker();
    this.update();
    this.el.sceneEl.addEventListener('mode-changed', this._onModeChanged);
    this._applyVisibility(
      this.el.sceneEl.systems['mode-manager']?.getMode() ?? 'editor'
    );
    this.system?.register(this);
  },

  update() {
    if (this._helperCamera) {
      this._helperCamera.fov = this.data.fov;
      this._helperCamera.updateProjectionMatrix();
      this._helper.update();
    }
    this.system?.applyInputLock();
  },

  remove() {
    this.el.sceneEl.removeEventListener('mode-changed', this._onModeChanged);
    this.el.removeObject3D('mesh');
    this.system?.unregister(this);
    this.system?.applyInputLock();
  },

  _onModeChanged(evt) {
    this._applyVisibility(evt.detail.to);
  },

  // setAttribute('visible') rather than object3D.visible: mesh batching
  // reads the attribute (see CLAUDE.md "Shared gotchas").
  _applyVisibility(mode) {
    this.el.setAttribute('visible', mode === 'editor');
  },

  // A small camera body (a mesh, so the editor selection raycast can pick
  // the entity) plus THREE.CameraHelper on a throwaway camera for the
  // frustum, which draws the real field of view for free. The helper
  // normally copies its camera's world matrix; pinning its local matrix
  // to identity keeps it in the entity's space as a child of the group.
  _buildMarker() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.4, 0.5),
      new THREE.MeshStandardMaterial({
        color: MARKER_COLOR,
        roughness: 0.5,
        transparent: true,
        opacity: 0.9
      })
    );
    body.position.set(0, 0, 0.35);
    group.add(body);

    this._helperCamera = new THREE.PerspectiveCamera(
      this.data.fov,
      16 / 10,
      0.1,
      2.5
    );
    this._helper = new THREE.CameraHelper(this._helperCamera);
    this._helper.matrix = new THREE.Matrix4();
    this._helper.material.color.set(MARKER_COLOR);
    this._helper.material.vertexColors = false;
    group.add(this._helper);

    this.el.setObject3D('mesh', group);
  }
});

/**
 * World-space camera state ({ position, rotation } in the snapshot
 * cameraState shape ExperimentalControls.focusCameraState consumes) for a
 * viewer-start entity: the entity's world transform, camera looking down
 * its local -Z.
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
    this.entries = new Set();
    this._restoreState = null;
    this._fallbackStartPose = null;
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

    // Playable capability: a start point alone is something for Start to
    // do. Registered on `loaded` so it's independent of system init order.
    const registerPlayable = () => {
      this.sceneEl.systems['mode-manager']?.registerPlayableCheck(
        'viewer-start',
        () => !!this.getActive()
      );
    };
    if (this.sceneEl.hasLoaded) registerPlayable();
    else {
      this.sceneEl.addEventListener('loaded', registerPlayable, { once: true });
    }
  },

  register(component) {
    this.entries.add(component);
  },

  unregister(component) {
    this.entries.delete(component);
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

  // Legacy start pose for scenes without a Viewer Start entity: the default
  // snapshot's camera state, handed over by the viewport on scene load.
  setFallbackStartPose(cameraState) {
    this._fallbackStartPose = cameraState || null;
  },

  // The scene's effective start pose: the Viewer Start entity if there is
  // one, else the legacy snapshot pose, else null. One accessor for the
  // load fly-in and for Start.
  getStartCameraState() {
    const el = this.getActive();
    if (el) return viewerStartCameraState(el);
    return this._fallbackStartPose;
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
