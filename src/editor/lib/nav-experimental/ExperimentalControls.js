/* global THREE, AFRAME, STREET */

// Sibling to THREE.EditorControls. Drives the editor camera when the
// `?nav=experimental` URL flag is set. See claude/specs/001-phase-0-plan.md.
//
// Phase 0 placeholder behavior: LB+drag pans in screen space at ~2x the
// EditorControls speed so flag-on mode is visibly distinguishable during
// the smoke test. This is NOT the proposed Phase 1 behavior — it exists
// only to confirm the toggle wires through to camera updates and
// re-renders correctly.
//
// API surface (mirrors THREE.EditorControls — see plan §"Toggle insertion
// in viewport.js"):
//   - enabled, center, panSpeed, zoomSpeed, minSpeedFactor, rotationSpeed
//   - setCamera(camera), setAspectRatio(ratio)
//   - focus(target) — reuses focus-animation A-Frame component
//   - newSceneCameraZoom(snapshotCameraState)
//   - resetZoom()
//   - zoomInStart/Stop, zoomOutStart/Stop
//   - addEventListener / dispatchEvent (Three EventDispatcher)
//   - dispose()

import { ModifierState } from './modifierState.js';
import { GestureLatch } from './gestureLatch.js';
import { SceneBounds } from './sceneBounds.js';

export class ExperimentalControls extends THREE.EventDispatcher {
  constructor(camera, domElement) {
    super();

    // Public, EditorControls-compatible knobs. Defaults chosen to differ
    // visibly from EditorControls so flag-on mode is recognisable.
    this.enabled = true;
    this.center = new THREE.Vector3();
    this.panSpeed = 0.002;
    this.zoomSpeed = 0.1;
    this.minSpeedFactor = 8;
    this.rotationSpeed = 0.005;

    this._camera = camera;
    this._domElement = domElement;
    this._isOrthographic = false;
    this._disabledByOrtho = false;
    this._aspectRatio = 1;

    this._modifiers = new ModifierState(domElement);
    this._latch = new GestureLatch();
    this._bounds = new SceneBounds(
      typeof AFRAME !== 'undefined' && AFRAME.scenes ? AFRAME.scenes[0] : null
    );

    this._pointer = new THREE.Vector2();
    this._pointerOld = new THREE.Vector2();
    this._delta = new THREE.Vector3();
    this._normalMatrix = new THREE.Matrix3();
    this._changeEvent = { type: 'change' };

    this._zoomInInterval = null;
    this._zoomOutInterval = null;

    this.setCamera(camera);
    this._initFocusAnimation();
    this._bindHandlers();
    this._attach();

    // Phase 0 marker so it's obvious in the console which control system
    // the editor is using. Remove or downgrade to debug-level once the
    // toggle is reliable.
    console.info(
      '[nav-experimental] ExperimentalControls active (Phase 0). ' +
        'See claude/specs/001-phase-0-plan.md.'
    );
  }

  // --- Public API consumed by viewport.js / ActionBar ---

  setCamera(camera) {
    this._camera = camera;
    if (camera && camera.type === 'OrthographicCamera') {
      this._isOrthographic = true;
      if (!this._disabledByOrtho) {
        this._disabledByOrtho = true;
        console.info(
          'ExperimentalControls: orthographic camera not supported in Phase 0; ' +
            'controls disabled until a perspective camera is restored. ' +
            'See claude/issues-for-discussion.md #2.'
        );
      }
    } else {
      this._isOrthographic = false;
      this._disabledByOrtho = false;
    }
  }

  setAspectRatio(ratio) {
    this._aspectRatio = ratio;
  }

