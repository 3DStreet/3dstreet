/* global THREE, AFRAME, STREET */

// Sibling to THREE.EditorControls. Drives the editor camera when the
// `?nav=experimental` URL flag is set.
//
// Phase 1 mechanics — see claude/specs/001-phase-1-plan.md:
//   - LB+drag        -> world-horizontal hit-anchored truck/dolly
//   - Shift+LB+drag  -> two-regime rotate, split on the tilt threshold T
//                       (TASK-010): Map orbit around the cursor pivot
//                       above T, rotate-in-place below T
//   - Wheel          -> exponential cursor-anchored dolly (budget drained
//                       per A-Frame tick; tilt-preserving)
//   - WASD           -> camera-yaw-projected horizontal motion
//   - Plan View      -> animated tween to top-down N-up (entered via
//                       handlePlanViewRequest, called by viewport.js)
//
// Phase 3 mechanics — see claude/specs/001-phase-3-plan.md:
//   - Wheel zoom is a 3-phase "swoop" gated by camera elevation **above
//     ground (AGL)** = camera.y − groundY, measured by a downward probe
//     (`_groundYBelowCamera`, TASK-013); on a flat scene at y=0 this
//     equals absolute camera.y:
//       AGL > 20m         -> phase1: cursor-anchored dolly (tilt-conditional)
//       1.5m < AGL ≤ 20m  -> phase2: pedestal + tilt-toward-horizontal
//       AGL ≤ 1.5m        -> phase3: FOV-only zoom
//   - Stored tilt latched at downward AGL-20m crossings; lerped during
//     Phase 2.
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

