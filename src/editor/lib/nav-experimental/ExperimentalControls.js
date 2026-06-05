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
import {
  CursorAnchor,
  isSolidFloorHit,
  classifyHitEntity,
  worldHitNormal
} from './cursorAnchor.js';
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
  WASD_VERTICAL_LIFT_RATE_MPS,
  PLAN_VIEW_DURATION_MS,
  LB_PAN_MAX_STEP_METRES,
  TILT_THRESHOLD_DEFAULT_DEGREES,
  MIN_ORBIT_RADIUS_METRES,
  MAP_PIVOT_BOUNDS_RADIUS_METRES,
  WHEEL_ZOOM_LATERAL_CAP_METRES,
  WHEEL_GROUND_REACH_CEILING_METRES,
  FALLBACK_FORWARD_DIST,
  SWOOP_PHASE2_ENTRY_ELEVATION_METRES,
  SWOOP_PHASE2_EXIT_ELEVATION_METRES,
  SWOOP_PHASE2_MAX_TICKS_PER_FRAME,
  SWOOP_PHASE2_FLOOR_SNAP_METRES,
  SWOOP_PHASE3_FOV_FLOOR_DEGREES,
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
  DOUBLECLICK_STANDOFF_PULLBACK_MAX_METRES
} from './constants.js';
import {
  cameraTiltDegrees,
  decideLbMode,
  decideDragModeSwitch,
  clampOrbitRadius,
  cappedDollyStep,
  levelForwardAnchor,
  shiftRotateStep,
  decideSwoopPhase,
  phase2TargetTilt,
  phase2AscentTilt,
  phase2HeightFrac,
  nextZoomUndo,
  phase2NextElevation,
  classifyWasdStep,
  wasdVerticalY,
  groundedAtLoad,
  classifyFallAction,
  isLegitPose,
  cueState,
  classifyDoubleClick,
  desiredDoubleClickPose,
  neverRaiseY,
  pullBackTowardTarget
} from './navMath.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// CR-D5: bounded-fallback cadence (ms) for the idle-gated enclosure probe.
// While the camera is stationary and no scene-geometry-dirty signal fired,
// the enclosure re-evaluation runs at most once per this interval so a
// streaming geometry source we didn't wire (e.g. Google 3D Tiles) is still
// picked up promptly. ~250 ms ⇒ ≤4 raycasts/sec worst-case idle cost.
const ENCLOSURE_FALLBACK_INTERVAL_MS = 250;

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

    // TASK-014d: cap on the HORIZONTAL component of one wheel-zoom dolly
    // tick (metres). Bounds the LT-1 shallow-tilt lurch without throttling
    // straight-down descent. Live value, overridable via the tuning
    // component (wheelZoomLateralCapMetres → setWheelZoomLateralCap).
    this._wheelZoomLateralCap = WHEEL_ZOOM_LATERAL_CAP_METRES;

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
    // TASK-022: dedicated scratch for the roll-safe re-tilt. `_tmpV3d` holds
    // the TRUE (un-flattened) camera forward through the rotation build, and
    // `_tmpQuat` is the minimal-arc rotation applied via premultiply.
    this._tmpV3d = new THREE.Vector3();
    this._tmpQuat = new THREE.Quaternion();
    this._groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._anchorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._tmpRay = new THREE.Ray();
    this._raycaster = new THREE.Raycaster();
    this._tmpNDC = new THREE.Vector2();

    // Wheel-budget accumulator (deltaY units; drained per tick).
    this._wheelBudget = 0;

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
    //   _phase3FovBaseline — latched on a Phase 2 zoom-in tick that
    //     clamps to AGL = SWOOP_PHASE2_EXIT_ELEVATION_METRES; cleared on
    //     Phase 3 zoom-out crossing back to baseline. Null when not in
    //     Phase 3.
    // See claude/specs/001-phase-3-plan.md.
    this._zoomUndo = {
      valid: false,
      tilt: cameraTiltDegrees(camera),
      fov: camera.fov
    };
    this._phase3FovBaseline = null;

    // TASK-022: swoop-OUT ascent anchor (atomic pair, the sole stored ascent
    // state). Captured TOGETHER on the first zoom-out tick of an ascent under
    // the single `_ascentStartFrac == null` guard, reset to null on any
    // descent tick / Phase-3 entry / ceiling hand-off so the next ascent
    // re-captures from the live pose. The ascent TARGET is NOT stored — it is
    // recomputed per-tick from `_zoomUndo.valid` (safe: the wheel path never
    // flips `valid` mid-ascent). 014b reads the same anchor for its FOV ramp.
    this._ascentStartFrac = null;
    this._ascentStartTilt = null;

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

    // TASK-012 (H-4): "a Phase-4 double-click teleport tween owns the camera"
    // flag. Mirrors `_recoveryActive` exactly — set for the tween's life,
    // cleared in its onDone. Deliberately NOT in `_isInactive()` (H-A) so an
    // active grab still reaches the `_onMouseDown` abort (L-3). The passive
    // input gates read `_tweenOwnsCamera()` = `_recoveryActive ||
    // _teleportActive`.
    this._teleportActive = false;

    // TASK-024a grounded/fly state.
    //   _grounded — SPEC D1: "I'm walking on the surface" vs "I'm flying
    //     above it". Cannot be computed truthfully in the constructor (pose /
    //     scene not ready, _floorYBelowAt returns the _lastGroundY=0 cache).
    //     Default false; re-derived at every load/teleport edge via
    //     _deriveGroundedFromPose(). Ground-true only on a deliberate descent
    //     reaching the surface; never because terrain rose under us (D1/H3).
    //   _H — SPEC D4 cruise-height scalar; null = not yet captured.
    //     Captured at every un-ground edge; lazily seeded on the first
    //     not-grounded WASD step. Held as an absolute y (DEC-A: option 3 is
    //     the sole flying behaviour — the 3-way toggle and options 1/2 are
    //     retired).
    this._grounded = false;
    this._H = null;

    // CR-D1: idle-gate cache for the per-frame enclosure probe. A stationary
    // camera's enclosure/legit/cue state cannot change, so the whole-scene
    // recursive raycast in _updateLegitSnapshotAndCue is skipped when the
    // pose hasn't moved since last evaluation AND no input/tween is active.
    // Null until the first tick evaluates (so tick 1 always runs).
    this._lastEvalPos = null;
    this._lastEvalQuat = null;

    // CR-D5: scene-geometry-dirty trigger. The CR-D1 idle gate skips the
    // per-frame enclosure raycast when the camera is stationary and idle —
    // but solid geometry can change AROUND a motionless camera (scene load,
    // teleport inside a building, tiles streaming in). When that happens the
    // cached not-enclosed result would otherwise stand until the camera
    // moves, so the recovery cue never appears (WE-9 / M-3c). This flag,
    // set by the scene geometry listeners below (and started true so the
    // first settled state always evaluates), forces one re-evaluation; it is
    // cleared each time _updateLegitSnapshotAndCue actually evaluates.
    this._sceneGeometryDirty = true;
    // CR-D5 bounded fallback: timestamp of the last enclosure evaluation.
    // While stationary AND no dirty signal fired, re-evaluate at most once
    // per FALLBACK_INTERVAL so a streaming source we didn't wire (e.g.
    // Google 3D Tiles, whose load event lives on the internal TilesRenderer,
    // not a scene DOM event) is still picked up within a quarter-second.
    // Bounds worst-case idle cost to ~4 raycasts/sec, not per-frame.
    this._lastEvalTime = 0;
    this._onSceneGeometryDirty = () => {
      this._sceneGeometryDirty = true;
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
    this._lastLegitPose = null;
    // TASK-024a (D1): re-derive grounded from the post-reset pose (the reset
    // camera at (0,15,30) is high → not-grounded unless a floor sits near it).
    this._deriveGroundedFromPose();
    // TASK-022: belt-and-braces — a reset/new-scene wipes all nav state.
    // Init is already valid:false, but an explicit clear is self-documenting.
    this._clearZoomUndo();
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
    // TASK-024a (D1, MED-2/PA-4): re-derive grounded from the explicit-pose
    // teleport. (The resetZoom() fallback branches above already route through
    // resetZoom's own derive call, so only this explicit-pose path needs it.)
    this._deriveGroundedFromPose();
    // TASK-022: explicit-pose teleport is a non-wheel camera move → clear.
    this._clearZoomUndo();
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

  // TASK-014d: live-tunable cap on the horizontal component of one
  // wheel-zoom dolly tick (metres). Relayed from the tuning component.
  setWheelZoomLateralCap(metres) {
    if (typeof metres !== 'number' || !isFinite(metres) || metres <= 0) {
      return;
    }
    this._wheelZoomLateralCap = metres;
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
    const isMap = cameraTiltDegrees(camera) > this._tiltThreshold;
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
      this._sceneEl.addEventListener(
        'object3dset',
        this._onSceneGeometryDirty
      );
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
    const pick = this._pickFloorFromHits(hits, p.y, {
      acceptBuildings: true,
      acceptTiles: true
    });
    const floorY = pick ? pick.hit.point.y : null;
    if (!isLegitPose({ enclosed, camY: p.y, floorY })) return false;
    // TASK-012 (M-A buried guard): the enclosure half rejects a candidate with
    // solid directly overhead, but a downward-only probe can miss a candidate
    // at mid-interior height inside a closed building with no solid straight
    // up. 3DStreet building glTF is single-sided (FrontSide), so a normal-
    // parity test gives a false negative — instead test AABB containment
    // against the building(s) whose column this candidate sits in (the same
    // downward `hits` already pass through any enclosing building's roof +
    // floor). Opt-in (`checkBuried`) so existing recovery callers, which pass
    // no opts, are byte-identical.
    if (opts.checkBuried && this._pointInsideBuildingHit(p, hits)) {
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
  _pointInsideBuildingHit(point, hits) {
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
      const box = new THREE.Box3().setFromObject(el.object3D);
      if (
        point.x >= box.min.x &&
        point.x <= box.max.x &&
        point.y >= box.min.y &&
        point.y <= box.max.y &&
        point.z >= box.min.z &&
        point.z <= box.max.z
      ) {
        return true;
      }
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
        this._deriveGroundedFromPose();
        this._reseedLegitPose();
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
    if (
      rawEl &&
      raycasterComp &&
      typeof raycasterComp.getIntersection === 'function'
    ) {
      hit = raycasterComp.getIntersection(rawEl);
    }

    // (2) Classify by owning-entity identity → category. D (no hit) → no-op.
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

    // (5) Never-raise (absolute world height, DC6).
    const currentCamY = camera.position.y;
    position.y = neverRaiseY(position.y, currentCamY);

    // (6) Clearance resolution against the live scene (probe from the
    // CANDIDATE, not the live camera — H-1).
    if (category === 'A') {
      // Floor-clearance half only; ACCEPT enclosed (landing under an overpass
      // deck is a legal A state — WE-12). A's clicked point guaranteed a hit,
      // so a 'cache' miss here is degenerate; proceed with the desired Y.
      const floor = this._collisionFloorAt(position.x, position.z, {
        fromY: position.y,
        refreshCache: false
      });
      if (floor.source !== 'cache') {
        const clearY = floor.y + EYE_MARGIN_METRES;
        if (position.y < clearY) {
          if (clearY > currentCamY) return; // can't clear ≤ current height → no-op (OI-1)
          position.y = clearY;
        }
      }
    } else {
      // B/C: full legit + buried guard, with standoff pull-back.
      const resolved = this._resolveStandoff(position, lookTarget, currentCamY);
      if (!resolved) return; // no clear pose at/below pre-click height → no-op (OI-1)
      position.copy(resolved);
    }

    // (7) End orientation from the (possibly lowered/capped) position toward
    // the look target. No Phase-4 path approaches nadir, so a plain
    // up=+Y lookAt is roll-safe (R2-5 guard, not a dependency).
    const scratch = new THREE.PerspectiveCamera();
    scratch.position.copy(position);
    scratch.up.set(0, 1, 0);
    scratch.lookAt(lookTarget);
    const endQuat = scratch.quaternion.clone();

    // (8) Commit the motion. A mid-tween re-click cancels the in-flight tween
    // and restarts from the current (in-flight) pose — the live reads above
    // already used the mid-flight camera, so no jump.
    this._cancelCameraTween();
    this._teleportActive = true;
    this._easeToPose({
      position,
      quaternion: endQuat,
      durationMs: FALL_DURATION_MS,
      onDone: () => {
        // DC7: a teleport is a non-wheel move → clear 022's transient memory.
        this._clearZoomUndo();
        // D4: recovery must not ease back to the pre-teleport pose.
        this._reseedLegitPose();
        // Landed pose is programmatic → re-eval mode/letterbox from the
        // resulting tilt now (not on the next mouse nudge).
        this._maybeEmitLbModeChange();
        // TASK-024a: a teleport is a load/teleport edge.
        this._deriveGroundedFromPose();
        this._teleportActive = false;
      }
    });
  }

  // TASK-012 (H-2/M-A/M-5): resolve a B/C standoff onto a clear, non-buried
  // camera point at or below `maxY` (never-raise). Probes from the candidate,
  // raising to floor + eye-margin when below it (capped by maxY); on a void
  // (probe miss) or an enclosed / inside-building candidate, pulls the
  // standoff inward (toward the look target) one step at a time, re-testing,
  // until clear or the pull-back cap is hit. Returns a THREE.Vector3 or null
  // (no clear pose → caller no-ops).
  _resolveStandoff(position, lookTarget, maxY) {
    const cand = position.clone();
    const step = DOUBLECLICK_STANDOFF_PULLBACK_STEP_METRES;
    let pulled = 0;
    while (pulled <= DOUBLECLICK_STANDOFF_PULLBACK_MAX_METRES) {
      if (cand.y > maxY) cand.y = maxY; // never lift above pre-click height
      const floor = this._collisionFloorAt(cand.x, cand.z, {
        fromY: cand.y,
        refreshCache: false
      });
      let clearColumn = true;
      if (floor.source === 'cache') {
        // Probe miss — void at a finite scene's edge. Treat as no-floor
        // (never last-known); pull inward to find a column with a real floor.
        clearColumn = false;
      } else {
        const clearY = floor.y + EYE_MARGIN_METRES;
        if (cand.y < clearY) {
          if (clearY > maxY) {
            // Can't clear the floor at/below the pre-click height here.
            clearColumn = false;
          } else {
            cand.y = clearY;
          }
        }
      }
      if (
        clearColumn &&
        this._poseStillLegit({ position: cand }, { checkBuried: true })
      ) {
        return cand;
      }
      // Pull the standoff inward (toward the look target) and re-test.
      const next = pullBackTowardTarget(cand, lookTarget, step);
      cand.set(next.x, next.y, next.z);
      pulled += step;
    }
    return null;
  }

  // TASK-012 (M-1/M-2): minimal committed-motion tween for a Phase-4
  // double-click teleport. Lerps position + quaternion (+ FOV) only, with a
  // simple onDone — DISTINCT from `_tweenToPose` (the recovery ease-back),
  // which embeds CR-D2 per-tick re-validation + the `_popToRoof` hand-off,
  // none of it teleport-relevant (the teleport endpoint is pre-validated, so
  // it needs no mid-tween hand-off). The teleport is a committed motion: only
  // its endpoint is validated; the path is not per-frame collision-clamped.
  // Returns the TickAnimator handle. `_tweenToPose` is left untouched.
  _easeToPose({ position, quaternion, fromFov, toFov, durationMs, onTick, onDone }) {
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

  // TASK-024a (D1): re-derive `_grounded` from the current settled pose.
  // Grounded iff the collision floor under the camera was a real hit (not a
  // cache miss) AND the camera sits within eye-margin of it (M3, inclusive).
  // Forces `_H = null` so the next un-ground edge lazily re-captures a cruise
  // height. Called at every load/teleport edge (reset / new-scene / swoop-
  // land / recovery-tween settle).
  _deriveGroundedFromPose() {
    const cam = this._camera;
    const floor = this._collisionFloorAt(cam.position.x, cam.position.z);
    this._grounded = groundedAtLoad({
      camY: cam.position.y,
      floorY: floor.y,
      source: floor.source,
      eyeMargin: EYE_MARGIN_METRES
    });
    this._H = null; // re-capture on next un-ground (D4)
  }

  // TASK-024a (D4 / DEC-A): capture the cruise height `H` from the current
  // pose. Held as the absolute camera y (option 3 is the sole flying
  // behaviour). Called AFTER `_grounded` is set false, at every un-ground
  // edge, and again on deliberate vertical nav while already not-grounded
  // (that re-capture IS the D4 update).
  _captureH() {
    this._H = this._camera.position.y; // absolute cruise height (option 3)
  }

  // TASK-024a (1.3.2 / PA-2): shared net-upward-rise un-ground check. Given
  // the camera y captured BEFORE a motion (wheel-drain pass or toolbar zoom),
  // if the camera ended net-higher, the user deliberately left the surface
  // upward → un-ground and re-capture H. A pure FOV zoom or a zoom-in that
  // lowers the camera produces no rise and never flips the flag.
  _checkUngroundOnRise(startY) {
    const EPS = 1e-3;
    if (this._camera.position.y > startY + EPS) {
      this._grounded = false;
      this._captureH();
    }
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
        this._grounded = true;
        this._reseedLegitPose();
        this.dispatchEvent(this._changeEvent);
      }
    });
  }

  _onWheel(event) {
    // TASK-012 (M-3): a camera-owning tween (recovery or teleport) owns the
    // camera — passive wheel input is ignored, not raced (L-3).
    if (this._isInactive() || this._tweenOwnsCamera()) return;
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
        // TASK-022 (C3 / HIGH-2): Space fall / level-out swoop is a non-wheel
        // descent. Callers (_handleFallKey) early-return on noop/pop/already-
        // below, so a no-op Space never reaches this tween. Idempotent.
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
        this._grounded = true;
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
    // after the drains so it captures the post-move pose. Suppressed while a
    // recovery OR teleport tween owns the camera (D2 / TASK-012 M-C) — the
    // legit snapshot must not capture a mid-flight teleport pose.
    if (!this._tweenOwnsCamera()) {
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
    // CR-D5: geometry around a stationary camera may have changed. Force one
    // re-evaluation when a scene-geometry-dirty signal fired since the last
    // eval, OR (bounded fallback) when ~250 ms have elapsed while idle so a
    // streaming source we didn't wire still gets picked up within a quarter-
    // second. The fallback caps idle cost at ~4 raycasts/sec, not per-frame.
    const now =
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();
    const fallbackDue =
      now - this._lastEvalTime >= ENCLOSURE_FALLBACK_INTERVAL_MS;
    if (!moved && !busy && !this._sceneGeometryDirty && !fallbackDue) return;

    // We are evaluating this tick: clear the dirty flag and stamp the
    // eval-time so the next idle frame measures the fallback window from here.
    this._sceneGeometryDirty = false;
    this._lastEvalTime = now;

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
    // TASK-012 (H-1): cast from an arbitrary candidate Y (default = the live
    // camera, so EXISTING callers are unchanged), and reference the same Y as
    // the floor ceiling so a teleport endpoint validated under an overpass
    // finds the LANE below it, not the deck the high camera would otherwise
    // probe through. A downward ray from `fromY` only produces hits at/below
    // `fromY`, so passing it as refY (vs the old Infinity) excludes nothing
    // for the default camera-Y callers — byte-identical.
    const fromY = opts.fromY != null ? opts.fromY : camera.position.y;
    if (!sceneEl || !sceneEl.object3D) {
      return { y: this._lastGroundY, normal: null, source: 'cache', hit: null };
    }
    this._tmpV3a.set(x, fromY, z);
    this._raycaster.set(this._tmpV3a, GROUND_PROBE_DIR);
    this._raycaster.near = 0;
    this._raycaster.far = Infinity;
    const hits = this._raycaster.intersectObject(sceneEl.object3D, true);
    const pick = this._pickFloorFromHits(hits, fromY, {
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
  _collisionFloorAt(x, z, opts = {}) {
    // TASK-012 (H-1 / L-A): pass `fromY` through (default camera-Y) so a
    // teleport clearance probe can cast from the candidate position; and let
    // a clearance/standoff probe opt out of the `_lastGroundY` cache refresh
    // (`refreshCache: false`) so a candidate column the camera never visits
    // doesn't poison the next recovery/WASD miss fallback. Defaults keep all
    // existing callers unchanged.
    return this._floorYBelowAt(x, z, {
      acceptBuildings: true,
      acceptTiles: true,
      refreshCache: opts.refreshCache !== false,
      fromY: opts.fromY
    });
  }

  // TASK-024: travel-height floor below the camera (WASD fly-speed only).
  //   3DStreet: nearest segment-only hit (buildings see-through — B4 speed
  //     rationale preserved).
  //   Tiles (no separable ground): the MINIMUM collision-floor y over a
  //     small fixed grid below the camera, approximating the street/ground
  //     between roofs so speed doesn't crawl over a single roof.
  _travelHeightFloorYBelow() {
    return this._travelHeightFloorAt(
      this._camera.position.x,
      this._camera.position.z
    );
  }

  // TASK-024 / TASK-024a: travel-height floor at an arbitrary XZ column.
  // `_travelHeightFloorYBelow` delegates here with the camera column for WASD
  // *speed* scaling (height above the land beneath buildings). Same math:
  // segment-only first, else the ±2 m 3×3 grid minimum over tiles.
  // (The retired option-2 destination-column sampler used this too; DEC-A.)
  _travelHeightFloorAt(cx, cz) {
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
    // TASK-024 (D2) / TASK-012 (M-3): a recovery OR teleport tween owns the
    // camera — drop queued wheel.
    if (this._tweenOwnsCamera()) {
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
    const frameFloor = this._collisionFloorAt(
      this._camera.position.x,
      this._camera.position.z
    );
    this._frameGroundY = frameFloor.y;
    // TASK-024a (solid-geometry guard): track whether the probe hit a real
    // surface. On a miss (outside finite bounds) the swoop phase handlers skip
    // every ground-relative clamp so the wheel is a plain anchored dolly.
    this._frameGroundHit = frameFloor.source !== 'cache';
    // Per H4 of `claude/reports/007-phase-3-plan-review.md`: latch the
    // per-frame cap once at the start of the drain pass, hold for the
    // whole frame. Re-evaluating per iteration produces an asymmetric
    // speed-up at boundary crossings (Phase 2 → Phase 1 zoom-out would
    // unlock 7 extra Phase 1 ticks in the same frame the moment AGL
    // crosses 20m).
    const frameCap = this._wheelFrameCap();
    let ticksThisFrame = 0;
    let changed = false;
    // TASK-024a (1.3.2 / 2.2): capture y before the drain so the net vertical
    // move over the whole pass drives the grounded / H edges once — covering
    // reverse-swoop, low-tilt dolly-up, Phase-2 zoom-out and Ctrl+wheel
    // uniformly, without scattering flags across every wheel branch.
    const wheelStartY = this._camera.position.y;
    while (ticksThisFrame < frameCap && Math.abs(this._wheelBudget) >= unit) {
      const sign = this._wheelBudget > 0 ? 1 : -1;
      this._wheelBudget -= sign * unit;
      this._applyWheelTick(sign);
      ticksThisFrame++;
      changed = true;
    }
    if (changed) {
      const EPS = 1e-3;
      if (this._camera.position.y > wheelStartY + EPS) {
        // Net-upward pass — deliberate up-move leaves the surface (1.3.2).
        this._checkUngroundOnRise(wheelStartY);
      } else if (this._camera.position.y < wheelStartY - EPS && !this._grounded) {
        // Net-downward pass while still flying (a swoop landing this pass would
        // have grounded us, so the `!_grounded` test excludes that case) →
        // deliberate vertical nav: lower H (D4, 2.2).
        this._captureH();
      }
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
    // TASK-024a (solid-geometry guard): no ground below (outside finite
    // bounds) → the wheel is a plain anchored dolly, never the slow Phase-2
    // swoop, so use the default (faster) cap. `_frameGroundY` is stale here.
    if (!this._frameGroundHit) return WHEEL_MAX_TICKS_PER_FRAME;
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
    // a plain cursor-anchored dolly at the current tilt and elevation (Open
    // Decision #2). TASK-014d: routes to the shared cursor-anchored dolly
    // (`_applyCursorDolly`) regardless of tilt or phase — it does no AGL /
    // boundary math, so it is safe at every elevation Ctrl+wheel reaches
    // (stale-ground / Phase-2 / Phase-3 altitudes), preserving the
    // swoop-bypass. No Phase1→Phase2 boundary clamp on this path.
    const camera = this._camera;
    if (this._lastWheelCtrlKey) {
      return this._applyCursorDolly(sign);
    }
    // TASK-024a (solid-geometry guard): no ground below (outside finite
    // bounds) → there is no swoop floor to land on. Act as a plain anchored
    // dolly at the current tilt (Phase 1), never Phase 2/3, so the camera
    // descends freely toward street level. `_frameGroundY` is stale, so the
    // AGL-based phase dispatch below would mis-route to a swoop landing.
    // TASK-014d: the old tilt-conditional split (low-tilt → screen-centre)
    // is collapsed — Phase 1 is now always the cursor-anchored path.
    if (!this._frameGroundHit) {
      return this._applyPhase1WheelTick(sign);
    }
    const yAgl = camera.position.y - this._frameGroundY;
    const phase = decideSwoopPhase(yAgl);
    if (phase === 'phase2') return this._applyPhase2WheelTick(sign);
    if (phase === 'phase3') return this._applyPhase3WheelTick(sign);
    // phase1: TASK-014d collapsed the tilt-conditional split — every Phase-1
    // tick is the cursor-anchored dolly (the lurch is bounded by the
    // movement cap inside the dolly step, not by switching anchor source).
    return this._applyPhase1WheelTick(sign);
  }

  // Phase 1 — cursor-anchored exponential dolly at high tilt + high
  // altitude. Translates the camera along the camera→anchor ray by 10%
  // of the current distance per tick. Tilt-preserving by construction.
  //
  // Boundary handling: if zoom-in pushes AGL below 20m, clamp the camera
  // to (groundY + 20) so it enters Phase 2 at 20m above the actual ground
  // (TASK-013; formerly an absolute clamp to y=10m), and capture the
  // transient zoom-undo memory's entry tilt (TASK-022; round-down model —
  // see §"Tick energy" in the plan). The next tick is Phase 2. Reads the
  // per-pass ground snapshot `this._frameGroundY`.
  _applyPhase1WheelTick(sign) {
    const camera = this._camera;
    // TASK-014d: the cursor-anchored capped dolly (no AGL / boundary math).
    this._applyCursorDolly(sign);

    // TASK-024a (solid-geometry guard): no ground below (outside finite
    // bounds) → no Phase-2 boundary to snap to. Leave the anchored dolly step
    // as-is (free descent); `_frameGroundY` is stale and would snap us up.
    if (!this._frameGroundHit) return;

    // Boundary: Phase 1 → Phase 2 on zoom-in. Compare AGL, clamp the
    // camera to (groundY + yCeil).
    const groundY = this._frameGroundY;
    if (
      sign < 0 &&
      camera.position.y - groundY < SWOOP_PHASE2_ENTRY_ELEVATION_METRES
    ) {
      camera.position.y = groundY + SWOOP_PHASE2_ENTRY_ELEVATION_METRES;
      // Phase 1 ticks are tilt-preserving, so this matches the tilt at
      // the moment of crossing. TASK-022: capture the transient zoom-undo
      // memory (the entry tilt + fov). Fires ONLY on a wheel zoom-in crossing
      // AGL 20 downward, behind the `!_frameGroundHit` guard — so FOV-zoom
      // below the band, out-of-bounds descents, and every non-wheel descent
      // set no memory (spec point 3 / WE-3). `fov` is the TASK-014b twin
      // (harmless for 022; the C4 seam).
      this._zoomUndo = nextZoomUndo(this._zoomUndo, {
        type: 'wheel-in-crossing',
        tilt: cameraTiltDegrees(camera),
        fov: camera.fov
      });
      camera.updateMatrixWorld();
    }
  }

  // TASK-014d: the shared cursor-anchored capped dolly. Resolves the world
  // point under the cursor and dollies the camera toward/away from it by one
  // capped step. No AGL / Phase-boundary logic — pure cursor-anchored dolly,
  // so it is safe to call in any state (Phase 1, Ctrl+wheel at any
  // elevation). Both the Phase-1 tick and the Ctrl+wheel path use it (the
  // source-dispatch exists exactly once).
  //
  // Anchor dispatch branches on the hit *source* (spec item 3 / Decision 3 —
  // condition on no-real-hit, NOT on "anchor above camera"):
  //   mesh | ground → a real target; dolly toward it (rises toward a tower's
  //     upper floors if that is what the cursor is on).
  //   fallback      → the ray hit nothing real (open sky); substitute a
  //     LEVEL-forward anchor so zoom-in advances forward at constant height
  //     rather than drifting up into empty sky. If even the level heading is
  //     undefined (true vertical) the tick is a no-op (the drain loop has
  //     already consumed this tick's budget, so it never stalls).
  _applyCursorDolly(sign) {
    const camera = this._camera;
    const x = this._lastWheelClientX;
    const y = this._lastWheelClientY;
    // Defence: `_onWheel` populates these on every wheel event, so this
    // never strands zoom as a silent no-op in practice.
    if (x == null || y == null) return;

    const hit = this._cursorAnchor.worldPointAt(x, y, {
      maxGroundDist: WHEEL_GROUND_REACH_CEILING_METRES
    });
    if (hit.source === 'mesh' || hit.source === 'ground') {
      this._applyAnchoredDollyStep(sign, hit);
      return;
    }
    // hit.source === 'fallback' → no real target under the cursor.
    const levelHit = levelForwardAnchor(camera, FALLBACK_FORWARD_DIST);
    if (levelHit == null) return; // near-vertical at sky → no camera motion
    this._applyAnchoredDollyStep(sign, levelHit);
  }

  // Shared step: translate the camera along the camera→hit ray toward (in)
  // or away from (out) the fixed `hit`, by 10% of the current distance —
  // with the HORIZONTAL component of the translation capped to
  // `this._wheelZoomLateralCap` metres (TASK-014d, via cappedDollyStep).
  // The cap scales the whole step vector uniformly, so the move stays on the
  // camera→hit ray (target stays under the cursor) and reversibility about a
  // fixed target is exact. A non-finite step (degenerate grazing ray) is
  // dropped — the tick is a no-op rather than NaN-ing the camera.
  _applyAnchoredDollyStep(sign, hit) {
    const camera = this._camera;
    const newPos = cappedDollyStep({
      camPos: camera.position,
      hit,
      sign,
      alpha: ZOOM_PER_WHEEL_TICK,
      lateralCapMetres: this._wheelZoomLateralCap
    });
    if (newPos == null) return; // non-finite step: skip this tick
    camera.position.copy(newPos);

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

    if (sign > 0) {
      // ASCENT (zoom-out): atomically capture the ascent anchor on the FIRST
      // out-tick of this ascent (the sole writer, under the == null guard).
      // Both fields set together — no interleaving where one is fresh, one
      // stale. `yAgl` here is the PRE-step height (matches the camera's live
      // tilt read below).
      if (this._ascentStartFrac == null) {
        this._ascentStartFrac = phase2HeightFrac(yAgl);
        this._ascentStartTilt = cameraTiltDegrees(camera);
      }
    } else {
      // DESCENT (zoom-in): reset the ascent anchor so the next ascent
      // re-captures from the live pose. Descent tilt semantics are unchanged.
      this._ascentStartFrac = null;
      this._ascentStartTilt = null;
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
      this._phase3FovBaseline = camera.fov;
      // TASK-022: Phase-3 entry ends any ascent geometry; reset the anchor so
      // a fresh ascent re-captures from the live pose (already null on a
      // descent run, but explicit at the band exit).
      this._ascentStartFrac = null;
      this._ascentStartTilt = null;
      camera.updateMatrixWorld();
      // TASK-024a (D1, 1.2.2 / PA-3): the wheel swoop has no onDone — landing
      // IS this Phase-2→3 boundary crossing. DERIVE (don't force-true): the
      // landing height is groundY + SWOOP_PHASE2_EXIT_ELEVATION, a constant
      // INDEPENDENT of EYE_MARGIN, so deriving runs the real ≤ eye-margin test
      // against a fresh collision-floor probe and survives either constant
      // being retuned. `groundY` here is the collision floor under the camera,
      // so a swoop onto a roof grounds to the roof (D5/WE-7).
      this._deriveGroundedFromPose();
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
      // Ascent complete at the ceiling: reset the anchor. Above the ceiling
      // the tilt is the user's to set freely (Phase 1 is tilt-preserving).
      this._ascentStartFrac = null;
      this._ascentStartTilt = null;
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
    } else {
      this._setCameraTiltPreservingYaw(
        phase2AscentTilt(
          yAglNext,
          this._ascentStartFrac,
          this._ascentStartTilt,
          ascentTarget
        )
      );
    }
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

  // TASK-022: invalidate the transient zoom-undo memory. Call ONLY from a
  // site that has just committed an actual non-wheel camera move (past its
  // own no-op early-returns AND any zero-delta gate). Never from the wheel
  // path. Idempotent (reducer returns valid:false again).
  _clearZoomUndo() {
    this._zoomUndo = nextZoomUndo(this._zoomUndo, { type: 'non-wheel-move' });
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
      const axis = this._tmpV3b
        .set(1, 0, 0)
        .applyQuaternion(camera.quaternion); // camera-right in world
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
      if (!this._grounded && this._H == null) this._captureH();
      const newY = wasdVerticalY({
        grounded: this._grounded,
        camY: camera.position.y,
        floorNowY: outcome.floorNowY,
        collisionFloorDestY: outcome.floorDestY,
        destFloorHit: outcome.destFloorHit,
        H: this._H,
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
      if (this._grounded) {
        this._grounded = false;
        this._captureH();
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
    // TASK-022: clear on ACTUAL movement only — a jitter drag that nets ~0 on
    // the latched plane must NOT clear (WE-6). (no-hit / non-finite cases
    // already early-returned above.)
    if (sx || sz) this._clearZoomUndo();
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
      this._grounded = true;
    } else if (dY > EPS) {
      // Pedestal-up leaves the surface → un-ground + capture H (D1, 1.3.1).
      this._grounded = false;
      this._captureH();
    } else if (dY < -EPS && !this._grounded) {
      // Pedestal-down NOT reaching the clamp, while already flying, is
      // deliberate vertical nav → lower H (D4, 2.2).
      this._captureH();
    }
    // TASK-022: clear on ACTUAL movement only — a near-zero-delta drag (no
    // truck, no clamped y-change) must NOT clear (WE-6). (no-hit / degenerate
    // cases already early-returned above.)
    if (sR || dY) this._clearZoomUndo();
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
      const pivotFloor = this._collisionFloorAt(center.x, center.z);
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
    // TASK-022: clear on ACTUAL rotation only — a zero-delta drag
    // (dxPx==dyPx==0) reaches here with R≈identity and would otherwise clear
    // (WE-6 violation). Gate on a non-zero applied pixel delta.
    if (dxPx || dyPx) this._clearZoomUndo();
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
    this._checkUngroundOnRise(zoomStartY);
    // TASK-022: the toolbar zoom buttons move the camera by a non-wheel
    // mechanism → clear. `delta` is non-zero while a button is held
    // (interval-driven), so no gate needed.
    this._clearZoomUndo();
    camera.updateMatrixWorld();
    this.dispatchEvent(this._changeEvent);
  }
}
