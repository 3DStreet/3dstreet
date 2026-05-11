/* global THREE, AFRAME, STREET */

// Sibling to THREE.EditorControls. Drives the editor camera when the
// `?nav=experimental` URL flag is set.
//
// Phase 1 mechanics — see claude/specs/001-phase-1-plan.md:
//   - LB+drag        -> world-horizontal hit-anchored truck/dolly
//   - Shift+LB+drag  -> orbit/tilt around screen-center hit (>=30° clamp)
//   - Wheel          -> exponential cursor-anchored dolly (budget drained
//                       per A-Frame tick; tilt-preserving)
//   - WASD           -> camera-yaw-projected horizontal motion
//   - Plan View      -> animated tween to top-down N-up (entered via
//                       handlePlanViewRequest, called by viewport.js)
//
// Phase 3 mechanics — see claude/specs/001-phase-3-plan.md:
//   - Wheel zoom is a 3-phase "swoop" gated by camera elevation:
//       y > 10m         -> phase1: cursor-anchored dolly (tilt-conditional)
//       1.5m < y ≤ 10m  -> phase2: pedestal + tilt-toward-horizontal
//       y ≤ 1.5m        -> phase3: FOV-only zoom
//   - Stored tilt latched at downward 10m crossings; lerped during Phase 2.
//   - Ctrl+wheel (incl. Mac trackpad pinch) bypasses the swoop entirely
//     -> plain camera-Z dolly at current tilt and elevation.
//   - Per-phase drain cap: Phase 2 = 3 ticks/frame; Phase 1/3 = 10.
//
// Public API (mirrors THREE.EditorControls — see plan §"Toggle insertion
// in viewport.js"):
//   - enabled, center, panSpeed, zoomSpeed, minSpeedFactor, rotationSpeed
//   - setCamera(camera), setAspectRatio(ratio)
//   - focus(target) — reuses focus-animation A-Frame component
//   - newSceneCameraZoom(snapshotCameraState)
//   - resetZoom()
//   - zoomInStart/Stop, zoomOutStart/Stop
//   - handlePlanViewRequest()         (new in Phase 1)
//   - addEventListener / dispatchEvent (Three EventDispatcher)
//   - dispose()

import { ModifierState } from './modifierState.js';
import { GestureLatch } from './gestureLatch.js';
import { SceneBounds } from './sceneBounds.js';
import { CursorAnchor } from './cursorAnchor.js';
import { TickAnimator } from './tickAnimator.js';
import {
  ZOOM_PER_WHEEL_TICK,
  WHEEL_BUDGET_PER_TICK_UNITS,
  WHEEL_MAX_TICKS_PER_FRAME,
  WHEEL_MAX_BUDGET,
  ROTATION_SPEED_RAD_PER_PX,
  WASD_SPEED_HEIGHT_FACTOR,
  WASD_MIN_SPEED,
  WASD_MAX_SPEED,
  WASD_RAMP_UP_MS,
  PLAN_VIEW_DURATION_MS,
  LB_PAN_MAX_STEP_METRES,
  ROTATION_BLEND_LOW_DEGREES,
  TRUCK_PEDESTAL_CUTOFF_DEGREES,
  SWOOP_PHASE2_ENTRY_ELEVATION_METRES,
  SWOOP_PHASE2_EXIT_ELEVATION_METRES,
  SWOOP_PHASE2_MAX_TICKS_PER_FRAME,
  SWOOP_PHASE2_FLOOR_SNAP_METRES,
  SWOOP_PHASE3_FOV_FLOOR_DEGREES
} from './constants.js';
import {
  cameraTiltDegrees,
  decideLbMode,
  latchedRotationCenter,
  computeLowTiltWheelHit,
  shiftRotateStep,
  decideSwoopPhase,
  phase2TargetTilt,
  phase2NextElevation
} from './navMath.js';

const DEG2RAD = Math.PI / 180;
// Note: spherical phi clamps for Shift+LB rotation now live in
// navMath.shiftRotateStep (derived from MIN/MAX_TILT_DEGREES at module
// load time there). They were removed from this file when the rotation
// step extracted to a pure helper.

const NAV_DEBUG = (() => {
  if (typeof window === 'undefined' || !window.location) return false;
  return new URLSearchParams(window.location.search).get('navDebug') === 'true';
})();

export class ExperimentalControls extends THREE.EventDispatcher {
  constructor(camera, domElement) {
    super();

    // EditorControls-compatible knobs.
    this.enabled = true;
    this.center = new THREE.Vector3();
    this.panSpeed = 0.002;
    this.zoomSpeed = ZOOM_PER_WHEEL_TICK;
    this.minSpeedFactor = 8;
    this.rotationSpeed = ROTATION_SPEED_RAD_PER_PX;

    this._camera = camera;
    this._domElement = domElement;
    this._isOrthographic = false;
    this._disabledByOrtho = false;
    this._aspectRatio = 1;

    this._sceneEl =
      typeof AFRAME !== 'undefined' && AFRAME.scenes ? AFRAME.scenes[0] : null;

    this._modifiers = new ModifierState(domElement);
    this._latch = new GestureLatch();
    this._bounds = new SceneBounds(this._sceneEl);
    this._cursorAnchor = new CursorAnchor({
      camera,
      sceneEl: this._sceneEl,
      domElement
    });
    this._tick = new TickAnimator(this._sceneEl);

    this._pointer = new THREE.Vector2();
    this._pointerOld = new THREE.Vector2();
    this._delta = new THREE.Vector3();
    this._normalMatrix = new THREE.Matrix3();
    this._changeEvent = { type: 'change' };

    // Scratch.
    this._tmpV3a = new THREE.Vector3();
    this._tmpV3b = new THREE.Vector3();
    this._tmpV3c = new THREE.Vector3();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._anchorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._tmpRay = new THREE.Ray();
    this._raycaster = new THREE.Raycaster();
    this._tmpNDC = new THREE.Vector2();

    // Wheel-budget accumulator (deltaY units; drained per tick).
    this._wheelBudget = 0;

    // Phase 3 swoop state.
    //
    //   _storedTilt — latched on a Phase 1 zoom-in tick that clamps to
    //     y = SWOOP_PHASE2_ENTRY_ELEVATION_METRES; read by Phase 2's
    //     tilt lerp. Init from current tilt so Phase 2's lerp is defined
    //     even if the session opens already inside the elevation band.
    //     Manual camera moves (Shift+LB, LB+drag, Plan View, etc.) do
    //     not update this — only wheel-driven downward 10m crossings.
    //   _phase3FovBaseline — latched on a Phase 2 zoom-in tick that
    //     clamps to y = SWOOP_PHASE2_EXIT_ELEVATION_METRES; cleared on
    //     Phase 3 zoom-out crossing back to baseline. Null when not in
    //     Phase 3.
    // See claude/specs/001-phase-3-plan.md.
    this._storedTilt = cameraTiltDegrees(camera);
    this._phase3FovBaseline = null;

    // WASD held-key set; drained per tick.
    this._heldKeys = new Set();
    // Current WASD velocity in world horizontal plane (m/s). Ramps up
    // toward the target while keys are held; snaps to zero on release.
    this._wasdVelocity = new THREE.Vector3();

    // ActionBar zoom-in/out hold-down intervals.
    this._zoomInInterval = null;
    this._zoomOutInterval = null;

    // Plan View animation in flight — input ignored while true.
    this._planViewActive = false;
    this._planViewHandle = null;

    // Phase 2 visual-indicator state. `_currentLbMode` is the last
    // value emitted via `nav-experimental:modechange` for the LB sub-
    // mode comparator. Initialised lazily on the first gesture / tween.
    this._currentLbMode = null;

    this.setCamera(camera);
    this._initFocusAnimation();
    this._bindHandlers();
    this._attach();

    // Per-tick driver for WASD + wheel-budget drain.
    this._unsubscribeTick = this._tick.subscribe((delta) =>
      this._onTick(delta)
    );

    if (NAV_DEBUG) {
      console.info(
        '[nav-experimental] ExperimentalControls active (Phase 1). ' +
          'See claude/specs/001-phase-1-plan.md.'
      );
    }
  }

