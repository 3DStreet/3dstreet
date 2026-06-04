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
//     (`_collisionFloorAt`, TASK-013/024 — collision floor incl. building
//     roofs + tiles); on a flat scene at y=0 this equals absolute camera.y:
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
import { CursorAnchor, isSolidFloorHit, worldHitNormal } from './cursorAnchor.js';
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
  COMPASS_ROTATE_STEP_DEGREES,
  EYE_MARGIN_METRES,
  WASD_CAMERA_RADIUS_METRES,
  ENCLOSURE_PROBE_UP_MARGIN_METRES,
  FALL_DURATION_MS,
  POP_TO_ROOF_DURATION_MS
} from './constants.js';
import {
  cameraTiltDegrees,
  decideLbMode,
  decideDragModeSwitch,
  clampOrbitRadius,
  computeLowTiltWheelHit,
  shiftRotateStep,
  decideSwoopPhase,
  phase2TargetTilt,
  phase2NextElevation,
  classifyWasdStep,
  classifyFallAction,
  isLegitPose,
  cueState
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
// frozen constant so the per-frame floor / enclosure probes do not
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
    // set at the top of each _drainWheel pass from _collisionFloorAt()
    // (TASK-024 — the collision floor, so the swoop lands on roofs).
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

    // TASK-024 recovery state.
    //   _recoveryActive — "a recovery tween owns the camera" flag (D2).
    //     While set, _drainWASD/_drainWheel suspend, the legit snapshot is
    //     suppressed, _handleFallKey early-returns, and a fresh mousedown
    //     aborts the tween (N4).
    //   _lastLegitPose — { position, quaternion, center } running snapshot
    //     of the most-recent legit camera pose (D3 includes center).
    //   _lastWasdBlocked — WASD block hysteresis carry (WE-3b).
    //   _cueShown — discoverability-cue shown state for the show/hide
    //     hysteresis comparator (D7).
    this._recoveryActive = false;
    this._lastLegitPose = null;
    this._lastWasdBlocked = false;
    this._cueShown = false;

    // CR-D1: idle-gate cache for the per-frame enclosure probe. A stationary
    // camera's enclosure/legit/cue state cannot change, so the whole-scene
    // recursive raycast in _updateLegitSnapshotAndCue is skipped when the
    // pose hasn't moved since last evaluation AND no input/tween is active.
    // Null until the first tick evaluates (so tick 1 always runs).
    this._lastEvalPos = null;
    this._lastEvalQuat = null;

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
    // TASK-024 (D4): invalidate the legit-pose snapshot so a subsequent
    // recovery never tweens back to the pre-reset pose. It re-seeds on the
    // next legit tick.
    this._lastLegitPose = null;
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
        // TASK-024 (D4): reseed the legit-pose snapshot from the committed
        // plan-view pose so recovery can never ease back to a pre-teleport
        // pose.
        this._reseedLegitPose();
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
        // TASK-024 (D4): reseed the legit-pose snapshot once the focus
        // (double-click teleport) animation has settled, so recovery can't
        // ease back to the pre-teleport pose. The component sets
        // `transitioning = false` on its final frame.
        if (this._focusAnimation && !this._focusAnimation.transitioning) {
          this._reseedLegitPose();
        }
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

    // TASK-024 (N4): a fresh press mid-recovery-tween would otherwise start
    // a drag that fights the still-running tween. Policy: abort the
    // recovery (cancel the tween, clear the flag) and let the new drag take
    // over. The aborted tween's onDone doesn't run, so its reseed is
    // skipped — the next legit tick reseeds normally.
    if (this._recoveryActive) {
      this._tick.cancel();
      this._recoveryActive = false;
    }

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
    let endedMode = null;
    if (this._latch.isActive()) {
      // TASK-024 (N1): capture the gesture `mode` BEFORE `_latch.end()`,
      // which nulls the latch's value bag (so `_latch.get('mode')` returns
      // undefined afterward). Used for the gesture-end recovery decision.
      endedMode = this._latch.get('mode');
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

    // TASK-024 (3b): gesture-end correction — the one bounded automatic
    // motion the principle allows. If a camera-drag (pan/rotate) ended with
    // the camera inside a building (not legit), ease it back to the most
    // recent legit pose (or pop to the roof if none / no longer valid).
    if (
      (endedMode === 'pan' || endedMode === 'rotate') &&
      !this._recoveryActive
    ) {
      this._maybeRecoverAtGestureEnd();
    }
  }

  // TASK-024 (3b): if the current pose isn't legit, tween back to the
  // stored legit pose (re-validated against current geometry — H-C), else
  // pop to the roof.
  _maybeRecoverAtGestureEnd() {
    const camera = this._camera;
    const probe = this._enclosureProbe();
    const legitNow = isLegitPose({
      enclosed: probe.enclosed,
      camY: camera.position.y,
      floorY: probe.floorY
    });
    if (legitNow) return; // gesture ended clear — nothing to do.

    const stored = this._lastLegitPose;
    if (stored && this._poseStillLegit(stored)) {
      this._tweenToPose(stored, FALL_DURATION_MS);
    } else {
      this._popToRoof();
    }
  }

  // TASK-024 (3b): re-validate a stored pose against CURRENT geometry (a
  // tile may have streamed in around it). Probes enclosure + the collision
  // floor at the stored position.
  _poseStillLegit(pose) {
    // Probe at the stored position: a one-off downward cast from above it.
    const sceneEl = this._sceneEl;
    if (!sceneEl || !sceneEl.object3D) return true;
    const p = pose.position;
    this._tmpV3a.set(p.x, p.y + ENCLOSURE_PROBE_UP_MARGIN_METRES, p.z);
    this._raycaster.set(this._tmpV3a, GROUND_PROBE_DIR);
    this._raycaster.near = 0;
    this._raycaster.far = Infinity;
    const hits = this._raycaster.intersectObject(sceneEl.object3D, true);
    let enclosed = false;
    let floorY = null;
    for (const hit of hits) {
      if (!isSolidFloorHit(hit)) continue;
      if (hit.point.y > p.y + 1e-3) {
        enclosed = true;
        break;
      } else if (floorY == null) {
        floorY = hit.point.y;
      }
    }
    return isLegitPose({ enclosed, camY: p.y, floorY });
  }

  // TASK-024 (3b): tween the camera back to a stored pose (position +
  // quaternion + center). Sets `_recoveryActive` for the tween's life. On
  // done, reseeds `_lastLegitPose` from the committed pose (D4).
  _tweenToPose(pose, durationMs) {
    const camera = this._camera;
    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();
    const startCenter = this.center.clone();
    const endPos = pose.position.clone();
    const endQuat = pose.quaternion.clone();
    const endCenter = pose.center.clone();
    this._recoveryActive = true;
    // CR-D2: single mid-tween hand-off latch. If a tile streams in during
    // the ease-back so the stored target is no longer legit, cancel and
    // pop to the roof — once, not a per-frame retarget loop.
    let handedOff = false;
    this._tick.animate({
      durationMs,
      onTick: (eased) => {
        // CR-D2: re-validate the stored TARGET against current geometry
        // each tick (cheap — the same short probe used at tween start). A
        // newly-streamed tile can render the target no longer legit; hand
        // off to _popToRoof exactly once.
        if (!handedOff && !this._poseStillLegit(pose)) {
          handedOff = true;
          this._tick.cancel();
          this._recoveryActive = false;
          this._popToRoof();
          return;
        }
        camera.position.lerpVectors(startPos, endPos, eased);
        camera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        this.center.lerpVectors(startCenter, endCenter, eased);
        camera.updateMatrixWorld();
        this.dispatchEvent(this._changeEvent);
      },
      onDone: () => {
        camera.position.copy(endPos);
        camera.quaternion.copy(endQuat);
        this.center.copy(endCenter);
        camera.updateMatrixWorld();
        this._recoveryActive = false;
        this._reseedLegitPose();
        this.dispatchEvent(this._changeEvent);
      }
    });
  }

  // TASK-024 (D4): reseed `_lastLegitPose` from the current committed pose.
  // Called at the onDone of every pose-setting tween so recovery can never
  // ease back to a pre-teleport pose.
  _reseedLegitPose() {
    const camera = this._camera;
    this._lastLegitPose = {
      position: camera.position.clone(),
      quaternion: camera.quaternion.clone(),
      center: this.center.clone()
    };
  }

  // TASK-024 (3c): pop-to-daylight. One up-ray collects accepted overhead
  // solids in the camera column; target just above the HIGHEST one
  // (+ EYE_MARGIN) so a single press clears a multi-slab / nested stack
  // (D6). Vertical only (preserve yaw/pitch). Probe-miss → no-op (don't
  // bury at a stale height).
  _popToRoof() {
    const camera = this._camera;
    const probe = this._enclosureProbe();
    if (!probe.overheadHits.length) {
      // Nothing overhead — nothing to pop out of. No-op.
      this._recoveryActive = false;
      return;
    }
    const topY = probe.overheadHits[probe.overheadHits.length - 1];
    let targetY = topY + EYE_MARGIN_METRES;
    if (targetY <= camera.position.y) {
      this._recoveryActive = false;
      return;
    }
    const startY = camera.position.y;
    const startCenterY = this.center.y;
    this._recoveryActive = true;
    // CR-D2: single mid-tween retarget. If a higher overhead slab streams
    // in during the pop, the original target would surface still enclosed;
    // raise the target once (a single hand-off — guarded by a small
    // threshold so it can't oscillate).
    const RETARGET_EPS = 0.1; // metres
    let retargeted = false;
    this._tick.animate({
      durationMs: POP_TO_ROOF_DURATION_MS,
      onTick: (eased) => {
        if (!retargeted) {
          const reprobe = this._enclosureProbe();
          if (reprobe.overheadHits.length) {
            const newTop =
              reprobe.overheadHits[reprobe.overheadHits.length - 1] +
              EYE_MARGIN_METRES;
            if (newTop > targetY + RETARGET_EPS) {
              targetY = newTop;
              retargeted = true;
            }
          }
        }
        const y = startY + (targetY - startY) * eased;
        camera.position.y = y;
        this.center.y = startCenterY + (y - startY);
        camera.updateMatrixWorld();
        this.dispatchEvent(this._changeEvent);
      },
      onDone: () => {
        camera.position.y = targetY;
        this.center.y = startCenterY + (targetY - startY);
        camera.updateMatrixWorld();
        this._recoveryActive = false;
        this._reseedLegitPose();
        this.dispatchEvent(this._changeEvent);
      }
    });
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
      return;
    }

    // TASK-024 (3d): Space — discrete fall/pop action (not a held key).
    if (k === 'Space') {
      event.preventDefault(); // stop page scroll
      // Don't pre-empt a plan-view/compass tween (would strand
      // _planViewActive / _compassAnimating with its onDone unrun) or
      // interrupt a recovery tween in flight (D2).
      if (this._isInactive() || this._tick.isAnimating()) return;
      this._handleFallKey();
    }
  }

  // TASK-024 (3d): Space fall/pop. Context-sensitive, evaluated in
  // precedence order (states overlap, so order is load-bearing — WE-8b):
  //   1. enclosed         -> pop up to daylight (wins regardless of tilt)
  //   2. elevated + down  -> swoop down to the surface
  //   3. elevated + ~horiz-> fall straight down to the surface
  //   no surface below    -> no-op
  // Each tween below owns `_recoveryActive` (set on start, cleared in
  // onDone).
  _handleFallKey() {
    // First line (D2): a recovery tween owns the camera.
    if (this._recoveryActive) return;
    const camera = this._camera;
    const probe = this._enclosureProbe();
    const tiltDeg = cameraTiltDegrees(camera);
    const action = classifyFallAction({
      enclosed: probe.enclosed,
      camY: camera.position.y,
      floorY: probe.floorY,
      tiltDeg
    });
    if (action === 'pop') {
      this._popToRoof();
      return;
    }
    if (action === 'noop') return;
    // 'swoop' and 'fall' both descend vertically to collisionFloor +
    // EYE_MARGIN. Faithful low-risk reuse of the _tick.animate tween (avoids
    // wheel-drain re-entrancy). For 'swoop' the tilt is lerped toward
    // horizontal during the descent; 'fall' preserves orientation.
    const floorY = probe.floorY;
    if (floorY == null) return; // streaming miss — hold
    const targetY = floorY + EYE_MARGIN_METRES;
    if (targetY >= camera.position.y) return; // already at/below — no-op
    this._fallTo(targetY, action === 'swoop');
  }

  // TASK-024 (3d): vertical descent tween to `targetY`. When `levelOut`,
  // lerp the camera tilt toward horizontal during the descent (swoop feel);
  // otherwise preserve orientation (straight fall). Owns `_recoveryActive`.
  _fallTo(targetY, levelOut) {
    const camera = this._camera;
    const startY = camera.position.y;
    const startCenterY = this.center.y;
    const startQuat = camera.quaternion.clone();
    let endQuat = null;
    if (levelOut) {
      // Build a level (tilt=0) target orientation preserving yaw. The level
      // look is independent of the target height, so a mid-fall retarget of
      // `targetY` (CR-D2) leaves this orientation valid.
      const scratch = new THREE.PerspectiveCamera();
      scratch.position.set(camera.position.x, targetY, camera.position.z);
      const fwd = new THREE.Vector3();
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      scratch.lookAt(
        camera.position.x + fwd.x,
        targetY,
        camera.position.z + fwd.z
      );
      endQuat = scratch.quaternion.clone();
    }
    this._recoveryActive = true;
    // CR-D2: single mid-fall retarget. If a closer solid surface streams in
    // ABOVE the original floor target during the descent, halt higher so the
    // camera doesn't sink through it. One hand-off — guarded by a threshold
    // so it can't oscillate. The level-out orientation above stays valid.
    const RETARGET_EPS = 0.1; // metres
    let retargeted = false;
    this._tick.animate({
      durationMs: FALL_DURATION_MS,
      onTick: (eased) => {
        if (!retargeted) {
          const floor = this._collisionFloorAt(
            camera.position.x,
            camera.position.z
          );
          if (floor.source !== 'cache') {
            const newTarget = floor.y + EYE_MARGIN_METRES;
            // A higher floor than the original target, still below the
            // camera's current y: clamp the descent to it (single hand-off).
            if (
              newTarget > targetY + RETARGET_EPS &&
              newTarget < camera.position.y
            ) {
              targetY = newTarget;
              retargeted = true;
            }
          }
        }
        const y = startY + (targetY - startY) * eased;
        camera.position.y = y;
        this.center.y = startCenterY + (y - startY);
        if (endQuat) camera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        camera.updateMatrixWorld();
        this.dispatchEvent(this._changeEvent);
      },
      onDone: () => {
        camera.position.y = targetY;
        this.center.y = startCenterY + (targetY - startY);
        if (endQuat) camera.quaternion.copy(endQuat);
        camera.updateMatrixWorld();
        this._recoveryActive = false;
        this._reseedLegitPose();
        this._maybeEmitLbModeChange();
        this.dispatchEvent(this._changeEvent);
      }
    });
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
    // TASK-024 (3b/3e): legit-pose snapshot + discoverability cue. Runs
    // after the drains so it captures the post-move pose. Suppressed while
    // a recovery tween owns the camera (D2).
    if (!this._recoveryActive) {
      this._updateLegitSnapshotAndCue();
    }
  }

  // TASK-024 (3b/3e): refresh `_lastLegitPose` if the current pose is
  // legit, and emit the discoverability cue on a show/hide transition. One
  // enclosure up-ray (double duty: enclosure + collision floor under the
  // camera) per call.
  _updateLegitSnapshotAndCue() {
    const camera = this._camera;

    // CR-D1: idle gate. A motionless camera with no active input/gesture/
    // tween cannot change its enclosure/legit/cue state, so skip the
    // whole-scene recursive enclosure raycast and let the cached cue/legit
    // result stand. Evaluate when ANY of: the pose moved since last eval
    // (within EPS), WASD velocity is non-zero, wheel budget is pending, a
    // drag is latched, a tween is animating, or there is no cache yet (the
    // first tick). Cache is refreshed below whenever we do evaluate.
    const POS_EPS_SQ = 1e-8; // ~1e-4 m
    const QUAT_EPS = 1e-6; // 1 - |dot| threshold
    const moved =
      this._lastEvalPos == null ||
      this._lastEvalQuat == null ||
      camera.position.distanceToSquared(this._lastEvalPos) > POS_EPS_SQ ||
      1 - Math.abs(camera.quaternion.dot(this._lastEvalQuat)) > QUAT_EPS;
    const busy =
      this._wasdVelocity.lengthSq() > 0 ||
      this._wheelBudget !== 0 ||
      this._latch.isActive() ||
      this._tick.isAnimating();
    if (!moved && !busy) return;

    // Update the eval-pose cache (this evaluation establishes the new
    // baseline a subsequent stationary frame compares against).
    if (this._lastEvalPos == null) {
      this._lastEvalPos = camera.position.clone();
      this._lastEvalQuat = camera.quaternion.clone();
    } else {
      this._lastEvalPos.copy(camera.position);
      this._lastEvalQuat.copy(camera.quaternion);
    }

    const probe = this._enclosureProbe();
    const camY = camera.position.y;
    const legit = isLegitPose({
      enclosed: probe.enclosed,
      camY,
      floorY: probe.floorY
    });
    if (legit) {
      if (!this._lastLegitPose) {
        this._lastLegitPose = {
          position: camera.position.clone(),
          quaternion: camera.quaternion.clone(),
          center: this.center.clone()
        };
      } else {
        this._lastLegitPose.position.copy(camera.position);
        this._lastLegitPose.quaternion.copy(camera.quaternion);
        this._lastLegitPose.center.copy(this.center);
      }
    }
    // Discoverability cue (D7): keyed off height above the collision floor
    // below, with show/hide hysteresis; enclosure forces show.
    const agl = probe.floorY != null ? camY - probe.floorY : 0;
    const nextShown = cueState(this._cueShown, agl, probe.enclosed);
    if (nextShown !== this._cueShown) {
      this._cueShown = nextShown;
      if (nextShown) {
        this._emitRecoveryCue(probe.enclosed ? 'enclosed' : 'drop');
      } else {
        this._emitRecoveryCue(null);
      }
    }
  }

  // TASK-024 (3e): emit a transient recovery cue on the sceneEl bus,
  // mirroring `_emitModeChange`. `kind` is 'enclosed' | 'drop' to show, or
  // null to hide.
  _emitRecoveryCue(kind) {
    const event = { type: 'nav-experimental:recovery-cue', kind };
    this.dispatchEvent(event);
    if (this._sceneEl && this._sceneEl.emit) {
      this._sceneEl.emit('nav-experimental:recovery-cue', { kind }, false);
    }
  }

  // TASK-024 (1b): downward floor probe at an arbitrary XZ column. Casts
  // (0,-1,0) from (x, camera.y, z), classifies each hit, and picks the
  // nearest segment-or-building hit (priority) else the nearest tiles hit
  // (TASK-019 D3 — a tiles rooftop must never beat a lower segment). Honours
  // `acceptBuildings` / `acceptTiles` flags so the travel-height query can
  // exclude buildings. Returns { y, normal, source, hit } (hit = the raw
  // intersection for normal extraction). On a miss returns the last-known
  // ground cache with source 'cache'. When `refreshCache` is set, a hit
  // updates `_lastGroundY` (D2 continuity).
  _floorYBelowAt(x, z, opts = {}) {
    const camera = this._camera;
    const sceneEl = this._sceneEl;
    const acceptBuildings = opts.acceptBuildings !== false;
    const acceptTiles = opts.acceptTiles !== false;
    if (!sceneEl || !sceneEl.object3D) {
      return { y: this._lastGroundY, normal: null, source: 'cache', hit: null };
    }
    this._tmpV3a.set(x, camera.position.y, z);
    this._raycaster.set(this._tmpV3a, GROUND_PROBE_DIR);
    this._raycaster.near = 0;
    this._raycaster.far = Infinity;
    const hits = this._raycaster.intersectObject(sceneEl.object3D, true);
    const pick = this._pickFloorFromHits(hits, Infinity, {
      acceptBuildings,
      acceptTiles
    });
    if (pick) {
      if (opts.refreshCache) this._lastGroundY = pick.hit.point.y;
      return {
        y: pick.hit.point.y,
        normal: worldHitNormal(pick.hit),
        source: pick.source,
        hit: pick.hit
      };
    }
    return { y: this._lastGroundY, normal: null, source: 'cache', hit: null };
  }

  // TASK-024 (TASK-019 D3): the SHARED floor-priority picker. Given a
  // near→far hit list and a reference height `refY` (only hits at/below
  // refY + epsilon are floor candidates), return the priority floor:
  //   { hit, source: 'segment-or-building' } — nearest accepted
  //     segment/building below refY, if any; else
  //   { hit, source: 'tiles' } — nearest accepted tiles hit below refY;
  //   else null.
  // A tiles rooftop must never beat a lower segment/building, even when the
  // tiles hit is nearer. Reused by `_floorYBelowAt` (the WASD/swoop floor)
  // and `_enclosureProbe` (the enclosure floor) so consumers — isLegitPose,
  // the cue, _handleFallKey — read the SAME floor the swoop/WASD path does.
  _pickFloorFromHits(hits, refY, { acceptBuildings, acceptTiles }) {
    const ceil = refY === Infinity ? Infinity : refY + 1e-3;
    let tilesHit = null;
    for (const hit of hits) {
      if (hit.point.y > ceil) continue; // overhead — not a floor candidate
      if (isSolidFloorHit(hit, { acceptBuildings, acceptTiles: false })) {
        return { hit, source: 'segment-or-building' };
      }
      if (
        acceptTiles &&
        !tilesHit &&
        isSolidFloorHit(hit, { acceptBuildings: false, acceptTiles: true })
      ) {
        tilesHit = hit;
      }
    }
    if (tilesHit) return { hit: tilesHit, source: 'tiles' };
    return null;
  }

  // TASK-024: collision floor at an XZ column — nearest solid surface
  // (ground OR building roof OR tiles), scatter excluded. Used by the
  // descent clamp, swoop, orbit clamp, WASD destination, enclosure floor.
  _collisionFloorAt(x, z) {
    return this._floorYBelowAt(x, z, {
      acceptBuildings: true,
      acceptTiles: true,
      refreshCache: true
    });
  }

  // TASK-024: travel-height floor below the camera (WASD fly-speed only).
  //   3DStreet: nearest segment-only hit (buildings see-through — B4 speed
  //     rationale preserved).
  //   Tiles (no separable ground): the MINIMUM collision-floor y over a
  //     small fixed grid below the camera, approximating the street/ground
  //     between roofs so speed doesn't crawl over a single roof.
  _travelHeightFloorYBelow() {
    const cx = this._camera.position.x;
    const cz = this._camera.position.z;
    // Segment-only first (3DStreet land-floor).
    const seg = this._floorYBelowAt(cx, cz, {
      acceptBuildings: false,
      acceptTiles: false,
      refreshCache: false
    });
    if (seg.source === 'segment-or-building') return seg.y;
    // No segment ground — tiles regime. Sample a small 3×3 grid (±2 m) and
    // take the lowest collision floor (the low point ≈ street/ground).
    // Perf worst-case: this 3×3 grid is the ~9-ray path, reached only while
    // WASD is held over tiles (no street segment below); the common
    // segment-below case early-returns above after a single ray.
    const SPAN = 2;
    let minY = Infinity;
    let any = false;
    for (let ix = -1; ix <= 1; ix++) {
      for (let iz = -1; iz <= 1; iz++) {
        const f = this._floorYBelowAt(cx + ix * SPAN, cz + iz * SPAN, {
          acceptBuildings: true,
          acceptTiles: true,
          refreshCache: false
        });
        if (f.source !== 'cache') {
          any = true;
          if (f.y < minY) minY = f.y;
        }
      }
    }
    return any ? minY : this._lastGroundY;
  }

  // TASK-024 (3a): enclosure / overhead probe. Casts (0,-1,0) from
  // (camera.x, camera.y + UP_MARGIN, camera.z), filtered by isSolidFloorHit.
  // Any accepted hit with point.y > camera.y means solid overhead →
  // enclosed; the nearest accepted hit with point.y <= camera.y is the
  // collision floor (one ray, double duty). Returns
  // { enclosed, floorY, overheadHits } — overheadHits is the raw array of
  // accepted hits above the camera, sorted ascending by y, so _popToRoof can
  // pick the highest exit face (D6/N7).
  _enclosureProbe() {
    const camera = this._camera;
    const sceneEl = this._sceneEl;
    if (!sceneEl || !sceneEl.object3D) {
      return { enclosed: false, floorY: null, overheadHits: [] };
    }
    const camY = camera.position.y;
    this._tmpV3a.set(
      camera.position.x,
      camY + ENCLOSURE_PROBE_UP_MARGIN_METRES,
      camera.position.z
    );
    this._raycaster.set(this._tmpV3a, GROUND_PROBE_DIR);
    this._raycaster.near = 0;
    this._raycaster.far = Infinity;
    const hits = this._raycaster.intersectObject(sceneEl.object3D, true);
    const overhead = [];
    for (const hit of hits) {
      if (!isSolidFloorHit(hit)) continue;
      if (hit.point.y > camY + 1e-3) {
        overhead.push(hit.point.y);
      }
    }
    overhead.sort((a, b) => a - b);
    // CR-D3: route the floor selection through the SAME priority picker as
    // the WASD/swoop path (_collisionFloorAt → _floorYBelowAt). The old
    // "nearest accepted hit at/below the camera" could return a tiles
    // rooftop where a lower segment/building sits below it (TASK-019 D3),
    // making isLegitPose / the cue / _handleFallKey read a different floor
    // than the swoop. refY = camY so only hits at/below the camera count.
    const pick = this._pickFloorFromHits(hits, camY, {
      acceptBuildings: true,
      acceptTiles: true
    });
    const floorY = pick ? pick.hit.point.y : null;
    return { enclosed: overhead.length > 0, floorY, overheadHits: overhead };
  }

  _drainWheel() {
    // TASK-024 (D2): a recovery tween owns the camera — drop queued wheel.
    if (this._recoveryActive) {
      this._wheelBudget = 0;
      return;
    }
    if (this._wheelBudget === 0) return;
    const unit = WHEEL_BUDGET_PER_TICK_UNITS;
    // Snapshot the ground height once per pass (TASK-013 → TASK-024). All
    // ticks — including the recursive Phase 3 → Phase 2 → Phase 1 hand-offs
    // — read this._frameGroundY so they see a single consistent ground for
    // the frame. TASK-024: the swoop now reads the COLLISION floor (ground
    // OR building roof OR tiles), so a swoop over a building lands on the
    // roof (WE-2 / C5 — the B4 reversal falls out of the wider floor).
    this._frameGroundY = this._collisionFloorAt(
      this._camera.position.x,
      this._camera.position.z
    ).y;
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
    camera.lookAt(target);
  }

  _drainWASD(deltaMs) {
    const camera = this._camera;
    // TASK-024 (D2): a recovery tween owns the camera — held keys must not
    // fight it. Snap velocity to zero and suspend.
    if (this._recoveryActive) {
      this._wasdVelocity.set(0, 0, 0);
      return;
    }
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

    // Target velocity: unit direction × height-scaled speed. Copy out of
    // the scratch vector — the classifier raycasts below reuse _tmpV3a/b/c.
    this._tmpV3c.set(0, 0, 0);
    this._tmpV3c.addScaledVector(forward, fwd);
    this._tmpV3c.addScaledVector(right, strafe);
    this._tmpV3c.normalize();
    const targetDirX = this._tmpV3c.x;
    const targetDirZ = this._tmpV3c.z;

    // TASK-024: WASD fly-speed scales by TRAVEL HEIGHT (height above the
    // land/ground beneath buildings), NOT the collision floor — so speed
    // doesn't crawl over a building roof (B4 speed rationale; TASK-013 WE-4).
    const groundY = this._travelHeightFloorYBelow();
    const aglRaw = camera.position.y - groundY;
    const height = Math.max(0.1, aglRaw);
    const targetSpeed = THREE.MathUtils.clamp(
      height * WASD_SPEED_HEIGHT_FACTOR,
      WASD_MIN_SPEED,
      WASD_MAX_SPEED
    );
    const targetVel = new THREE.Vector3(targetDirX, 0, targetDirZ).multiplyScalar(
      targetSpeed
    );

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

    // TASK-024 (2b): forward-ray step classifier. Decide block / step-up /
    // follow / hover from the surface geometry ahead before committing the
    // horizontal move + any y change.
    const stepThisFrame = Math.hypot(move.x, move.z);
    const outcome = this._classifyWasdMove(targetDirX, targetDirZ, stepThisFrame);

    if (outcome.kind === 'block') {
      // Stop at the wall: cancel the horizontal step, snap velocity to 0,
      // don't advance the centre.
      this._wasdVelocity.set(0, 0, 0);
      this._lastWasdBlocked = true;
      return;
    }
    this._lastWasdBlocked = false;

    // Apply the horizontal move.
    camera.position.x += move.x;
    camera.position.z += move.z;
    this.center.x += move.x;
    this.center.z += move.z;

    if (outcome.kind === 'step-up' || outcome.kind === 'follow') {
      // Mount / track the surface at eye height (up AND down — WE-4).
      const newY = outcome.floorDestY + EYE_MARGIN_METRES;
      const dy = newY - camera.position.y;
      camera.position.y = newY;
      this.center.y += dy;
    }
    // 'hover' holds y (no plunge — WE-5); centre y unchanged.

    camera.updateMatrixWorld();
    this.dispatchEvent(this._changeEvent);
  }

  // TASK-024 (2b): run the WASD forward-ray + destination-floor probes and
  // classify the step. Returns { kind, floorDestY }. `kind` is
  // 'block' | 'step-up' | 'follow' | 'hover'. Gated to held-WASD-with-input
  // (the caller only invokes it inside the hasInput branch), so idle frames
  // cost nothing.
  _classifyWasdMove(dirX, dirZ, stepThisFrame) {
    const camera = this._camera;
    const reach = stepThisFrame + WASD_CAMERA_RADIUS_METRES;

    // Floor under the camera now (collision floor).
    const floorNow = this._collisionFloorAt(
      camera.position.x,
      camera.position.z
    );
    // Destination column floor.
    const destX = camera.position.x + dirX * reach;
    const destZ = camera.position.z + dirZ * reach;
    const floorDest = this._collisionFloorAt(destX, destZ);

    // Forward ray: from the camera along the horizontal travel direction,
    // length `reach`, first accepted solid-floor hit (the wall/façade/cliff
    // ahead).
    const forwardHit = this._forwardRayHit(dirX, dirZ, reach);

    const outcome = classifyWasdStep({
      floorNow: { y: floorNow.y, normal: floorNow.normal },
      floorDest: { y: floorDest.y, normal: floorDest.normal },
      forwardHit,
      reach,
      targetDir: { x: dirX, z: dirZ },
      currentEnclosed: false,
      lastBlocked: !!this._lastWasdBlocked
    });

    if (outcome === 'block') {
      // D5: before refusing, fire the on-demand enclosure up-ray. If the
      // camera's own column is enclosed (loaded inside a building — the
      // WE-13 freeze trap), downgrade block → follow so the user can drive
      // out in any direction.
      const probe = this._enclosureProbe();
      if (probe.enclosed) {
        return { kind: 'follow', floorDestY: floorDest.y };
      }
    }
    return { kind: outcome, floorDestY: floorDest.y };
  }

  // TASK-024 (2b): cast a forward (horizontal) ray of length `reach` along
  // (dirX, 0, dirZ) and return the first accepted solid-floor hit as
  // { hit, dist, normalY, normalH } — or { hit: false } when clear.
  _forwardRayHit(dirX, dirZ, reach) {
    const sceneEl = this._sceneEl;
    if (!sceneEl || !sceneEl.object3D) return { hit: false };
    this._tmpV3a.set(dirX, 0, dirZ);
    if (this._tmpV3a.lengthSq() < 1e-9) return { hit: false };
    this._tmpV3a.normalize();
    this._raycaster.set(this._camera.position, this._tmpV3a);
    this._raycaster.near = 0;
    this._raycaster.far = reach;
    const hits = this._raycaster.intersectObject(sceneEl.object3D, true);
    for (const hit of hits) {
      if (!isSolidFloorHit(hit)) continue;
      const n = worldHitNormal(hit);
      return {
        hit: true,
        dist: hit.distance,
        normalY: n.y,
        normalH: { x: n.x, z: n.z }
      };
    }
    return { hit: false };
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
    let newY = camera.position.y + sU;
    // TASK-024 (2a / WE-6): descent clamp — pedestal-down can't sink
    // through a solid surface. Clamp to collisionFloor + eye-margin at the
    // (post-truck) XZ column. y-write only; the truck-right component is
    // unaffected.
    const floor = this._collisionFloorAt(
      camera.position.x,
      camera.position.z
    );
    const minY = floor.y + EYE_MARGIN_METRES;
    if (newY < minY) newY = minY;
    const dY = newY - camera.position.y;
    camera.position.y = newY;
    this.center.x += right.x * sR;
    this.center.z += right.z * sR;
    this.center.y += dY;
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
    // TASK-024 (2c/D8/C3): in the Map-orbit regime, pass the COLLISION
    // floor under the latched pivot as a reversible floor bound.
    // `shiftRotateStep` caps the *input* down-tilt so the resulting
    // `pos.y >= pivotFloor + EYE_MARGIN` (fixing C2's flat-plane y=0+0.5
    // guard), without accumulating over-drag — reversing the drag retraces
    // exactly. Street-mode rotate is rotate-in-place (no vertical motion),
    // so no floor bound there.
    let floorY = null;
    if (this._latch.get('regime') === 'map') {
      floorY = this._collisionFloorAt(center.x, center.z).y;
    }
    const { pos, lookTarget } = shiftRotateStep({
      camPos: camera.position,
      viewDir: fwd,
      centre: center,
      dxPx,
      dyPx,
      speed: this.rotationSpeed,
      floorY
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
