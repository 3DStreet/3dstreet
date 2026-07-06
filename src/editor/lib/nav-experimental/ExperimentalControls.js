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
import { isStreetLevelNav, isWasdNav } from './flag.js';
import { ModifierState } from './modifierState.js';
import { GestureLatch } from './gestureLatch.js';
import { SceneBounds } from './sceneBounds.js';
import {
  CursorAnchor,
  isSolidFloorHit,
  classifyHitEntity,
  worldHitNormal
} from './cursorAnchor.js';
import { RotationIndicator } from './rotationIndicator.js';
import { TickAnimator } from './tickAnimator.js';
import { CollisionProbe } from './collisionProbe.js';
import { GroundedState } from './groundedState.js';
import { SituationSensor } from './situationSensor.js';
import { CameraWriteFunnel } from './cameraWriteFunnel.js';
import {
  ZOOM_PER_WHEEL_TICK,
  FOV_PER_WHEEL_TICK,
  WHEEL_MAX_ACCUM_TICKS,
  WHEEL_ACCUM_EPS_TICKS,
  WHEEL_ANCHOR_DENOM_EPS_METRES,
  ROTATION_SPEED_RAD_PER_PX,
  WASD_SPEED_HEIGHT_FACTOR,
  WASD_MIN_SPEED,
  WASD_MAX_SPEED,
  WASD_RAMP_UP_MS,
  WASD_VERTICAL_LIFT_RATE_MPS,
  PLAN_VIEW_DURATION_MS,
  LB_PAN_MAX_STEP_METRES,
  TILT_THRESHOLD_DEFAULT_DEGREES,
  MIN_ORBIT_RADIUS_METRES,
  MAP_PIVOT_BOUNDS_RADIUS_METRES,
  MAP_PIVOT_FAR_ACCEPT_GAIN,
  WHEEL_ZOOM_LATERAL_CAP_LOWER_BOUND_METRES,
  WHEEL_ZOOM_LATERAL_CAP_AGL_COEFF,
  WHEEL_GROUND_REACH_CEILING_METRES,
  FALLBACK_FORWARD_DIST,
  SWOOP_PHASE2_ENTRY_ELEVATION_METRES,
  SWOOP_PHASE2_EXIT_ELEVATION_METRES,
  SWOOP_PHASE2_MAX_TICKS_PER_FRAME,
  SWOOP_PHASE2_FLOOR_SNAP_METRES,
  SWOOP_PHASE3_FOV_FLOOR_DEGREES,
  SWOOP_LANDING_FOV_DEGREES,
  SWOOP_FOV_RAMP_EXPONENT,
  DEFAULT_MAP_FOV_DEGREES,
  PHASE3_FOV_WIDE_CAP_DEGREES,
  REAIM_FADE_NEAR_METRES,
  REAIM_FADE_FAR_METRES,
  PHASE3_REAIM_NDC_EPS,
  DEFAULT_OVERVIEW_TILT_DEGREES,
  NORTH_AXIS,
  NORTH_BEARING_FROM_MINUS_Z,
  COMPASS_TOPDOWN_TOLERANCE_DEGREES,
  COMPASS_NORTH_TOLERANCE_DEGREES,
  COMPASS_ROTATE_STEP_DEGREES,
  EYE_MARGIN_METRES,
  WASD_CAMERA_RADIUS_METRES,
  ENCLOSURE_PROBE_UP_MARGIN_METRES,
  FALL_DURATION_MS,
  POP_TO_ROOF_DURATION_MS,
  DOUBLECLICK_STANDOFF_PULLBACK_STEP_METRES,
  DOUBLECLICK_STANDOFF_PULLBACK_MAX_METRES,
  DOUBLECLICK_MAX_FRAMING_PITCH_DEGREES,
  DEFAULT_DRONE_HEIGHT,
  ROOF_CLEARANCE,
  DEFAULT_FOV_DEGREES
} from './constants.js';
import {
  cameraTiltDegrees,
  decideLbMode,
  decideDragModeSwitch,
  clampOrbitRadius,
  wheelDeltaToTicks,
  dollyFactorForTicks,
  fovFactorForTicks,
  cappedDollyStep,
  levelForwardAnchor,
  lateralCap,
  classifySwoopTickTarget,
  reaimWeight,
  shiftRotateStep,
  decideSwoopPhase,
  phase2TargetTilt,
  phase2AscentTilt,
  swoopLandingFov,
  phase2HeightFrac,
  nextZoomUndo,
  phase2NextElevation,
  classifyWasdStep,
  wasdVerticalY,
  isLegitPose,
  classifyDoubleClick,
  desiredDoubleClickPose,
  clampFramingPitch,
  pullBackTowardTarget
} from './navMath.js';
import { captureNavDiscovery } from '../navAnalytics.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// The held-key movement set (WASD + arrows). Shared by the keydown
// movement branch, the keyup release path, and the WASD ↔ rotation
// interplay edge detection.
const MOVEMENT_KEY_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight'
]);


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
  constructor(camera, domElement, sceneEl) {
    super();

    // EditorControls-compatible knobs.
    this.enabled = true;
    this.center = new THREE.Vector3();
    this.panSpeed = 0.002;
    // Legacy field used only by the ActionBar +/- buttons (_zoomActionBar),
    // which is OUT OF SCOPE for TASK-014a and must keep its current feel.
    // It previously aliased ZOOM_PER_WHEEL_TICK (0.1); B7 halved that
    // constant to 0.05 for the WHEEL dolly only, so pin zoomSpeed to the
    // prior literal here rather than re-deriving — otherwise halving the
    // wheel dolly would silently halve the ActionBar button step too.
    this.zoomSpeed = 0.1;
    this.minSpeedFactor = 8;
    this.rotationSpeed = ROTATION_SPEED_RAD_PER_PX;

    this._camera = camera;
    this._domElement = domElement;
    this._isOrthographic = false;
    this._disabledByOrtho = false;
    this._aspectRatio = 1;

    // The scene element may be injected explicitly (third argument); when it
    // is omitted the app path resolves it from the A-Frame global, exactly as
    // before. Injection lets the controller be constructed and exercised
    // outside a live A-Frame scene (e.g. headless tests) without changing the
    // app's behaviour. `undefined` = not supplied; pass `null` to force the
    // no-scene branch.
    this._sceneEl =
      sceneEl !== undefined
        ? sceneEl
        : typeof AFRAME !== 'undefined' && AFRAME.scenes
          ? AFRAME.scenes[0]
          : null;

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

    // The shared context object handed to the extracted nav modules. Live
    // getters (camera/scene can be swapped via setCamera) — never cache the ref.
    // A module reads its siblings via `ctx` at call time, never in its own
    // constructor.
    // No `controls: this` here on purpose: the ctx is a curated service locator
    // (read-only refs + tuning getters + named services), never a back-door to
    // the whole orchestrator. Dispatch identity is handed to the write funnel as
    // an explicit bound callback; predicates are exposed as named ctx functions.
    const self = this;
    this._ctx = {
      get camera() {
        return self._camera;
      },
      get sceneEl() {
        return self._sceneEl;
      },
      get center() {
        return self.center;
      },
      get latch() {
        return self._latch;
      },
      get streetLevelEnabled() {
        return self._streetLevelEnabled;
      },
      get probe() {
        return self._probe;
      },
      get grounded() {
        return self._groundedState;
      },
      get sensor() {
        return self._sensor;
      },
      get funnel() {
        return self._funnel;
      },
      // Dispatch identity: the `change`/cue events must fire ON the controls
      // instance (frozen external contract) — hand modules a bound callback,
      // never the instance itself.
      dispatch: self.dispatchEvent.bind(self),
      // The situation-sensor idle gate: is any engine actively moving the
      // camera? (Deliberately distinct from the resolveContextAction busy
      // predicate, which additionally counts recovery/inactive.)
      isCameraBusy: () =>
        self._wasdVelocity.lengthSq() > 0 ||
        self._wheelAccum !== 0 ||
        self._latch.isActive() ||
        self._tick.isAnimating()
    };
    // Collision-floor probe (stateful _lastGroundY cache). Owns its own scratch
    // + raycaster so a probe never aliases another gesture's scratch.
    this._probe = new CollisionProbe(this._ctx);
    // Shared grounded-vs-flying state (SPEC D1/D4), read + written by the wheel,
    // WASD, pedestal, and transition subsystems.
    this._groundedState = new GroundedState(this._ctx);
    // Per-tick situation sensor: legit-pose snapshot, recovery cue, context
    // snapshot from one idle-gated enclosure ray.
    this._sensor = new SituationSensor(this._ctx);
    // Camera-write funnel (M1): the single `change`-dispatch + wheel-memory-
    // invalidation edge every camera move passes through. `clearWheelMemory`
    // points at the wheel's zoom-undo reset, which still lives on this class
    // until the wheel engine extracts (a one-line re-point then).
    this._funnel = new CameraWriteFunnel({
      dispatch: this._ctx.dispatch,
      clearWheelMemory: () => this._clearZoomUndo()
    });

    // TASK-010 (D2): the single tilt threshold T governing the LB
    // sub-mode, the wheel cut, the rotation regime, and the letterbox.
    // Live value (overridable via `setTiltThreshold` / the
    // `nav-experimental-tuning` component); defaults to the constant.
    this._tiltThreshold = TILT_THRESHOLD_DEFAULT_DEGREES;

    // TASK-010 (D-LT-3): Map-pivot bounds radius (metres on the ground,
    // measured from the screen-centre point). Live value, overridable via
    // the tuning component.
    this._mapPivotBoundsRadius = MAP_PIVOT_BOUNDS_RADIUS_METRES;

    // Street-level-mode-OFF far-acceptance budget for a clicked Map rotation
    // pivot (see the constant). Live value, overridable via the tuning
    // component (mapPivotFarAcceptGain → setMapPivotFarAcceptGain).
    this._mapPivotFarAcceptGain = MAP_PIVOT_FAR_ACCEPT_GAIN;

    // TASK-014d / TASK-027 Part F: lower bound on the per-tick wheel-zoom
    // lateral cap. The live cap is `max(lowerBound, 0.1×AGL)` (navMath.
    // lateralCap), so it scales with height; this lower bound governs near the
    // ground and on the no-AGL Ctrl+wheel path. Live value, overridable via
    // the tuning component (wheelZoomLateralCapLowerBoundMetres →
    // setWheelZoomLateralCap).
    this._wheelZoomLateralCapLowerBound =
      WHEEL_ZOOM_LATERAL_CAP_LOWER_BOUND_METRES;

    // Street-level mode gate. OFF (the ?streetview=on default) disables the
    // street-level regime as a whole: the wheel never dispatches to the
    // swoop / street-FOV phases (it stays a plain anchored dolly at every
    // height, like Ctrl+wheel), the context button offers no street action,
    // the 'drop' discoverability cue is suppressed, and a lane double-click
    // no-ops. Elevated nav, drone rise, and the enclosure (daylight)
    // recovery are unaffected. Live value, flippable at runtime via the
    // tuning component (streetLevelEnabled → setStreetLevelEnabled).
    this._streetLevelEnabled = isStreetLevelNav();

    // First-person kit gate (?wasd=on, default off): WASD / arrow-key
    // flight and the WASD ↔ rotation interplay (which rides on the
    // held-key set, so it gates for free). Live value, flippable via the
    // tuning component (wasdEnabled → setWasdEnabled).
    this._wasdEnabled = isWasdNav();

    // TASK-010 (live-Shift, B6): last-known cursor coords, tracked on
    // mousedown and every mousemove so a mid-drag Shift toggle can
    // re-latch the sub-gesture at the current cursor position.
    this._lastClientX = null;
    this._lastClientY = null;

    // Which mouse button latched the current gesture (0 = LB, 2 = RMB).
    // The mid-drag Shift mode-switch applies to LB drags only.
    this._gestureButton = null;

    this._pointer = new THREE.Vector2();
    this._pointerOld = new THREE.Vector2();
    this._delta = new THREE.Vector3();
    this._normalMatrix = new THREE.Matrix3();
    this._changeEvent = { type: 'change' };

    // Scratch.
    this._tmpV3a = new THREE.Vector3();
    this._tmpV3b = new THREE.Vector3();
    this._tmpV3c = new THREE.Vector3();
    // TASK-022: dedicated scratch for the roll-safe re-tilt. `_tmpV3d` holds
    // the TRUE (un-flattened) camera forward through the rotation build, and
    // `_tmpQuat` is the minimal-arc rotation applied via premultiply.
    this._tmpV3d = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    // TASK-027 Part B: scratch for the cursor-lock re-aim. `_tmpV3f` holds the
    // camera→P direction; `_tmpQuatB/C` build the minimal-arc rotation and its
    // slerp-from-identity; `_reaimRaycaster` is a dedicated raycaster so the
    // re-aim's baseline-orientation probe never disturbs the CursorAnchor's.
    // (The target point P is held in the `_phase3Reaim` session, not scratch.)
    this._tmpV3f = new THREE.Vector3();
    this._tmpQuatB = new THREE.Quaternion();
    this._tmpQuatC = new THREE.Quaternion();
    this._reaimRaycaster = new THREE.Raycaster();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._anchorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._tmpRay = new THREE.Ray();
    this._raycaster = new THREE.Raycaster();
    this._tmpNDC = new THREE.Vector2();

    // TASK-014a (#6 Option B): continuous wheel accumulator, in signed
    // fractional "nominal ticks" (replaces the old integer deltaY-unit
    // _wheelBudget). _onWheel normalises each event via wheelDeltaToTicks
    // and adds it here (clamped to ±WHEEL_MAX_ACCUM_TICKS); _drainWheel
    // applies the high/FOV regimes as one continuous step per frame and the
    // swoop as whole ticks under its rate-cap, carrying any sub-tick
    // remainder frame-to-frame.
    this._wheelAccum = 0;

    // Phase 3 swoop state.
    //
    //   _zoomUndo — TASK-022 transient zoom-undo memory {valid, tilt, fov}.
    //     `tilt` is the entry tilt captured at the wheel Phase-1→2 downward
    //     crossing; `valid` gates whether the swoop-OUT reverses to it (true)
    //     or eases to the default overview (false). Cleared by any ACTUAL
    //     non-wheel camera move (not by a bare input event). Wheel activity
    //     (in or out) preserves it. `fov` is reserved for TASK-014b (the
    //     landing-FOV ascent — captured/cleared on the SAME flag; this task
    //     writes it on capture and reads nothing from it: the C4 seam is live
    //     but inert until 014b). Init `valid:false` so a session that opens
    //     inside the band eases to the default overview on the first
    //     swoop-out, not to a meaningless live tilt read as if it were a real
    //     entry. Mutated only via the nextZoomUndo reducer (never poke fields).
    //   TASK-027 Part A: the old latched `_phase3FovBaseline` is GONE. The
    //     street-level wide-FOV cap is now the constant PHASE3_FOV_WIDE_CAP_
    //     DEGREES (= min(landing, distortion)); the landing FOV is reached by a
    //     height-driven ramp in Phase 2, not a latch on the floor crossing.
    // See claude/specs/001-phase-3-plan.md.
    this._zoomUndo = {
      valid: false,
      tilt: cameraTiltDegrees(camera),
      fov: camera.fov
    };

    // TASK-027 Part B: cursor-lock re-aim baseline session, captured lazily on
    // the first Phase-3 wheel tick and re-captured when the cursor pixel moves.
    // { baselineQuat, baselineFov, ndc } | null. Cleared on leaving Phase 3 and
    // on any non-wheel camera move (_clearZoomUndo).
    this._phase3Reaim = null;

    // TASK-027 Part C: the regime the last Phase-2 zoom-in tick resolved to
    // ('swoop' | 'dolly' | null). A swoop↔dolly switch clears the zoom-undo
    // memory (C2 for mixed descents). Reset to null whenever the dispatch
    // leaves the Phase-2 band, so a stale value can't spuriously clear a fresh
    // descent's memory.
    this._lastSwoopRegime = null;

    // TASK-027 Part C-add-2 (live-test "B"): depth (in nominal ticks, a float
    // under TASK-014a's continuous model) of the current break-out dolly
    // excursion — how far the camera has dollied toward a wall since the last
    // swoop tick. Zoom-out unwinds this back to 0 (dolly back to the rail)
    // before resuming the swoop ascent. Reset on a swoop tick / leaving the
    // band / non-wheel move.
    this._breakoutDollyDepth = 0;

    // TASK-022 / TASK-027 Part A (L4): swoop-OUT ascent anchor, the sole stored
    // ascent state — the three fields bundled into ONE struct `{ frac, tilt,
    // fov } | null` so they cannot desync. null = no ascent in progress.
    // Captured TOGETHER on the first zoom-out tick of an ascent (under the
    // `== null` guard), nulled together on any descent tick / Phase-3 entry /
    // ceiling hand-off / swoop↔dolly regime switch, so the next ascent
    // re-captures from the live pose. The ascent TARGET (tilt + fov) is NOT
    // stored — recomputed per-tick from `_zoomUndo.valid` (safe: the wheel path
    // never flips `valid` mid-ascent).
    this._ascentAnchor = null;

    // Per-pass snapshot of the ground height directly below the camera,
    // set at the top of each _drainWheel pass from _collisionFloorAt()
    // (TASK-024 — the collision floor, so the swoop lands on roofs).
    // Read (not re-probed) by _decideWheelRegime / _applyContinuousHighStep /
    // _applyPhase2WheelTick / the phase helpers so every step in a pass —
    // including the recursive swoop ↔ high hand-offs — sees the same ground.
    // Distinct from
    // _lastGroundY (the persisted miss-fallback cache). (TASK-013)
    this._frameGroundY = 0;
    // TASK-024a (solid-geometry guard): did this pass's ground probe HIT a
    // real surface, or did it miss (source 'cache' = stale last-known ground,
    // no surface below — outside a finite scene's bounds)? On a miss every
    // swoop ground-relative clamp / phase-snap is suppressed so the wheel acts
    // as a plain anchored dolly (free descent), letting the camera reach
    // street level from outside the bounds.
    this._frameGroundHit = false;

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
    //     suppressed, triggerContextAction is inert (busy), and a fresh
    //     mousedown aborts the tween (N4).
    //   _lastWasdBlocked — WASD block hysteresis carry (WE-3b).
    // (The legit-pose snapshot and the discoverability-cue shown state live in
    //  the SituationSensor service.)
    this._recoveryActive = false;
    this._lastWasdBlocked = false;

    // TASK-012 (H-4): "a Phase-4 double-click teleport tween owns the camera"
    // flag. Mirrors `_recoveryActive` exactly — set for the tween's life,
    // cleared in its onDone. Deliberately NOT in `_isInactive()` (H-A) so an
    // active grab still reaches the `_onMouseDown` abort (L-3). The passive
    // input gates read `_tweenOwnsCamera()` = `_recoveryActive ||
    // _teleportActive`.
    this._teleportActive = false;

    // The per-tick context snapshot the view-button resolver reads lives in the
    // SituationSensor service (a pure read — the resolver never probes, so the
    // React button polls it every frame at zero raycast cost). `_lastResolvedKind`
    // lets a `busy` frame hold the last icon.
    this._lastResolvedKind = 'drone';


    // The enclosure idle-gate cache + scene-geometry-dirty state live in the
    // SituationSensor service. This scene-geometry listener (wired in _attach)
    // marks the sensor dirty so it re-evaluates once around a motionless camera
    // when solid geometry changes under it (scene load, teleport into a
    // building, tiles streaming in) — otherwise the cached result would stand
    // until the camera moves and the recovery cue would never appear.
    this._onSceneGeometryDirty = () => {
      this._sensor.markGeometryDirty();
    };

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
    this._sensor.lastLegitPose = null;
    // TASK-024a (D1): re-derive grounded from the post-reset pose (the reset
    // camera at (0,15,30) is high → not-grounded unless a floor sits near it).
    this._groundedState.deriveFromPose();
    // A reset/new-scene wipes all nav state: a non-wheel move → invalidate the
    // wheel zoom-undo memory, then dispatch.
    this._funnel.commitMove('reset');
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
    // TASK-024a (D1, MED-2/PA-4): re-derive grounded from the explicit-pose
    // teleport. (The resetZoom() fallback branches above already route through
    // resetZoom's own derive call, so only this explicit-pose path needs it.)
    this._groundedState.deriveFromPose();
    // Explicit-pose teleport is a non-wheel camera move → invalidate + dispatch.
    this._funnel.commitMove('reset');
  }

  zoomInStart() {
    if (this._disabledByOrtho) return;
    captureNavDiscovery('zoom');
    this._zoomInInterval = setInterval(() => this._zoomActionBar(-1), 50);
  }
  zoomInStop() {
    clearInterval(this._zoomInInterval);
    this._zoomInInterval = null;
  }
  zoomOutStart() {
    if (this._disabledByOrtho) return;
    captureNavDiscovery('zoom');
    this._zoomOutInterval = setInterval(() => this._zoomActionBar(1), 50);
  }
  zoomOutStop() {
    clearInterval(this._zoomOutInterval);
    this._zoomOutInterval = null;
  }

  // LB sub-mode from the live tilt. Street-level mode off (Stage 1): a
  // single screen-space pan ('pan-screen') at every tilt — the legacy
  // THREE.EditorControls LB behaviour. The tilt-gated truck/pedestal split
  // (and the letterbox indicator driven off it) is the Stage 2 street mode
  // and only engages when street-level is enabled. See
  // docs/07-phased-rollout-plan.md §"the seam". The single decision point
  // for all three callers (the mode cache, the mode-change emitter, and the
  // pan gesture latch).
  _decideLbModeLive() {
    if (!this._streetLevelEnabled) return 'pan-screen';
    return decideLbMode(cameraTiltDegrees(this._camera), this._tiltThreshold);
  }

  // Phase 2: read the cached LB sub-mode for the visual indicator. The
  // hook (`useNavMode`) calls this on mount to seed initial state, then
  // listens for `nav-experimental:modechange` for updates. Forces a
  // recompute if the cache is empty so the first read is always honest.
  getCurrentLbMode() {
    if (this._currentLbMode == null && this._camera) {
      this._currentLbMode = this._decideLbModeLive();
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

  // Street-level-mode-OFF far-acceptance budget for a clicked Map rotation
  // pivot: gain on the height/sin(max(tilt,T)) budget (see the constant).
  // Relayed from the tuning component (mapPivotFarAcceptGain).
  setMapPivotFarAcceptGain(gain) {
    if (typeof gain !== 'number' || !isFinite(gain) || gain <= 0) return;
    this._mapPivotFarAcceptGain = THREE.MathUtils.clamp(gain, 0.05, 100);
  }

  // TASK-014d / TASK-027 Part F: live-tunable LOWER BOUND of the wheel-zoom
  // lateral cap (metres). The live cap is `max(lowerBound, 0.1×AGL)`. Relayed
  // from the tuning component (wheelZoomLateralCapLowerBoundMetres).
  setWheelZoomLateralCap(metres) {
    if (typeof metres !== 'number' || !isFinite(metres) || metres <= 0) {
      return;
    }
    this._wheelZoomLateralCapLowerBound = metres;
  }

  // Street-level mode gate (see the constructor field for what it covers).
  // Relayed from the tuning component (streetLevelEnabled); the URL flag
  // (?streetview=on) sets the default.
  setStreetLevelEnabled(enabled) {
    if (typeof enabled !== 'boolean') return;
    this._streetLevelEnabled = enabled;
    // Flipping the gate can change the LB sub-mode comparator at a fixed
    // tilt (pedestal ↔ truck) — re-emit so the letterbox updates without
    // waiting for the next interaction (same reasoning as setTiltThreshold).
    this._maybeEmitLbModeChange();
  }

  // First-person kit gate (see the constructor field). Relayed from the
  // tuning component (wasdEnabled); the ?wasd=on URL flag sets the default.
  // Note the shortcuts.js w/s/d keymap restore reads the URL flag at load
  // time only — this runtime toggle moves the camera bindings, not the
  // editor shortcut map.
  setWasdEnabled(enabled) {
    if (typeof enabled !== 'boolean') return;
    this._wasdEnabled = enabled;
    // Flipped off mid-flight: drop any held movement keys so the camera
    // doesn't keep flying on keys whose keyups will now be ignored.
    if (!enabled) this._heldKeys.clear();
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

    // TASK-012 (H-4): a recovery/teleport tween may own the camera (e.g. Plan
    // View pre-empting a gesture-end recovery). Cancel it and clear its flags
    // first so `_tick.animate` below doesn't drop the prior tween's onDone and
    // strand `_recoveryActive`/`_teleportActive` true.
    this._cancelCameraTween();

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
        // TASK-022: Plan View moves the camera by a non-wheel mechanism →
        // clear the zoom-undo memory. In onTick (idempotent) so it's gone the
        // instant the tween starts moving — a tween pre-empted at frame 0
        // never ticks, correctly leaving the memory intact.
        this._clearZoomUndo();
        this.dispatchEvent(this._changeEvent);
      },
      onDone: () => {
        camera.position.copy(endPos);
        camera.quaternion.copy(endQuat);
        camera.updateMatrixWorld();
        this._clearZoomUndo(); // TASK-022 (idempotent; closes the onTick window)
        this._planViewActive = false;
        this._planViewHandle = null;
        // TASK-024 (D4): reseed the legit-pose snapshot from the committed
        // plan-view pose so recovery can never ease back to a pre-teleport
        // pose.
        this._sensor.reseedLegitPose();
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
    // Pivot selection — keyed on the canonical Map/Street tilt regime
    // (the same `tilt > _tiltThreshold` test every other control uses,
    // e.g. _latchRotationCenter). In the Map regime (looking down) we
    // orbit the screen-centre ground point so the centred feature stays
    // centred while the heading turns — a map-style turn, matching the
    // Shift+LB Map rotation. In the Street regime (near-horizontal) we
    // spin in place (null pivot). Top-down is just the steep end of Map:
    // the screen-centre point sits ~directly below, so the orbit degrades
    // to a spin in place on its own — no dedicated top-down case needed.
    // (TASK-026: this replaces a call to a never-implemented
    // _screenCenterHit() that threw on every non-top-down click.)
    // Street-level mode off: always the Map turn (orbit the screen-centre
    // ground point). At/above the horizon that point is null and the code
    // below already falls through to spin-in-place — the one pose where
    // there is no ground feature to pivot.
    const isMap =
      !this._streetLevelEnabled ||
      cameraTiltDegrees(camera) > this._tiltThreshold;
    let pivot = null;
    if (isMap) {
      // Screen-centre ground point = where the camera's view ray meets
      // y=0. getWorldDirection writes the unit view direction into the
      // shared scratch _tmpV3c; _viewRayGroundPoint copies what it needs
      // into a fresh Vector3, so the returned pivot does not alias the
      // scratch. A null return (ray at/above horizon, or the plane behind
      // a below-ground camera) falls through to spin-in-place.
      const fwd = this._tmpV3c;
      camera.getWorldDirection(fwd);
      pivot = this._viewRayGroundPoint(camera.position, fwd);
    }

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
    // TASK-012 (H-4): a compass action can pre-empt a recovery/teleport tween
    // (those are not in `_compassAnimating`). Cancel + clear flags first so
    // `_tick.animate` doesn't strand `_recoveryActive`/`_teleportActive`.
    this._cancelCameraTween();
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
      // TASK-022: compass rotate / align / body-click top-down all route here
      // — a non-wheel camera move. Clear the zoom-undo memory.
      this._clearZoomUndo();
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
        // TASK-022: clear the instant the tween starts moving (idempotent).
        this._clearZoomUndo();
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
    if (
      this._sceneEl &&
      this._sceneEl.hasAttribute('nav-experimental-tuning')
    ) {
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
        // TASK-022: focus-to-object moves the camera via the A-Frame
        // focus-animation component — a non-wheel move. Clear on its change
        // hook (fires each frame of the transition; idempotent).
        this._clearZoomUndo();
        // TASK-024 (D4): reseed the legit-pose snapshot once the focus
        // (double-click teleport) animation has settled, so recovery can't
        // ease back to the pre-teleport pose. The component sets
        // `transitioning = false` on its final frame.
        if (this._focusAnimation && !this._focusAnimation.transitioning) {
          this._sensor.reseedLegitPose();
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
    // CR-D5: subscribe to the signals that mean "solid geometry under/around
    // the camera may have changed", each marking the enclosure cache dirty so
    // the idle gate re-evaluates once. `object3dset` fires when entities
    // add/replace their object3D (street-segment/building clones appearing,
    // scene loads); `child-attached`/`newScene` cover entity-tree changes
    // (mirrors SceneBounds' invalidation lifecycle). Google 3D Tiles
    // streaming has no scene-level DOM event (its load event lives on the
    // internal TilesRenderer), so tiles-only streaming leans on the 250 ms
    // bounded fallback in _updateLegitSnapshotAndCue rather than a guessed
    // API. Removed in _detach (called from dispose) — no leak.
    if (this._sceneEl && typeof this._sceneEl.addEventListener === 'function') {
      this._sceneEl.addEventListener('object3dset', this._onSceneGeometryDirty);
      this._sceneEl.addEventListener(
        'child-attached',
        this._onSceneGeometryDirty
      );
      this._sceneEl.addEventListener('newScene', this._onSceneGeometryDirty);
    }
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
    // CR-D5: tear down the scene-geometry-dirty listeners added in _attach.
    if (
      this._sceneEl &&
      typeof this._sceneEl.removeEventListener === 'function'
    ) {
      this._sceneEl.removeEventListener(
        'object3dset',
        this._onSceneGeometryDirty
      );
      this._sceneEl.removeEventListener(
        'child-attached',
        this._onSceneGeometryDirty
      );
      this._sceneEl.removeEventListener('newScene', this._onSceneGeometryDirty);
    }
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
    const next = this._decideLbModeLive();
    if (next !== this._currentLbMode) {
      this._currentLbMode = next;
      this._emitModeChange(next);
    }
  }

  // Mouse-mode dispatch. Phase 1 returns 'pan' (LB) or 'rotate' (Shift+LB).
  // Phase 2 splits the 'pan' branch further at gesture-start time via
  // `decideLbMode(cameraTiltDegrees(camera))`.
  _decideMouseMode(event) {
    // RMB = rotate, identical to Shift+LB — legacy-EditorControls parity
    // (its mapping was LB pan / MMB zoom / RMB rotate; the canvas context
    // menu is suppressed). Unlike LB, an RMB drag never mode-switches on
    // Shift (see the `_gestureButton` guard in `_syncDragModeToShift`),
    // matching the legacy controls' LB-only Shift toggle.
    if (event.button === 2) return 'rotate';
    if (event.button !== 0) return null;
    if (event.shiftKey) return 'rotate';
    return 'pan';
  }

  _onContextMenu(event) {
    event.preventDefault();
  }

  // TASK-012 (H-4): "a camera-owning tween is in flight" — the recovery
  // ease-back OR the Phase-4 teleport. The PASSIVE input gates (wheel, WASD,
  // toolbar zoom, the legit-snapshot) read this so neither races the tween.
  // NOT used by `_onMouseDown` (an active grab must still reach the abort).
  _tweenOwnsCamera() {
    return this._recoveryActive || this._teleportActive;
  }

  // TASK-012 (H-4): cancel whatever camera-owning tween is in flight and clear
  // its ownership flags. `_tick.cancel()` does NOT run the tween's onDone, so
  // the flag clear must happen here — a naive per-flag clear would strand on
  // any cross-tween pre-emption (e.g. Plan View starting mid-recovery would
  // drop recovery's onDone and leave `_recoveryActive` true → input dead).
  // Every tween-START path routes through this first, generalising the old
  // ad-hoc `_recoveryActive` clearing and fixing the symmetric pre-existing
  // strands (teleport-mid-recovery, recovery-mid-plan-view).
  //
  // Clears recovery + teleport flags only — NOT `_planViewActive` /
  // `_compassAnimating`: a teleport can never START mid-plan-view/compass
  // (navigateDoubleClick's `_isInactive()` guard blocks it — those two ARE in
  // `_isInactive()`), so they own their own lifecycles.
  _cancelCameraTween() {
    this._tick.cancel();
    this._recoveryActive = false;
    this._teleportActive = false;
  }

  _onMouseDown(event) {
    if (this._isInactive()) return;
    const mode = this._decideMouseMode(event);
    if (!mode) return;

    // TASK-024 (N4) / TASK-012 (L-3): a fresh press mid-tween would otherwise
    // start a drag that fights the still-running tween. Policy: abort the
    // recovery OR teleport (cancel the tween, clear the flags) and let the new
    // drag take over. The aborted tween's onDone doesn't run, so its reseed /
    // teleport-clear is skipped — the next legit tick reseeds normally, and
    // `_cancelCameraTween` already cleared `_teleportActive`.
    if (this._tweenOwnsCamera()) {
      this._cancelCameraTween();
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

    // Remember which button latched the gesture: the mid-drag Shift
    // mode-switch applies to LB drags only (legacy parity — an RMB rotate
    // must not flip to pan when Shift is up; see `_syncDragModeToShift`).
    this._gestureButton = event.button;

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
    const subMode = this._decideLbModeLive();
    const anchor = this._cursorAnchor.worldPointAt(clientX, clientY);

    if (subMode === 'pan-screen') {
      // Stage 1 screen-space pan: plane through the anchor whose normal is
      // the camera-facing direction (i.e. parallel to the image plane).
      // Translating the camera within this plane keeps the anchor under the
      // cursor and moves purely in the camera's right/up basis — the legacy
      // ⊥-to-camera pan. The plane is latched at gesture start (the pan
      // never rotates the camera, so it stays parallel to the image plane).
      const fwd = new THREE.Vector3();
      this._camera.getWorldDirection(fwd);
      if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
      fwd.normalize();
      const planeAnchor = new THREE.Vector3(anchor.x, anchor.y, anchor.z);
      this._anchorPlane.setFromNormalAndCoplanarPoint(fwd, planeAnchor);
      this._latch.start({
        mode: 'pan',
        subMode,
        anchor: planeAnchor
      });
    } else if (subMode === 'pan-truck') {
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
      // Feature-discovery: count the first real pan drag (here, not at
      // mousedown, so a click that never moves doesn't register as a pan).
      captureNavDiscovery('pan');
      const subMode = this._latch.get('subMode');
      if (subMode === 'pan-screen') {
        this._lbScreenPan(event.clientX, event.clientY);
      } else if (subMode === 'pan-pedestal') {
        this._lbPedestalMove(event.clientX, event.clientY);
      } else {
        this._lbTruckMove(event.clientX, event.clientY);
      }
    } else if (mode === 'rotate') {
      captureNavDiscovery('rotate');
      this._shiftRotate(dx, dy);
      // Emit LB-mode change the moment the tilt crosses T mid-gesture,
      // not at gesture end (letterbox is live; see plan §4b).
      this._maybeEmitLbModeChange();
    }
  }

  _onMouseUp() {
    this._gestureButton = null;
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
    const probe = this._sensor.enclosureProbe();
    const legitNow = isLegitPose({
      enclosed: probe.enclosed,
      camY: camera.position.y,
      floorY: probe.floorY
    });
    if (legitNow) return; // gesture ended clear — nothing to do.

    const stored = this._sensor.lastLegitPose;
    if (stored && this._poseStillLegit(stored)) {
      this._tweenToPose(stored, FALL_DURATION_MS);
    } else {
      this._popToRoof();
    }
  }

  // TASK-024 (3b): re-validate a stored pose against CURRENT geometry (a
  // tile may have streamed in around it). Probes enclosure + the collision
  // floor at the stored position.
  _poseStillLegit(pose, opts = {}) {
    // Probe at the stored / candidate position: a one-off downward cast from
    // above it. TASK-012: `pose` may be a `{ position }` bag (recovery) OR a
    // bare THREE.Vector3-like point (teleport B/C standoff clearance).
    const sceneEl = this._sceneEl;
    if (!sceneEl || !sceneEl.object3D) return true;
    const p = pose.position || pose;
    this._tmpV3a.set(p.x, p.y + ENCLOSURE_PROBE_UP_MARGIN_METRES, p.z);
    this._raycaster.set(this._tmpV3a, GROUND_PROBE_DIR);
    this._raycaster.near = 0;
    this._raycaster.far = Infinity;
    const hits = this._raycaster.intersectObject(sceneEl.object3D, true);
    let enclosed = false;
    for (const hit of hits) {
      if (isSolidFloorHit(hit) && hit.point.y > p.y + 1e-3) {
        enclosed = true;
        break;
      }
    }
    // FR-LOW-1: select the floor via the SHARED priority picker (segment/
    // building beats a higher tiles rooftop, TASK-019 D3) — same as
    // `_collisionFloorAt`/`_enclosureProbe` — rather than a manual
    // nearest-hit loop, so legit-pose re-validation reads the same floor
    // the WASD/swoop path does.
    const pick = this._probe.pickFloorFromHits(hits, p.y, {
      acceptBuildings: true,
      acceptTiles: true
    });
    const floorY = pick ? pick.hit.point.y : null;
    // Overhead solid always disqualifies (enclosure half of the predicate).
    if (enclosed) return false;
    // Floor-clearance (eye-margin above the surface beneath the candidate).
    // The B/C standoff caller (`_resolveStandoff`) has ALREADY raised the
    // candidate to floor+eye-margin using its OWN probe and gated on it
    // (`clearColumn`), so re-checking here against an INDEPENDENT re-probe is
    // redundant — and worse, the two probes can disagree at the exact boundary
    // by a sub-millimetre difference, flipping `camY >= floor+eye-margin` to
    // false and wrongly rejecting a low candidate pinned at the boundary (a
    // car / pedestrian, whose centre height is below eye-margin so it always
    // lands exactly at it). Trust the caller via `skipFloorClearance`. Recovery
    // callers pass no opts → full check, byte-identical to before.
    if (
      !opts.skipFloorClearance &&
      !isLegitPose({ enclosed, camY: p.y, floorY })
    ) {
      return false;
    }
    // TASK-012 (M-A buried guard): the enclosure half rejects a candidate with
    // solid directly overhead, but a downward-only probe can miss a candidate
    // at mid-interior height inside a closed building with no solid straight
    // up. 3DStreet building glTF is single-sided (FrontSide), so a normal-
    // parity test gives a false negative — instead test AABB containment
    // against the building(s) whose column this candidate sits in (the same
    // downward `hits` already pass through any enclosing building's roof +
    // floor). Opt-in (`checkBuried`) so existing recovery callers, which pass
    // no opts, are byte-identical.
    if (
      opts.checkBuried &&
      this._pointInsideBuildingHit(p, hits, opts.extraBox)
    ) {
      return false;
    }
    return true;
  }

  // TASK-012 (M-A): is `point` inside the AABB of any building entity struck
  // by the candidate column's downward probe? Reuses the existing `hits`
  // (a downward ray through a building the candidate is inside passes through
  // its roof above and its floor below, so the owning building entity is in
  // the list). Sidedness-independent (AABB, not normal parity). De-dupes by
  // owning entity so each building's Box3 is computed at most once.
  // `extraBox` (TASK-012 code-review M1): the Category-B/C TARGET building's
  // Box3, tested unconditionally. The probe-hit scan below only catches
  // buildings the candidate's downward ray actually strikes — a shell building
  // with no interior floor slab (the ray exits through the segment ground
  // below) would be missed. Testing the known target box closes the most
  // common WE-13 case (the standoff landing inside the very building you
  // clicked) independent of asset geometry. Neighbour buildings remain
  // best-effort via the probe hits.
  // Known tradeoff (code-review M2): AABB containment treats the full bounding
  // box as solid, so a concave footprint (L-shape / courtyard / overhang) can
  // false-positive a clear standoff in a notch and pull it inward. Accepted as
  // low-cost per the spec (B/C standoff is a tuning concern; pull-back-further
  // or a no-op are both safe) — the camera never ends up buried, only framed
  // from slightly further back.
  _pointInsideBuildingHit(point, hits, extraBox) {
    const inBox = (box) =>
      point.x >= box.min.x &&
      point.x <= box.max.x &&
      point.y >= box.min.y &&
      point.y <= box.max.y &&
      point.z >= box.min.z &&
      point.z <= box.max.z;
    if (extraBox && !extraBox.isEmpty() && inBox(extraBox)) return true;
    const seen = new Set();
    for (const hit of hits) {
      if (classifyHitEntity(hit) !== 'building') continue;
      let node = hit.object;
      let el = null;
      while (node) {
        if (node.el) {
          el = node.el;
          break;
        }
        node = node.parent;
      }
      if (!el || !el.object3D || seen.has(el)) continue;
      seen.add(el);
      if (inBox(new THREE.Box3().setFromObject(el.object3D))) return true;
    }
    return false;
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
    // TASK-012 (H-4): route the recovery tween start through the shared
    // cancel so a prior camera-owning tween (e.g. an interrupted teleport)
    // can't strand its flag. No prior tween in the normal recovery flow, so
    // this is a no-op there (behaviour-preserving).
    this._cancelCameraTween();
    this._recoveryActive = true;
    // CR-D2: single mid-tween hand-off latch. If a tile streams in during
    // the ease-back so the stored target is no longer legit, cancel and
    // pop to the roof — once, not a per-frame retarget loop.
    //
    // D2 hand-off hardening: when the hand-off fires on the SAME frame the
    // tween reaches tRaw>=1 (its final frame), TickAnimator's `sub` still
    // runs its trailing terminal block AFTER onTick returns — it would (a)
    // null `_currentTween`, clobbering the just-started _popToRoof tween's
    // handle, and (b) run this stale `onDone`, re-clearing _recoveryActive
    // and reseeding to the superseded ease-back target. `handedOff`
    // short-circuits onDone, and `_handoffTween` (the captured _popToRoof
    // handle) is restored as `_currentTween` so the pop tween isn't orphaned.
    let handedOff = false;
    let handoffTween = null;
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
          // Capture the pop tween's handle (if _popToRoof started one) so a
          // trailing terminal block on this same final frame can't orphan it.
          handoffTween = this._tick._currentTween;
          return;
        }
        camera.position.lerpVectors(startPos, endPos, eased);
        camera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        this.center.lerpVectors(startCenter, endCenter, eased);
        camera.updateMatrixWorld();
        // TASK-022 (C3 / HIGH-2): the recovery ease-back moves the camera by a
        // non-wheel mechanism. Without this clear, wheel-in (memory valid) →
        // recovery → wheel-out would reverse to a stale entry tilt. Idempotent.
        this._clearZoomUndo();
        this.dispatchEvent(this._changeEvent);
      },
      onDone: () => {
        // D2: superseded by a same-frame hand-off — do not run the stale
        // terminal commit (it would re-clear _recoveryActive and reseed to
        // the abandoned ease-back target). Restore the pop tween's handle in
        // case the trailing block nulled it.
        if (handedOff) {
          if (handoffTween) this._tick._currentTween = handoffTween;
          return;
        }
        camera.position.copy(endPos);
        camera.quaternion.copy(endQuat);
        this.center.copy(endCenter);
        camera.updateMatrixWorld();
        this._clearZoomUndo(); // TASK-022 (C3 / HIGH-2)
        this._recoveryActive = false;
        // TASK-024a (D1, 1.2.5): a recovery tween returns to _lastLegitPose,
        // but "legit" is camY >= floor + eye-margin (at-or-ABOVE) — it can
        // settle you hovering. DERIVE from the settled pose rather than
        // force-true, so a hover recovery does not falsely ground.
        this._groundedState.deriveFromPose();
        this._sensor.reseedLegitPose();
        this.dispatchEvent(this._changeEvent);
      }
    });
  }

  // TASK-012 Phase-4: double-click navigation. Wired from viewport.js
  // (`nav-experimental:doubleclick` → here) when the experimental flag is on.
  // Classifies what is under the cursor, computes a predictable "good view"
  // desired pose (navMath, pure), resolves it onto a clear non-buried camera
  // pose (never-raise + the shared TASK-024 clearance machinery), and eases
  // the camera there. The endpoint is the ONLY thing validated — the tween is
  // a committed motion (it may descend through an intervening roof).
  navigateDoubleClick(_payload) {
    if (this._isInactive()) return; // ortho / plan-view / compass — no-op
    const camera = this._camera;
    if (!camera || camera.type !== 'PerspectiveCamera') return;

    // (1) Single source of truth for "what's under the cursor" (M-4/H-B): the
    // raw A-Frame cursor intersection — NOT getIntersectedEl() (which remaps a
    // lane-child car up to the parent segment) and NOT cursorAnchor's own
    // differently-excluded raycast. The cursor raycasts continuously
    // (interval 100 ms) and the mouse is stationary at a double-click, so its
    // cached intersection is fresh; the payload coords are a redundant
    // fallback we don't need.
    const cursorEntity =
      typeof document !== 'undefined'
        ? document.getElementById('aframeInspectorMouseCursor')
        : null;
    const comps = cursorEntity ? cursorEntity.components : null;
    const cursorComp = comps ? comps.cursor : null;
    const raycasterComp = comps ? comps.raycaster : null;
    const rawEl = cursorComp ? cursorComp.intersectedEl : null;
    let hit = null;
    if (rawEl && raycasterComp) {
      if (typeof raycasterComp.getIntersection === 'function') {
        hit = raycasterComp.getIntersection(rawEl);
      }
      // Defensive: `getIntersection(el)` can return null in some A-Frame
      // states even when the cursor has an `intersectedEl`. The cursor derived
      // `rawEl` from the raycaster's closest intersection, so fall back to it —
      // `intersections[0]` carries `.point` and a `.object` we can walk up to
      // the owning entity.
      if (!hit && Array.isArray(raycasterComp.intersections)) {
        hit = raycasterComp.intersections[0] || null;
      }
    }

    // (2) Classify by owning-entity identity → category. D (no hit) → no-op.
    // (Street-level mode off: raycaster.js routes canvas double-clicks to the
    // legacy objectfocus instead, so this path only runs with the mode on.)
    const category = classifyDoubleClick(classifyHitEntity(hit));
    if (category === 'D') return;

    const hitPoint = new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
    let objectBox = null;
    if (category === 'B' || category === 'C') {
      let node = hit.object;
      let el = null;
      while (node) {
        if (node.el) {
          el = node.el;
          break;
        }
        node = node.parent;
      }
      const obj3D = el && el.object3D ? el.object3D : hit.object;
      objectBox = new THREE.Box3().setFromObject(obj3D);
      if (objectBox.isEmpty()) return; // degenerate — nothing to frame
    }

    // (3) Pre-click heading bearing (0 = +X/North, increasing toward +Z).
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const currentYaw = Math.atan2(fwd.z, fwd.x) * RAD2DEG;

    // (4) Desired pose (pure math).
    const desired = desiredDoubleClickPose({
      category,
      hitPoint,
      objectBox,
      currentYaw,
      eyeHeight: EYE_MARGIN_METRES
    });
    if (!desired) return;
    const position = desired.position;
    const lookTarget = desired.lookTarget;

    // (5) Never-raise — DC6′, AGL-relative (spec delta
    // TASK-012-phase4-navheight-delta, supersedes the absolute-Y DC6/H4): the
    // camera may never sit higher above the LOCAL collision floor than it
    // currently does. Measure the current height above the floor beneath the
    // camera; the per-column cap is applied in the clearance step below. A void
    // below the camera (no floor) → no downward reference → no cap.
    const currentCamY = camera.position.y;
    const curFloor = this._probe.collisionFloorAt(
      camera.position.x,
      camera.position.z,
      {
        refreshCache: false
      }
    );
    const currentAGL =
      curFloor.source === 'cache'
        ? Infinity
        : Math.max(0, currentCamY - curFloor.y);

    // (6) Resolve onto a sensible pose against the live scene (probe from the
    // CANDIDATE, not the live camera — H-1). A double-click ALWAYS moves; the
    // AGL cap constrains WHERE it lands, never WHETHER (spec delta).
    if (category === 'A') {
      // Lane landing: eye height above the clicked point, AGL-capped, not
      // buried. (A's clicked point guaranteed a hit; a 'cache' miss is
      // degenerate — keep the desired eye-height Y.)
      const floor = this._probe.collisionFloorAt(position.x, position.z, {
        fromY: position.y,
        refreshCache: false
      });
      if (floor.source !== 'cache') {
        const cap = floor.y + currentAGL; // DC6′ AGL never-raise
        if (position.y > cap) position.y = cap; // clamp down — never raise above AGL
        if (position.y < floor.y) position.y = floor.y; // not buried
      }
    } else {
      // B/C: frame at the desired (centre / ⅓-height) Y, AGL-capped, with
      // standoff pull-back out of solid. Always returns a pose (never no-op).
      position.copy(
        this._resolveStandoff(position, lookTarget, currentAGL, objectBox)
      );
    }

    // (7) End orientation from the (possibly lowered/capped) position toward
    // the look target. No Phase-4 path approaches nadir, so a plain
    // up=+Y lookAt is roll-safe (R2-5 guard, not a dependency).
    // Category B: re-apply the framing-pitch cap against the FINAL position
    // (round-3 H1) — never-raise/standoff lowered the camera since the pure
    // helper's first-pass cap, and WE-8 (street-level look-up at a tall tower)
    // is exactly the case where the final height is well below the desired one.
    let finalLook = lookTarget;
    if (category === 'B') {
      finalLook = clampFramingPitch(
        position,
        lookTarget,
        DOUBLECLICK_MAX_FRAMING_PITCH_DEGREES
      );
    }
    const scratch = new THREE.PerspectiveCamera();
    scratch.position.copy(position);
    scratch.up.set(0, 1, 0);
    scratch.lookAt(finalLook);
    const endQuat = scratch.quaternion.clone();

    // (8) Commit the motion. A mid-tween re-click cancels the in-flight tween
    // and restarts from the current (in-flight) pose — the live reads above
    // already used the mid-flight camera, so no jump.
    this._cancelCameraTween();
    this._teleportActive = true;
    this._easeToPose({
      position,
      quaternion: endQuat,
      // TASK-012 (R2-3/DC7): a fresh arrival discards any Phase-3 focal-zoom
      // FOV — tween FOV from its current (in-flight on a re-click) value to the
      // default so a telephoto arrival reframes smoothly (WE-11). Uses the
      // DEFAULT_FOV_DEGREES literal (TASK-025), NOT a construction-time
      // `camera.fov` capture — TASK-025 found that capture unreliable on a
      // re-attach mid-zoom, and 50 is the shared resting FOV across nav views.
      fromFov: camera.fov,
      toFov: DEFAULT_FOV_DEGREES,
      durationMs: FALL_DURATION_MS,
      onDone: () => {
        // DC7: a teleport is a non-wheel move → clear 022's transient memory.
        this._clearZoomUndo();
        // D4: recovery must not ease back to the pre-teleport pose.
        this._sensor.reseedLegitPose();
        // Landed pose is programmatic → re-eval mode/letterbox from the
        // resulting tilt now (not on the next mouse nudge).
        this._maybeEmitLbModeChange();
        // TASK-024a: a teleport is a load/teleport edge.
        this._groundedState.deriveFromPose();
        this._teleportActive = false;
        // TASK-025 (merge): refresh the context-button snapshot on settle, like
        // every other tween — so the button icon reflects the landed pose
        // immediately rather than one tick later.
        this._sensor.refreshContextSnapshot();
      }
    });
  }

  // TASK-012 (spec delta — AGL never-raise + always-move) + TASK-028 (spec
  // delta — never bounded to the finite scene): resolve a B/C standoff onto a
  // sensible, non-buried camera point. Per candidate column:
  //   - Floor present below the candidate → clamp the height to
  //     `floor + currentAGL` (DC6′ — never higher above the local floor than
  //     the camera currently is) and keep it above the floor (not buried).
  //   - Void below the candidate (probe miss — beyond a bounded scene's edge)
  //     → no floor to measure against, so keep the desired framing height
  //     unclamped. A double-click is NEVER bounded to the finite scene
  //     (TASK-028): a camera hanging over the void at framing distance, looking
  //     back at the edge item, is a valid pose — consistent with KD-02 (the
  //     finite-scene-boundary concept was removed system-wide) and WASD/fly,
  //     which holds height over the void rather than snapping back inside.
  // The accept-gate (`_poseStillLegit`, skipping the floor-clearance half —
  // the AGL clamp + not-buried already own height) runs for BOTH floored and
  // void columns: the floor's only jobs are the AGL cap and not-buried, and a
  // void column triggers neither. Pull the standoff inward (toward the look
  // target) ONLY when the candidate is inside SOLID (a building, WE-13) —
  // never merely because there is no ground beneath it. ALWAYS returns a
  // THREE.Vector3 — never null: the double-click must always move (the cap
  // constrains *where*, not *whether*). If no clear standoff is found within
  // the pull-back budget, fall back to the nominal (outermost floored)
  // candidate — the intended framing distance — rather than refusing.
  _resolveStandoff(position, lookTarget, currentAGL, targetBox) {
    const cand = position.clone();
    const step = DOUBLECLICK_STANDOFF_PULLBACK_STEP_METRES;
    let pulled = 0;
    let fallback = null; // first column with a real floor (nominal framing)
    while (pulled <= DOUBLECLICK_STANDOFF_PULLBACK_MAX_METRES) {
      const floor = this._probe.collisionFloorAt(cand.x, cand.z, {
        fromY: cand.y,
        refreshCache: false
      });
      // Floor present → DC6′ AGL never-raise + not-buried clamp. Void (probe
      // miss, beyond bounds) → leave the desired framing height untouched.
      if (floor.source !== 'cache') {
        const cap = floor.y + currentAGL; // DC6′ AGL never-raise
        if (cand.y > cap) cand.y = cap; // clamp down — never raise above AGL
        if (cand.y < floor.y) cand.y = floor.y; // not buried (below the floor)
        if (!fallback) fallback = cand.clone(); // nominal framing distance
      }
      // Accept unless inside SOLID. Same gate for floored and void columns; a
      // void standoff (not inside the target box, no overhead solid) passes
      // here and is taken at framing distance — never dragged inside (TASK-028).
      if (
        this._poseStillLegit(
          { position: cand },
          { checkBuried: true, extraBox: targetBox, skipFloorClearance: true }
        )
      ) {
        return cand;
      }
      // Inside solid → pull the standoff inward (toward the look target) and
      // re-test (WE-13).
      const next = pullBackTowardTarget(cand, lookTarget, step);
      cand.set(next.x, next.y, next.z);
      pulled += step;
    }
    // Always move: no clear standoff found within budget → the nominal floored
    // candidate, or (if no column had a floor at all) the desired position.
    return fallback || position.clone();
  }

  // TASK-012 (M-1/M-2): minimal committed-motion tween for a Phase-4
  // double-click teleport. Lerps position + quaternion (+ FOV) only, with a
  // simple onDone — DISTINCT from `_tweenToPose` (the recovery ease-back),
  // which embeds CR-D2 per-tick re-validation + the `_popToRoof` hand-off,
  // none of it teleport-relevant (the teleport endpoint is pre-validated, so
  // it needs no mid-tween hand-off). The teleport is a committed motion: only
  // its endpoint is validated; the path is not per-frame collision-clamped.
  // Returns the TickAnimator handle. `_tweenToPose` is left untouched.
  _easeToPose({
    position,
    quaternion,
    fromFov,
    toFov,
    durationMs,
    onTick,
    onDone
  }) {
    const camera = this._camera;
    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();
    const endPos = position.clone();
    const endQuat = quaternion.clone();
    const animateFov = fromFov != null && toFov != null;
    return this._tick.animate({
      durationMs,
      onTick: (eased) => {
        camera.position.lerpVectors(startPos, endPos, eased);
        camera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        if (animateFov) {
          camera.fov = fromFov + (toFov - fromFov) * eased;
          camera.updateProjectionMatrix();
        }
        camera.updateMatrixWorld();
        if (onTick) onTick(eased);
        this.dispatchEvent(this._changeEvent);
      },
      onDone: () => {
        camera.position.copy(endPos);
        camera.quaternion.copy(endQuat);
        if (animateFov) {
          camera.fov = toFov;
          camera.updateProjectionMatrix();
        }
        camera.updateMatrixWorld();
        if (onDone) onDone();
        this.dispatchEvent(this._changeEvent);
      }
    });
  }

  // Grounded-state surface. The state and logic live in the GroundedState
  // service (this._groundedState); these thin instance-level accessors exist
  // because the characterization suite pins `_grounded` / `_captureH` /
  // `_deriveGroundedFromPose` on the controls instance. Production code inside
  // this class reads the service directly.
  get _grounded() {
    return this._groundedState.grounded;
  }

  set _grounded(v) {
    this._groundedState.grounded = v;
  }

  _captureH() {
    this._groundedState.captureH();
  }

  _deriveGroundedFromPose() {
    this._groundedState.deriveFromPose();
  }


  // TASK-024 (3c): pop-to-daylight. One up-ray collects accepted overhead
  // solids in the camera column; target just above the HIGHEST one
  // (+ EYE_MARGIN) so a single press clears a multi-slab / nested stack
  // (D6). Vertical only (preserve yaw/pitch). Probe-miss → no-op (don't
  // bury at a stale height).
  _popToRoof() {
    const camera = this._camera;
    const probe = this._sensor.enclosureProbe();
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
          const reprobe = this._sensor.enclosureProbe();
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
        // TASK-022 (C3 / HIGH-2): pop-to-roof is a non-wheel vertical move.
        // The two early-return no-op branches above never tick, so they
        // correctly leave the memory intact. Idempotent.
        this._clearZoomUndo();
        this.dispatchEvent(this._changeEvent);
      },
      onDone: () => {
        camera.position.y = targetY;
        this.center.y = startCenterY + (targetY - startY);
        camera.updateMatrixWorld();
        this._clearZoomUndo(); // TASK-022 (C3 / HIGH-2)
        this._recoveryActive = false;
        // TASK-024a (D1, 1.2.3): a pop-to-roof / pop-to-daylight lands you
        // standing on that roof → grounded. (The two early-return no-op
        // branches above must NOT set this — the camera wasn't moved onto a
        // surface there.)
        this._groundedState.grounded = true;
        this._sensor.reseedLegitPose();
        this._sensor.refreshContextSnapshot(); // TASK-025 (H4)
        this.dispatchEvent(this._changeEvent);
      }
    });
  }

  _onWheel(event) {
    // TASK-012 (M-3): a camera-owning tween (recovery or teleport) owns the
    // camera — passive wheel input is ignored, not raced (L-3).
    if (this._isInactive() || this._tweenOwnsCamera()) return;
    event.preventDefault();

    // Feature-discovery: first wheel zoom this session.
    captureNavDiscovery('zoom');

    // TASK-014a (#6 Option B): accumulate only — apply no motion here (the
    // drain owns motion + recovery suppression, exactly as before). Normalise
    // the event to a signed fractional "nominal tick" count (deltaMode-aware,
    // per-event clamped) and add it to the continuous accumulator.
    const viewportH =
      typeof window !== 'undefined' && window.innerHeight
        ? window.innerHeight
        : 800;
    this._wheelAccum += wheelDeltaToTicks(
      event.deltaY,
      event.deltaMode,
      viewportH
    );
    // A4: bound the accumulator (replaces the old WHEEL_MAX_BUDGET clamp, in
    // the same place). High/FOV drain the whole accumulator each frame so they
    // can't pile up, but the swoop drains only a few ticks/frame — without this
    // a sustained fast scroll would build a runaway tail that keeps descending
    // long after the input stops.
    if (this._wheelAccum > WHEEL_MAX_ACCUM_TICKS) {
      this._wheelAccum = WHEEL_MAX_ACCUM_TICKS;
    } else if (this._wheelAccum < -WHEEL_MAX_ACCUM_TICKS) {
      this._wheelAccum = -WHEEL_MAX_ACCUM_TICKS;
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
    // LB drags only: an RMB rotate is Shift-independent (legacy parity —
    // EditorControls' Shift toggle applied to `event.buttons === 1` only).
    if (this._gestureButton !== 0) return;
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
    // TASK-025 v2 (R2-REV-F / finding 6): Space focus-yield. `_onKeyDown` is a
    // WINDOW keydown listener, so `event.target` is the focused element. When an
    // interactive control (button, link, the compass `role=button` div, the
    // context action slot, etc.) is focused, Space belongs to THAT control —
    // return WITHOUT preventDefault and WITHOUT triggering nav, so the focused
    // control owns the key (its own keydown handler activates it; a real
    // <button> activates natively). Placed BEFORE the `_isInactive` early-return
    // so the guard applies consistently in both active and inactive states — a
    // focused button must never trigger nav, and Space must never double-fire.
    if (event.code === 'Space' && this._isInteractiveTarget(event.target)) {
      return;
    }
    if (this._isInactive()) return;
    if (this._isTypingTarget(event.target)) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const k = event.code;
    // Both WASD and arrow keys drive movement. The original W/S/D
    // editor shortcuts (translate-mode, scale-mode, clone-entity) were
    // remapped to T/L/C in shortcuts.js on 2026-05-09 so WASD is free
    // for camera movement.
    // First-person kit off: movement keys are NOT claimed — no
    // preventDefault, no held-key tracking — so w/s/d fall through to the
    // legacy editor shortcuts that shortcuts.js keeps live in that mode.
    if (this._wasdEnabled && MOVEMENT_KEY_CODES.has(k)) {
      // Interplay: ENTERING WASD mode (first movement key down from idle)
      // ends an in-progress rotation gesture. Edge-detected on the empty
      // set so auto-repeat keydowns and additional movement keys do NOT
      // end a rotation started while already moving — only the WASD-mode
      // boundary does (the matching exit edge lives in `_onKeyUp`).
      if (this._heldKeys.size === 0) this._endRotationGestureForWasd();
      this._heldKeys.add(k);
      // Prevent the browser from scrolling the page (arrow keys) or
      // shifting focus in scrollable panels while driving the camera.
      event.preventDefault();
      return;
    }

    // TASK-024 (3d) / TASK-025: Space — discrete context-action key (not a
    // held key). Only reached when focus is NOT on an interactive control (the
    // focus-yield guard above handles that case) — i.e. the canvas/body has
    // focus, so Space is the nav key here: preventDefault (suppress scroll) +
    // dispatch. Routes through the SAME resolver + dispatch as the view button,
    // so the two never disagree (spec "one resolver, two triggers").
    // `triggerContextAction` owns the full gate (busy = inactive / animating /
    // recovery), so an un-gated Space mid-tween can no longer cancel/restart a
    // motion (H-5). This adds the third rung Space lacked in 024: at street
    // level Space now rises to drone view (was a no-op).
    if (k === 'Space') {
      event.preventDefault(); // stop page scroll
      // TASK-025 supersedes TASK-024's Space→fall: Space now routes through the
      // shared context resolver (the view-button action). Its `busy` gate
      // includes `_tick.isAnimating()`, so Space is inert during a Phase-4
      // teleport tween (TASK-012) — no separate guard needed here.
      this.triggerContextAction();
    }
  }

  // TASK-025: the shared context resolver — a PURE READ of the per-tick
  // `_contextSnapshot` (it does NOT probe). Returns { kind, enabled, busy }:
  //   kind    — 'daylight' | 'street' | 'drone' (the destination state; the
  //             icon shows where the button will take you, spec D-C).
  //   enabled — false = the no-op grey-out (no valid target for `kind`).
  //   busy    — a tween is in flight or the controls are inactive; both
  //             triggers are inert and the button holds its last icon greyed.
  // The resolver is the SINGLE authority on busy/enabled — the button never
  // independently inspects `_tick` (round-1 M5). Precedence ladder (fixed
  // order — load-bearing, spec): enclosed → daylight; elevated → street;
  // else (at street level) → drone.
  resolveContextAction() {
    const s = this._sensor.contextSnapshot;
    const camY = this._camera.position.y;
    const busy =
      this._isInactive() || this._tick.isAnimating() || this._recoveryActive;
    if (busy) {
      // Hold the last resolved icon, greyed, for the whole tween/inactive
      // window. (`_isInactive` already covers plan-view / compass tweens,
      // which run on the shared `_tick` slot — one authoritative busy.)
      return { kind: this._lastResolvedKind, enabled: false, busy: true };
    }

    let kind;
    let enabled;
    if (s.enclosed) {
      // Daylight: pop up to the nearest clear surface above. Grey out when
      // there is nothing above to pop to / we are already above it — mirrors
      // `_popToRoof`'s two no-op early-returns.
      kind = 'daylight';
      enabled =
        s.topOverhead != null && s.topOverhead + EYE_MARGIN_METRES > camY;
    } else if (s.elevationState === 'elevated') {
      // Street-level mode off: there is no street action to offer from an
      // elevated pose. 'none' hides the button entirely (ContextViewButton
      // renders nothing for it) and `triggerContextAction` / Space no-op.
      if (!this._streetLevelEnabled) {
        this._lastResolvedKind = 'none';
        return { kind: 'none', enabled: false, busy: false };
      }
      // Street view. Enabled mirrors `_swoopToStreet` EXACTLY (R4): it swoops to
      // the camera-centre look-at when tilted past T, else drops vertically to
      // the floor below. So it has a target — and the button is enabled — when
      // EITHER the look-at swoop (tilt > T, a per-column floor at the look-at
      // below us) OR the vertical drop (a floor below us) would move. Grey out
      // only when neither does (over the void with nothing in view, WE-8). This
      // is why a fresh load looking down at the street from over the scene edge
      // is correctly ENABLED even though nothing is directly below.
      kind = 'street';
      const tiltedToGround =
        cameraTiltDegrees(this._camera) > this._tiltThreshold;
      const lookAtOk =
        s.lookAtFloorY != null && s.lookAtFloorY + EYE_MARGIN_METRES < camY;
      const belowOk =
        s.floorY != null &&
        isFinite(s.floorY) &&
        s.floorY + EYE_MARGIN_METRES < camY;
      enabled = (tiltedToGround && lookAtOk) || belowOk;
    } else {
      // Drone view: rise. Never greys — it always targets a height above the
      // surface below, rising past an overhang if need be (spec D-A).
      kind = 'drone';
      enabled = true;
    }
    this._lastResolvedKind = kind; // hold across the next busy frame
    return { kind, enabled, busy: false };
  }

  // TASK-025: the single dispatch both the button click and Space funnel into.
  // One gate (busy || !enabled), shared by both triggers (H-5), so neither can
  // interrupt an in-flight camera tween or click into a no-op.
  triggerContextAction() {
    const { kind, enabled, busy } = this.resolveContextAction();
    if (busy || !enabled) return;
    if (kind === 'daylight') return this._popToRoof();
    if (kind === 'street') return this._swoopToStreet();
    if (kind === 'drone') return this._riseToDrone();
    return undefined;
  }

  // TASK-025 v2 (R2-REV-B): street view is a DESCENDING SWOOP to the point you
  // are LOOKING AT, not the point directly below. Anchor = the camera-center
  // ground hit (`_centerRayGroundHit`, a forward raycast to the collision
  // floor). The motion is still the v1 `_fallTo` TWEEN MECHANISM (pre-computed
  // start→end pose + linear position lerp + quaternion slerp) — NOT
  // `_dollyAlongRay` (its 15 m lateral cap can't reach a distant look-at point)
  // and NOT the wheel tilt-coupling (welded to wheel accumulator state). The
  // only change from v1 is the END POSE: when the look-at hit `P` is non-null,
  // we land at street eye-height AT `P` (not straight down). The combined
  // down+forward translation + the tilt slerp gives the forward-and-down swoop
  // arc to the spot you were looking at — "drop the pegman where I am looking".
  _swoopToStreet() {
    if (!this._streetLevelEnabled) return; // gated upstream; belt-and-braces
    const cam = this._camera;
    const P = this._probe.centerRayGroundHit();
    // Discriminate the two street-view cases by HOW STEEPLY you are looking down
    // (live-test v2 #2). The look-at point sits on the view ray, so the swoop's
    // descent-path angle IS the camera pitch: a shallow gaze means "big
    // horizontal / tiny drop" = a lurch. So swoop to the look-at ONLY when
    // pitched down past the low-tilt threshold (`_tiltThreshold`, the SAME T the
    // wheel-zoom / Map-mode boundary uses — "are you looking down enough to be
    // targeting the ground"); otherwise drop straight down to settle back where
    // you were. This makes the drone→street toggle (steep, ~60°) swoop to your
    // start, while a small pedestal-up-looking-forward just drops vertically.
    // (Supersedes the crude absolute distance cap — the lurch happens within it
    // at low elevation, and it wrongly blocked legit far swoops when high+steep.)
    const lookingDownEnough = cameraTiltDegrees(cam) > this._tiltThreshold;
    if (P && lookingDownEnough) {
      // Look-at swoop: end at street eye-height above the look-at point P.
      const floorAtP = this._probe.collisionFloorAt(P.x, P.z);
      // Prefer the per-column collision floor at P (slope-safe); if that misses
      // (P sits over a void seam), fall back to P.y itself (the ray hit).
      const groundYAtP = floorAtP.source !== 'cache' ? floorAtP.y : P.y;
      const targetY = groundYAtP + EYE_MARGIN_METRES;
      // Only swoop if the target is strictly below the camera (else the click
      // would be a silent no-op though the button reads enabled — v2 MEDIUM-1);
      // otherwise fall through to the vertical drop.
      if (targetY < cam.position.y) {
        this._swoopTo(P.x, targetY, P.z);
        return;
      }
    }
    // P null (looking at sky / off-scene), a shallow gaze (looking out, not down
    // at a spot), or an unsuitable look-at (above the camera): fall back to the
    // v1 VERTICAL drop to the surface directly below, leveling out — preserves
    // WE-3 and gives the "settle back down where I was" feel for a small pedestal.
    const floor = this._probe.collisionFloorAt(cam.position.x, cam.position.z);
    if (floor.source === 'cache') return; // no surface below either → no-op (WE-8)
    const targetY = floor.y + EYE_MARGIN_METRES;
    if (targetY >= cam.position.y) return; // already at/below
    this._fallTo(targetY, /* levelOut = */ true); // v1 vertical level-out swoop
  }

  // TASK-025 v2 (R2-REV-B): the look-at descending swoop tween. End pose =
  // (endX, endY, endZ) at street eye-height over the look-at point, yaw kept,
  // pitch leveled to ~0° (the v1 street landing). Position is interpolated
  // LINEARLY start→end (x and z change too, unlike `_fallTo`'s y-only lerp) and
  // the quaternion is slerped to a level orientation. Carries the v1 `_fallTo`
  // onDone lifecycle discipline verbatim (grounded=true, _clearZoomUndo,
  // _reseedLegitPose, _refreshContextSnapshot). No mid-tween floor retarget here
  // (the target column is the look-at point, fixed at commit; the destination is
  // street level and clear by construction — 024 permits passing through solid
  // mid-swoop, forbidding only ending inside).
  _swoopTo(endX, endY, endZ) {
    const cam = this._camera;
    const startPos = cam.position.clone();
    const startCenter = this.center.clone();
    const startQuat = cam.quaternion.clone();
    // Level (tilt=0) end orientation preserving yaw, the v1 `_fallTo` levelOut
    // way: scratch camera at the end position, looking 1 m ahead along the live
    // horizontal forward.
    const scratch = new THREE.PerspectiveCamera();
    scratch.position.set(endX, endY, endZ);
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    scratch.lookAt(endX + fwd.x, endY, endZ + fwd.z);
    const endQuat = scratch.quaternion.clone();
    // Center tracks the camera's translation in lockstep (orbit pivot rides
    // along, as `_fallTo`/`_popToRoof` do for y; here all three axes move).
    const endPos = new THREE.Vector3(endX, endY, endZ);
    const endCenter = new THREE.Vector3(
      startCenter.x + (endX - startPos.x),
      startCenter.y + (endY - startPos.y),
      startCenter.z + (endZ - startPos.z)
    );
    this._recoveryActive = true;
    this._tick.animate({
      durationMs: FALL_DURATION_MS,
      onTick: (eased) => {
        cam.position.lerpVectors(startPos, endPos, eased);
        this.center.lerpVectors(startCenter, endCenter, eased);
        cam.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        cam.updateMatrixWorld();
        this._clearZoomUndo();
        this.dispatchEvent(this._changeEvent);
      },
      onDone: () => {
        cam.position.set(endX, endY, endZ);
        this.center.copy(endCenter);
        cam.quaternion.copy(endQuat);
        cam.updateMatrixWorld();
        this._clearZoomUndo();
        this._recoveryActive = false;
        // Lands at collisionFloor + eye-margin → grounded by construction,
        // mirroring `_fallTo`'s street landing.
        this._groundedState.grounded = true;
        this._sensor.reseedLegitPose();
        this._maybeEmitLbModeChange();
        this._sensor.refreshContextSnapshot(); // TASK-025 (H4)
        this.dispatchEvent(this._changeEvent);
      }
    });
  }

  // TASK-025 v2 (R2-REV-B): drone view — an ASCENDING / REVERSE SWOOP. The
  // camera pulls UP-AND-BACK along its horizontal heading to a canonical height
  // H, ending at the 60° overview attitude LOOKING AT the feet point F (so the
  // round-trip closes: from drone, the center-ray hit ≈ F, and street swoops
  // back down to F). Anchor = the FEET (`_collisionFloorAt` below the camera),
  // which is ALWAYS defined → drone has no null case (spec D-A: drone never
  // greys). This is the v1 TWEEN MECHANISM (pre-computed start→end pose + linear
  // position lerp + quaternion slerp + FOV lerp) with a CLOSED-FORM end pose —
  // NOT `_dollyAlongRay`, NOT the wheel tilt-coupling. A separate method from
  // `_fallTo` (opposite grounded semantics: drone leaves the surface upward →
  // `_grounded = false` + `_captureH`).
  _riseToDrone() {
    const cam = this._camera;
    // Anchor = the feet (surface directly below). Feet-miss fallback (R2-REV-B /
    // round-2 §3d): `_collisionFloorAt` returns source 'cache' on a miss (over a
    // void); substitute the travel-height ground for F.y so the void case
    // degrades to a sane pose. `_collisionFloorAt` refreshes the floor cache
    // (refreshCache: true) — NOT a pure read; call it exactly once. The `busy`
    // gate prevents interleave with an in-flight `_fallTo` retarget (M6).
    const groundLevel = this._probe.travelHeightFloorYBelow();
    const floor = this._probe.collisionFloorAt(cam.position.x, cam.position.z);
    // surfaceBelow = the collision floor directly below (the roof you stand on,
    // for the ROOF_CLEARANCE term) AND the feet point the drone looks AT / offsets
    // back from. On a feet-miss (cache, over a void) substitute groundLevel so the
    // back-offset and lookAt target stay sane. Same value for both uses.
    const surfaceBelow = floor.source !== 'cache' ? floor.y : groundLevel;
    const feetY = surfaceBelow;
    const camX = cam.position.x;
    const camZ = cam.position.z;
    // Canonical target height (v1 max(...)): default drone height above GROUND
    // LEVEL (travel height — looks past tall buildings to the ground between
    // them), OR a fixed clearance above the ROOF directly below when atop a
    // building taller than that. Both per-column raycasts (slope-safe). Keeps
    // the drone reliably "elevated" for the toggle (b1).
    let targetY = Math.max(
      groundLevel + DEFAULT_DRONE_HEIGHT,
      surfaceBelow + ROOF_CLEARANCE
    );

    // Horizontal forward (heading); the back-offset is OPPOSITE this.
    const fwdH = new THREE.Vector3();
    cam.getWorldDirection(fwdH);
    fwdH.y = 0;
    if (fwdH.lengthSq() < 1e-6) fwdH.set(0, 0, -1);
    fwdH.normalize();

    // Closed-form end (x,z): pull BACK along the heading by d so the camera at
    // height H looking at F sits at DEFAULT_OVERVIEW_TILT_DEGREES (60°) below
    // horizontal. d = (H − F.y) / tan(tilt). At 60° → d ≈ 0.577·(H−F.y).
    const tiltRad = DEFAULT_OVERVIEW_TILT_DEGREES * DEG2RAD;
    const computeEndXZ = (H) => {
      const d = (H - feetY) / Math.tan(tiltRad);
      return { x: camX - fwdH.x * d, z: camZ - fwdH.z * d };
    };

    // WE-7 overhang end-pose check: the rise may pass THROUGH solid mid-motion
    // (024 permits that), but the END pose must be clear. If the end column is
    // itself enclosed (overhead solid above targetY — multiple floors), raise
    // the target to just above the highest overhead solid there (a daylight-
    // style pop). One extra raycast at commit time only. Keeps drone's "never
    // greys" property — it always ends in open air. (Probe the END (x,z), which
    // is offset back from the camera column.) Streaming-in-overhead mid-rise
    // retarget is deferred polish — the rise is short (600 ms).
    let endXZ = computeEndXZ(targetY);
    const endProbe = this._sensor.enclosureProbeAt(endXZ.x, targetY, endXZ.z);
    if (endProbe.overheadHits.length) {
      const popTargetY =
        endProbe.overheadHits[endProbe.overheadHits.length - 1] +
        EYE_MARGIN_METRES;
      targetY = Math.max(targetY, popTargetY);
      endXZ = computeEndXZ(targetY); // recompute back-offset for the raised H
    }

    if (targetY <= cam.position.y) return; // already at/above canonical height

    const startPos = cam.position.clone();
    const startCenter = this.center.clone();
    const startFov = cam.fov;
    const startQuat = cam.quaternion.clone();

    // End quaternion: a scratch camera at the end position looking AT the feet
    // point F = (camX, feetY, camZ), up=+Y. At 60° there is no nadir/roll
    // singularity (TASK-023 is about the straight-down case only). Yaw is
    // preserved by construction (the back-offset is along the heading; lookAt(F)
    // keeps the same azimuth).
    const endX = endXZ.x;
    const endZ = endXZ.z;
    const scratch = new THREE.PerspectiveCamera();
    scratch.position.set(endX, targetY, endZ);
    scratch.up.set(0, 1, 0);
    scratch.lookAt(camX, feetY, camZ);
    const endQuat = scratch.quaternion.clone();

    const endPos = new THREE.Vector3(endX, targetY, endZ);
    const endCenter = new THREE.Vector3(
      startCenter.x + (endX - startPos.x),
      startCenter.y + (targetY - startPos.y),
      startCenter.z + (endZ - startPos.z)
    );

    this._recoveryActive = true; // suspend WASD; hold the busy gate
    this._tick.animate({
      durationMs: FALL_DURATION_MS,
      onTick: (eased) => {
        cam.position.lerpVectors(startPos, endPos, eased);
        this.center.lerpVectors(startCenter, endCenter, eased);
        cam.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        cam.fov = startFov + (DEFAULT_FOV_DEGREES - startFov) * eased;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        this._clearZoomUndo();
        this.dispatchEvent(this._changeEvent);
      },
      onDone: () => {
        cam.position.copy(endPos);
        this.center.copy(endCenter);
        cam.quaternion.copy(endQuat);
        cam.fov = DEFAULT_FOV_DEGREES;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
        this._clearZoomUndo();
        this._recoveryActive = false;
        // Drone view deliberately leaves the surface upward → flying, and
        // re-capture the cruise height (mirrors `_checkUngroundOnRise`).
        this._groundedState.grounded = false;
        this._groundedState.captureH();
        this._sensor.reseedLegitPose();
        this._sensor.refreshContextSnapshot(); // TASK-025 (H4): flip icon drone→street
        this.dispatchEvent(this._changeEvent);
      }
    });
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
          const floor = this._probe.collisionFloorAt(
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
        if (endQuat) {
          camera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        }
        camera.updateMatrixWorld();
        // TASK-022 (C3 / HIGH-2): Space fall / level-out swoop is a non-wheel
        // descent. Callers (_swoopToStreet / triggerContextAction) early-return
        // on noop/pop/already-below, so a no-op Space never reaches this tween.
        // Idempotent.
        this._clearZoomUndo();
        this.dispatchEvent(this._changeEvent);
      },
      onDone: () => {
        camera.position.y = targetY;
        this.center.y = startCenterY + (targetY - startY);
        if (endQuat) camera.quaternion.copy(endQuat);
        camera.updateMatrixWorld();
        this._clearZoomUndo(); // TASK-022 (C3 / HIGH-2)
        this._recoveryActive = false;
        // TASK-024a (D1, 1.2.1 / WE-6): a Space fall / level-out swoop lands
        // the camera at collisionFloor + eye-margin → grounded by construction.
        this._groundedState.grounded = true;
        this._sensor.reseedLegitPose();
        this._maybeEmitLbModeChange();
        this._sensor.refreshContextSnapshot(); // TASK-025 (H4)
        this.dispatchEvent(this._changeEvent);
      }
    });
  }

  _onKeyUp(event) {
    // TASK-010 (B6): symmetric with `_onKeyDown` — same first-line sync.
    this._syncDragModeToShift(event.shiftKey);
    const k = event.code;
    const wasHeld = this._heldKeys.has(k);
    if (wasHeld) this._heldKeys.delete(k);
    // Interplay: releasing a held movement key ends an in-progress
    // rotation gesture — functionally equivalent to Shift-up / button-up,
    // even though the user may keep dragging. `_heldKeys` only ever holds
    // movement codes, so `wasHeld` doubles as the movement-key test (and
    // excludes keyups whose keydown was swallowed by a typing target).
    if (wasHeld) this._endRotationGestureForWasd();
  }

  // WASD ↔ rotation interplay: entering WASD mode (first movement key
  // down) or releasing any held movement key ends an in-progress rotation
  // gesture (Shift+LB or RMB — both latch mode 'rotate'). The latch ends
  // NOW — the still-held button keeps the window listeners until mouseup,
  // but every subsequent move no-ops and the Shift sync can't re-latch
  // (both gate on an active latch) — so rotating again requires a fresh
  // click / Shift press. Pan gestures are left alone (only rotation is
  // specced to yield to WASD).
  _endRotationGestureForWasd() {
    if (!this._latch.isActive()) return;
    if (this._latch.get('mode') !== 'rotate') return;
    this._latch.end();
    this._emitModeChange(null);
    this._indicator.hide();
    this._maybeEmitLbModeChange();
  }

  _isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (target.isContentEditable) return true;
    return false;
  }

  // TASK-025 v2 (R2-REV-F): a SUPERSET of `_isTypingTarget` — any focusable
  // interactive control that should own Space when focused. Covers native
  // buttons/links/form fields, contenteditable, ARIA `role="button"` divs (the
  // compass needle / rotate arrows are such divs), and anything with a tabindex
  // (focusable widgets). Used by `_onKeyDown` to yield Space to the focused
  // control rather than firing nav (and to avoid double-firing).
  _isInteractiveTarget(target) {
    if (!target) return false;
    if (this._isTypingTarget(target)) return true;
    const tag = target.tagName;
    if (tag === 'BUTTON') return true;
    if (tag === 'A' && target.hasAttribute && target.hasAttribute('href')) {
      return true;
    }
    if (target.getAttribute && target.getAttribute('role') === 'button') {
      return true;
    }
    if (target.hasAttribute && target.hasAttribute('tabindex')) return true;
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
    // after the drains so it captures the post-move pose. Suppressed while a
    // recovery OR teleport tween owns the camera (D2 / TASK-012 M-C) — the
    // legit snapshot must not capture a mid-flight teleport pose.
    if (!this._tweenOwnsCamera()) {
      this._updateLegitSnapshotAndCue();
    }
  }

  // The per-tick situation eval lives in the SituationSensor service. This
  // named delegator is kept on the instance because the characterization
  // harness's idle-gate break-check monkey-patches `_updateLegitSnapshotAndCue`
  // here; `_onTick` invokes it so the patch still intercepts.
  _updateLegitSnapshotAndCue() {
    this._sensor.update();
  }

  // TASK-014a (#6 Option B): continuous single-drain. ONE frame, ONE ground
  // snapshot, ONE net-vertical bracket, ONE recovery guard — all exactly as
  // before. The change vs the old budget drain: the high & FOV regimes apply
  // the WHOLE pending accumulator as a single continuous step (no
  // quantisation, no multi-frame lag), while the swoop still consumes whole
  // ticks under its per-frame rate-cap, carrying any sub-tick remainder to a
  // later frame. The five responsibilities the TASK-024/024a safety guard
  // depends on (floor snapshot, recovery suppression, swoop rate-cap,
  // net-vertical un-ground/captureH bracket, active phase-boundary hand-offs)
  // all stay in this one method.
  _drainWheel() {
    // TASK-024 (D2) / TASK-012 (M-3): a recovery OR teleport tween owns the
    // camera — drop queued wheel.
    if (this._tweenOwnsCamera()) {
      this._wheelAccum = 0;
      return;
    }
    if (this._wheelAccum === 0) return;
    // Snapshot the collision floor once per pass (TASK-013 → TASK-024). Every
    // step in the loop — including the recursive swoop ↔ high hand-offs —
    // reads this._frameGroundY so they see a single consistent ground for the
    // frame. The swoop reads the COLLISION floor (ground OR building roof OR
    // tiles), so a swoop over a building lands on the roof (WE-2 / C5).
    const frameFloor = this._probe.collisionFloorAt(
      this._camera.position.x,
      this._camera.position.z
    );
    this._frameGroundY = frameFloor.y;
    // TASK-024a (solid-geometry guard): track whether the probe hit a real
    // surface. On a miss (outside finite bounds) the swoop phase handlers skip
    // every ground-relative clamp so the wheel is a plain anchored dolly.
    this._frameGroundHit = frameFloor.source !== 'cache';
    let changed = false;
    // TASK-024a (1.3.2 / 2.2): capture y before the drain so the net vertical
    // move over the whole pass drives the grounded / H edges once — covering
    // reverse-swoop, low-tilt dolly-up, Phase-2 zoom-out and Ctrl+wheel
    // uniformly, without scattering flags across every wheel branch.
    const wheelStartY = this._camera.position.y;
    // The swoop rate-cap survives Option B unchanged: a whole-tick budget,
    // latched once at the start of the frame and held for it (re-reading per
    // iteration would unlock extra ticks at a boundary crossing — H4 of
    // `claude/reports/007-phase-3-plan-review.md`).
    let swoopTicksLeft = SWOOP_PHASE2_MAX_TICKS_PER_FRAME;
    const EPS_TICK = WHEEL_ACCUM_EPS_TICKS;
    while (Math.abs(this._wheelAccum) >= EPS_TICK) {
      const sign = this._wheelAccum > 0 ? 1 : -1;
      const regime = this._decideWheelRegime();
      if (regime === 'swoop') {
        // TASK-027 Part C: within the swoop band, a zoom-IN craning UP at a
        // solid wall / open sky breaks out to a cursor dolly; a zoom-OUT
        // unwinds any such break-out excursion back to the rail (Part C-add-2
        // "B") before resuming the swoop ascent.
        let breakout;
        if (sign < 0) {
          const r = this._classifyPhase2Target();
          this._notePhase2Regime(r);
          breakout = r === 'dolly';
        } else {
          breakout = this._breakoutDollyDepth > EPS_TICK;
        }
        if (breakout) {
          // Continuous break-out dolly. On the way out, cap the step at the
          // remaining excursion depth so it lands back on the rail and the
          // remainder re-dispatches to the swoop ascent next iteration.
          const t =
            sign < 0
              ? this._wheelAccum
              : Math.min(this._wheelAccum, this._breakoutDollyDepth);
          const tApplied = this._applyBreakoutDolly(t);
          if (tApplied === 0) break;
          this._wheelAccum -= tApplied;
          if (sign < 0) this._breakoutDollyDepth += Math.abs(tApplied);
          else {
            this._breakoutDollyDepth = Math.max(
              0,
              this._breakoutDollyDepth - Math.abs(tApplied)
            );
          }
          changed = true;
        } else {
          // A1: only fire the swoop on a WHOLE available tick AND with rate-cap
          // headroom. A sub-tick remainder (e.g. 0.3) must NOT drive a full
          // whole-tick descent — carry it to a later frame instead.
          if (swoopTicksLeft < 1 || Math.abs(this._wheelAccum) < 1) break;
          // TASK-027 Part D: restore the entry zoom-undo memory when the swoop
          // is reached without a Phase-1 boundary capture (the no-ground
          // free-descent bypass). Guarded by `!valid` ⇒ a no-op once captured.
          if (sign < 0 && !this._zoomUndo.valid) {
            this._zoomUndo = nextZoomUndo(this._zoomUndo, {
              type: 'wheel-in-crossing',
              tilt: cameraTiltDegrees(this._camera),
              fov: this._camera.fov
            });
          }
          this._applyPhase2WheelTick(sign); // whole-tick internals unchanged
          this._wheelAccum -= sign; // consume one whole tick
          swoopTicksLeft -= 1;
          this._breakoutDollyDepth = 0; // a swoop tick commits the excursion
          changed = true;
        }
      } else {
        // high / lowtilt / fov: leaving the swoop band — reset the Part-C
        // excursion + regime tracker so a stale value can't spuriously clear a
        // fresh descent's memory. Apply the ENTIRE remaining accumulator as one
        // continuous step (a zoom-in crossing phase1→phase2 stops at the
        // boundary; the remainder re-dispatches to the swoop). Returns the
        // ticks actually consumed.
        this._lastSwoopRegime = null;
        this._breakoutDollyDepth = 0;
        const tApplied = this._applyContinuousHighStep(
          this._wheelAccum,
          regime
        );
        if (tApplied === 0) break; // safety: no progress → stop (no spin)
        this._wheelAccum -= tApplied;
        changed = true;
      }
    }
    if (Math.abs(this._wheelAccum) < EPS_TICK) this._wheelAccum = 0;
    if (changed) {
      const EPS = 1e-3;
      if (this._camera.position.y > wheelStartY + EPS) {
        // Net-upward pass — deliberate up-move leaves the surface (1.3.2).
        this._groundedState.checkUngroundOnRise(wheelStartY);
      } else if (
        this._camera.position.y < wheelStartY - EPS &&
        !this._groundedState.grounded
      ) {
        // Net-downward pass while still flying (a swoop landing this pass would
        // have grounded us, so the `!_grounded` test excludes that case) →
        // deliberate vertical nav: lower H (D4, 2.2).
        this._groundedState.captureH();
      }
      this.dispatchEvent(this._changeEvent);
    }
  }

  // Decide which regime the wheel is in RIGHT NOW (read each loop iteration
  // off the current, post-step camera pose). Extracted from the old
  // `_applyWheelTick` dispatch. Elevation-first (per H1 of
  // `claude/reports/007-phase-3-plan-review.md`): the swoop runs regardless of
  // tilt. TASK-014d collapsed the tilt-conditional anchor split — 'high' and
  // 'lowtilt' both dolly toward the cursor now (the lurch is bounded by the
  // lateral cap in the dolly step, not by switching anchor source), so the
  // two are treated identically by the drain; the labels are retained only to
  // mark the Ctrl / no-ground / low-tilt cases.
  //   'swoop'   — Phase 2 pedestal+tilt band (whole-tick, rate-capped)
  //   'fov'     — Phase 3 street-level FOV-only
  //   'lowtilt' — Ctrl+wheel, no-ground, or live tilt ≤ threshold dolly
  //   'high'    — cursor-anchored Phase 1 dolly
  _decideWheelRegime() {
    const camera = this._camera;
    // Ctrl+wheel (incl. Mac trackpad pinch) bypasses the swoop — plain
    // camera-Z dolly at the current tilt/elevation (Open Decision #2).
    if (this._lastWheelCtrlKey) return 'lowtilt';
    // Street-level mode off: never dispatch to the swoop (phase 2) or the
    // street FOV zoom (phase 3) — the wheel is a plain anchored dolly at
    // every height, the same behaviour Ctrl+wheel gives with the mode on.
    if (!this._streetLevelEnabled) {
      return cameraTiltDegrees(camera) <= this._tiltThreshold
        ? 'lowtilt'
        : 'high';
    }
    // TASK-024a (solid-geometry guard): no ground below → no swoop floor to
    // land on. Plain anchored dolly at the current tilt, never Phase 2/3.
    if (!this._frameGroundHit) {
      return cameraTiltDegrees(camera) <= this._tiltThreshold
        ? 'lowtilt'
        : 'high';
    }
    const yAgl = camera.position.y - this._frameGroundY;
    let phase = decideSwoopPhase(yAgl);
    // TASK-027 (live-test #3): float-robust / sticky street level — AGL within
    // a sub-centimetre tolerance of the floor counts as Phase 3 ('fov'), so a
    // rounding ulp at the just-landed boundary (`(groundY+1.5)−groundY` can
    // round to `1.5+ulp`) can't route a street FOV-zoom-out into an immediate
    // reverse swoop. 1 cm shift, imperceptible for swoop entry.
    if (
      phase === 'phase2' &&
      yAgl <= SWOOP_PHASE2_EXIT_ELEVATION_METRES + 0.01
    ) {
      phase = 'phase3';
    }
    if (phase === 'phase2') return 'swoop';
    if (phase === 'phase3') return 'fov';
    // phase1: tilt-conditional split (LIVE — read instantaneous tilt).
    return cameraTiltDegrees(camera) <= this._tiltThreshold
      ? 'lowtilt'
      : 'high';
  }

  // TASK-027 Part C: classify the current cursor target as a swoop landing
  // surface or a break-out dolly target. Resolves the cursor anchor (with the
  // additive hit normal) + camera look-direction and defers the cut to
  // navMath.classifySwoopTickTarget.
  _classifyPhase2Target() {
    const hit = this._cursorAnchor.worldPointAt(
      this._lastWheelClientX,
      this._lastWheelClientY,
      { maxGroundDist: WHEEL_GROUND_REACH_CEILING_METRES }
    );
    const isSolidFloor =
      hit.source === 'mesh' ? isSolidFloorHit(hit.raw) : true;
    // Break out only when craning UP at a wall/sky — looking down/level always
    // swoops (Part C-add-1). Tilt < 0 ⇒ looking above horizontal.
    const lookingUp = cameraTiltDegrees(this._camera) < 0;
    return classifySwoopTickTarget({
      source: hit.source,
      normalY: hit.normal ? hit.normal.y : null,
      isSolidFloor,
      lookingUp
    });
  }

  // TASK-027 Part C.3: a swoop↔dolly regime switch mid-descent is an intent
  // change — invalidate the transient zoom-undo memory (C2) and drop any
  // ascent anchor. Per-tick; no latched mode.
  _notePhase2Regime(regime) {
    if (this._lastSwoopRegime != null && regime !== this._lastSwoopRegime) {
      this._clearZoomUndo();
      this._ascentAnchor = null;
    }
    this._lastSwoopRegime = regime;
  }

  // TASK-027 Part C-add-2: one continuous break-out dolly step of `t` nominal
  // ticks (the same cursor-anchored dolly as Phase 1, but WITHOUT the
  // phase1→phase2 entry-boundary clamp — we are already inside the band). The
  // caller tracks the excursion depth and caps the unwind. Returns the ticks
  // applied (== t, or 0 if no cursor latch / no real anchor and vertical sky).
  _applyBreakoutDolly(t) {
    const camera = this._camera;
    const x = this._lastWheelClientX;
    const y = this._lastWheelClientY;
    if (x == null || y == null) return t; // no cursor latch → consume, no-op
    let hit = this._cursorAnchor.worldPointAt(x, y, {
      maxGroundDist: WHEEL_GROUND_REACH_CEILING_METRES
    });
    if (hit.source !== 'mesh' && hit.source !== 'ground') {
      hit = levelForwardAnchor(camera, FALLBACK_FORWARD_DIST);
      if (hit == null) return t; // near-vertical at sky → consume, no move
    }
    this._dollyAlongRay(dollyFactorForTicks(t, ZOOM_PER_WHEEL_TICK), hit);
    return t;
  }

  // TASK-014a (#6 Option B): apply `t` nominal ticks of high/lowtilt/FOV zoom
  // as ONE continuous step. Returns the ticks actually consumed (== `t` for
  // the interior case; a partial value when a boundary or clamp is hit so the
  // loop re-dispatches the remainder). `regime` is one of 'high' | 'lowtilt'
  // | 'fov' from `_decideWheelRegime`.
  //
  // Boundary handling (zoom-in crossing AGL 20 downward): clamp to the
  // Phase-2 entry and capture TASK-022's transient zoom-undo memory (entry
  // tilt + fov) via `nextZoomUndo`, exactly as the pre-Option-B
  // `_applyPhase1WheelTick` did — Phase 2's descent lerp reads `_zoomUndo.tilt`.
  _applyContinuousHighStep(t, regime) {
    const camera = this._camera;
    const sign = t > 0 ? 1 : -1;

    if (regime === 'fov') {
      // Phase 3 — FOV zoom at street level (TASK-027 Parts A + B; continuous
      // per TASK-014a). Part A: the wide end is the constant
      // PHASE3_FOV_WIDE_CAP_DEGREES (no per-entry latched baseline). Part B:
      // the world point under the cursor is PINNED as FOV changes by re-aiming
      // the camera (_applyPhase3Reaim). A2: the return rule is split by sign so
      // a remainder is never left stuck in the FOV regime (which would spin).
      const fovBefore = camera.fov; // H1: snapshot BEFORE any mutation
      const cap = PHASE3_FOV_WIDE_CAP_DEGREES;
      const floor = SWOOP_PHASE3_FOV_FLOOR_DEGREES;
      // Zoom-out at/above the wide cap → ACTIVE hand-off to the swoop (consume
      // ONE whole tick via the swoop kick-start; just returning the remainder
      // would re-dispatch to 'fov' forever since camera.y hasn't changed). Ends
      // the re-aim session (leaving Phase 3 upward).
      if (sign > 0 && camera.fov >= cap - 1e-6) {
        this._phase3Reaim = null;
        this._applyPhase2WheelTick(sign); // whole-tick swoop kick-start
        return sign;
      }
      let fov = camera.fov * fovFactorForTicks(t, FOV_PER_WHEEL_TICK);
      if (fov < floor) fov = floor;
      if (sign > 0 && fov > cap) fov = cap;
      camera.fov = fov;
      camera.updateProjectionMatrix();
      // Part B re-aim (skip on Ctrl, or a floored/capped no-op step).
      if (!this._lastWheelCtrlKey && fov !== fovBefore) {
        this._applyPhase3Reaim(fovBefore);
      }
      // Interior FOV step, or zoom-in pinned at the 15° floor. Consume the
      // ENTIRE remaining `t` so the loop terminates rather than spinning.
      return t;
    }

    // Dolly. TASK-014d collapsed the tilt-conditional anchor split: cursor-
    // anchor at EVERY tilt (the lurch is bounded by the lateral cap in
    // `_dollyAlongRay`, not by switching anchor source). Anchor dispatch on the
    // hit *source*: mesh/ground → a real target; fallback (open sky) → a
    // LEVEL-forward anchor so zoom-in advances forward at constant height
    // rather than drifting up into empty sky; near-vertical-at-sky → no move.
    const x = this._lastWheelClientX;
    const y = this._lastWheelClientY;
    if (x == null || y == null) return t; // no cursor latch → consume, no-op
    let hit = this._cursorAnchor.worldPointAt(x, y, {
      maxGroundDist: WHEEL_GROUND_REACH_CEILING_METRES
    });
    if (hit.source !== 'mesh' && hit.source !== 'ground') {
      hit = levelForwardAnchor(camera, FALLBACK_FORWARD_DIST);
      if (hit == null) return t; // near-vertical at sky → consume, no move
    }

    const groundY = this._frameGroundY;
    const yEntry = SWOOP_PHASE2_ENTRY_ELEVATION_METRES;

    // Boundary-aware zoom-in: if the full step would drop AGL below the
    // Phase-2 entry (and there IS a ground), stop exactly at the boundary and
    // hand the remainder to the swoop. TASK-014d: Ctrl+wheel is the swoop
    // BYPASS escape hatch — a plain cursor dolly at the current tilt that may
    // descend past AGL 20 without entering the swoop, so skip the boundary when
    // Ctrl is held. Street-level mode off: same bypass — there is no swoop to
    // hand off to, so the dolly descends freely.
    if (
      sign < 0 &&
      this._frameGroundHit &&
      !this._lastWheelCtrlKey &&
      this._streetLevelEnabled
    ) {
      const denom = camera.position.y - hit.y;
      const targetY = groundY + yEntry;
      // Would the full step land below the entry boundary?
      const fullFactor = dollyFactorForTicks(t, ZOOM_PER_WHEEL_TICK);
      const fullY = hit.y + fullFactor * denom;
      if (fullY < targetY) {
        // A3: degenerate denominator (near-horizontal anchor ≈ camera height)
        // — the analytic solve divides by ~0. Fall back to the proven
        // per-tick path: apply the full step, then post-step y-clamp exactly
        // as the old _applyPhase1WheelTick did, and consume the whole `t`.
        if (Math.abs(denom) <= WHEEL_ANCHOR_DENOM_EPS_METRES) {
          this._dollyAlongRay(fullFactor, hit);
          if (camera.position.y - groundY < yEntry) {
            camera.position.y = targetY;
            this._zoomUndo = nextZoomUndo(this._zoomUndo, {
              type: 'wheel-in-crossing',
              tilt: cameraTiltDegrees(camera),
              fov: camera.fov
            });
            camera.updateMatrixWorld();
          }
          return t;
        }
        // Solve for the tick fraction t* that lands AGL exactly at the entry:
        //   factor* = (groundY + yEntry − hit.y) / (cam.y − hit.y)
        //   t*      = −ln(factor*) / ln(1 − α)
        const factorStar = (targetY - hit.y) / denom;
        // factorStar should be in (0,1) for a normal descent toward a lower
        // anchor; guard against a non-positive (numerically degenerate) value.
        if (factorStar > 0 && factorStar < 1) {
          const alpha = ZOOM_PER_WHEEL_TICK;
          const tStar = -Math.log(factorStar) / Math.log(1 - alpha);
          this._dollyAlongRay(factorStar, hit);
          camera.position.y = targetY; // exact y-clamp (matches old behaviour)
          this._zoomUndo = nextZoomUndo(this._zoomUndo, {
            type: 'wheel-in-crossing',
            tilt: cameraTiltDegrees(camera),
            fov: camera.fov
          });
          camera.updateMatrixWorld();
          return tStar; // remainder (t − tStar) re-dispatches to the swoop
        }
        // Degenerate factor* — fall back to the full step + post-step clamp.
        this._dollyAlongRay(fullFactor, hit);
        if (camera.position.y - groundY < yEntry) {
          camera.position.y = targetY;
          this._zoomUndo = nextZoomUndo(this._zoomUndo, {
            type: 'wheel-in-crossing',
            tilt: cameraTiltDegrees(camera),
            fov: camera.fov
          });
          camera.updateMatrixWorld();
        }
        return t;
      }
    }

    // Interior step (no boundary crossing, or free descent with no ground):
    // apply the full continuous dolly and consume the whole `t`.
    this._dollyAlongRay(dollyFactorForTicks(t, ZOOM_PER_WHEEL_TICK), hit);
    return t;
  }

  // Translate the camera along the camera→hit ray by the continuous `factor`
  // (factor < 1 = closer; > 1 = farther), with the HORIZONTAL component of the
  // translation capped (TASK-014d, via cappedDollyStep). The cap scales the
  // whole step vector uniformly, so the move stays on the camera→hit ray
  // (target stays under the cursor) and reversibility about a fixed target is
  // exact. `factor` is the continuous generalisation of the old per-tick step
  // (dollyFactorForTicks(t)·dollyFactorForTicks(−t) === 1). A non-finite step
  // (degenerate grazing ray) is dropped — a no-op rather than NaN-ing the
  // camera. TASK-027 Part F: the cap scales with height — max(lowerBound,
  // 0.1×AGL) — bounding the lurch proportionally; falls to the lower bound on
  // the no-AGL path (Ctrl+wheel / out of bounds, where AGL is non-finite).
  _dollyAlongRay(factor, hit) {
    const camera = this._camera;
    const yAgl = this._frameGroundHit
      ? camera.position.y - this._frameGroundY
      : NaN;
    const cap = lateralCap(
      yAgl,
      this._wheelZoomLateralCapLowerBound,
      WHEEL_ZOOM_LATERAL_CAP_AGL_COEFF
    );
    const newPos = cappedDollyStep({
      camPos: camera.position,
      hit,
      factor,
      lateralCapMetres: cap
    });
    if (newPos == null) return; // non-finite step: skip this tick
    camera.position.copy(newPos);

    // Track far plane based on distance.
    const distance = camera.position.distanceTo(this.center);
    camera.far = Math.min(100000000, Math.max(20000, distance * 10));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // Whole-tick Phase 1 / low-tilt dolly used by the swoop's active hand-offs
  // (Phase 2 → Phase 1 zoom-out). These only ever hand off one whole tick's
  // worth, in the same drain pass that latched the cursor — so they keep the
  // pre-Option-B whole-tick form (sidesteps M7: a fractional swoop-exit anchor
  // never arises). Routes to the same `_dollyAlongRay` math the continuous
  // step uses, at the per-whole-tick factor.
  _applyPhase1WheelTick(sign) {
    const camera = this._camera;
    const x = this._lastWheelClientX;
    const y = this._lastWheelClientY;
    if (x == null || y == null) return;
    // TASK-014d collapsed anchor dispatch (same as the continuous step):
    // cursor at every tilt, level-forward on a no-real-hit (sky), no move when
    // the heading is vertical-undefined.
    let hit = this._cursorAnchor.worldPointAt(x, y, {
      maxGroundDist: WHEEL_GROUND_REACH_CEILING_METRES
    });
    if (hit.source !== 'mesh' && hit.source !== 'ground') {
      hit = levelForwardAnchor(camera, FALLBACK_FORWARD_DIST);
      if (hit == null) return; // near-vertical at sky → no move
    }
    this._dollyAlongRay(dollyFactorForTicks(sign, ZOOM_PER_WHEEL_TICK), hit);

    // TASK-024a (solid-geometry guard): no ground below → no Phase-2 boundary.
    if (!this._frameGroundHit) return;

    // Boundary: Phase 1 → Phase 2 on zoom-in (post-step y-clamp). TASK-022:
    // capture the zoom-undo memory at the crossing, same as the continuous step.
    const groundY = this._frameGroundY;
    if (
      sign < 0 &&
      this._streetLevelEnabled && // mode off: no Phase-2 boundary to clamp at
      camera.position.y - groundY < SWOOP_PHASE2_ENTRY_ELEVATION_METRES
    ) {
      camera.position.y = groundY + SWOOP_PHASE2_ENTRY_ELEVATION_METRES;
      this._zoomUndo = nextZoomUndo(this._zoomUndo, {
        type: 'wheel-in-crossing',
        tilt: cameraTiltDegrees(camera),
        fov: camera.fov
      });
      camera.updateMatrixWorld();
    }
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
  //   zoom-in: yAglNext ≤ yFloor → snap to floor, tilt to 0°, FOV eased to the
  //     landing FOV (Part A). Next tick dispatches naturally to Phase 3.
  //   zoom-in: yAglNext within SWOOP_PHASE2_FLOOR_SNAP_METRES of yFloor →
  //     snap (H6).
  //   zoom-out: yAgl in [0, yFloor + snap] → kick-start to yFloor + snap.
  //     The multiplicative reciprocal `1.5 + (yAgl-1.5)/(1-α)` is zero at
  //     yAgl=yFloor exactly, so without the kick-start zoom-out from
  //     street level produces no motion. The `yAgl >= 0` lower bound
  //     suppresses a stale-cache teleport (negative AGL — see below)
  //     while preserving every legitimate fresh-probe kick-start.
  //   zoom-out: yAglNext ≥ yCeil → clamp to groundY + yCeil, set tilt to
  //     the recomputed ascentTarget, hand the tick's energy to Phase 1.
  //
  // TASK-022 (model 1D): the DESCENT (zoom-in) tilt is unchanged — it lerps
  // the captured entry tilt (`_zoomUndo.tilt`) toward 0° via phase2TargetTilt.
  // The ASCENT (zoom-out) interpolates from the camera's LIVE current tilt
  // toward a target — the captured entry tilt if `_zoomUndo.valid`, else the
  // DEFAULT_OVERVIEW_TILT_DEGREES default — anchored at (startFrac, startTilt)
  // captured on the ascent's first tick (no jump, WE-5; exact reverse for an
  // immediate undo, C1). Both legs go through the roll-safe re-tilt below.
  _applyPhase2WheelTick(sign) {
    const camera = this._camera;
    const groundY = this._frameGroundY; // pass snapshot
    const yFloor = SWOOP_PHASE2_EXIT_ELEVATION_METRES; // AGL floor 1.5
    const yCeil = SWOOP_PHASE2_ENTRY_ELEVATION_METRES; // AGL ceil 20
    const snap = SWOOP_PHASE2_FLOOR_SNAP_METRES; // 1.0

    let yAgl = camera.position.y - groundY; // ← convert in

    // TASK-022: the swoop-OUT target, recomputed per-tick (NOT stored — the
    // wheel path never flips `_zoomUndo.valid` mid-ascent, so it is constant
    // across an ascent whether read once or per-tick). Memory valid → reverse
    // to the captured entry tilt; else ease to the default overview.
    const ascentTarget = this._zoomUndo.valid
      ? this._zoomUndo.tilt
      : DEFAULT_OVERVIEW_TILT_DEGREES;
    // TASK-027 Part A: the swoop-OUT FOV target mirrors the tilt — memory valid
    // → exact FOV undo (the captured entry FOV); else the default map FOV.
    const ascentTargetFov = this._zoomUndo.valid
      ? this._zoomUndo.fov
      : DEFAULT_MAP_FOV_DEGREES;

    if (sign > 0) {
      // ASCENT (zoom-out): atomically capture the ascent anchor on the FIRST
      // out-tick of this ascent (the sole writer, under the == null guard).
      // Only the TILT needs an anchor (the user can crane the camera mid-swoop,
      // so the ascent tilt must start from the live pose without a jump). FOV
      // can't be perturbed mid-band (only the wheel changes it), so the ascent
      // FOV is a pure function of height (swoopLandingFov) — no anchor needed.
      // `yAgl` here is the PRE-step height (matches the camera's live tilt read
      // below).
      if (this._ascentAnchor == null) {
        this._ascentAnchor = {
          frac: phase2HeightFrac(yAgl),
          tilt: cameraTiltDegrees(camera)
        };
      }
    } else {
      // DESCENT (zoom-in): reset the ascent anchor so the next ascent
      // re-captures from the live pose. Descent tilt semantics are unchanged.
      this._ascentAnchor = null;
    }

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
      // TASK-027 Part A: reach the landing FOV exactly at the floor (no latched
      // baseline; the wide cap is the PHASE3_FOV_WIDE_CAP_DEGREES constant).
      camera.fov = swoopLandingFov(
        yFloor,
        this._zoomUndo.fov,
        SWOOP_LANDING_FOV_DEGREES,
        SWOOP_FOV_RAMP_EXPONENT
      );
      camera.updateProjectionMatrix();
      // TASK-022: Phase-3 entry ends any ascent geometry; reset the anchor so
      // a fresh ascent re-captures from the live pose (already null on a
      // descent run, but explicit at the band exit).
      this._ascentAnchor = null;
      camera.updateMatrixWorld();
      // TASK-024a (D1, 1.2.2 / PA-3): the wheel swoop has no onDone — landing
      // IS this Phase-2→3 boundary crossing. DERIVE (don't force-true): the
      // landing height is groundY + SWOOP_PHASE2_EXIT_ELEVATION, a constant
      // INDEPENDENT of EYE_MARGIN, so deriving runs the real ≤ eye-margin test
      // against a fresh collision-floor probe and survives either constant
      // being retuned. `groundY` here is the collision floor under the camera,
      // so a swoop onto a roof grounds to the roof (D5/WE-7).
      this._groundedState.deriveFromPose();
      this._maybeEmitLbModeChange();
      return;
    }

    // Boundary: Phase 2 → Phase 1 on zoom-out. Hand the tick off
    // actively so the wheel click visibly continues past AGL=yCeil
    // rather than deadlocking at the boundary.
    if (sign > 0 && yAglNext >= yCeil) {
      camera.position.y = groundY + yCeil; // ← write back
      // TASK-022: the ceiling tilt is the recomputed ascentTarget (the
      // captured entry tilt if memory valid, else the default overview) — the
      // same target the per-tick ascent ramps toward. A ≤90° single-step arc,
      // applied via the roll-safe re-tilt (antiparallel guard not triggered).
      this._setCameraTiltPreservingYaw(ascentTarget);
      // TASK-027 Part A: set FOV to the ascent target in one step (mirrors the
      // tilt), so leaving the band upward always restores a sane FOV (entry FOV
      // if memory valid, else the 60° map default) — closing the stale-FOV
      // window where a re-descent would read a leftover-narrow `_zoomUndo.fov`.
      camera.fov = ascentTargetFov;
      camera.updateProjectionMatrix();
      // TASK-022: ascent complete at the ceiling: reset the anchor. Above the
      // ceiling the tilt is the user's to set freely (Phase 1 tilt-preserving).
      this._ascentAnchor = null;
      camera.updateMatrixWorld();
      this._maybeEmitLbModeChange();
      // Now dispatch a Phase 1 tick. TASK-014d collapsed the tilt split, so
      // this is always the cursor-anchored Phase-1 tick (reads the same
      // `this._frameGroundY` snapshot). This is a sign > 0 (zoom-out) tick
      // and the Phase-1 boundary clamp body is sign < 0-gated, so routing
      // through the full Phase-1 tick does NOT re-fire the clamp or re-latch
      // the ascent/undo tilt state (TASK-022) — exactly one anchored dolly
      // step happens here.
      return this._applyPhase1WheelTick(sign);
    }

    camera.position.y = groundY + yAglNext; // ← write back
    // TASK-022: per-tick re-tilt, branched on direction.
    //   sign < 0 (descent): unchanged — lerp the captured entry tilt → 0°.
    //   sign > 0 (ascent):  interpolate the ascent anchor (startFrac,
    //     startTilt) → ascentTarget, anchored so there is no jump (WE-5) and
    //     an immediate undo retraces the descent exactly (C1).
    if (sign < 0) {
      this._setCameraTiltPreservingYaw(
        phase2TargetTilt(yAglNext, this._zoomUndo.tilt)
      );
      // TASK-027 Part A: descent FOV ramp — ease the entry FOV open toward the
      // landing FOV as AGL falls, back-loaded into the final stretch.
      camera.fov = swoopLandingFov(
        yAglNext,
        this._zoomUndo.fov,
        SWOOP_LANDING_FOV_DEGREES,
        SWOOP_FOV_RAMP_EXPONENT
      );
    } else {
      this._setCameraTiltPreservingYaw(
        phase2AscentTilt(
          yAglNext,
          this._ascentAnchor.frac,
          this._ascentAnchor.tilt,
          ascentTarget
        )
      );
      // TASK-027 Part A: ascent FOV — a pure function of height (narrow =
      // ascent target), the SAME curve the descent drew, so an immediate undo
      // retraces it exactly; no anchor needed (FOV can't be perturbed mid-band).
      camera.fov = swoopLandingFov(
        yAglNext,
        ascentTargetFov,
        SWOOP_LANDING_FOV_DEGREES,
        SWOOP_FOV_RAMP_EXPONENT
      );
    }
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    // Toolbar visual indicator: Phase 2's tilt lerp crosses the 30°
    // boundary silently from the LB-mode comparator's perspective. Emit
    // here so the toolbar restyles in lock-step with the swoop. (Phase
    // 1 and Phase 3 are tilt-preserving, so no equivalent calls needed
    // there.)
    this._maybeEmitLbModeChange();
  }

  // (Phase 3 FOV-only zoom is now handled continuously inside
  // `_applyContinuousHighStep` (regime 'fov') — the old per-tick
  // `_applyPhase3WheelTick` was folded in for TASK-014a Option B. The
  // zoom-out→Phase-2 baseline hand-off and the lazy baseline latch live
  // there now.)

  // TASK-027 Part B — cursor-lock re-aim. Re-aims the camera so the world point
  // under the cursor stays pinned to the same screen pixel as FOV changes. The
  // orientation is rebuilt ABSOLUTELY from a captured baseline pose every tick
  // (not composed incrementally), so it is a pure function of FOV → exactly
  // reversible (WE-B2) and unwinds to the entry pose at baseline FOV (B.3). The
  // exact ordering is load-bearing (H1/H2/H3) — do not reorder:
  //   FOV already applied + updateProjectionMatrix (caller) →
  //   copy baselineQuat + updateMatrixWorld → raycast cursor pixel →
  //   slerp the minimal-arc QUATERNION by the continuity weight → premultiply.
  _applyPhase3Reaim(fovBefore) {
    const camera = this._camera;
    const ndc = this._cursorAnchor.ndcFor(
      this._lastWheelClientX,
      this._lastWheelClientY
    );

    // Baseline session: capture on the first Phase-3 tick; re-capture at the
    // current pose when the cursor PIXEL moves (a new aim — Δ starts at 0, no
    // jump). The target world point `P` is resolved ONCE at capture and held
    // for the whole session (live-test #3 fix): re-resolving the cursor target
    // every tick breaks the unwind — once the re-aim cranes the camera, the
    // cursor pixel points somewhere else (e.g. sky above the building), so on
    // zoom-out it can't find the original target to un-crane back to. A stable
    // P makes the re-aim a pure function of fov for the session → it unwinds
    // exactly back to the baseline (street) pose as the FOV widens. (This is
    // the notes' "first-frame-per-gesture capture"; the spec's WE-B caveat —
    // tile streaming voids retrace — is the accepted cost.) baselineFov is the
    // PRE-step FOV (H1).
    if (
      !this._phase3Reaim ||
      ndc.distanceTo(this._phase3Reaim.ndc) > PHASE3_REAIM_NDC_EPS
    ) {
      const hit = this._cursorAnchor.worldPointAt(
        this._lastWheelClientX,
        this._lastWheelClientY,
        { maxGroundDist: WHEEL_GROUND_REACH_CEILING_METRES }
      );
      this._phase3Reaim = {
        baselineQuat: camera.quaternion.clone(),
        baselineFov: fovBefore,
        ndc: ndc.clone(),
        // No real hit (open sky) at capture → no target to pin this session.
        targetP:
          hit.source === 'fallback'
            ? null
            : new THREE.Vector3(hit.x, hit.y, hit.z),
        targetDist: hit.distance
      };
    }
    const reaim = this._phase3Reaim;
    if (!reaim.targetP) return; // sky aim → centre-anchored FOV change (B.4)

    // camPos is fixed through Phase 3, so the captured P gives a stable aim.
    const toP = this._tmpV3f
      .subVectors(reaim.targetP, camera.position)
      .normalize();
    if (toP.lengthSq() < 1e-12) return; // P ≈ camera position: nothing to aim at

    // (H2) Re-orient to the BASELINE quat and refresh matrixWorld BEFORE the
    // raycast, so the cursor-pixel world ray is sampled under (baselineQuat,
    // NEW fov) — not the previous tick's premultiplied orientation.
    camera.quaternion.copy(reaim.baselineQuat);
    camera.updateMatrixWorld();
    this._reaimRaycaster.setFromCamera(reaim.ndc, camera);
    const rayDir = this._reaimRaycaster.ray.direction; // unit, world space

    // (M4) Continuity weight: fade re-aim to 0 as the target recedes toward the
    // horizon, so the façade → sky crossing is continuous. (H3) Scale the
    // QUATERNION via slerp from identity — never lerp the directions (that would
    // change the axis with the weight and break reversibility).
    const w = reaimWeight(
      reaim.targetDist,
      REAIM_FADE_NEAR_METRES,
      REAIM_FADE_FAR_METRES
    );
    const fullArc = this._tmpQuatB.setFromUnitVectors(rayDir, toP);
    const delta = this._tmpQuatC.identity().slerp(fullArc, w);
    camera.quaternion.premultiply(delta);
    camera.quaternion.normalize();
    camera.updateMatrixWorld();
  }

  // TASK-022: invalidate the transient zoom-undo memory. Call from a site that
  // has just committed an actual non-wheel camera move (past its own no-op
  // early-returns AND any zero-delta gate). Idempotent (reducer returns
  // valid:false again). TASK-027 Part C.3 adds ONE wheel-path caller: a
  // swoop↔dolly regime switch mid-descent (`_notePhase2Regime`) is a
  // deliberate intent change that clears the memory — the only sanctioned
  // wheel-path call.
  _clearZoomUndo() {
    this._zoomUndo = nextZoomUndo(this._zoomUndo, { type: 'non-wheel-move' });
    // TASK-027: a real non-wheel move also ends any in-flight cursor-lock
    // re-aim session (Part B) and any Phase-2 descent regime run (Part C) —
    // the camera is no longer where the captured baseline/regime assumed.
    this._phase3Reaim = null;
    this._lastSwoopRegime = null;
    this._breakoutDollyDepth = 0;
  }

  // Apply a tilt (in degrees from horizontal, positive = looking down)
  // while preserving the camera's current yaw. Used by Phase 2 (both swoop
  // legs).
  //
  // TASK-022: re-tilt is now ROLL-SAFE and NADIR-CONTINUOUS. We build the
  // absolute target forward from the live yaw + commanded tiltDeg (the same
  // direction the old lookAt aimed at — so descent and ascent passing through
  // the same height command identically-pointed forwards, C1), then rotate
  // the camera's TRUE current forward onto it with the minimal-arc rotation
  // and apply it via premultiply (modelled on TASK-023's _shiftRotate). The
  // shortest-arc axis `curFwd × newFwd` lies in the yaw-tilt plane (≈ the
  // camera's right axis), never the forward axis, so it adds NO roll — any
  // roll the camera carries in is preserved exactly, and there is no world-up
  // lookAt singularity at nadir (the old path's catastrophe).
  _setCameraTiltPreservingYaw(tiltDeg) {
    const camera = this._camera;
    // (1) Capture the TRUE current forward BEFORE any yaw-flattening — keep it
    //     un-flattened through the rotation build. Flattening it first would
    //     make the "current" forward read as tilt=0 every tick, so the arc to
    //     newFwd would pitch by the FULL tiltDeg every tick (a runaway).
    const curFwd = this._tmpV3d;
    camera.getWorldDirection(curFwd); // TRUE current forward — keep
    // Current yaw from a FLATTENED COPY of the forward.
    const fwd = this._tmpV3a;
    fwd.copy(curFwd);
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
    // (2) Build the absolute target forward newFwd from yaw + tiltDeg.
    const tiltRad = tiltDeg * DEG2RAD;
    const cos = Math.cos(tiltRad);
    const sin = Math.sin(tiltRad);
    const newFwd = this._tmpV3c.set(fwd.x * cos, -sin, fwd.z * cos);
    // (3) Minimal-arc rotation from the TRUE current forward onto newFwd,
    //     applied via premultiply (drops lookAt).
    const R = this._tmpQuat;
    if (curFwd.dot(newFwd) < -0.9999) {
      // Antiparallel (180° flip): setFromUnitVectors' cross product underflows
      // and picks an arbitrary axis → unpredictable roll/flip. Choose a fixed,
      // roll-free axis — the camera's right — explicitly. (No Phase-2 path
      // reaches this: the per-tick step is ≤ a few °, and the largest
      // single-step hand-off is a ≤90° arc. Guard is mandatory per the
      // spec-review-checklist degenerate-axis requirement.)
      const axis = this._tmpV3b.set(1, 0, 0).applyQuaternion(camera.quaternion); // camera-right in world
      R.setFromAxisAngle(axis, Math.PI);
    } else {
      R.setFromUnitVectors(curFwd, newFwd);
    }
    camera.quaternion.premultiply(R);
    camera.quaternion.normalize(); // drift guard, mirrors _shiftRotate (A1)
  }

  _drainWASD(deltaMs) {
    const camera = this._camera;
    // TASK-024 (D2) / TASK-012 (M-3): a recovery OR teleport tween owns the
    // camera — held keys must not fight it. Snap velocity to zero and suspend.
    if (this._tweenOwnsCamera()) {
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
    const groundY = this._probe.travelHeightFloorYBelow();
    const aglRaw = camera.position.y - groundY;
    const height = Math.max(0.1, aglRaw);
    const targetSpeed = THREE.MathUtils.clamp(
      height * WASD_SPEED_HEIGHT_FACTOR,
      WASD_MIN_SPEED,
      WASD_MAX_SPEED
    );
    const targetVel = new THREE.Vector3(
      targetDirX,
      0,
      targetDirZ
    ).multiplyScalar(targetSpeed);

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
    const outcome = this._classifyWasdMove(
      targetDirX,
      targetDirZ,
      stepThisFrame
    );

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
    // TASK-022: an advancing WASD step is a non-wheel camera move → clear the
    // zoom-undo memory. The `block` outcome early-returns above (zero-delta —
    // no clear); a hover/step-up that changes only y still moved → clear.
    this._clearZoomUndo();

    if (outcome.kind === 'step-up' || outcome.kind === 'follow') {
      // TASK-024a (DEC-A/DEC-B): grounded collision-follow (preserve AGL,
      // push-up clamp — walking hugs the surface); not-grounded eases toward
      // the option-3 absolute target `max(H, collisionFloorDest + eye)`,
      // rate-limited per tick so the lift/settle composes with continuous WASD.
      // Lazily seed H if we are flying but never captured it (scene loaded
      // not-grounded). The helper only READS H. `distMetres` (== deltaMs/1000)
      // is the per-tick dt in seconds; reuse it for the rate limit.
      if (!this._groundedState.grounded && this._groundedState.H == null) this._groundedState.captureH();
      const newY = wasdVerticalY({
        grounded: this._groundedState.grounded,
        camY: camera.position.y,
        floorNowY: outcome.floorNowY,
        collisionFloorDestY: outcome.floorDestY,
        destFloorHit: outcome.destFloorHit,
        H: this._groundedState.H,
        eyeMargin: EYE_MARGIN_METRES,
        dtSeconds: distMetres,
        rateMps: WASD_VERTICAL_LIFT_RATE_MPS
      });
      const dy = newY - camera.position.y;
      camera.position.y = newY;
      this.center.y += dy;
    } else if (outcome.kind === 'hover') {
      // TASK-024a (1.3.3 / WE-4): walking off a sharp drop floats the camera
      // off the surface — the ground is now far below; un-ground and capture H
      // at the roof height so the next W holds altitude over the street rather
      // than terrain-following down. Only the grounded→not-grounded transition
      // matters. y itself is held (no plunge — WE-5); centre y unchanged.
      if (this._groundedState.grounded) {
        this._groundedState.grounded = false;
        this._groundedState.captureH();
      }
    }

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
    const floorNow = this._probe.collisionFloorAt(
      camera.position.x,
      camera.position.z
    );
    // Destination column floor.
    const destX = camera.position.x + dirX * reach;
    const destZ = camera.position.z + dirZ * reach;
    const floorDest = this._probe.collisionFloorAt(destX, destZ);

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
      lastBlocked: !!this._lastWasdBlocked
    });

    return {
      kind: outcome,
      floorDestY: floorDest.y,
      floorNowY: floorNow.y,
      destFloorHit: floorDest.source !== 'cache'
    };
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

  // --- LB screen-space pan (Stage 1 parity-plus) ---
  //
  // The legacy THREE.EditorControls LB behaviour, restored: one continuous
  // pan in the camera's own right/up basis with no tilt-gated mode switch.
  // The drag is anchored on a plane through the cursor's world point whose
  // normal is the camera-facing direction (parallel to the image plane), so
  // the world point under the cursor stays under the cursor. Because that
  // plane tilts with the camera, the same gesture slides across the ground
  // when looking down and pedestals straight up when looking at the horizon
  // — one behaviour that degrades gracefully across tilt (see
  // docs/07-phased-rollout-plan.md). No floor clamp / grounding (Stage 2
  // machinery): matching legacy, dragging up always lifts back out.
  _lbScreenPan(clientX, clientY) {
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

    // Both points are coplanar with the image plane, so `delta` has no
    // camera-forward component: the camera translates purely in its
    // right/up basis and the anchor's screen projection is preserved.
    const delta = new THREE.Vector3().subVectors(anchor, hNow);
    if (!isFinite(delta.x) || !isFinite(delta.y) || !isFinite(delta.z)) return;

    // Sanity cap to avoid teleports from a degenerate plane solution.
    const stepMag = delta.length();
    const cap = LB_PAN_MAX_STEP_METRES;
    if (stepMag > cap) delta.multiplyScalar(cap / stepMag);

    camera.position.add(delta);
    this.center.add(delta);
    // Invalidate on ACTUAL movement only — a jitter drag that nets ~0 on the
    // latched plane must NOT invalidate (WE-6) — but always dispatch.
    if (delta.x || delta.y || delta.z) this._funnel.invalidateWheelMemory('pan');
    camera.updateMatrixWorld();
    this._funnel.dispatch();
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
    // Invalidate on ACTUAL movement only — a jitter drag that nets ~0 on the
    // latched plane must NOT invalidate (WE-6) — but always dispatch. (no-hit /
    // non-finite cases already early-returned above.)
    if (sx || sz) this._funnel.invalidateWheelMemory('pan');
    camera.updateMatrixWorld();
    this._funnel.dispatch();
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
    const floor = this._probe.collisionFloorAt(camera.position.x, camera.position.z);
    const minY = floor.y + EYE_MARGIN_METRES;
    // TASK-024a (solid-geometry guard): a probe miss (source 'cache' = stale
    // last-known ground, no real surface below) means "no floor below" —
    // outside a finite scene's bounds. No floor clamp, no grounding, so
    // pedestal-down stays available to reach street level (spec D1).
    const hasFloor = floor.source !== 'cache';
    // TASK-024a (1.2.4 / 1.3.1 / 2.2): grounded / H edges for pedestal nav.
    // `clampedToFloor` is read BEFORE the assignment — a descent that would
    // have sunk below collisionFloor + eye is "a deliberate down-nav reaching
    // the surface" (D1). `dY` (clamped) is the up/down signal; safe to read
    // because the descent clamp is one-directional (only ever raises newY),
    // so for an up-move dY == sU (MED-3).
    const clampedToFloor = hasFloor && newY < minY;
    if (clampedToFloor) newY = minY;
    const dY = newY - camera.position.y;
    camera.position.y = newY; // commit before any _captureH (reads camera.y)
    this.center.x += right.x * sR;
    this.center.z += right.z * sR;
    this.center.y += dY;
    const EPS = 1e-3;
    if (clampedToFloor) {
      // Pedestal-down reached the descent clamp → grounded (D1, 1.2.4).
      this._groundedState.grounded = true;
    } else if (dY > EPS) {
      // Pedestal-up leaves the surface → un-ground + capture H (D1, 1.3.1).
      this._groundedState.grounded = false;
      this._groundedState.captureH();
    } else if (dY < -EPS && !this._groundedState.grounded) {
      // Pedestal-down NOT reaching the clamp, while already flying, is
      // deliberate vertical nav → lower H (D4, 2.2).
      this._groundedState.captureH();
    }
    // Invalidate on ACTUAL movement only — a near-zero-delta drag (no truck, no
    // clamped y-change) must NOT invalidate (WE-6) — but always dispatch.
    // (no-hit / degenerate cases already early-returned above.)
    if (sR || dY) this._funnel.invalidateWheelMemory('pan');
    camera.updateMatrixWorld();
    this._funnel.dispatch();
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
    // Street-level mode off: the Street rotate-in-place regime never
    // engages — rotation is always the Map orbit. At/above the horizon
    // `_mapModePivot`'s defensive fallback (a bounds-radius-ahead ground
    // point) takes over, since the screen-centre ground point is null there.
    const tiltDeg = cameraTiltDegrees(camera);
    const isMap = !this._streetLevelEnabled || tiltDeg > this._tiltThreshold;
    // Stage 1 (street-level off): rotate about the SCREEN-CENTRE collision
    // point, not the cursor. Cursor-anchored orbit is deferred to Stage 2
    // (07-phased-rollout-plan.md). We still use the new collision raycast
    // (mesh → ground via `worldPointAt`) and still show the ring — it is
    // just fired through the screen centre instead of the pointer. With
    // street-level on, the cursor pivot (Stage 2) is used as before.
    let pivotX = clientX;
    let pivotY = clientY;
    if (!this._streetLevelEnabled) {
      const rect = this._domElement.getBoundingClientRect();
      pivotX = rect.left + rect.width / 2;
      pivotY = rect.top + rect.height / 2;
    }
    const center = isMap
      ? this._mapModePivot(pivotX, pivotY) // bounds sphere + D-LT-3 fallback
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
  // NOTE: `_latchRotationCenter` passes the SCREEN-CENTRE coords here when
  // street-level mode is off (Stage 1 rotate-about-centre), so "the cursor"
  // in the comments below is the screen centre in that path; the cursor-
  // anchored pivot only applies with street-level on (Stage 2).
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
    // Street-level mode off: Map rotation runs at EVERY tilt, and at shallow
    // tilt sc races toward the horizon — orbiting that far point (or a far
    // accepted hit) from a low camera is a violent swing, which then trips
    // gesture-end recovery (read as a position jump on mouseup). Two guards,
    // both computed with the tilt FLOORED at the threshold T ("as if looking
    // down at least T-steep"), so with tilt ≥ T and a near click this path
    // is identical to the unguarded one:
    //   • fallbackCentre — sc recomputed at the floored tilt: identical to
    //     sc while tilt ≥ T; at shallower tilt it stays a NEAR ground point
    //     ahead (height/tan(T) ≈ 2.1×height at the default T) instead of
    //     the horizon point.
    //   • maxHitDist — a cursor hit becomes the pivot only if it is within
    //     gain × height/sin(max(tilt, T)) of the camera; a farther click
    //     REJECTS to the centre pivot, exactly like a sky click. It is NOT
    //     pulled in along the cursor ray — that inward pull-in is the drift
    //     the old MAX_ORBIT_RADIUS cap was removed for (history note (a)
    //     above) and it re-tested as bad here. Near top-down the budget is
    //     gain × height, so any visible click passes.
    // Every pivot stays ON THE GROUND (this module's design value, see the
    // doc comment). Skipped at/below the ground plane (camY <= 0 is
    // degenerate recovery territory) and with street-level mode on, where
    // tilt > T bounds the geometry by construction (parity rule).
    let fallbackCentre = sc;
    let maxHitDist = Infinity;
    if (!this._streetLevelEnabled && camPos.y > 0) {
      const tEffRad = THREE.MathUtils.degToRad(
        Math.max(cameraTiltDegrees(this._camera), this._tiltThreshold)
      );
      maxHitDist = (camPos.y / Math.sin(tEffRad)) * this._mapPivotFarAcceptGain;
      const fwdH = Math.hypot(fwd.x, fwd.z);
      // fwdH ~ 0 = looking straight down; sc is already the nadir point.
      if (fwdH > 1e-6) {
        const ahead = camPos.y / Math.tan(tEffRad);
        fallbackCentre = new THREE.Vector3(
          camPos.x + (fwd.x / fwdH) * ahead,
          0,
          camPos.z + (fwd.z / fwdH) * ahead
        );
      }
    }
    const hit = this._cursorAnchor.worldPointAt(clientX, clientY);
    let p = fallbackCentre;
    if (hit.source !== 'fallback') {
      // Cursor hit a mesh OR the ground plane: orbit it if it lies within
      // the bounds radius of the screen-centre point (horizontal ground
      // distance). Street-level mode off: ALSO accept a hit within the
      // radius of the CAMERA (horizontal). Map rotation now runs at every
      // tilt, and at shallow tilt sc races to the horizon — the sc-centred
      // test then rejects every nearby ground click (the cursor pivot
      // stops registering and rotation pins to the horizon point). The
      // camera-centred test is gated so the tuned Map-mode bounds are
      // unchanged with the street regime on (where tilt > T keeps sc near
      // the view centre by construction).
      const candidate = new THREE.Vector3(hit.x, hit.y, hit.z);
      const fromSc = sc
        ? Math.hypot(candidate.x - sc.x, candidate.z - sc.z)
        : Infinity;
      const fromCam = this._streetLevelEnabled
        ? Infinity
        : Math.hypot(candidate.x - camPos.x, candidate.z - camPos.z);
      if (
        Math.min(fromSc, fromCam) <= this._mapPivotBoundsRadius &&
        candidate.distanceTo(camPos) <= maxHitDist
      ) {
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
    return clampOrbitRadius(camPos, p, MIN_ORBIT_RADIUS_METRES, Infinity, fwd);
  }

  // The point where the camera's view-direction ray meets the ground
  // plane y=0, or null if it points at/above the horizon. Pure given the
  // camera position + unit view direction.
  _viewRayGroundPoint(camPos, fwd) {
    if (fwd.y >= -1e-4) return null;
    const t = camPos.y / -fwd.y; // along-ray distance to y=0
    // Reject a non-forward intersection: if the camera sits below the
    // y=0 plane (camPos.y < 0), t is negative and the plane meets the
    // ray *behind* the camera. Returning that point would make callers
    // orbit/anchor on a behind-camera pivot (a fling). t <= 0 → null;
    // callers fall back to their no-pivot path (TASK-026). Also hardens
    // _mapModePivot, which already null-checks this return.
    if (t <= 0) return null;
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
      // OOB-1 (extended to orbit): only apply the floor bound when the
      // probe actually HIT real geometry. Outside the finite scene the
      // probe misses and returns a stale cached floor (`source==='cache'`)
      // — using it would over-restrict downward orbit tilt. A miss ⇒ no
      // floor bound.
      const pivotFloor = this._probe.collisionFloorAt(center.x, center.z);
      if (pivotFloor.source !== 'cache') floorY = pivotFloor.y;
    }
    // TASK-023: camera's screen-right axis (local +X in world space). Used
    // by shiftRotateStep as the pitch axis only at exact nadir, where
    // `view × up` degenerates — lets tilt work out of top-down.
    const camRight = new THREE.Vector3(1, 0, 0).applyQuaternion(
      camera.quaternion
    );
    const { pos, R } = shiftRotateStep({
      camPos: camera.position,
      viewDir: fwd,
      centre: center,
      dxPx,
      dyPx,
      speed: this.rotationSpeed,
      floorY,
      camRight
    });

    camera.position.copy(pos);
    // TASK-023: apply the step's rotation as an orientation delta instead
    // of re-deriving it via lookAt(lookTarget). lookAt rebuilds the basis
    // from camera.up = (0,1,0), which is singular at nadir (forward ∥ up)
    // → roll snaps to an arbitrary value (the ~90°/135° jump). premultiply
    // is continuous everywhere and preserves the inherited roll. R is the
    // same rotation shiftRotateStep applied to pos/lookTarget (for the
    // floor-bounded clampedTilt — TASK-024 D8), so position and orientation
    // stay locked. The map-regime floor guard is now the input-tilt bound
    // inside shiftRotateStep (the old applyGroundFloor y-shove was removed),
    // which keeps pos and R consistent — so premultiply is unconditional.
    camera.quaternion.premultiply(R);
    camera.quaternion.normalize(); // guard against drift over a long drag (A1)
    // `this.center` (EditorControls API field) reflects the orbit
    // anchor — distance-from-camera reference used by ActionBar / wheel
    // zoom. Use the latched rotation centre in the orbit case; for the
    // rotate-in-place case (centre coincides with camera) `pos === camPos`
    // and the latched centre equals camera position anyway.
    this.center.copy(center);
    // Invalidate on ACTUAL rotation only — a zero-delta drag (dxPx==dyPx==0)
    // reaches here with R≈identity and would otherwise invalidate (WE-6). Gate
    // on a non-zero applied pixel delta — but always dispatch.
    if (dxPx || dyPx) this._funnel.invalidateWheelMemory('rotate');
    camera.updateMatrixWorld();
    // TASK-010 (D3): billboard the ring as the camera orbits. No-op when
    // the ring is hidden (Street regime / not rotating).
    this._indicator.update(camera);
    this._funnel.dispatch();
  }

  // --- ActionBar zoom buttons (held-down repeat) ---
  // Phase 0 used a center-anchored dolly; Phase 1 keeps the same behavior
  // for the toolbar path so the zoom buttons feel unchanged.
  _zoomActionBar(sign) {
    // TASK-012 (M-3): suspend the toolbar zoom while a camera-owning tween
    // (recovery or teleport) is in flight.
    if (this._isInactive() || this._tweenOwnsCamera()) return;
    const camera = this._camera;
    const distance = camera.position.distanceTo(this.center);
    camera.far = Math.min(100000000, Math.max(20000, distance * 10));
    camera.updateProjectionMatrix();
    const delta = this._delta.set(0, 0, sign);
    delta.multiplyScalar(
      Math.max(this.minSpeedFactor, distance) * this.zoomSpeed
    );
    delta.applyMatrix3(this._normalMatrix.getNormalMatrix(camera.matrix));
    // TASK-024a (1.3.3 / PA-2): the toolbar zoom buttons move camera.y but do
    // NOT route through _drainWheel, so the wheel-pass un-ground check misses
    // them. Apply the same net-y-rise check here so a toolbar zoom-out-up
    // un-grounds (else the next W terrain-follows down instead of holding).
    const zoomStartY = camera.position.y;
    camera.position.add(delta);
    this._groundedState.checkUngroundOnRise(zoomStartY);
    // The toolbar zoom buttons move the camera by a non-wheel mechanism →
    // invalidate the wheel memory (delta is non-zero while a button is held), then
    // dispatch.
    this._funnel.invalidateWheelMemory('action-bar');
    camera.updateMatrixWorld();
    this._funnel.dispatch();
  }
}