  // --- Public API consumed by viewport.js / ActionBar ---

  setCamera(camera) {
    this._camera = camera;
    if (this._cursorAnchor) this._cursorAnchor.setCamera(camera);
    if (camera && camera.type === 'OrthographicCamera') {
      this._isOrthographic = true;
      if (!this._disabledByOrtho) {
        this._disabledByOrtho = true;

        console.info(
          'ExperimentalControls: orthographic camera not supported; ' +
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

    if (targetEl && targetEl.hasAttribute('focus-camera-pose')) {
      const rel =
        targetEl.getAttribute('focus-camera-pose').relativePosition || null;
      if (rel) {
        cameraPosition = new THREE.Vector3(rel.x, rel.y, rel.z)
          .applyQuaternion(focusWorldQuat)
          .add(focusWorldPos);
      }
    }

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
    this._zoomInInterval = setInterval(() => this._zoomActionBar(-1), 50);
  }
  zoomInStop() {
    clearInterval(this._zoomInInterval);
    this._zoomInInterval = null;
  }
  zoomOutStart() {
    if (this._disabledByOrtho) return;
    this._zoomOutInterval = setInterval(() => this._zoomActionBar(1), 50);
  }
  zoomOutStop() {
    clearInterval(this._zoomOutInterval);
    this._zoomOutInterval = null;
  }

  // Phase 2: read the cached LB sub-mode for the visual indicator. The
  // hook (`useNavMode`) calls this on mount to seed initial state, then
  // listens for `nav-experimental:modechange` for updates. Forces a
  // recompute if the cache is empty so the first read is always honest.
  getCurrentLbMode() {
    if (this._currentLbMode == null && this._camera) {
      this._currentLbMode = decideLbMode(cameraTiltDegrees(this._camera));
    }
    return this._currentLbMode;
  }

  // Phase 1 entry point used by viewport.js when the user triggers Plan
  // View (App menu / toolbar / keyboard) in flag-on mode. The camera was
  // briefly swapped to ortho by cameras.js; viewport.js reverts it back to
  // the perspective camera before calling this.
  handlePlanViewRequest() {
    if (this._disabledByOrtho) return;
    const camera = this._camera;
    if (!camera || camera.type !== 'PerspectiveCamera') return;

    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();

    // End pose target XZ: scene-bounds centre when bounded, else stay
    // over current XZ. Either way, lift to a height that frames the
    // whole scene (or a sensible default for unbounded scenes).
    const bounds = this._bounds.getBounds();
    const fov = (camera.fov || 60) * DEG2RAD;
    const aspect = camera.aspect || 1;
    // Vertical fov gives the height-fit; horizontal fov fits the width.
    // Use the smaller of the two so the radius fits both ways with margin.
    const halfVFov = fov / 2;
    const halfHFov = Math.atan(Math.tan(halfVFov) * aspect);
    const fitFov = Math.min(halfVFov, halfHFov);
    const margin = 1.3; // 30% padding around the bounds circle
    let endX, endZ, endY;
    if (bounds && bounds.bounded && bounds.radius > 0) {
      endX = bounds.center.x;
      endZ = bounds.center.z;
      endY = (bounds.radius * margin) / Math.tan(fitFov);
    } else {
      endX = camera.position.x;
      endZ = camera.position.z;
      endY = Math.max(camera.position.y, 200);
    }
    // Don't drop below the current altitude — Plan View should zoom out,
    // never zoom in.
    endY = Math.max(endY, camera.position.y);

    // Look straight down (-Y), with screen-up matching the camera's
    // current horizontal facing direction. Hardcoding screen-up to world
    // +Z (the original spec) forced a 180° spin whenever the user was
    // orbited so their heading pointed at world -Z. Preserving yaw keeps
    // the transition feeling continuous — only tilt and altitude change.
    //
    // Scratch PerspectiveCamera (not Object3D) so lookAt uses the camera
    // convention (-Z toward target).
    const endPos = new THREE.Vector3(endX, endY, endZ);
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) {
      // Degenerate (camera already looking straight down) — fall back to
      // world North. No yaw can be inferred.
      fwd.set(0, 0, -1);
    }
    fwd.normalize();
    const scratch = new THREE.PerspectiveCamera();
    scratch.position.copy(endPos);
    // With view=-Y, any horizontal `up` works — `fwd` is the camera's
    // current forward direction projected horizontal, so screen-up after
    // the transition equals that direction. Heading is preserved.
    scratch.up.copy(fwd);
    scratch.lookAt(endPos.x, 0, endPos.z);
    const endQuat = scratch.quaternion.clone();

    // Recenter "this.center" to be on the ground beneath the end pose.
    this.center.set(endPos.x, 0, endPos.z);

    this._planViewActive = true;
    // 'plan-view' is a forward-hook payload — no Phase 2 consumer reads
    // it (`useNavMode` filters to pan-truck/pan-pedestal only). Phase 3
    // / future indicator work may key off it; left dispatched so the
    // tween bracket is symmetric with the closing `null` emission.
    this._emitModeChange('plan-view');
    this._planViewHandle = this._tick.animate({
      durationMs: PLAN_VIEW_DURATION_MS,
      onTick: (eased) => {
        camera.position.lerpVectors(startPos, endPos, eased);
        camera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        camera.updateMatrixWorld();
        this.dispatchEvent(this._changeEvent);
      },
      onDone: () => {
        camera.position.copy(endPos);
        camera.quaternion.copy(endQuat);
        camera.updateMatrixWorld();
        this._planViewActive = false;
        this._planViewHandle = null;
        this._emitModeChange(null);
        // Plan View ends at near-90° tilt — guaranteed truck-mode. Per
        // A6, refresh the indicator on tween end so users who never
        // touch Shift+LB see the correct toolbar state.
        this._maybeEmitLbModeChange();
        this.dispatchEvent(this._changeEvent);
      }
    });
  }

  dispose() {
    this._detach();
    if (this._unsubscribeTick) this._unsubscribeTick();
    this._modifiers.dispose();
    this._bounds.dispose();
    if (this._cursorAnchor) this._cursorAnchor.dispose();
    if (this._tick) this._tick.dispose();
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
      // Wrap the change callback so a focus-animation tween that
      // crosses the 30° tilt boundary updates the visual indicator
      // mid-animation (per A6). The plan asked for an `onDone`-only
      // hook, but the focus-animation component doesn't expose one;
      // `_maybeEmitLbModeChange` is a no-op unless the comparator
      // flips, so per-frame is fine — cost is one asin + one
      // comparison, and the user gets the indicator update *during*
      // the tween rather than at its end.
      const callback = () => {
        this._maybeEmitLbModeChange();
        this.dispatchEvent(this._changeEvent);
      };
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
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onWindowBlur = this._onWindowBlur.bind(this);
  }

  _attach() {
    const el = this._domElement;
    el.addEventListener('mousedown', this._onMouseDown, false);
    el.addEventListener('wheel', this._onWheel, { passive: false });
    el.addEventListener('contextmenu', this._onContextMenu, false);
    window.addEventListener('keydown', this._onKeyDown, false);
    window.addEventListener('keyup', this._onKeyUp, false);
    window.addEventListener('blur', this._onWindowBlur, false);
  }

  _detach() {
    const el = this._domElement;
    el.removeEventListener('mousedown', this._onMouseDown, false);
    el.removeEventListener('wheel', this._onWheel, false);
    el.removeEventListener('contextmenu', this._onContextMenu, false);
    window.removeEventListener('mousemove', this._onMouseMove, false);
    window.removeEventListener('mouseup', this._onMouseUp, false);
    window.removeEventListener('keydown', this._onKeyDown, false);
    window.removeEventListener('keyup', this._onKeyUp, false);
    window.removeEventListener('blur', this._onWindowBlur, false);
  }

  _isInactive() {
    return !this.enabled || this._disabledByOrtho || this._planViewActive;
  }

  _emitModeChange(mode) {
    // Phase 2's visual indicator subscribes via the sceneEl event bus;
    // the controls dispatch on both `this` (Three.EventDispatcher) and
    // the scene element so React-side hooks have a stable mounting
    // point that survives camera-swap paths.
    const event = { type: 'nav-experimental:modechange', mode };
    this.dispatchEvent(event);
    if (this._sceneEl && this._sceneEl.emit) {
      // bubbles=false: no React subscriber currently listens above the
      // sceneEl in the DOM, and an A-Frame `componentchanged` storm on
      // ancestors during Plan View tweens shouldn't see this event.
      // Flip to true if a parent-level subscriber appears.
      this._sceneEl.emit('nav-experimental:modechange', { mode }, false);
    }
  }

  // Recompute the LB sub-mode from the live camera and emit on change.
  // Called from gesture-start (catches stale-from-tween states), from
  // every Shift+LB move (the moment the tilt crosses 30°), and from
  // Plan-View / focus-animation onDone callbacks.
  _maybeEmitLbModeChange() {
    if (!this._camera) return;
    const next = decideLbMode(cameraTiltDegrees(this._camera));
    if (next !== this._currentLbMode) {
      this._currentLbMode = next;
      this._emitModeChange(next);
    }
  }

  // Mouse-mode dispatch. Phase 1 returns 'pan' (LB) or 'rotate' (Shift+LB).
  // Phase 2 splits the 'pan' branch further at gesture-start time via
  // `decideLbMode(cameraTiltDegrees(camera))`.
  _decideMouseMode(event) {
    if (event.button !== 0) return null;
    if (event.shiftKey) return 'rotate';
    return 'pan';
  }

  // Wheel-phase dispatch. Phase 1 has one phase; Phase 3 will extend.
  _decideZoomPhase(_event) {
    return 'phase1';
  }

  _onContextMenu(event) {
    event.preventDefault();
  }

  _onMouseDown(event) {
    if (this._isInactive()) return;
    const mode = this._decideMouseMode(event);
    if (!mode) return;

    this._pointerOld.set(event.clientX, event.clientY);

    // Per A6: catch stale-from-tween states (e.g. a Plan View tween or
    // focus animation moved the camera across the 30° boundary without
    // going through `_shiftRotate`). Emits a fresh LB-mode if changed,
    // before the gesture latches.
    this._maybeEmitLbModeChange();

    if (mode === 'pan') {
      // Sub-mode latched at gesture start from the live camera tilt.
      // truck-mode (>30° looking down) keeps the Phase 1 horizontal-
      // plane anchor; pedestal-mode (everything else) uses a vertical
      // plane through the anchor.
      const subMode = decideLbMode(cameraTiltDegrees(this._camera));
      const anchor = this._cursorAnchor.worldPointAt(
        event.clientX,
        event.clientY
      );

      if (subMode === 'pan-truck') {
        this._anchorPlane.set(
          new THREE.Vector3(0, 1, 0),
          -anchor.y // signed dist; plane equation y = anchor.y
        );
        this._latch.start({
          mode: 'pan',
          subMode,
          anchor,
          anchorY: anchor.y
        });
      } else {
        // Pedestal: vertical plane through anchor, normal =
        // camera-forward-horizontal (camera -Z projected onto the
        // horizontal plane and normalized). Spans world-Y plus camera-
        // right-horizontal — sits "in front of" the camera like a
        // window. (See plan §"_lbPedestalMove" + inline discussion #1.)
        const fwd = new THREE.Vector3();
        this._camera.getWorldDirection(fwd);
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-6) {
          // Camera looking straight up or down — degenerate horizontal
          // forward. Fall back to world -Z so the gesture still latches
          // a sane plane; pedestal mode is normally unreachable from
          // straight-up via the tilt clamp, but be defensive.
          fwd.set(0, 0, -1);
        }
        fwd.normalize();
        const planeAnchor = new THREE.Vector3(anchor.x, anchor.y, anchor.z);
        this._anchorPlane.setFromNormalAndCoplanarPoint(fwd, planeAnchor);
        this._latch.start({
          mode: 'pan',
          subMode,
          anchor: planeAnchor,
          // Stash the plane normal so move-time math doesn't need to
          // re-derive it from the (possibly mid-rotated) camera.
          planeNormal: fwd.clone()
        });
      }
    } else if (mode === 'rotate') {
      this._latchRotationCenter(this._camera);
    }

    this._emitModeChange(mode);
    // mousemove + mouseup attached to window (not the canvas) so the
    // gesture follows the cursor across editor panels: leaving the
    // viewport mid-drag pauses input visually because the panel is
    // covering the canvas, but coming back resumes the same gesture.
    // Only an actual mouse-button release ends the latch.
    window.addEventListener('mousemove', this._onMouseMove, false);
    window.addEventListener('mouseup', this._onMouseUp, false);
  }

  _onMouseMove(event) {
    if (this._isInactive() || !this._latch.isActive()) return;

    this._pointer.set(event.clientX, event.clientY);
    const dx = this._pointer.x - this._pointerOld.x;
    const dy = this._pointer.y - this._pointerOld.y;
    this._pointerOld.copy(this._pointer);

    const mode = this._latch.get('mode');
    if (mode === 'pan') {
      const subMode = this._latch.get('subMode');
      if (subMode === 'pan-pedestal') {
        this._lbPedestalMove(event.clientX, event.clientY);
      } else {
        this._lbTruckMove(event.clientX, event.clientY);
      }
    } else if (mode === 'rotate') {
      this._shiftRotate(dx, dy);
      // Per Open Design Call #2: emit LB-mode change the moment the
      // tilt crosses the 30° boundary mid-gesture, not at gesture end.
      this._maybeEmitLbModeChange();
    }
  }

  _onMouseUp() {
    if (this._latch.isActive()) {
      this._latch.end();
      this._emitModeChange(null);
      // Safety-net recompute: in case the final move was missed (e.g.
      // mouseup arrived before a queued mousemove drained), recheck the
      // LB-mode comparator at gesture end.
      this._maybeEmitLbModeChange();
    }
    window.removeEventListener('mousemove', this._onMouseMove, false);
    window.removeEventListener('mouseup', this._onMouseUp, false);
  }

  _onWheel(event) {
    if (this._isInactive()) return;
    event.preventDefault();
    const phase = this._decideZoomPhase(event);
    if (phase !== 'phase1') return;

    // Normalize deltaY across deltaMode (pixel/line/page).
    let dy = event.deltaY;
    if (event.deltaMode === 1) {
      // line mode: ~16px per line
      dy *= 16;
    } else if (event.deltaMode === 2) {
      // page mode
      dy *= window.innerHeight || 800;
    }
    this._wheelBudget += dy;
    // Hard-cap so a trackpad burst can't queue zoom that keeps draining
    // for hundreds of ms after the user stops (felt like input lag /
    // queued inputs). At MAX_BUDGET the next frame consumes everything.
    if (this._wheelBudget > WHEEL_MAX_BUDGET) {
      this._wheelBudget = WHEEL_MAX_BUDGET;
    } else if (this._wheelBudget < -WHEEL_MAX_BUDGET) {
      this._wheelBudget = -WHEEL_MAX_BUDGET;
    }

    // Latest cursor position is needed at drain time; remember it.
    this._lastWheelClientX = event.clientX;
    this._lastWheelClientY = event.clientY;

    // Ctrl+wheel = fixed-tilt zoom escape hatch (Phase 3 plan, Open
    // Decision #2). Mac trackpad pinch arrives as Ctrl+wheel naturally,
    // so the same code path handles pinch-to-zoom. Latch the flag at
    // event time; drain-time consumes it per tick.
    this._lastWheelCtrlKey = !!event.ctrlKey;
  }

  _onWindowBlur() {
    this._heldKeys.clear();
    if (this._latch.isActive()) {
      this._latch.end();
      this._emitModeChange(null);
    }
  }

  _onKeyDown(event) {
    if (this._isInactive()) return;
    if (this._isTypingTarget(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const k = event.code;
    // Both WASD and arrow keys drive movement. The original W/S/D
    // editor shortcuts (translate-mode, scale-mode, clone-entity) were
    // remapped to T/L/C in shortcuts.js on 2026-05-09 so WASD is free
    // for camera movement.
    if (
      k === 'KeyW' ||
      k === 'KeyA' ||
      k === 'KeyS' ||
      k === 'KeyD' ||
      k === 'ArrowUp' ||
      k === 'ArrowDown' ||
      k === 'ArrowLeft' ||
      k === 'ArrowRight'
    ) {
      this._heldKeys.add(k);
      // Prevent the browser from scrolling the page (arrow keys) or
      // shifting focus in scrollable panels while driving the camera.
      event.preventDefault();
    }
  }

  _onKeyUp(event) {
    const k = event.code;
    if (this._heldKeys.has(k)) this._heldKeys.delete(k);
  }

  _isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  // --- Per-tick driver ---

  _onTick(deltaMs) {
    if (this._isInactive()) {
      // Plan View tween or disabled — nothing to do here. (The tween
      // itself runs as a separate TickAnimator subscription via animate().)
      return;
    }
    this._drainWheel();
    this._drainWASD(deltaMs);
  }

  _drainWheel() {
    if (this._wheelBudget === 0) return;
    const unit = WHEEL_BUDGET_PER_TICK_UNITS;
    // Per H4 of `claude/reports/007-phase-3-plan-review.md`: latch the
    // per-frame cap once at the start of the drain pass, hold for the
    // whole frame. Re-evaluating per iteration produces an asymmetric
    // speed-up at boundary crossings (Phase 2 → Phase 1 zoom-out would
    // unlock 7 extra Phase 1 ticks in the same frame the moment y
    // crosses 10m).
    const frameCap = this._wheelFrameCap();
    let ticksThisFrame = 0;
    let changed = false;
    while (ticksThisFrame < frameCap && Math.abs(this._wheelBudget) >= unit) {
      const sign = this._wheelBudget > 0 ? 1 : -1;
      this._wheelBudget -= sign * unit;
      this._applyWheelTick(sign);
      ticksThisFrame++;
      changed = true;
    }
    // If the residual is small, drop it so it doesn't accumulate forever.
    if (Math.abs(this._wheelBudget) < unit * 0.05) this._wheelBudget = 0;
    if (changed) this.dispatchEvent(this._changeEvent);
  }

  // Per-frame drain cap based on the current swoop phase. Latched once
  // at the start of `_drainWheel` and held for the frame. Phase 2 uses
  // a lower cap so trackpad bursts can't blast through the swoop
  // (~350ms guaranteed minimum, vs ~100ms with the default cap).
  _wheelFrameCap() {
    if (decideSwoopPhase(this._camera.position.y) === 'phase2') {
      return SWOOP_PHASE2_MAX_TICKS_PER_FRAME;
    }
    return WHEEL_MAX_TICKS_PER_FRAME;
  }

  _applyWheelTick(sign) {
    // sign > 0 -> deltaY positive -> wheel "down" -> zoom out
    // sign < 0 -> zoom in
    //
    // Elevation-first dispatch (per H1 of the adversarial review at
    // `claude/reports/007-phase-3-plan-review.md`). The tilt-conditional
    // split from `001-tilt-conditional-zoom.md` lives inside the Phase 1
    // branch only; Phase 2/3 must run regardless of tilt — that *is* the
    // swoop. The reverse dispatch order silently routes Phase 2 ticks
    // into the low-tilt camera-Z dolly the moment the swoop's lerp drops
    // tilt below 30° (≈ y=5.75m for θ_stored=60°), aborting mid-flight.
    //
    // Ctrl+wheel (incl. Mac trackpad pinch) bypasses the swoop and gives
    // a plain camera-Z dolly at the current tilt and elevation (Open
    // Decision #2). Routes to the low-tilt branch's math regardless of
    // tilt or phase.
    const camera = this._camera;
    if (this._lastWheelCtrlKey) {
      return this._applyLowTiltWheelTick(sign);
    }
    const phase = decideSwoopPhase(camera.position.y);
    if (phase === 'phase2') return this._applyPhase2WheelTick(sign);
    if (phase === 'phase3') return this._applyPhase3WheelTick(sign);
    // phase1: tilt-conditional split applies here only.
    if (cameraTiltDegrees(camera) <= TRUCK_PEDESTAL_CUTOFF_DEGREES) {
      return this._applyLowTiltWheelTick(sign);
    }
    return this._applyPhase1WheelTick(sign);
  }

  // Phase 1 — cursor-anchored exponential dolly at high tilt + high
  // altitude. Translates the camera along the camera→anchor ray by 10%
  // of the current distance per tick. Tilt-preserving by construction.
  //
  // Boundary handling: if zoom-in pushes y below 10m, clamp to 10m and
  // latch _storedTilt = current tilt (round-down model — see §"Tick
  // energy" in the plan). The next tick is Phase 2.
  _applyPhase1WheelTick(sign) {
    const camera = this._camera;
    const x = this._lastWheelClientX;
    const y = this._lastWheelClientY;
    if (x == null || y == null) return;
    const hit = this._cursorAnchor.worldPointAt(x, y);
    this._applyAnchoredDollyStep(sign, hit);

    // Boundary: Phase 1 → Phase 2 on zoom-in.
    if (sign < 0 && camera.position.y < SWOOP_PHASE2_ENTRY_ELEVATION_METRES) {
      camera.position.y = SWOOP_PHASE2_ENTRY_ELEVATION_METRES;
      // Phase 1 ticks are tilt-preserving, so this matches the tilt at
      // the moment of crossing.
      this._storedTilt = cameraTiltDegrees(camera);
      camera.updateMatrixWorld();
    }
  }

  // Low-tilt branch (tilt ≤ 30° while y > 10m) and the Ctrl+wheel
  // escape hatch. Synthetic anchor 30m along camera-forward; runs the
  // same orbit-step math as Phase 1 so behaviour matches a plain
  // camera-Z dolly. No cursor anchoring (per
  // `001-tilt-conditional-zoom.md`).
  _applyLowTiltWheelTick(sign) {
    const hit = computeLowTiltWheelHit(this._camera);
    this._applyAnchoredDollyStep(sign, hit);
  }

  // Shared step: translate the camera along the camera→hit ray by 10%
  // of current distance (sign<0 = closer; sign>0 = farther — exact
  // multiplicative inverse for reversibility).
  _applyAnchoredDollyStep(sign, hit) {
    const camera = this._camera;
    let factor;
    if (sign < 0) factor = 1 - ZOOM_PER_WHEEL_TICK;
    else factor = 1 / (1 - ZOOM_PER_WHEEL_TICK);

    const offset = this._tmpV3a
      .copy(camera.position)
      .sub(this._tmpV3b.set(hit.x, hit.y, hit.z));
    offset.multiplyScalar(factor);
    camera.position.copy(this._tmpV3b).add(offset);

    // Track far plane based on distance.
    const distance = camera.position.distanceTo(this.center);
    camera.far = Math.min(100000000, Math.max(20000, distance * 10));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // Phase 2 — pedestal + tilt-toward-horizontal. No cursor anchoring
  // (see plan §"Design history note"). Yaw and (x,z) preserved across
  // the tick; only y and tilt change.
  //
  // Boundary handling:
  //   zoom-in below SWOOP_PHASE2_EXIT_ELEVATION_METRES → snap to floor,
  //     tilt to 0°, latch _phase3FovBaseline. Next tick is Phase 3.
  //   zoom-out above SWOOP_PHASE2_ENTRY_ELEVATION_METRES → clamp at
  //     entry. _storedTilt is unchanged on zoom-out.
  //   zoom-out from y < exit (saved-scene-below-floor edge case, H2):
  //     snap up to exit elevation first, then begin the lerp.
  _applyPhase2WheelTick(sign) {
    const camera = this._camera;
    const yFloor = SWOOP_PHASE2_EXIT_ELEVATION_METRES;
    const yCeil = SWOOP_PHASE2_ENTRY_ELEVATION_METRES;

    // Saved-scene edge case: zoom-out from below the floor. Snap up
    // first; otherwise the reciprocal formula pushes y further down.
    let y = camera.position.y;
    if (sign > 0 && y < yFloor) {
      y = yFloor;
    }

    let yNext = phase2NextElevation(y, sign);

    // Floor snap on zoom-in (per H6 of the review): the asymptotic
    // approach to yFloor would otherwise leave the user wheeling
    // forever to land. Snap to floor when within snap distance.
    if (sign < 0 && yNext - yFloor < SWOOP_PHASE2_FLOOR_SNAP_METRES) {
      yNext = yFloor;
    }

    // Boundary: Phase 2 → Phase 3 on zoom-in.
    if (sign < 0 && yNext <= yFloor) {
      camera.position.y = yFloor;
      this._setCameraTiltPreservingYaw(0);
      this._phase3FovBaseline = camera.fov;
      camera.updateMatrixWorld();
      this.dispatchEvent(this._changeEvent);
      return;
    }

    // Boundary: Phase 2 → Phase 1 on zoom-out.
    if (sign > 0 && yNext >= yCeil) {
      camera.position.y = yCeil;
      this._setCameraTiltPreservingYaw(this._storedTilt);
      camera.updateMatrixWorld();
      return;
    }

    camera.position.y = yNext;
    this._setCameraTiltPreservingYaw(phase2TargetTilt(yNext, this._storedTilt));
    camera.updateMatrixWorld();
  }

  // Phase 3 — FOV-only zoom at street level. Camera position and tilt
  // locked; only fov changes. Multiplicative reciprocal for exact
  // reversibility. Clamped to [SWOOP_PHASE3_FOV_FLOOR_DEGREES,
  // _phase3FovBaseline].
  //
  // Boundary handling: zoom-out reaching baseline FOV clears the
  // baseline; next tick is Phase 2 (which begins pedestalling up). If
  // entry into Phase 3 was not via Phase 2 (e.g. saved scene at y<1.5
  // with FOV manually set), _phase3FovBaseline is null — latch it
  // lazily from the current FOV on first tick.
  _applyPhase3WheelTick(sign) {
    const camera = this._camera;
    if (this._phase3FovBaseline == null) {
      this._phase3FovBaseline = camera.fov;
    }
    const baseline = this._phase3FovBaseline;
    const floor = SWOOP_PHASE3_FOV_FLOOR_DEGREES;

    let fov;
    if (sign < 0) fov = camera.fov / (1 + ZOOM_PER_WHEEL_TICK);
    else fov = camera.fov * (1 + ZOOM_PER_WHEEL_TICK);

    if (fov < floor) fov = floor;
    if (fov >= baseline) {
      // Zoom-out hand-off to Phase 2: clamp to baseline, clear it so
      // the next zoom-out tick falls through to Phase 2.
      fov = baseline;
      this._phase3FovBaseline = null;
    }
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }

  // Apply a tilt (in degrees from horizontal, positive = looking down)
  // while preserving the camera's current yaw. Used by Phase 2.
  // Re-derives the view direction from yaw + tilt and re-points the
  // camera. (camera.lookAt() can't be used directly because it needs a
  // target point, not an orientation.)
  _setCameraTiltPreservingYaw(tiltDeg) {
    const camera = this._camera;
    // Current yaw from camera-forward horizontal projection.
    const fwd = this._tmpV3a;
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) {
      // Camera looking straight up/down — yaw is undefined. Use camera's
      // local +Y projected to horizontal as a stand-in (matches the
      // WASD-degenerate convention).
      this._tmpV3b.set(0, 1, 0).applyQuaternion(camera.quaternion);
      this._tmpV3b.y = 0;
      if (this._tmpV3b.lengthSq() > 1e-6) {
        fwd.copy(this._tmpV3b).normalize();
      } else {
        fwd.set(0, 0, -1);
      }
    } else {
      fwd.normalize();
    }
    // Tilt: rotate fwd downward by tiltDeg around the horizontal axis
    // perpendicular to fwd.
    const tiltRad = tiltDeg * DEG2RAD;
    const cos = Math.cos(tiltRad);
    const sin = Math.sin(tiltRad);
    const newFwd = this._tmpV3c.set(fwd.x * cos, -sin, fwd.z * cos);
    // Target = position + newFwd.
    const target = this._tmpV3a // reuse — fwd not needed past here
      .copy(camera.position)
      .add(newFwd);
    camera.lookAt(target);
  }

  _drainWASD(deltaMs) {
    const camera = this._camera;
    const dirX =
      this._heldKeys.has('KeyD') || this._heldKeys.has('ArrowRight') ? 1 : 0;
    const dirXNeg =
      this._heldKeys.has('KeyA') || this._heldKeys.has('ArrowLeft') ? 1 : 0;
    const dirZ =
      this._heldKeys.has('KeyW') || this._heldKeys.has('ArrowUp') ? 1 : 0;
    const dirZNeg =
      this._heldKeys.has('KeyS') || this._heldKeys.has('ArrowDown') ? 1 : 0;
    const strafe = dirX - dirXNeg;
    const fwd = dirZ - dirZNeg;
    const hasInput = strafe !== 0 || fwd !== 0;

    // Release semantics: any frame with no held movement keys snaps the
    // velocity to zero immediately. No deceleration ramp.
    if (!hasInput) {
      if (this._wasdVelocity.lengthSq() === 0) return;
      this._wasdVelocity.set(0, 0, 0);
      return;
    }

    // Forward = horizontal projection of camera -Z, normalized; if degenerate
    // (camera looking straight down), fall back to camera +Y horizontal projection.
    const forward = this._tmpV3a;
    camera.getWorldDirection(forward); // -Z direction, normalized
    forward.y = 0;
    if (forward.lengthSq() > 0.0001) {
      forward.normalize();
    } else {
      const up = this._tmpV3c.set(0, 1, 0).applyQuaternion(camera.quaternion);
      up.y = 0;
      if (up.lengthSq() > 0.0001) forward.copy(up).normalize();
      else forward.set(0, 0, -1);
    }
    // Right = forward × worldUp. For forward=(0,0,-1), worldUp=(0,1,0),
    // this yields (1,0,0), which is screen-right for an upright camera.
    const right = this._tmpV3b.copy(forward).cross(this._tmpV3c.set(0, 1, 0));
    right.y = 0;
    right.normalize();

    // Target velocity: unit direction × height-scaled speed.
    const targetDir = this._tmpV3c.set(0, 0, 0);
    targetDir.addScaledVector(forward, fwd);
    targetDir.addScaledVector(right, strafe);
    targetDir.normalize();

    const height = Math.max(0.1, Math.abs(camera.position.y));
    const targetSpeed = THREE.MathUtils.clamp(
      height * WASD_SPEED_HEIGHT_FACTOR,
      WASD_MIN_SPEED,
      WASD_MAX_SPEED
    );
    const targetVel = targetDir.multiplyScalar(targetSpeed);

    // Acceleration ramp toward target. accel = max-speed / ramp-time so a
    // standing-start key-press reaches WASD_MAX_SPEED in WASD_RAMP_UP_MS;
    // for lower target speeds the ramp completes proportionally faster.
    const accel = WASD_MAX_SPEED / (WASD_RAMP_UP_MS / 1000);
    const maxStep = accel * (deltaMs / 1000);
    const dv = new THREE.Vector3().subVectors(targetVel, this._wasdVelocity);
    const dvMag = dv.length();
    if (dvMag <= maxStep) {
      this._wasdVelocity.copy(targetVel);
    } else {
      this._wasdVelocity.add(dv.multiplyScalar(maxStep / dvMag));
    }

    if (this._wasdVelocity.lengthSq() === 0) return;
    const distMetres = deltaMs / 1000;
    const move = new THREE.Vector3()
      .copy(this._wasdVelocity)
      .multiplyScalar(distMetres);
    camera.position.add(move);
    this.center.add(move);
    camera.updateMatrixWorld();
    this.dispatchEvent(this._changeEvent);
  }

  // --- LB hit-anchored truck ---

  _lbTruckMove(clientX, clientY) {
    const camera = this._camera;
    const anchor = this._latch.get('anchor');
    if (!anchor) return;

    // Compute world point currently under the cursor on the latched
    // horizontal plane y = anchor.y.
    const rect = this._domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._tmpNDC.set(ndcX, ndcY);
    this._raycaster.setFromCamera(this._tmpNDC, camera);

    const hNow = new THREE.Vector3();
    const ok = this._raycaster.ray.intersectPlane(this._anchorPlane, hNow);
    if (!ok) return; // ray parallel to plane (camera looking horizontally) — no-op

    const dx = anchor.x - hNow.x;
    const dz = anchor.z - hNow.z;
    if (!isFinite(dx) || !isFinite(dz)) return;

    // Sanity cap to avoid teleports if the anchor solution is degenerate.
    const stepMag = Math.hypot(dx, dz);
    let sx = dx;
    let sz = dz;
    const cap = LB_PAN_MAX_STEP_METRES;
    if (stepMag > cap) {
      const k = cap / stepMag;
      sx *= k;
      sz *= k;
    }
    camera.position.x += sx;
    camera.position.z += sz;
    this.center.x += sx;
    this.center.z += sz;
    camera.updateMatrixWorld();
    this.dispatchEvent(this._changeEvent);
  }

  // --- LB pedestal move (Phase 2) ---
  //
  // Mirrors `_lbTruckMove` but operates on a *vertical* plane through
  // the latched anchor. Plane normal = camera-forward-horizontal (latched
  // at gesture start). Mouse-X drives camera-right-horizontal motion
  // (truck-right); mouse-Y drives world-Y motion (pedestal-up).
  //
  // The "world point under cursor stays under cursor in 2D" property is
  // preserved as long as the camera-yaw doesn't change during the
  // gesture (which it can't — pedestal mode doesn't rotate the camera).
  _lbPedestalMove(clientX, clientY) {
    const camera = this._camera;
    const anchor = this._latch.get('anchor');
    if (!anchor) return;

    const rect = this._domElement.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
    this._tmpNDC.set(ndcX, ndcY);
    this._raycaster.setFromCamera(this._tmpNDC, camera);

    const hNow = new THREE.Vector3();
    const ok = this._raycaster.ray.intersectPlane(this._anchorPlane, hNow);
    if (!ok) return; // ray parallel to plane — no-op

    // Decompose the (anchor - hNow) delta onto (camera-right-horizontal,
    // world-up) so a horizontal mouse drag never accidentally introduces
    // a y-component and vice-versa. The intersection point already lies
    // in the plane; this is just choosing a basis to read it in.
    const planeNormal = this._latch.get('planeNormal');
    if (!planeNormal) return;
    const right = new THREE.Vector3().crossVectors(
      planeNormal,
      new THREE.Vector3(0, 1, 0)
    );
    if (right.lengthSq() < 1e-6) return;
    right.normalize();

    const delta = new THREE.Vector3().subVectors(anchor, hNow);
    const stepRight = delta.dot(right);
    const stepUp = delta.y;
    if (!isFinite(stepRight) || !isFinite(stepUp)) return;

    // Sanity cap — same as `_lbTruckMove`. Numerically-degenerate hits
    // (drag near-parallel to plane normal) get clamped, not zeroed.
    const stepMag = Math.hypot(stepRight, stepUp);
    let sR = stepRight;
    let sU = stepUp;
    const cap = LB_PAN_MAX_STEP_METRES;
    if (stepMag > cap) {
      const k = cap / stepMag;
      sR *= k;
      sU *= k;
    }

    camera.position.x += right.x * sR;
    camera.position.z += right.z * sR;
    camera.position.y += sU;
    this.center.x += right.x * sR;
    this.center.z += right.z * sR;
    this.center.y += sU;
    camera.updateMatrixWorld();
    this.dispatchEvent(this._changeEvent);
  }

  // --- Phase 2 rotation-center pipeline (latch-time + live-time) ---

  // Truth table — see claude/specs/001-phase-2-plan.md §"Truth table".
  //
  //   Tilt > 30° down              -> Rule 1: screen-center hit.
  //                                   (falls back to ruleAB if null).
  //   20–30° down (blend zone)     -> lerp(screen-hit, ruleAB) by tilt.
  //   ≤20° down through any up     -> Rule 2/3 (ruleAB), no Rule 1 blend.
  //
  // ruleAB = Rule 2 (diorama center @ eye height) outside the scene
  //          AABB, Rule 3 (camera position) inside, smoothstepped over
  //          a SCENE_FEATHER_METRES feather extending outward from the
  //          AABB edge.
  //
  // Computed once at gesture start and held for the duration of the
  // drag. An earlier revision live-recomputed `ruleAB` per move so the
  // rotation center could slide as the camera crossed the AABB edge
  // mid-gesture, but during a Shift+LB rotate the camera *only* moves
  // because of the orbit math — feeding that back into the center
  // produced visible judder near the boundary. Latching breaks the
  // feedback. The next Shift+LB-down re-evaluates the camera state and
  // picks a fresh center.
  _latchRotationCenter(camera) {
    // Per A3 (deferred-raycast): if the tilt is at or below the blend
    // zone, the screen-center hit would be discarded by `blend === 1`
    // anyway. Skip the scene-mesh traversal in that case — saves work
    // at every Shift+LB-down at street level.
    const tiltDeg = cameraTiltDegrees(camera);
    const needsScreenHit = tiltDeg > ROTATION_BLEND_LOW_DEGREES;
    const screenHit = needsScreenHit ? this._screenCenterHit() : null;
    const bounds = this._bounds.getBounds();
    const latch = latchedRotationCenter(camera, bounds, screenHit);
    this._latch.start({
      mode: 'rotate',
      center: latch.center,
      screenHit: latch.screenHit,
      blend: latch.blend
    });
  }

  // Screen-center scene/ground raycast. Returns a Vector3 or null on
  // sky-miss (no scene mesh hit, no ground intersection in front of the
  // camera). Note: `CursorAnchor.worldPointAt` always returns a point
  // (with a fallback layer), so we can't rely on it for null. We do a
  // direct raycast/plane test here that intentionally allows null.
  _screenCenterHit() {
    const rect = this._domElement.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const ndcX = ((cx - rect.left) / rect.width) * 2 - 1;
    const ndcY = -((cy - rect.top) / rect.height) * 2 + 1;
    this._tmpNDC.set(ndcX, ndcY);
    this._raycaster.setFromCamera(this._tmpNDC, this._camera);

    // Step 1: scene mesh raycast (excludes gizmo / helper subtrees via
    // CursorAnchor's logic — reuse it here for consistency).
    const meshAnchor = this._cursorAnchor.worldPointAt(cx, cy);
    if (meshAnchor && meshAnchor.source === 'mesh') {
      return new THREE.Vector3(meshAnchor.x, meshAnchor.y, meshAnchor.z);
    }
    if (meshAnchor && meshAnchor.source === 'ground') {
      return new THREE.Vector3(meshAnchor.x, meshAnchor.y, meshAnchor.z);
    }
    // 'fallback' = sky-miss for our purposes — return null so the
    // latch-time logic collapses to ruleAB (per A3).
    return null;
  }

  // --- Shift+LB orbit/tilt around latched center ---

  // Shift+LB rotation step. Implements the "museum diorama" rotation
  // feel (per claude/specs/001-shiftrotate-decoupled-view.md): the
  // scene's angular position in the user's view is preserved across
  // the rotation. Camera position orbits the latched centre; camera
  // view direction rotates by the same yaw/tilt deltas, independently.
  // Math lives in navMath.shiftRotateStep.
  _shiftRotate(dxPx, dyPx) {
    const camera = this._camera;
    const center = this._latch.get('center');
    if (!center) return;

    const fwd = this._tmpV3c;
    camera.getWorldDirection(fwd); // unit, camera -Z in world space
    const { pos, lookTarget } = shiftRotateStep({
      camPos: camera.position,
      viewDir: fwd,
      centre: center,
      dxPx,
      dyPx,
      speed: this.rotationSpeed
    });

    camera.position.copy(pos);
    camera.lookAt(lookTarget);
    // `this.center` (EditorControls API field) reflects the orbit
    // anchor — distance-from-camera reference used by ActionBar / wheel
    // zoom. Use the latched rotation centre in the orbit case; for the
    // rotate-in-place case (centre coincides with camera) `pos === camPos`
    // and the latched centre equals camera position anyway.
    this.center.copy(center);
    camera.updateMatrixWorld();
    this.dispatchEvent(this._changeEvent);
  }

  // --- ActionBar zoom buttons (held-down repeat) ---
  // Phase 0 used a center-anchored dolly; Phase 1 keeps the same behavior
  // for the toolbar path so the zoom buttons feel unchanged.
  _zoomActionBar(sign) {
    if (this._isInactive()) return;
    const camera = this._camera;
    const distance = camera.position.distanceTo(this.center);
    camera.far = Math.min(100000000, Math.max(20000, distance * 10));
    camera.updateProjectionMatrix();
    const delta = this._delta.set(0, 0, sign);
    delta.multiplyScalar(
      Math.max(this.minSpeedFactor, distance) * this.zoomSpeed
    );
    delta.applyMatrix3(this._normalMatrix.getNormalMatrix(camera.matrix));
    camera.position.add(delta);
    camera.updateMatrixWorld();
    this.dispatchEvent(this._changeEvent);
  }
}