  // Reuses the existing focus-animation A-Frame component, mirroring
  // THREE.EditorControls.focus(). Mutual exclusion at construction time
  // (only one of EditorControls or ExperimentalControls per session) means
  // this is the sole holder of focus-animation's camera registration.
  focus(target) {
    if (this._disabledByOrtho || !this._focusAnimation) return;
    const camera = this._camera;
    const fa = this._focusAnimation;

    fa.transitionCamPosStart.copy(camera.position);
    fa.transitionCamQuaternionStart.copy(camera.quaternion);

    const box = new THREE.Box3().setFromObject(target);
    const targetCenter = new THREE.Vector3();
    let distance;
    let localCenterY;

    if (!box.isEmpty() && !isNaN(box.min.x)) {
      box.getCenter(targetCenter);
      distance = box.getBoundingSphere(new THREE.Sphere()).radius;
      localCenterY = (box.max.y - box.min.y) / 2;
    } else {
      // AmbientLight, etc.
      targetCenter.setFromMatrixPosition(target.matrixWorld);
      distance = 0.1;
      localCenterY = target.position.y;
    }
    this.center.copy(targetCenter);

    const focusWorldPos = new THREE.Vector3();
    const focusWorldQuat = new THREE.Quaternion();
    const focusWorldScale = new THREE.Vector3();
    target.matrixWorld.decompose(
      focusWorldPos,
      focusWorldQuat,
      focusWorldScale
    );

    const targetEl = target.el;
    let cameraPosition;

    // Use focus-camera-pose override if present.
    if (targetEl && targetEl.hasAttribute('focus-camera-pose')) {
      const rel =
        targetEl.getAttribute('focus-camera-pose').relativePosition || null;
      if (rel) {
        cameraPosition = new THREE.Vector3(rel.x, rel.y, rel.z)
          .applyQuaternion(focusWorldQuat)
          .add(focusWorldPos);
      }
    }

    // Fallback: catalog baseRotation-aware default offset.
    if (!cameraPosition) {
      let baseRotation = 0;
      if (targetEl && targetEl.hasAttribute('mixin')) {
        const mixinId = targetEl.getAttribute('mixin');
        const catalogEntry =
          typeof STREET !== 'undefined' && STREET.catalog
            ? STREET.catalog.find((entry) => entry.id === mixinId)
            : null;
        baseRotation = (catalogEntry && catalogEntry.baseRotation) || 0;
      }
      const rad = THREE.MathUtils.degToRad(baseRotation);
      const defaultOffset = new THREE.Vector3(
        0,
        localCenterY + distance * 0.5,
        distance * 2.5
      );
      const rotated = defaultOffset.clone();
      rotated.x =
        defaultOffset.x * Math.cos(rad) - defaultOffset.z * Math.sin(rad);
      rotated.z =
        defaultOffset.x * Math.sin(rad) + defaultOffset.z * Math.cos(rad);
      cameraPosition = rotated
        .applyQuaternion(focusWorldQuat)
        .add(focusWorldPos);
    }

    camera.position.copy(cameraPosition);
    camera.lookAt(targetCenter);
    fa.transitionCamPosEnd.copy(camera.position);
    fa.transitionCamQuaternionEnd.copy(camera.quaternion);

    // Restore start pose; let focus-animation tick the transition.
    camera.position.copy(fa.transitionCamPosStart);
    camera.quaternion.copy(fa.transitionCamQuaternionStart);
    fa.transitionProgress = 0;
    fa.transitioning = true;
  }

  resetZoom() {
    if (this._disabledByOrtho) return;
    const camera = this._camera;
    this.center.set(0, 1.6, 0);
    camera.position.set(0, 15, 30);
    camera.lookAt(this.center);
    camera.updateMatrixWorld();
    this.dispatchEvent(this._changeEvent);
  }

  // Phase 0: snap to the snapshot pose without animation. EditorControls
  // does an easeOutCubic 3s tween via a sibling RAF loop; replicating that
  // accurately would mean a second RAF loop here, which we explicitly
  // avoid (see plan "Camera-update loop"). Phase 1+ can route this through
  // A-Frame's tick if a smoother arrival is wanted.
  newSceneCameraZoom(snapshotCameraState) {
    if (this._disabledByOrtho) {
      this.resetZoom();
      return;
    }
    const camera = this._camera;
    if (!snapshotCameraState) {
      this.resetZoom();
      return;
    }
    const pos = snapshotCameraState.position || {};
    const rot = snapshotCameraState.rotation || {};
    camera.position.set(
      pos.x != null ? pos.x : 0,
      pos.y != null ? pos.y : 15,
      pos.z != null ? pos.z : 30
    );
    camera.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
    camera.updateMatrixWorld();
    this.dispatchEvent(this._changeEvent);
  }

