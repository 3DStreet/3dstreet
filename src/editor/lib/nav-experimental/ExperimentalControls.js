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
import { CursorAnchor, classifyHitEntity } from './cursorAnchor.js';
import { TickAnimator } from './tickAnimator.js';
import { CollisionProbe } from './collisionProbe.js';
import { GroundedState } from './groundedState.js';
import { SituationSensor } from './situationSensor.js';
import { CameraWriteFunnel } from './cameraWriteFunnel.js';
import { CommittedMotionRunner } from './committedMotionRunner.js';
import { WheelSwoopEngine } from './wheelSwoopEngine.js';
import { WasdFlight, MOVEMENT_KEY_CODES } from './wasdFlight.js';
import { DragGestureController } from './dragGestureController.js';
import {
  ROTATION_SPEED_RAD_PER_PX,
  PLAN_VIEW_DURATION_MS,
  TILT_THRESHOLD_DEFAULT_DEGREES,
  MAP_PIVOT_BOUNDS_RADIUS_METRES,
  MAP_PIVOT_FAR_ACCEPT_GAIN,
  WHEEL_ZOOM_LATERAL_CAP_LOWER_BOUND_METRES,
  DEFAULT_OVERVIEW_TILT_DEGREES,
  NORTH_AXIS,
  NORTH_BEARING_FROM_MINUS_Z,
  COMPASS_TOPDOWN_TOLERANCE_DEGREES,
  COMPASS_NORTH_TOLERANCE_DEGREES,
  COMPASS_ROTATE_STEP_DEGREES,
  EYE_MARGIN_METRES,
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
  isLegitPose,
  classifyDoubleClick,
  desiredDoubleClickPose,
  clampFramingPitch,
  pullBackTowardTarget,
  viewRayGroundPoint
} from './navMath.js';
import { captureNavDiscovery } from '../navAnalytics.js';

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
      get domElement() {
        return self._domElement;
      },
      get center() {
        return self.center;
      },
      get latch() {
        return self._latch;
      },
      get cursorAnchor() {
        return self._cursorAnchor;
      },
      get streetLevelEnabled() {
        return self._streetLevelEnabled;
      },
      get tiltThreshold() {
        return self._tiltThreshold;
      },
      get mapPivotBoundsRadius() {
        return self._mapPivotBoundsRadius;
      },
      get mapPivotFarAcceptGain() {
        return self._mapPivotFarAcceptGain;
      },
      get rotationSpeed() {
        return self.rotationSpeed;
      },
      get wheelZoomLateralCapLowerBound() {
        return self._wheelZoomLateralCapLowerBound;
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
      get runner() {
        return self._runner;
      },
      get wheel() {
        return self._wheel;
      },
      get wasd() {
        return self._wasd;
      },
      get drag() {
        return self._drag;
      },
      get tick() {
        return self._tick;
      },
      // Dispatch identity: the `change`/cue events must fire ON the controls
      // instance (frozen external contract) — hand modules a bound callback,
      // never the instance itself.
      dispatch: self.dispatchEvent.bind(self),
      // Re-evaluate the LB sub-mode from the live camera and emit a modechange
      // on transition. A committed-motion settle epilogue that lands the camera
      // programmatically calls this so the toolbar/letterbox reflect the landed
      // tilt immediately. Now owned by the drag controller (Fable A6b).
      emitLbModeChange: () => self._drag.maybeEmitLbModeChange(),
      // Coarse `nav-experimental:modechange` (pan/rotate/null) dual-dispatch,
      // owned by the orchestrator; the drag controller emits through it.
      emitModeChange: (mode) => self._emitModeChange(mode),
      // "Controls disabled / a Plan View or compass tween owns the frame" — the
      // gesture guard the drag controller reads.
      isInactive: () => self._isInactive(),
      // The situation-sensor idle gate: is any engine actively moving the
      // camera? (Deliberately distinct from the resolveContextAction busy
      // predicate, which additionally counts recovery/inactive.)
      isCameraBusy: () =>
        self._wasd.isMoving() ||
        self._wheel.hasAccum() ||
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
    // points at the wheel engine's zoom-undo reset.
    this._funnel = new CameraWriteFunnel({
      dispatch: this._ctx.dispatch,
      clearWheelMemory: () => this._wheel.clearZoomUndo()
    });
    // Committed-motion runner (M2): the single home for every camera-owning
    // tween (recovery ease-back, teleport, and the four preset motions) — the
    // ownership flags, the anti-stranding cancel, the per-tick write-funnel
    // commit, and the parameterized settle epilogue.
    this._runner = new CommittedMotionRunner(this._ctx);
    // Wheel-swoop engine: the continuous wheel accumulator + the three-phase
    // swoop zoom + the transient zoom-undo memory. Fed by the `_onWheel` router,
    // drained each frame by `_onTick`.
    this._wheel = new WheelSwoopEngine(this._ctx);
    // Held-key WASD flight controller: the held-key set + ramped velocity + the
    // per-tick yaw-projected move with the step classifier. Fed by the key
    // routers, driven each frame by `_onTick`.
    this._wasd = new WasdFlight(this._ctx);
    // Drag-gesture controller: the merged pan+rotate mouse gesture core, the
    // letterbox comparator, and the rotation ring. Fed by the thin mouse routers
    // (`_onMouseDown/Move/Up`) + the key routers' Shift-sync / WASD-yield seams.
    this._drag = new DragGestureController(this._ctx);

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
    this._drag.maybeEmitLbModeChange();
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
    this._drag.maybeEmitLbModeChange();
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
    if (!enabled) this._wasd.clearHeldKeys();
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
        this._wheel.clearZoomUndo();
        this.dispatchEvent(this._changeEvent);
      },
      onDone: () => {
        camera.position.copy(endPos);
        camera.quaternion.copy(endQuat);
        camera.updateMatrixWorld();
        this._wheel.clearZoomUndo(); // TASK-022 (idempotent; closes the onTick window)
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
        this._drag.maybeEmitLbModeChange();
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
      pivot = viewRayGroundPoint(camera.position, fwd);
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
      this._wheel.clearZoomUndo();
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
        this._wheel.clearZoomUndo();
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
    if (this._drag) this._drag.dispose();
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
        this._drag.maybeEmitLbModeChange();
        // TASK-022: focus-to-object moves the camera via the A-Frame
        // focus-animation component — a non-wheel move. Clear on its change
        // hook (fires each frame of the transition; idempotent).
        this._wheel.clearZoomUndo();
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

  _onContextMenu(event) {
    event.preventDefault();
  }

  // TASK-012 (H-4): "a camera-owning tween is in flight" — the recovery
  // ease-back OR the Phase-4 teleport. The PASSIVE input gates (wheel, WASD,
  // toolbar zoom, the legit-snapshot) read this so neither races the tween.
  // NOT used by `_onMouseDown` (an active grab must still reach the abort).
  // Delegates to the runner, which owns the ownership flags.
  _tweenOwnsCamera() {
    return this._runner.ownsCamera();
  }

  // TASK-012 (H-4): cancel whatever camera-owning tween is in flight and clear
  // its ownership flags. Delegates to the runner. Clears recovery + teleport
  // only — NOT `_planViewActive` / `_compassAnimating` (those own their own
  // lifecycles; a teleport can never start mid-plan-view/compass). Every
  // tween-START path routes through this first.
  _cancelCameraTween() {
    this._runner.cancel();
  }

  // Frozen public surface: the `useNavMode` hook reads the cached LB sub-mode
  // for the visual indicator. Delegates to the drag controller (which owns the
  // comparator + its cache).
  getCurrentLbMode() {
    return this._drag.getCurrentLbMode();
  }

  // Mouse gesture entry points. These stay named on the orchestrator (the
  // window listeners bind their identity) but are thin routers over the drag
  // controller: O owns only the passive-input guard, the window-listener
  // attach/detach, the mid-tween abort, and the gesture-end recovery call.
  _onMouseDown(event) {
    if (this._isInactive()) return;
    const mode = this._drag.decideMouseMode(event);
    if (!mode) return;
    // TASK-024 (N4) / TASK-012 (L-3): a fresh press mid-tween would otherwise
    // start a drag that fights the still-running tween — abort the recovery OR
    // teleport (its onDone is skipped; the next legit tick reseeds). An active
    // grab must reach this abort, so it is NOT gated by the passive-input guard.
    if (this._tweenOwnsCamera()) {
      this._cancelCameraTween();
    }
    this._drag.beginGesture(event, mode);
    // mousemove + mouseup on window (not the canvas) so the gesture follows the
    // cursor across editor panels; only an actual button release ends the latch.
    window.addEventListener('mousemove', this._onMouseMove, false);
    window.addEventListener('mouseup', this._onMouseUp, false);
  }

  _onMouseMove(event) {
    this._drag.onMove(event);
  }

  _onMouseUp() {
    const endedMode = this._drag.endGesture();
    window.removeEventListener('mousemove', this._onMouseMove, false);
    window.removeEventListener('mouseup', this._onMouseUp, false);
    // TASK-024 (3b): gesture-end correction — the one bounded automatic motion
    // the principle allows. If a camera-drag (pan/rotate) ended with the camera
    // inside a building (not legit), ease it back to the most recent legit pose
    // (or pop to the roof if none / no longer valid).
    if (
      (endedMode === 'pan' || endedMode === 'rotate') &&
      !this._runner.isRecovering()
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
    if (stored && this._runner.poseStillLegit(stored)) {
      // Recovery ease-back (runner Door 1). On a mid-tween target invalidation
      // it hands off once to pop-to-roof.
      this._runner.runRecovery(stored, FALL_DURATION_MS, () =>
        this._popToRoof()
      );
    } else {
      this._popToRoof();
    }
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

    // (8) Commit the motion (runner Door 2, teleport). A mid-tween re-click
    // cancels the in-flight tween and restarts from the current (in-flight)
    // pose — the live reads above already used the mid-flight camera, so no
    // jump. `run()` does the cancel + ownership set internally.
    //
    // Teleport is the ONE motion that does NOT clear the zoom-undo memory per
    // tick (`perTick: 'dispatch'`) — it clears once in the settle. FOV tweens
    // from its current (in-flight on a re-click) value to the default so a
    // telephoto arrival reframes smoothly (WE-11); DEFAULT_FOV_DEGREES literal
    // (TASK-025 found a construction-time `camera.fov` capture unreliable on a
    // re-attach mid-zoom, and 50 is the shared resting FOV across nav views).
    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();
    const fromFov = camera.fov;
    const toFov = DEFAULT_FOV_DEGREES;
    const endPos = position.clone();
    this._runner.run({
      ownership: 'teleport',
      durationMs: FALL_DURATION_MS,
      perTick: 'dispatch',
      onTick: (eased) => {
        camera.position.lerpVectors(startPos, endPos, eased);
        camera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        camera.fov = fromFov + (toFov - fromFov) * eased;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
      },
      commitPose: () => {
        camera.position.copy(endPos);
        camera.quaternion.copy(endQuat);
        camera.fov = toFov;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
      },
      // Settle: clear zoom-undo (DC7), reseed legit-pose so recovery can't ease
      // back to the pre-teleport pose (D4), re-eval letterbox from the landed
      // tilt, derive grounded (teleport = a load/teleport edge, TASK-024a), and
      // refresh the context-button snapshot so its icon reflects the landed
      // pose immediately (TASK-025).
      settle: {
        grounded: 'derive',
        reseedLegit: true,
        lbMode: true,
        refreshSnapshot: true
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
        this._runner.poseStillLegit(
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
      // Nothing overhead — nothing to pop out of. No-op (no tween starts, so no
      // ownership is taken; the runner's flags stay as they were).
      return;
    }
    const topY = probe.overheadHits[probe.overheadHits.length - 1];
    let targetY = topY + EYE_MARGIN_METRES;
    if (targetY <= camera.position.y) {
      return;
    }
    const startY = camera.position.y;
    const startCenterY = this.center.y;
    // CR-D2: single mid-tween retarget. If a higher overhead slab streams
    // in during the pop, the original target would surface still enclosed;
    // raise the target once (a single hand-off — guarded by a small
    // threshold so it can't oscillate).
    const RETARGET_EPS = 0.1; // metres
    let retargeted = false;
    // Runner Door 2 (preset motion). y-delta center follow; per-tick commit.
    // Settle: a pop-to-roof / pop-to-daylight lands you standing on that roof →
    // grounded; reseed; refresh the context snapshot. No letterbox re-eval.
    this._runner.run({
      ownership: 'recovery',
      durationMs: POP_TO_ROOF_DURATION_MS,
      perTick: 'commit',
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
      },
      commitPose: () => {
        camera.position.y = targetY;
        this.center.y = startCenterY + (targetY - startY);
        camera.updateMatrixWorld();
      },
      settle: {
        grounded: 'force-true',
        reseedLegit: true,
        refreshSnapshot: true
      }
    });
  }

  _onWheel(event) {
    // TASK-012 (M-3): a camera-owning tween (recovery or teleport) owns the
    // camera — passive wheel input is ignored, not raced (L-3). Input plumbing
    // stays on the orchestrator; the accumulate + drain logic lives on the
    // wheel-swoop engine.
    if (this._isInactive() || this._tweenOwnsCamera()) return;
    event.preventDefault();
    // Feature-discovery: first wheel zoom this session.
    captureNavDiscovery('zoom');
    this._wheel.accumulate(event);
  }

  _onWindowBlur() {
    this._wasd.clearHeldKeys();
    if (this._latch.isActive()) {
      this._latch.end();
      this._emitModeChange(null);
      // TASK-010 (S-4): hide the ring on a window blur (e.g. Alt-Tab
      // mid-orbit) so it can't leak visible.
      this._drag.hideIndicator();
    }
  }

  _onKeyDown(event) {
    // TASK-010 (B6): first line, before every other guard, so keydown
    // and keyup are symmetric and the Shift sync isn't swallowed by the
    // typing/modifier/WASD early returns below.
    this._drag.syncDragModeToShift(event.shiftKey);
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
      if (this._wasd.noHeldKeys()) this._drag.endRotationForWasd();
      this._wasd.addHeldKey(k);
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
      this._isInactive() ||
      this._tick.isAnimating() ||
      this._runner.isRecovering();
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
    // Runner Door 2 (preset motion). Full-vector center lerp; per-tick commit;
    // lands at collisionFloor + eye-margin → grounded by construction, mirroring
    // `_fallTo`'s street landing (reseed, re-eval letterbox, refresh snapshot).
    this._runner.run({
      ownership: 'recovery',
      durationMs: FALL_DURATION_MS,
      perTick: 'commit',
      onTick: (eased) => {
        cam.position.lerpVectors(startPos, endPos, eased);
        this.center.lerpVectors(startCenter, endCenter, eased);
        cam.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        cam.updateMatrixWorld();
      },
      commitPose: () => {
        cam.position.set(endX, endY, endZ);
        this.center.copy(endCenter);
        cam.quaternion.copy(endQuat);
        cam.updateMatrixWorld();
      },
      settle: {
        grounded: 'force-true',
        reseedLegit: true,
        lbMode: true,
        refreshSnapshot: true
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

    // Runner Door 2 (preset motion). Full-vector center lerp + FOV lerp;
    // per-tick commit; suspends WASD / holds the busy gate via the 'recovery'
    // ownership. Settle: drone deliberately leaves the surface upward → flying,
    // re-capture the cruise height (mirrors `_checkUngroundOnRise`), reseed, and
    // refresh the context snapshot (flip icon drone→street). No letterbox re-eval.
    this._runner.run({
      ownership: 'recovery',
      durationMs: FALL_DURATION_MS,
      perTick: 'commit',
      onTick: (eased) => {
        cam.position.lerpVectors(startPos, endPos, eased);
        this.center.lerpVectors(startCenter, endCenter, eased);
        cam.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        cam.fov = startFov + (DEFAULT_FOV_DEGREES - startFov) * eased;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
      },
      commitPose: () => {
        cam.position.copy(endPos);
        this.center.copy(endCenter);
        cam.quaternion.copy(endQuat);
        cam.fov = DEFAULT_FOV_DEGREES;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
      },
      settle: {
        grounded: 'force-false-captureH',
        reseedLegit: true,
        refreshSnapshot: true
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
    // CR-D2: single mid-fall retarget. If a closer solid surface streams in
    // ABOVE the original floor target during the descent, halt higher so the
    // camera doesn't sink through it. One hand-off — guarded by a threshold
    // so it can't oscillate. The level-out orientation above stays valid.
    const RETARGET_EPS = 0.1; // metres
    let retargeted = false;
    // Runner Door 2 (preset motion). Per-tick commit (clears zoom-undo + the
    // Space fall / level-out swoop is a non-wheel descent — callers early-return
    // on noop/pop/already-below, so a no-op Space never reaches here). Settle:
    // grounded by construction (lands at collisionFloor + eye-margin), reseed,
    // re-eval letterbox, refresh the context snapshot.
    this._runner.run({
      ownership: 'recovery',
      durationMs: FALL_DURATION_MS,
      perTick: 'commit',
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
      },
      commitPose: () => {
        camera.position.y = targetY;
        this.center.y = startCenterY + (targetY - startY);
        if (endQuat) camera.quaternion.copy(endQuat);
        camera.updateMatrixWorld();
      },
      settle: {
        grounded: 'force-true',
        reseedLegit: true,
        lbMode: true,
        refreshSnapshot: true
      }
    });
  }

  _onKeyUp(event) {
    // TASK-010 (B6): symmetric with `_onKeyDown` — same first-line sync.
    this._drag.syncDragModeToShift(event.shiftKey);
    const k = event.code;
    const wasHeld = this._wasd.hasHeldKey(k);
    if (wasHeld) this._wasd.deleteHeldKey(k);
    // Interplay: releasing a held movement key ends an in-progress
    // rotation gesture — functionally equivalent to Shift-up / button-up,
    // even though the user may keep dragging. `_heldKeys` only ever holds
    // movement codes, so `wasHeld` doubles as the movement-key test (and
    // excludes keyups whose keydown was swallowed by a typing target).
    if (wasHeld) this._drag.endRotationForWasd();
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
    this._wheel.drain();
    this._wasd.drain(deltaMs);
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

  // --- LB hit-anchored truck ---

  // --- TASK-010 rotation regime (two-way, latched at gesture start) ---

  // --- Shift+LB orbit/tilt around latched center ---

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
