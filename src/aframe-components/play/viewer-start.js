/* global AFRAME, THREE */
import useStore from '../../store.js';

/**
 * `viewer-start` — the scene's explicit starting vantage for a visitor.
 *
 * A discrete entity (Add Layer → "Viewer Start") whose position/rotation IS
 * the camera pose Play starts from: pressing Start glides the shared
 * editor/viewer camera to it, so a hotspot tour (or any viewer-side
 * experience) begins from the same place every time regardless of where
 * the author's camera happens to be. Stop returns an editor-origin session
 * to the pre-Start pose. The scene thumbnail keeps defining the pose a
 * scene LOADS at; this entity defines where Start goes.
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
const CAMERA_OFFSET_Z = 0; // pose origin = entity origin; body sits behind

AFRAME.registerComponent('viewer-start', {
  schema: {
    enabled: { default: true }
  },

  init() {
    this._onModeChanged = this._onModeChanged.bind(this);
    this._buildMarker();
    this.el.sceneEl.addEventListener('mode-changed', this._onModeChanged);
    this._applyVisibility(
      this.el.sceneEl.systems['mode-manager']?.getMode() ?? 'editor'
    );
    this.system?.register(this);
  },

  remove() {
    this.el.sceneEl.removeEventListener('mode-changed', this._onModeChanged);
    this.el.removeObject3D('mesh');
    this.system?.unregister(this);
  },

  _onModeChanged(evt) {
    this._applyVisibility(evt.detail.to);
  },

  // setAttribute('visible') rather than object3D.visible: mesh batching
  // reads the attribute (see CLAUDE.md "Shared gotchas").
  _applyVisibility(mode) {
    this.el.setAttribute('visible', mode === 'editor');
  },

  // Camera-shaped body + a wireframe frustum pointing down local -Z, the
  // direction the camera will face. Meshes (not just lines) so the editor
  // selection raycast can pick the entity in the viewport.
  _buildMarker() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshStandardMaterial({
      color: MARKER_COLOR,
      roughness: 0.5,
      transparent: true,
      opacity: 0.9
    });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.4, 0.5), bodyMat);
    body.position.set(0, 0, 0.35 + CAMERA_OFFSET_Z);
    group.add(body);

    const lens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.18, 0.25, 20),
      bodyMat
    );
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0, 0.0 + CAMERA_OFFSET_Z);
    group.add(lens);

    // Frustum: apex at the pose origin, opening toward -Z.
    const depth = 2.2;
    const hw = 1.1;
    const hh = 0.7;
    const apex = [0, 0, CAMERA_OFFSET_Z];
    const c = [
      [-hw, hh, -depth],
      [hw, hh, -depth],
      [hw, -hh, -depth],
      [-hw, -hh, -depth]
    ];
    const pts = [];
    for (let i = 0; i < 4; i++) {
      pts.push(...apex, ...c[i]);
      pts.push(...c[i], ...c[(i + 1) % 4]);
    }
    // Small "up" tick on the far rectangle so roll reads at a glance.
    pts.push(-0.25, hh, -depth, 0, hh + 0.3, -depth);
    pts.push(0, hh + 0.3, -depth, 0.25, hh, -depth);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(
      geom,
      new THREE.LineBasicMaterial({ color: MARKER_COLOR })
    );
    group.add(lines);

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
    rotation: { x: rotation.x, y: rotation.y, z: rotation.z }
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
    this._onPlayStart = this._onPlayStart.bind(this);
    this._onPlayStop = this._onPlayStop.bind(this);
    this.sceneEl.addEventListener('play-mode-start', this._onPlayStart);
    this.sceneEl.addEventListener('play-mode-stop', this._onPlayStop);

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

  // First enabled viewer-start in DOM order (one per scene is the intended
  // authoring; the DOM sweep keeps property toggles visible immediately).
  getActive() {
    return (
      Array.from(this.sceneEl.querySelectorAll('[viewer-start]')).find(
        (el) => el.components?.['viewer-start']?.data?.enabled
      ) || null
    );
  },

  // Glide the shared camera to the start pose. Public so the sidebar's
  // Preview button and Play share one path.
  goToStart(el = this.getActive()) {
    const controls = window.AFRAME?.INSPECTOR?.controls;
    if (!el || !controls?.focusCameraState) return false;
    controls.focusCameraState(viewerStartCameraState(el));
    return true;
  },

  _onPlayStart() {
    this._restoreState = null;
    const startEl = this.getActive();
    if (!startEl) return;
    // Drive/fly borrow the rig camera for the whole session; the start
    // vantage only applies to sessions that keep the shared viewer camera.
    // Ask the playable registry rather than the DOM so a hidden/disabled
    // vehicle (which drive-mode itself ignores) doesn't suppress the glide.
    const caps =
      this.sceneEl.systems['mode-manager']?.getPlayableCapabilities() || [];
    if (caps.includes('drive-controls') || caps.includes('fly-controls')) {
      return;
    }
    const origin = useStore.getState().playEntryOrigin;
    if (origin === 'editor') this._restoreState = editorCameraState();
    this.goToStart(startEl);
  },

  _onPlayStop() {
    const state = this._restoreState;
    this._restoreState = null;
    if (!state) return;
    const controls = window.AFRAME?.INSPECTOR?.controls;
    controls?.focusCameraState?.(state);
  }
});