  zoomInStart() {
    if (this._disabledByOrtho) return;
    this._zoomInInterval = setInterval(
      () => this._zoom(this._delta.set(0, 0, -1)),
      50
    );
  }
  zoomInStop() {
    clearInterval(this._zoomInInterval);
    this._zoomInInterval = null;
  }
  zoomOutStart() {
    if (this._disabledByOrtho) return;
    this._zoomOutInterval = setInterval(
      () => this._zoom(this._delta.set(0, 0, 1)),
      50
    );
  }
  zoomOutStop() {
    clearInterval(this._zoomOutInterval);
    this._zoomOutInterval = null;
  }

  dispose() {
    this._detach();
    this._modifiers.dispose();
    this._bounds.dispose();
    this.zoomInStop();
    this.zoomOutStop();
  }

  // --- Internals ---

  _initFocusAnimation() {
    const el =
      typeof document !== 'undefined'
        ? document.querySelector('[focus-animation]')
        : null;
    this._focusAnimation =
      el && el.components ? el.components['focus-animation'] : null;
    if (this._focusAnimation) {
      const callback = () => this.dispatchEvent(this._changeEvent);
      this._focusAnimation.setCamera(this._camera, callback);
    } else {
      console.warn(
        'ExperimentalControls: focus-animation component not found; ' +
          'focus() will be a no-op until it loads.'
      );
    }
  }

  _bindHandlers() {
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onContextMenu = this._onContextMenu.bind(this);
  }

  _attach() {
    const el = this._domElement;
    el.addEventListener('mousedown', this._onMouseDown, false);
    el.addEventListener('wheel', this._onWheel, false);
    el.addEventListener('contextmenu', this._onContextMenu, false);
  }

  _detach() {
    const el = this._domElement;
    el.removeEventListener('mousedown', this._onMouseDown, false);
    el.removeEventListener('wheel', this._onWheel, false);
    el.removeEventListener('contextmenu', this._onContextMenu, false);
    el.removeEventListener('mousemove', this._onMouseMove, false);
    el.removeEventListener('mouseup', this._onMouseUp, false);
    el.removeEventListener('mouseout', this._onMouseUp, false);
  }

  _isInactive() {
    return !this.enabled || this._disabledByOrtho;
  }

  _onContextMenu(event) {
    event.preventDefault();
  }

  _onMouseDown(event) {
    if (this._isInactive()) return;
    // Phase 0 placeholder: LB only.
    if (event.button !== 0) return;

    this._pointerOld.set(event.clientX, event.clientY);
    this._latch.start({ button: event.button });

    const el = this._domElement;
    el.addEventListener('mousemove', this._onMouseMove, false);
    el.addEventListener('mouseup', this._onMouseUp, false);
    el.addEventListener('mouseout', this._onMouseUp, false);
  }

  _onMouseMove(event) {
    if (this._isInactive() || !this._latch.isActive()) return;

    this._pointer.set(event.clientX, event.clientY);
    const movementX = this._pointer.x - this._pointerOld.x;
    const movementY = this._pointer.y - this._pointerOld.y;
    this._pointerOld.copy(this._pointer);

    this._pan(this._delta.set(-movementX, movementY, 0));
  }

  _onMouseUp() {
    this._latch.end();
    const el = this._domElement;
    el.removeEventListener('mousemove', this._onMouseMove, false);
    el.removeEventListener('mouseup', this._onMouseUp, false);
    el.removeEventListener('mouseout', this._onMouseUp, false);
  }

  _onWheel(event) {
    if (this._isInactive()) return;
    event.preventDefault();
    this._zoom(this._delta.set(0, 0, event.deltaY > 0 ? 1 : -1));
  }

  _pan(delta) {
    const camera = this._camera;
    const distance = camera.position.distanceTo(this.center);
    delta.multiplyScalar(
      Math.max(this.minSpeedFactor, distance) * this.panSpeed
    );
    delta.applyMatrix3(this._normalMatrix.getNormalMatrix(camera.matrix));
    camera.position.add(delta);
    this.center.add(delta);
    this.dispatchEvent(this._changeEvent);
  }

  _zoom(delta) {
    const camera = this._camera;
    const distance = camera.position.distanceTo(this.center);
    camera.far = Math.min(100000000, Math.max(20000, distance * 10));
    camera.updateProjectionMatrix();
    delta.multiplyScalar(
      Math.max(this.minSpeedFactor, distance) * this.zoomSpeed
    );
    delta.applyMatrix3(this._normalMatrix.getNormalMatrix(camera.matrix));
    camera.position.add(delta);
    this.dispatchEvent(this._changeEvent);
  }
}