import './navTuningComponent.js';
import { ModifierState } from './modifierState.js';
import { GestureLatch } from './gestureLatch.js';
import { SceneBounds } from './sceneBounds.js';
import { CursorAnchor, isGroundSegmentHit } from './cursorAnchor.js';
import { RotationIndicator } from './rotationIndicator.js';
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
  TILT_THRESHOLD_DEFAULT_DEGREES,
  ROTATION_GROUND_FLOOR_METRES,
  MIN_ORBIT_RADIUS_METRES,
  MAP_PIVOT_BOUNDS_RADIUS_METRES,
  SWOOP_PHASE2_ENTRY_ELEVATION_METRES,
  SWOOP_PHASE2_EXIT_ELEVATION_METRES,
  SWOOP_PHASE2_MAX_TICKS_PER_FRAME,
  SWOOP_PHASE2_FLOOR_SNAP_METRES,
  SWOOP_PHASE3_FOV_FLOOR_DEGREES,
  NORTH_AXIS,
  NORTH_BEARING_FROM_MINUS_Z,
  COMPASS_TOPDOWN_TOLERANCE_DEGREES,
  COMPASS_NORTH_TOLERANCE_DEGREES,
  COMPASS_ROTATE_STEP_DEGREES
} from './constants.js';
import {
  cameraTiltDegrees,
  decideLbMode,
  decideDragModeSwitch,
  clampOrbitRadius,
  applyGroundFloor,
  computeLowTiltWheelHit,
  shiftRotateStep,
  decideSwoopPhase,
  phase2TargetTilt,
  phase2NextElevation
} from './navMath.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Normalize an angle in degrees to (-180, 180].
function normalizeDeg(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

// On-screen angle (degrees, 0 = up/12-o'clock, positive = clockwise) at
// which to draw the north needle, derived from camera YAW ALONE (no 3D
// projection, so it never jitters near top-down). Shared by the compass
// React widget (needle render) and the controls' north-up pose test, so
// the visual and the decision can never disagree.
//
// needle = normalize(NORTH_BEARING_FROM_MINUS_Z - headingForward),
// headingForward = atan2(f.x, -f.z). Near top-down the horizontal forward
// vanishes, so fall back to the camera up-vector's horizontal projection
// (which carries the same heading — proven in the plan §4.1); last-resort
// face -Z.
export function needleScreenAngle(camera) {
  const f = new THREE.Vector3();
  camera.getWorldDirection(f);
  let fx = f.x;
  let fz = f.z;
  if (fx * fx + fz * fz < 1e-8) {
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    fx = up.x;
    fz = up.z;
    if (fx * fx + fz * fz < 1e-8) {
      fx = 0;
      fz = -1;
    }
  }
  const headingForward = Math.atan2(fx, -fz) * RAD2DEG;
  return normalizeDeg(NORTH_BEARING_FROM_MINUS_Z - headingForward);
}

// Arrow sign → yaw delta sign. The right arrow (sign=+1, drawn as a
// clockwise arc) must rotate the VIEW clockwise; the left arrow (sign=-1,
// CCW arc) counter-clockwise. The plan's §5 Ex7 derivation had this
// inverted relative to the actual three.js yaw handedness (confirmed on
// live test), so the mapping is: right → +90° yaw about world +Y, left →
// -90°. Single pure local map — not re-derived at call sites.
function signToYaw(sign) {
  return sign > 0 ? 1 : -1;
}

// Downward direction for the AGL ground probe (TASK-013). Module-level
// frozen constant so `_groundYBelowCamera` (called every frame) does not
// allocate per call. `Raycaster.set` copies it into `ray.direction`, so a
// shared read-only vector is safe.
const GROUND_PROBE_DIR = Object.freeze(new THREE.Vector3(0, -1, 0));

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
    this._indicator = new RotationIndicator(this._sceneEl);
    this._tick = new TickAnimator(this._sceneEl);

    // TASK-010 (D2): the single tilt threshold T governing the LB
    // sub-mode, the wheel cut, the rotation regime, and the letterbox.
    // Live value (overridable via `setTiltThreshold` / the
    // `nav-experimental-tuning` component); defaults to the constant.
    this._tiltThreshold = TILT_THRESHOLD_DEFAULT_DEGREES;

    // TASK-010 (D-LT-3): Map-pivot bounds radius (metres on the ground,
    // measured from the screen-centre point). Live value, overridable via
    // the tuning component.
    this._mapPivotBoundsRadius = MAP_PIVOT_BOUNDS_RADIUS_METRES;

    // TASK-010 (live-Shift, B6): last-known cursor coords, tracked on
    // mousedown and every mousemove so a mid-drag Shift toggle can
    // re-latch the sub-gesture at the current cursor position.
    this._lastClientX = null;
    this._lastClientY = null;

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
    //     AGL = SWOOP_PHASE2_ENTRY_ELEVATION_METRES (i.e. camera.y =
    //     groundY + 20); read by Phase 2's tilt lerp. Init from current
    //     tilt so Phase 2's lerp is defined even if the session opens
    //     already inside the elevation band. Manual camera moves
    //     (Shift+LB, LB+drag, Plan View, etc.) do not update this — only
    //     wheel-driven downward AGL-20m crossings.
    //   _phase3FovBaseline — latched on a Phase 2 zoom-in tick that
    //     clamps to AGL = SWOOP_PHASE2_EXIT_ELEVATION_METRES; cleared on
    //     Phase 3 zoom-out crossing back to baseline. Null when not in
    //     Phase 3.
    // See claude/specs/001-phase-3-plan.md.
    this._storedTilt = cameraTiltDegrees(camera);
    this._phase3FovBaseline = null;

    // Last ground height found directly below the camera by the AGL probe
    // (TASK-013). Held through probe misses so the inferred ground stays
    // continuous as the camera crosses a scene edge (spec D2 / WE-8). Init
    // 0 so the never-probed-yet case == today's absolute-y behaviour on
    // the flat default scene.
    this._lastGroundY = 0;
    // Per-pass snapshot of the ground height directly below the camera,
    // set at the top of each _drainWheel pass from _groundYBelowCamera().
    // Read (not re-probed) by _wheelFrameCap / _applyWheelTick / the phase
    // helpers so every tick in a pass — including the recursive Phase 3 →
    // Phase 2 → Phase 1 hand-offs — sees the same ground. Distinct from
    // _lastGroundY (the persisted miss-fallback cache). (TASK-013)
    this._frameGroundY = 0;

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

    // TASK-011 compass animation state.
    //   _compassHandle  — the in-flight compass tween's TickAnimator handle,
    //                     or null. `_compassAnimating` (a derived getter) is
    //                     `_compassHandle != null && _compassHandle.isActive()`
    //                     so any external animate()/cancel() self-heals the
    //                     input gate — never a manually-managed boolean.
    //   _compassPending — at most one queued compass action ({kind, sign?})
    //                     re-dispatched against the settled pose on done.
    this._compassHandle = null;
    this._compassPending = null;

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
      // Drop any in-flight compass tween/queue — the derived gate already
      // self-heals, this just clears a stale pending slot.
      this._compassHandle = null;
      this._compassPending = null;
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
      this._currentLbMode = decideLbMode(
        cameraTiltDegrees(this._camera),
        this._tiltThreshold
      );
    }
    return this._currentLbMode;
  }

  // TASK-010 (D2): set the live tilt threshold T. Clamped to a sane range
  // (5–45°). Re-emits the LB-mode after storing: changing T while the
  // camera sits at a fixed tilt can flip the comparator (e.g. pan-truck →
  // pan-pedestal) without any mouse-move, and `_maybeEmitLbModeChange`
  // otherwise only fires on a move/tween — without this call the
  // letterbox wouldn't update until the next interaction. The re-emit is
  // a no-op when the comparator result is unchanged, so it is cheap.
  setTiltThreshold(deg) {
    if (typeof deg !== 'number' || !isFinite(deg)) return;
    this._tiltThreshold = THREE.MathUtils.clamp(deg, 5, 45);
    this._maybeEmitLbModeChange();
  }

  // TASK-010 (D-LT-3 / #6): live-tunable Map-pivot bounds radius (metres
  // on the ground from the screen-centre point). Relayed from the tuning
  // component.
  setMapPivotBoundsRadius(metres) {
    if (typeof metres !== 'number' || !isFinite(metres)) return;
    this._mapPivotBoundsRadius = THREE.MathUtils.clamp(metres, 1, 100000);
  }

  // TASK-010 (D-LT-3 / #6): live-tunable Shift+LB rotation speed
  // (radians per pixel). Relayed from the tuning component.
  setRotationSpeed(radPerPx) {
    if (typeof radPerPx !== 'number' || !isFinite(radPerPx) || radPerPx <= 0) {
      return;
    }
    this.rotationSpeed = radPerPx;
  }

  // Phase 1 entry point used by viewport.js when the user triggers Plan
  // View (App menu / toolbar / keyboard) in flag-on mode. The camera was
  // briefly swapped to ortho by cameras.js; viewport.js reverts it back to
  // the perspective camera before calling this.
  handlePlanViewRequest(opts = {}) {
    if (this._disabledByOrtho) return;
    const camera = this._camera;
    if (!camera || camera.type !== 'PerspectiveCamera') return;

    // TASK-011: when an EXTERNAL plan view (key-4 / menu) pre-empts a live
    // compass tween, drop the compass queue so it can't resurrect. The
    // derived `_compassAnimating` already goes false when this method's
    // `_tick.animate()` cancels the compass tween below; this just clears
    // the pending slot. Existing callers pass no opts ⇒ no-op unless a
    // compass tween is live.
    if (this._compassAnimating && !opts.fromCompass) {
      this._compassHandle = null;
      this._compassPending = null;
    }

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
        // TASK-011: when this plan view was the compass's stage 1, null the
        // compass handle and drain any queued action — placed LAST, after
        // the end pose is committed above, so the re-dispatched action sees
        // the settled pose.
        if (opts.fromCompass) {
          this._compassHandle = null;
          this._drainCompassPending();
        }
      }
    });
  }

  // --- TASK-011 compass ---

  // Derived "compass tween in flight" state. Reads TickAnimator's real
  // current-tween state, so ANY external animate()/cancel() flips it to
  // false automatically — the input gate can never be orphaned by a missed
  // teardown.
  get _compassAnimating() {
    return this._compassHandle != null && this._compassHandle.isActive();
  }

  // Body click — pose dispatcher. Top-down test FIRST, then north test,
  // then strict no-op (resolved decision #1). Decided from the LIVE camera
  // pose at click time, so it stays correct if the user moved between
  // clicks.
  handleCompassBodyClick() {
    if (this._disabledByOrtho) return;
    const camera = this._camera;
    if (!camera || camera.type !== 'PerspectiveCamera') return;
    if (this._compassAnimating) {
      this._compassPending = { kind: 'body' };
      return;
    }
    const tilt = cameraTiltDegrees(camera); // +90 = straight down
    const isTopDown = 90 - tilt <= COMPASS_TOPDOWN_TOLERANCE_DEGREES;
    if (!isTopDown) {
      this._runStage1FromCompass(); // stage 1 — preserves heading
      return;
    }
    // Already top-down: test north via the needle angle (same constant
    // governs the visual and the decision, so they never disagree).
    const needle = needleScreenAngle(camera);
    const isNorthUp = Math.abs(needle) <= COMPASS_NORTH_TOLERANCE_DEGREES;
    if (!isNorthUp) {
      this._alignToNorth(); // stage 2
      return;
    }
    // top-down AND north-up → strict no-op.
  }

  // Rotation arrow — relative ±90° heading turn. sign=+1 (right) = view 90°
  // CW; sign=-1 (left) = 90° CCW (spec examples 7-8).
  handleCompassRotate(sign) {
    if (this._disabledByOrtho) return;
    const camera = this._camera;
    if (!camera || camera.type !== 'PerspectiveCamera') return;
    if (this._compassAnimating) {
      this._compassPending = { kind: 'arrow', sign };
      return;
    }
    // Pivot selection. The top-down test has a 2° tolerance, so a
    // screen-centre raycast hit can sit off the nadir; a 90° orbit about
    // that off-nadir point would translate the camera (lurch). So when
    // top-down, force spin-in-place (null pivot) regardless of the
    // raycast. Only below top-down do we orbit about the screen-centre
    // hit; a null hit (sky / empty scene) also spins in place.
    const isTopDown =
      90 - cameraTiltDegrees(camera) <= COMPASS_TOPDOWN_TOLERANCE_DEGREES;
    const pivot = isTopDown ? null : this._screenCenterHit();

    const deltaYaw = COMPASS_ROTATE_STEP_DEGREES * signToYaw(sign);
    this._compassHandle = this._animateYawAboutPivot({ deltaYaw, pivot });
  }

  // Stage 1 from the compass — route through handlePlanViewRequest (the
  // shared plan-view action) and adopt its handle as the compass handle iff
  // a tween actually started. If it early-returned (ortho / non-persp),
  // drain the queue (nothing to await) — closes the early-return orphan.
  _runStage1FromCompass() {
    this.handlePlanViewRequest({ fromCompass: true });
    if (this._planViewActive) {
      this._compassHandle = this._planViewHandle;
    } else {
      this._drainCompassPending();
    }
  }

  // Stage 2 — pure-heading rotation so screen-up aligns to NORTH_AXIS (+X),
  // staying top-down at the same XZ + altitude. Shortest angular direction
  // (slerp). Does NOT reuse handlePlanViewRequest's degenerate branch
  // (which targets screen-up = -Z).
  _alignToNorth() {
    const camera = this._camera;
    const endPos = camera.position.clone(); // same XZ + altitude
    const scratch = new THREE.PerspectiveCamera();
    scratch.position.copy(endPos);
    scratch.up.set(NORTH_AXIS.x, 0, NORTH_AXIS.z); // = (1,0,0) for +X north
    scratch.lookAt(endPos.x, 0, endPos.z); // straight down (-Y)
    const endQuat = scratch.quaternion.clone();
    // pivot=null ⇒ position fixed; orientation slerps start→end the short
    // way by construction. The onDone sets this.center under the camera.
    this._compassHandle = this._animateYawAboutPivot({ endQuat, pivot: null });
  }

  // The single shared tween primitive. Takes EXACTLY ONE of:
  //   deltaYaw — a yaw delta (degrees) about world +Y (the arrows), or
  //   endQuat  — an explicit target orientation (align-to-north),
  // plus an optional `pivot` (THREE.Vector3 | null). When `pivot` and
  // `deltaYaw` are both present, the camera position orbits about `pivot`
  // in lockstep with the orientation slerp (the pivot stays screen-centred
  // for the WHOLE tween, since slerp of a fixed-axis delta equals that axis
  // interpolated). Otherwise position is fixed (spin/align in place).
  // Returns the TickAnimator handle (caller stores as _compassHandle).
  _animateYawAboutPivot({ deltaYaw = null, endQuat = null, pivot = null }) {
    const camera = this._camera;
    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();

    let targetQuat;
    if (deltaYaw != null) {
      const R = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        deltaYaw * DEG2RAD
      );
      targetQuat = R.clone().multiply(startQuat); // world-frame premultiply
    } else {
      targetQuat = endQuat.clone();
    }

    const orbiting = pivot != null && deltaYaw != null;
    const offset = orbiting ? startPos.clone().sub(pivot) : null;

    const finalize = () => {
      camera.quaternion.copy(targetQuat);
      if (orbiting) {
        const fullR = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          deltaYaw * DEG2RAD
        );
        camera.position.copy(
          pivot.clone().add(offset.clone().applyQuaternion(fullR))
        );
      }
      camera.updateMatrixWorld();
      this.dispatchEvent(this._changeEvent);
      // this.center: the orbit pivot, or the ground point under the camera
      // for a spin/align in place. Downstream wheel-zoom references it, so
      // it must be under the camera, not a stale pivot.
      if (orbiting) {
        this.center.copy(pivot);
      } else {
        this.center.set(camera.position.x, 0, camera.position.z);
      }
      this._compassHandle = null;
      this._drainCompassPending();
    };

    return this._tick.animate({
      durationMs: PLAN_VIEW_DURATION_MS,
      onTick: (eased) => {
        camera.quaternion.slerpQuaternions(startQuat, targetQuat, eased);
        if (orbiting) {
          const stepR = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            deltaYaw * eased * DEG2RAD
          );
          camera.position.copy(
            pivot.clone().add(offset.clone().applyQuaternion(stepR))
          );
        }
        camera.updateMatrixWorld();
        this.dispatchEvent(this._changeEvent);
      },
      onDone: finalize
    });
    // Pre-emption needs no onCancel: an external animate()/cancel() flips
    // this handle's isActive() to false, so the derived _compassAnimating
    // self-heals.
  }

  // Re-dispatch at most one queued compass action against the settled pose.
  // Runs inside a tween's onDone (after TickAnimator has unsubscribed and
  // nulled _currentTween), so the re-dispatched action starts a fresh
  // subscriber — at most one re-dispatch per completion, no recursion.
  _drainCompassPending() {
    const p = this._compassPending;
    this._compassPending = null;
    if (!p) return;
    if (p.kind === 'body') {
      this.handleCompassBodyClick(); // re-decide vs the post-anim pose
    } else {
      this.handleCompassRotate(p.sign); // fixed ±90° on post-anim heading
    }
  }

  dispose() {
    // TASK-011: drop any in-flight compass tween/queue (belt-and-braces;
    // the derived gate already self-heals).
    this._compassHandle = null;
    this._compassPending = null;
    this._detach();
    if (this._unsubscribeTick) this._unsubscribeTick();
    this._modifiers.dispose();
    this._bounds.dispose();
    if (this._cursorAnchor) this._cursorAnchor.dispose();
    if (this._indicator) this._indicator.dispose();
    if (this._tick) this._tick.dispose();
    // TASK-010 (D2): remove the tuning component this controls instance
    // caused viewport.js to attach, mirroring how dispose() tears down
    // everything else it owns. The app never re-instantiates the controls
    // today, but if it ever does, a stale component left attached would
    // call setTiltThreshold on whatever AFRAME.INSPECTOR.controls then is.
    if (this._sceneEl && this._sceneEl.hasAttribute('nav-experimental-tuning')) {
      this._sceneEl.removeAttribute('nav-experimental-tuning');
    }
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
    return (
      !this.enabled ||
      this._disabledByOrtho ||
      this._planViewActive ||
      this._compassAnimating
    );
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
    const next = decideLbMode(
      cameraTiltDegrees(this._camera),
      this._tiltThreshold
    );
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
    // TASK-010 (B6): track the cursor coords so a mid-drag Shift toggle
    // can re-latch the sub-gesture at the current position.
    this._lastClientX = event.clientX;
    this._lastClientY = event.clientY;

    // Per A6: catch stale-from-tween states (e.g. a Plan View tween or
    // focus animation moved the camera across the tilt boundary without
    // going through `_shiftRotate`). Emits a fresh LB-mode if changed,
    // before the gesture latches.
    this._maybeEmitLbModeChange();

    if (mode === 'pan') {
      this._beginPanSubGesture(event.clientX, event.clientY);
    } else if (mode === 'rotate') {
      this._beginRotateSubGesture(event.clientX, event.clientY);
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

  // TASK-010 (B6): start (or restart, mid-drag) the pan sub-gesture. The
  // truck-vs-pedestal pick reads the *current* tilt here (not at the call
  // site), so a mid-drag rotate→pan switch re-picks the sub-mode from the
  // live tilt — the pan-side mirror of the rotate-side regime re-eval.
  // truck-mode (> T looking down) keeps the horizontal-plane anchor;
  // pedestal-mode (everything else) uses a vertical plane through the
  // anchor. `_latch.start` replaces the latch's value bag wholesale, so a
  // rotate→pan switch wipes the stale rotate keys (center/regime).
  _beginPanSubGesture(clientX, clientY) {
    // TASK-010 (D3/D6): a pan sub-gesture never shows the ring. Hide it
    // here at the single pan-start point so a mid-drag Map-rotate→pan
    // switch (Shift released while the button is still held) clears the
    // ring left visible by the rotate — otherwise it leaks on the stale
    // pivot for the rest of the drag (it only marks a Map-rotate pivot).
    this._indicator.hide();
    const subMode = decideLbMode(
      cameraTiltDegrees(this._camera),
      this._tiltThreshold
    );
    const anchor = this._cursorAnchor.worldPointAt(clientX, clientY);

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
  }

  // TASK-010 (B6): start (or restart, mid-drag) the rotate sub-gesture.
  // `_latchRotationCenter` reads the current tilt to pick the regime
  // (Map orbit vs rotate-in-place) and the pivot, and toggles the ring.
  _beginRotateSubGesture(clientX, clientY) {
    this._latchRotationCenter(this._camera, clientX, clientY);
  }

  _onMouseMove(event) {
    if (this._isInactive() || !this._latch.isActive()) return;

    this._pointer.set(event.clientX, event.clientY);
    const dx = this._pointer.x - this._pointerOld.x;
    const dy = this._pointer.y - this._pointerOld.y;
    this._pointerOld.copy(this._pointer);
    // TASK-010 (B6): keep the last-cursor coords fresh for Shift toggles.
    this._lastClientX = event.clientX;
    this._lastClientY = event.clientY;

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
      // Emit LB-mode change the moment the tilt crosses T mid-gesture,
      // not at gesture end (letterbox is live; see plan §4b).
      this._maybeEmitLbModeChange();
    }
  }

  _onMouseUp() {
    if (this._latch.isActive()) {
      this._latch.end();
      this._emitModeChange(null);
      // TASK-010 (S-3): hide the ring on any latch-end via mouseup (e.g.
      // Shift-then-release-button) so it can't leak visible.
      this._indicator.hide();
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
      // TASK-010 (S-4): hide the ring on a window blur (e.g. Alt-Tab
      // mid-orbit) so it can't leak visible.
      this._indicator.hide();
    }
  }

  // TASK-010 (B6): make the active LB drag's sub-gesture match the live
  // Shift state. Idempotent and driven by `event.shiftKey` (not by
  // edge-detecting the Shift key), so it is symmetric on keydown/keyup
  // (H1), correct for two Shift keys / autorepeat (H2) and Ctrl+Shift
  // orderings (H3). Inert when no LB drag is latched — the latch-active
  // gate is the safety guarantee (not any "drags don't happen while
  // typing" claim): a latched window-bound LB drag survives the cursor
  // moving off-canvas, and a Shift toggle while the button is held is a
  // deliberate switch regardless of focus (decision D-R1-5).
  _syncDragModeToShift(shiftHeld) {
    if (this._isInactive() || !this._latch.isActive()) return; // only mid-drag
    const desired = decideDragModeSwitch(this._latch.get('mode'), shiftHeld);
    if (desired === null) return; // already in the desired mode
    if (desired === 'rotate') {
      this._beginRotateSubGesture(this._lastClientX, this._lastClientY);
    } else {
      this._beginPanSubGesture(this._lastClientX, this._lastClientY);
    }
    // B7: reset the pointer-delta baseline so the first move after the
    // switch doesn't apply an accumulated jump.
    this._pointerOld.set(this._lastClientX, this._lastClientY);
    // Two emit channels, matching the mousedown/mouseup contract:
    // `_emitModeChange` carries the coarse 'pan'/'rotate' mode the hook
    // tolerates; `_maybeEmitLbModeChange` drives the separate
    // pan-truck/pan-pedestal letterbox stream. Firing both keeps the
    // indicator and letterbox consistent after a switch.
    this._emitModeChange(desired);
    this._maybeEmitLbModeChange();
  }

  _onKeyDown(event) {
    // TASK-010 (B6): first line, before every other guard, so keydown
    // and keyup are symmetric and the Shift sync isn't swallowed by the
    // typing/modifier/WASD early returns below.
    this._syncDragModeToShift(event.shiftKey);
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
    // TASK-010 (B6): symmetric with `_onKeyDown` — same first-line sync.
    this._syncDragModeToShift(event.shiftKey);
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

  // AGL ground probe (TASK-013). Casts straight down from the camera and
  // returns the absolute world-Y of the nearest *visible street-segment*
  // surface below it (`isGroundSegmentHit`). On a miss (no scene, or no
  // accepted hit — over a gap / off the scene edge / over geo terrain)
  // holds the last-known ground (D2). Refreshes `_lastGroundY` on a hit.
  _groundYBelowCamera() {
    const camera = this._camera;
    const sceneEl = this._sceneEl;
    if (!sceneEl || !sceneEl.object3D) {
      return this._lastGroundY; // D2: hold last-known (init 0)
    }
    // D5: straight down from the camera.
    this._raycaster.set(camera.position, GROUND_PROBE_DIR);
    // Defense-in-depth: near/far default to 0/Infinity and nothing in the
    // current codebase mutates them (setFromCamera sets only
    // origin/direction/camera in three r181). Set them explicitly so a
    // future consumer that does perturb them can't silently clamp the
    // probe.
    this._raycaster.near = 0;
    this._raycaster.far = Infinity;
    const hits = this._raycaster.intersectObject(sceneEl.object3D, true);
    for (const hit of hits) {
      // near → far
      if (isGroundSegmentHit(hit)) {
        this._lastGroundY = hit.point.y; // refresh cache (D2)
        return this._lastGroundY;
      }
    }
    return this._lastGroundY; // miss → hold last-known (D2)
  }

  _drainWheel() {
    if (this._wheelBudget === 0) return;
    const unit = WHEEL_BUDGET_PER_TICK_UNITS;
    // Snapshot the ground height once per pass (TASK-013). All ticks —
    // including the recursive Phase 3 → Phase 2 → Phase 1 hand-offs — read
    // this._frameGroundY so they see a single consistent ground for the
    // frame (avoids up to 10 raycasts/frame and the cap/threshold
    // asymmetry a mid-frame re-probe would introduce).
    this._frameGroundY = this._groundYBelowCamera();
    // Per H4 of `claude/reports/007-phase-3-plan-review.md`: latch the
    // per-frame cap once at the start of the drain pass, hold for the
    // whole frame. Re-evaluating per iteration produces an asymmetric
    // speed-up at boundary crossings (Phase 2 → Phase 1 zoom-out would
    // unlock 7 extra Phase 1 ticks in the same frame the moment AGL
    // crosses 20m).
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
    const yAgl = this._camera.position.y - this._frameGroundY;
    if (decideSwoopPhase(yAgl) === 'phase2') {
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
    const yAgl = camera.position.y - this._frameGroundY;
    const phase = decideSwoopPhase(yAgl);
    if (phase === 'phase2') return this._applyPhase2WheelTick(sign);
    if (phase === 'phase3') return this._applyPhase3WheelTick(sign);
    // phase1: tilt-conditional split applies here only. The wheel cut is
    // intentionally LIVE (read instantaneous tilt each tick) — wheel and
    // LB-drag don't compose in one gesture, so it is never latched.
    if (cameraTiltDegrees(camera) <= this._tiltThreshold) {
      return this._applyLowTiltWheelTick(sign);
    }
    return this._applyPhase1WheelTick(sign);
  }

  // Phase 1 — cursor-anchored exponential dolly at high tilt + high
  // altitude. Translates the camera along the camera→anchor ray by 10%
  // of the current distance per tick. Tilt-preserving by construction.
  //
  // Boundary handling: if zoom-in pushes AGL below 20m, clamp the camera
  // to (groundY + 20) so it enters Phase 2 at 20m above the actual ground
  // (TASK-013; formerly an absolute clamp to y=10m), and latch
  // _storedTilt = current tilt (round-down model — see §"Tick energy" in
  // the plan). The next tick is Phase 2. Reads the per-pass ground
  // snapshot `this._frameGroundY`.
  _applyPhase1WheelTick(sign) {
    const camera = this._camera;
    const x = this._lastWheelClientX;
    const y = this._lastWheelClientY;
    if (x == null || y == null) return;
    const hit = this._cursorAnchor.worldPointAt(x, y);
    this._applyAnchoredDollyStep(sign, hit);

    // Boundary: Phase 1 → Phase 2 on zoom-in. Compare AGL, clamp the
    // camera to (groundY + yCeil).
    const groundY = this._frameGroundY;
    if (
      sign < 0 &&
      camera.position.y - groundY < SWOOP_PHASE2_ENTRY_ELEVATION_METRES
    ) {
      camera.position.y = groundY + SWOOP_PHASE2_ENTRY_ELEVATION_METRES;
      // Phase 1 ticks are tilt-preserving, so this matches the tilt at
      // the moment of crossing.
      this._storedTilt = cameraTiltDegrees(camera);
      camera.updateMatrixWorld();
    }
  }

  // Low-tilt branch (tilt ≤ 30° while AGL > 20m, i.e. Phase 1) and the Ctrl+wheel
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
  // Boundary handling at zoom-out is *active*, not deferred to next
  // tick. The naive "clamp at boundary, let next tick re-dispatch"
  // model deadlocks because `decideSwoopPhase(yCeil)` returns 'phase2'
  // (the table is inclusive on the Phase 2 side at y = yCeil) and the
  // next tick fires the boundary again. The active hand-off applies
  // this tick's energy in the destination phase. Found at feel-test
  // 2026-05-11.
  //
  // Runs entirely in AGL space (yAgl = camera.y − groundY), reading the
  // per-pass ground snapshot `this._frameGroundY`, and writes the result
  // back as absolute camera.y = groundY + yAglNext (TASK-013). On a flat
  // scene at y=0 this is behaviour-identical to the old absolute math
  // (modulo one cheap extra probe per pass).
  //
  // Boundary handling (all in AGL):
  //   zoom-in: yAglNext ≤ yFloor → snap to floor, tilt to 0°, latch
  //     _phase3FovBaseline. Next tick dispatches naturally to Phase 3.
  //   zoom-in: yAglNext within SWOOP_PHASE2_FLOOR_SNAP_METRES of yFloor →
  //     snap (H6).
  //   zoom-out: yAgl in [0, yFloor + snap] → kick-start to yFloor + snap.
  //     The multiplicative reciprocal `1.5 + (yAgl-1.5)/(1-α)` is zero at
  //     yAgl=yFloor exactly, so without the kick-start zoom-out from
  //     street level produces no motion. The `yAgl >= 0` lower bound
  //     suppresses a stale-cache teleport (negative AGL — see below)
  //     while preserving every legitimate fresh-probe kick-start.
  //   zoom-out: yAglNext ≥ yCeil → clamp to groundY + yCeil, set tilt to
  //     _storedTilt, hand the tick's energy to Phase 1 (recursive call).
  _applyPhase2WheelTick(sign) {
    const camera = this._camera;
    const groundY = this._frameGroundY; // pass snapshot
    const yFloor = SWOOP_PHASE2_EXIT_ELEVATION_METRES; // AGL floor 1.5
    const yCeil = SWOOP_PHASE2_ENTRY_ELEVATION_METRES; // AGL ceil 20
    const snap = SWOOP_PHASE2_FLOOR_SNAP_METRES; // 1.0

    let yAgl = camera.position.y - groundY; // ← convert in

    // Zoom-out kick-start (AGL-relative — WE-7). A FRESH downward probe
    // always yields yAgl >= 0 (the hit ground is below the camera), so
    // the `yAgl >= 0` lower bound preserves EVERY legitimate case —
    // including the saved-scene-below-floor kick-start (a camera at
    // AGL 0.5 on real ground must still kick-start). A NEGATIVE yAgl can
    // only arise from the D2 stale cache (cached ground ABOVE the camera —
    // camera over a gap, reachable via WASD-during-Phase-3 then
    // zoom-out); that is exactly the teleport case to suppress.
    if (sign > 0 && yAgl >= 0 && yAgl <= yFloor + snap) {
      yAgl = yFloor + snap;
    }

    let yAglNext = phase2NextElevation(yAgl, sign);

    // Floor snap on zoom-in (H6) — AGL-relative.
    if (sign < 0 && yAglNext - yFloor < snap) {
      yAglNext = yFloor;
    }

    // Boundary: Phase 2 → Phase 3 on zoom-in.
    if (sign < 0 && yAglNext <= yFloor) {
      camera.position.y = groundY + yFloor; // ← write back
      this._setCameraTiltPreservingYaw(0);
      this._phase3FovBaseline = camera.fov;
      camera.updateMatrixWorld();
      this._maybeEmitLbModeChange();
      return;
    }

    // Boundary: Phase 2 → Phase 1 on zoom-out. Hand the tick off
    // actively so the wheel click visibly continues past AGL=yCeil
    // rather than deadlocking at the boundary.
    if (sign > 0 && yAglNext >= yCeil) {
      camera.position.y = groundY + yCeil; // ← write back
      this._setCameraTiltPreservingYaw(this._storedTilt);
      camera.updateMatrixWorld();
      this._maybeEmitLbModeChange();
      // Now dispatch a Phase 1 tick. Phase 1 may itself route to the
      // low-tilt branch depending on _storedTilt; that's fine. Phase 1
      // reads the same `this._frameGroundY` snapshot. Uses the runtime
      // tilt threshold (TASK-010) — was TRUCK_PEDESTAL_CUTOFF_DEGREES.
      if (cameraTiltDegrees(camera) <= this._tiltThreshold) {
        return this._applyLowTiltWheelTick(sign);
      }
      return this._applyPhase1WheelTick(sign);
    }

    camera.position.y = groundY + yAglNext; // ← write back
    this._setCameraTiltPreservingYaw(
      phase2TargetTilt(yAglNext, this._storedTilt)
    );
    camera.updateMatrixWorld();
    // Toolbar visual indicator: Phase 2's tilt lerp crosses the 30°
    // boundary silently from the LB-mode comparator's perspective. Emit
    // here so the toolbar restyles in lock-step with the swoop. (Phase
    // 1 and Phase 3 are tilt-preserving, so no equivalent calls needed
    // there.)
    this._maybeEmitLbModeChange();
  }

  // Phase 3 — FOV-only zoom at street level. Camera position and tilt
  // locked; only fov changes. Multiplicative reciprocal for exact
  // reversibility. Clamped to [SWOOP_PHASE3_FOV_FLOOR_DEGREES,
  // _phase3FovBaseline].
  //
  // Boundary handling:
  //   zoom-out at fov ≥ baseline → clear _phase3FovBaseline, hand the
  //     tick off to Phase 2 (active hand-off; same dispatch-deadlock
  //     reason as Phase 2 → Phase 1 — `decideSwoopPhase(1.5)` returns
  //     'phase3' inclusively, so without active hand-off the next
  //     zoom-out tick re-latches baseline and loops). Found at
  //     feel-test 2026-05-11.
  //   _phase3FovBaseline null at entry: lazy-latch from current FOV
  //     (Phase 3 was entered without Phase 2 doing the latch — e.g.
  //     saved scene at y < yFloor).
  _applyPhase3WheelTick(sign) {
    const camera = this._camera;

    // Hand-off on zoom-out from baseline FOV. Check first so we don't
    // re-latch and loop when zoom-out continues past Phase 3.
    if (
      sign > 0 &&
      this._phase3FovBaseline != null &&
      camera.fov >= this._phase3FovBaseline
    ) {
      this._phase3FovBaseline = null;
      return this._applyPhase2WheelTick(sign);
    }

    if (this._phase3FovBaseline == null) {
      this._phase3FovBaseline = camera.fov;
    }
    const baseline = this._phase3FovBaseline;
    const floor = SWOOP_PHASE3_FOV_FLOOR_DEGREES;

    let fov;
    if (sign < 0) fov = camera.fov / (1 + ZOOM_PER_WHEEL_TICK);
    else fov = camera.fov * (1 + ZOOM_PER_WHEEL_TICK);

    if (fov < floor) fov = floor;
    if (fov > baseline) fov = baseline;
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
    // TASK-023 (deferred, latent hazard): this lookAt reads the live
    // camera.up = (0,1,0), so it (a) is singular at nadir (tiltDeg = 90 →
    // newFwd = (0,-1,0) ∥ up) and (b) rebuilds orientation with the
    // world-up roll convention, discarding any roll the camera arrived
    // with. This path is reachable from the wheel-zoom swoop
    // (_applyPhase2WheelTick), so after a rolled top-down rotate the first
    // Phase-2 wheel tick resets the preserved roll. NOT fixed here: the
    // correct screen-up for a swoop-to-street landing is a TASK-022/025
    // design question, intentionally deferred (see plan §5).
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

    // AGL height (TASK-013): scale speed by height above the ground
    // directly below the camera, from the same downward probe the swoop
    // uses. A local groundY (not this._frameGroundY) — the WASD path has
    // no recursive hand-offs, so no snapshot field is needed; the field
    // exists solely to carry the snapshot across the wheel-drain's phase
    // hand-offs. Use Math.max (NOT Math.abs): a camera above the ground
    // always has positive AGL; the only way aglRaw goes negative is the
    // camera being below the surface (the TASK-010-owned underground
    // case), where clamping to the 0.1 floor is a safe degenerate.
    const groundY = this._groundYBelowCamera();
    const aglRaw = camera.position.y - groundY;
    const height = Math.max(0.1, aglRaw);
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

  // --- TASK-010 rotation regime (two-way, latched at gesture start) ---

  // Pick the rotation pivot from the live tilt and the cursor position,
  // and latch it for the whole rotate sub-gesture. Two regimes split on
  // T (D2):
  //   Map (tilt > T):    orbit the world point under the cursor (D7
  //                      fallback chain + D5/far-cap clamp). Show the
  //                      ring on that point (D3).
  //   Street (tilt ≤ T): rotate in place around the camera's own
  //                      position. No ring (D6).
  // The regime and the ring are LATCHED here at sub-gesture start; the
  // letterbox is driven separately by LIVE tilt (`_maybeEmitLbModeChange`),
  // so mid-drag the two can disagree by design (see plan §4b / worked
  // examples 3 & 4). Do NOT wire the ring off live tilt.
  _latchRotationCenter(camera, clientX, clientY) {
    const tiltDeg = cameraTiltDegrees(camera);
    const isMap = tiltDeg > this._tiltThreshold;
    const center = isMap
      ? this._mapModePivot(clientX, clientY) // bounds sphere + D-LT-3 fallback
      : camera.position.clone(); // street: rotate-in-place
    this._latch.start({
      mode: 'rotate',
      center,
      regime: isMap ? 'map' : 'street'
    });
    if (isMap) {
      this._indicator.show(center); // D3
      // Set the ring's apparent size for the latched pivot *now*, on the
      // same frame as show(). `show()` only sets position + visibility;
      // without this, the first rendered frame (before the first
      // mousemove drives `_shiftRotate`→`update`) uses the previous
      // gesture's scale, which flashes the ring at the wrong size
      // (reports/010-testing.md — "circle briefly flashes up massive").
      this._indicator.update(camera);
    } else {
      this._indicator.hide(); // D6
    }
  }

  // Map-mode pivot. The fallback rotation centre is the screen-centre
  // ground point `sc` (where the view ray meets y=0). The "bounds" is a
  // circle on the ground CENTRED ON `sc`, radius `_mapPivotBoundsRadius`:
  //   • cursor's ground/mesh hit within that radius of `sc` → orbit the
  //     cursor's point (rigid orbit keeps it pinned under the cursor).
  //   • cursor over sky, OR its hit beyond the radius from `sc` → orbit
  //     `sc` itself (the ring sits there).
  // Both pivots are on the ground (y=0), so rotation visibly pivots a
  // ground feature. (Ideally the pivot's height would be true ground
  // level rather than y=0 — that is TASK-018, gated on the AGL work in
  // TASK-013/019, not yet landed.)
  //
  // History: replaced (a) the MAX_ORBIT_RADIUS inward cap along the
  // cursor ray, which drifted on tilt when zoomed out (#7); and (b) a
  // fixed-distance point straight ahead, which sat off the ground and
  // read as rotating about the cursor. The bounds centre is `sc`, not the
  // camera nadir/position. Orbiting a far pivot at a shallow
  // ground-skimming angle is otherwise prevented by the two-regime split
  // (below the tilt threshold, rotation is in-place about the camera), so
  // in Map mode (tilt > T, looking down) the view ray always meets y=0.
  _mapModePivot(clientX, clientY) {
    const camPos = this._camera.position;
    const fwd = this._tmpV3c;
    this._camera.getWorldDirection(fwd); // unit view direction
    // Screen-centre ground point: bounds centre AND fallback pivot.
    const sc = this._viewRayGroundPoint(camPos, fwd);
    const hit = this._cursorAnchor.worldPointAt(clientX, clientY);
    let p = sc;
    if (sc && hit.source !== 'fallback') {
      // Cursor hit a mesh OR the ground plane: orbit it if it lies within
      // the bounds radius of the screen-centre point (horizontal ground
      // distance).
      const candidate = new THREE.Vector3(hit.x, hit.y, hit.z);
      const groundDist = Math.hypot(candidate.x - sc.x, candidate.z - sc.z);
      if (groundDist <= this._mapPivotBoundsRadius) {
        p = candidate;
      }
    }
    if (!p) {
      // Defensive: no ground intersection ahead (view at/above the
      // horizon — not normally reachable in Map mode) and no cursor
      // ground hit. Drop a fixed-distance-ahead point to the ground.
      const d = this._mapPivotBoundsRadius;
      p = new THREE.Vector3(camPos.x + fwd.x * d, 0, camPos.z + fwd.z * d);
    }
    // maxR = Infinity → no inward cap; MIN still guards a twitchy
    // very-close pivot.
    return clampOrbitRadius(
      camPos,
      p,
      MIN_ORBIT_RADIUS_METRES,
      Infinity,
      fwd
    );
  }

  // The point where the camera's view-direction ray meets the ground
  // plane y=0, or null if it points at/above the horizon. Pure given the
  // camera position + unit view direction.
  _viewRayGroundPoint(camPos, fwd) {
    if (fwd.y >= -1e-4) return null;
    const t = camPos.y / -fwd.y; // along-ray distance to y=0
    return new THREE.Vector3(camPos.x + fwd.x * t, 0, camPos.z + fwd.z * t);
  }

  // --- Shift+LB orbit/tilt around latched center ---

  // Shift+LB rotation step. Rigid orbit about the latched centre: a
  // single yaw+pitch rotation is applied to both the camera's
  // position-offset-from-centre and its view direction, so the latched
  // pivot stays pinned on screen (under the cursor) at any tilt. In the
  // Street regime the centre is the camera position, so the offset is
  // zero and this degrades to rotate-in-place. Math lives in
  // navMath.shiftRotateStep.
  _shiftRotate(dxPx, dyPx) {
    const camera = this._camera;
    const center = this._latch.get('center');
    if (!center) return;

    const fwd = this._tmpV3c;
    camera.getWorldDirection(fwd); // unit, camera -Z in world space
    // Camera's screen-right axis (local +X in world space). Used by
    // shiftRotateStep as the pitch axis only at exact nadir, where
    // `view × up` degenerates — lets tilt work out of top-down (TASK-023).
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(
      camera.quaternion
    );
    let { pos, lookTarget, R } = shiftRotateStep({
      camPos: camera.position,
      viewDir: fwd,
      centre: center,
      dxPx,
      dyPx,
      speed: this.rotationSpeed,
      camRight
    });

    // TASK-010 (D4): underground guard, only in the Map-orbit regime.
    // Street-mode rotate is rotate-in-place (pos === camPos, no vertical
    // motion), so the floor is only meaningful there. `applyGroundFloor`
    // re-projects onto the orbit sphere (centre = latched pivot) rather
    // than flattening pos.y, so the radius is preserved and the next
    // move's `shiftRotateStep` (which re-derives the offset from
    // camera.position) doesn't see a shrunken orbit (no inward spiral).
    if (this._latch.get('regime') === 'map') {
      ({ pos, lookTarget } = applyGroundFloor(
        pos,
        lookTarget,
        center,
        ROTATION_GROUND_FLOOR_METRES
      ));
    }

    camera.position.copy(pos);
    // TASK-023: apply the step's rotation as an orientation delta instead
    // of re-deriving it via lookAt(lookTarget). lookAt rebuilds the basis
    // from camera.up = (0,1,0), which is singular at nadir (forward ∥ up)
    // → roll snaps to an arbitrary value (the ~90°/135° jump). premultiply
    // is continuous everywhere and preserves the inherited roll. R is the
    // same rotation shiftRotateStep applied to pos/lookTarget, so position
    // and orientation stay locked. applyGroundFloor (map regime) is a pure
    // translation that leaves the view direction bit-identical, so this is
    // unconditional — no floored/non-floored branch needed.
    camera.quaternion.premultiply(R);
    camera.quaternion.normalize(); // guard against drift over a long drag (A1)
    // `this.center` (EditorControls API field) reflects the orbit
    // anchor — distance-from-camera reference used by ActionBar / wheel
    // zoom. Use the latched rotation centre in the orbit case; for the
    // rotate-in-place case (centre coincides with camera) `pos === camPos`
    // and the latched centre equals camera position anyway.
    this.center.copy(center);
    camera.updateMatrixWorld();
    // TASK-010 (D3): billboard the ring as the camera orbits. No-op when
    // the ring is hidden (Street regime / not rotating).
    this._indicator.update(camera);
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
