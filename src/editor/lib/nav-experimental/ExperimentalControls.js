/* global THREE, AFRAME, STREET */

// Sibling to THREE.EditorControls. Drives the editor camera by default;
// `?nav=classic` opts out to the legacy controls (KD-01).
//
// Core gesture mechanics (LB / Shift+LB / wheel / WASD / Plan View):
//   - LB+drag        -> world-horizontal hit-anchored truck/dolly
//   - Shift+LB+drag  -> two-regime rotate, split on the tilt threshold T:
//                       Map orbit around the cursor pivot above T,
//                       rotate-in-place below T
//   - Wheel          -> exponential cursor-anchored dolly (budget drained
//                       per A-Frame tick; tilt-preserving)
//   - WASD           -> camera-yaw-projected horizontal motion
//   - Plan View      -> animated tween to top-down N-up (entered via
//                       handlePlanViewRequest, called by viewport.js)
//
// Wheel-zoom swoop mechanics:
//   - Wheel zoom is a 3-phase "swoop" gated by camera elevation **above
//     ground (AGL)** = camera.y − groundY, measured by a downward probe
//     (`collisionFloorAt` — collision floor incl. building
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
// Public API (mirrors THREE.EditorControls):
//   - enabled, center, panSpeed, zoomSpeed, minSpeedFactor, rotationSpeed
//   - setCamera(camera), setAspectRatio(ratio)
//   - focus(target) — reuses focus-animation A-Frame component
//   - newSceneCameraZoom(snapshotCameraState)
//   - resetZoom()
//   - zoomInStart/Stop, zoomOutStart/Stop
//   - handlePlanViewRequest()
//   - addEventListener / dispatchEvent (Three EventDispatcher)
//   - dispose()

import './navTuningComponent.js';
import { isStreetLevelNav, isWasdNav } from './flag.js';
import { ModifierState } from './modifierState.js';
import { GestureLatch } from './gestureLatch.js';
import { SceneBounds } from './sceneBounds.js';
import { ProbeTargets } from './probeTargets.js';
import { CursorAnchor } from './cursorAnchor.js';
import { TickAnimator } from './tickAnimator.js';
import { CollisionProbe } from './collisionProbe.js';
import { GroundedState } from './groundedState.js';
import { SituationSensor } from './situationSensor.js';
import { CameraWriteFunnel } from './cameraWriteFunnel.js';
import { CommittedMotionRunner } from './committedMotionRunner.js';
import { WheelSwoopEngine } from './wheelSwoopEngine.js';
import { WasdFlight, MOVEMENT_KEY_CODES } from './wasdFlight.js';
import { DragGestureController } from './dragGestureController.js';
import { TransitionController } from './transitionController.js';
import { RecoveryService } from './recoveryService.js';
import { DoubleClickNav } from './doubleClickNav.js';
import { CompassController } from './compassController.js';
import {
  ROTATION_SPEED_RAD_PER_PX,
  TILT_THRESHOLD_DEFAULT_DEGREES,
  MAP_PIVOT_BOUNDS_RADIUS_METRES,
  MAP_PIVOT_FAR_ACCEPT_GAIN,
  WHEEL_ZOOM_LATERAL_CAP_LOWER_BOUND_METRES,
  FOCUS_EMPTY_BBOX_DISTANCE_METRES
} from './constants.js';
import { captureNavDiscovery } from '../navAnalytics.js';
// Frozen import path: the Compass widget imports `needleScreenAngle` from this
// module. Re-export it from its new home (the compass controller).
export { needleScreenAngle } from './compassController.js';

const NAV_DEBUG = (() => {
  if (typeof window === 'undefined' || !window.location) return false;
  return new URLSearchParams(window.location.search).get('navDebug') === 'true';
})();

export class ExperimentalControls extends THREE.EventDispatcher {
  constructor(camera, domElement, sceneEl) {
    super();

    // EditorControls-compatible knobs. `enabled` is an accessor (see below):
    // input handlers and `_onTick` gate on `_isInactive()`, but runner/compass
    // tweens run as their OWN TickAnimator subscriptions which never re-check
    // the flag — so the false edge must actively cancel any in-flight motion,
    // or a tween started before a mode handoff (drive start, WebXR entry —
    // mode-manager's activateSceneCamera() sets `controls.enabled = false`)
    // would keep writing the now-unrendered editor camera.
    this._enabled = true;
    this.center = new THREE.Vector3();
    this.panSpeed = 0.002;
    // Legacy field used only by the ActionBar +/- buttons (_zoomActionBar),
    // which is out of the wheel-dolly path and must keep its current feel.
    // It previously aliased ZOOM_PER_WHEEL_TICK (0.1); that constant was
    // later halved to 0.05 for the WHEEL dolly only, so pin zoomSpeed to the
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
    // Curated raycast-target list for the floor/enclosure probes — the
    // whole scene minus `[data-ignore-raycaster]` subtrees (excepting the
    // Google 3D Tiles subtree, an accepted collision floor). See
    // probeTargets.js for the exclusion contract (#1853).
    this._probeTargets = new ProbeTargets(this._sceneEl);
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
    // the whole orchestrator (KD-32, the shared-context decomposition). Dispatch
    // identity is handed to the write funnel as an explicit bound callback;
    // predicates are exposed as named ctx functions.
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
      get bounds() {
        return self._bounds;
      },
      get probeTargets() {
        return self._probeTargets;
      },
      get disabledByOrtho() {
        return self._disabledByOrtho;
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
      get transition() {
        return self._transition;
      },
      get zoomSpeed() {
        return self.zoomSpeed;
      },
      get minSpeedFactor() {
        return self.minSpeedFactor;
      },
      get tick() {
        return self._tick;
      },
      // Dispatch identity: the `change`/cue events must fire ON the controls
      // instance (frozen external contract) — hand modules a bound callback,
      // never the instance itself.
      dispatch: self.dispatchEvent.bind(self),
      // Re-evaluate the LB sub-mode from the live camera and emit a modechange on
      // transition. The camera-write funnel drives this on every camera write
      // (exact T via `dispatch`, hysteresis via `commitTween`); the drag
      // controller owns the comparator.
      resolveLetterbox: (useHysteresis) =>
        self._drag.resolveLetterbox(useHysteresis),
      // Coarse `nav-experimental:modechange` (pan/rotate/null) dual-dispatch,
      // owned by the orchestrator; the drag controller emits through it.
      emitModeChange: (mode) => self._emitModeChange(mode),
      // "Controls disabled / a Plan View or compass tween owns the frame" — the
      // gesture guard the drag controller reads.
      isInactive: () => self._isInactive(),
      // Stop an in-flight F-key focus glide. Called from the runner's shared
      // cancel (which every camera-owning tween start routes through) so a
      // teleport/preset/compass tween never dual-writes the camera against
      // the focus-animation component's per-tick lerp (PR #1851 review).
      cancelFocusGlide: () => {
        if (self._focusAnimation) self._focusAnimation.transitioning = false;
      },
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
    // Shared grounded-vs-flying state, read + written by the wheel,
    // WASD, pedestal, and transition subsystems.
    this._groundedState = new GroundedState(this._ctx);
    // Per-tick situation sensor: legit-pose snapshot, recovery cue, context
    // snapshot from one idle-gated enclosure ray.
    this._sensor = new SituationSensor(this._ctx);
    // Camera-write funnel: the single edge every camera move passes through —
    // letterbox resolve + `change`-dispatch + wheel-memory invalidation.
    // `clearWheelMemory` points at the wheel engine's zoom-undo reset;
    // `resolveLetterbox` at the drag controller's letterbox comparator.
    this._funnel = new CameraWriteFunnel({
      dispatch: this._ctx.dispatch,
      clearWheelMemory: () => this._wheel.clearZoomUndo(),
      resolveLetterbox: this._ctx.resolveLetterbox
    });
    // Committed-motion runner: the single home for every camera-owning
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
    // Transition controller: the preset-pose motions (pop-to-roof / swoop-to-
    // street / rise-to-drone / fall-to) + the context-view-button resolver + the
    // ActionBar zoom. Each preset hands its tween to the runner.
    this._transition = new TransitionController(this._ctx);
    // Recovery service: the gesture-end ease-back-or-pop policy (uses the runner
    // + the transition controller's pop-to-roof; reached by the mouseup router).
    this._recovery = new RecoveryService(this._ctx);
    // Double-click navigation: classify → desired pose → standoff → teleport
    // tween via the runner. Called from viewport.js on the doubleclick event.
    this._dblclick = new DoubleClickNav(this._ctx);
    // Compass + plan-view controller: the top-down plan-view tween + the compass
    // body-click / rotate-arrow actions. Keeps its own tick animation + ownership
    // flags (feeding _isInactive); does NOT enter the runner.
    this._compass = new CompassController(this._ctx);

    // The single tilt threshold T governing the LB
    // sub-mode, the wheel cut, the rotation regime, and the letterbox.
    // Live value (overridable via `setTiltThreshold` / the
    // `nav-experimental-tuning` component); defaults to the constant.
    this._tiltThreshold = TILT_THRESHOLD_DEFAULT_DEGREES;

    // Map-pivot bounds radius (metres on the ground,
    // measured from the screen-centre point). Live value, overridable via
    // the tuning component.
    this._mapPivotBoundsRadius = MAP_PIVOT_BOUNDS_RADIUS_METRES;

    // Street-level-mode-OFF far-acceptance budget for a clicked Map rotation
    // pivot (see the constant). Live value, overridable via the tuning
    // component (mapPivotFarAcceptGain → setMapPivotFarAcceptGain).
    this._mapPivotFarAcceptGain = MAP_PIVOT_FAR_ACCEPT_GAIN;

    // Lower bound on the per-tick wheel-zoom
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

    // ActionBar zoom-in/out hold-down intervals.
    this._zoomInInterval = null;
    this._zoomOutInterval = null;

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
      console.info('[nav-experimental] ExperimentalControls active.');
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
      this._compass.cancelPending();
      if (!this._disabledByOrtho) {
        this._disabledByOrtho = true;

        console.info(
          'ExperimentalControls: orthographic camera not supported; ' +
            'controls disabled until a perspective camera is restored.'
        );
      }
    } else {
      this._isOrthographic = false;
      this._disabledByOrtho = false;
    }
  }

  // `enabled` false edge: freeze EVERYTHING, including motions already in
  // flight. Handlers and `_onTick` already gate on `_isInactive()`; this
  // covers the runner/compass tweens (own TickAnimator subscriptions), held
  // WASD keys, a latched drag (also hides the rotation ring), and the legacy
  // focus glide — so a camera borrower (drive mode, WebXR) never has the
  // editor camera written underneath it. The true edge restores nothing:
  // subsystems re-engage on the next input, from the camera's current pose.
  get enabled() {
    return this._enabled;
  }

  set enabled(value) {
    const wasEnabled = this._enabled;
    this._enabled = value;
    if (wasEnabled && !value) {
      if (this._runner) this._runner.cancel();
      if (this._compass) this._compass.cancelPending();
      if (this._wasd) this._wasd.clearHeldKeys();
      if (this._drag && this._latch && this._latch.isActive()) {
        this._drag.endGesture();
      }
      if (this._focusAnimation) this._focusAnimation.transitioning = false;
    }
  }

  setAspectRatio(ratio) {
    this._aspectRatio = ratio;
  }

  focus(target) {
    if (this._disabledByOrtho || !this._focusAnimation) return;
    // A committed-motion tween (teleport / preset / recovery / scene-load
    // fly-in) may own the camera. Cancel it first — wheel/WASD/mousedown are
    // all tween-gated; focus was the one ungated writer, so F mid-tween had
    // two per-frame camera writers fighting (PR #1851 review).
    this._cancelCameraTween();
    const camera = this._camera;
    const fa = this._focusAnimation;

    fa.transitionCamPosStart.copy(camera.position);
    fa.transitionCamQuaternionStart.copy(camera.quaternion);

    const box = new THREE.Box3().setFromObject(target);
    // Batched entities have their mesh tree stripped at batch time, so
    // setFromObject finds no geometry under them. batch-models stashes an
    // entity-local AABB on the object3D (same fallback OrientedBoxHelper
    // uses) — union it in world space.
    if (target._batchLocalBbox) {
      box.union(
        new THREE.Box3()
          .copy(target._batchLocalBbox)
          .applyMatrix4(target.matrixWorld)
      );
    }
    const targetCenter = new THREE.Vector3();
    let distance;
    let localCenterY;

    if (!box.isEmpty() && !isNaN(box.min.x)) {
      box.getCenter(targetCenter);
      distance = box.getBoundingSphere(new THREE.Sphere()).radius;
      localCenterY = (box.max.y - box.min.y) / 2;
    } else {
      // No measurable geometry (a light, an empty wrapper, a geojson data
      // layer whose meshes aren't under the entity's object3D): frame the
      // entity origin from a usable standoff. Legacy's 0.1 parked the camera
      // 0.25 m from the origin — at street level over a collision floor that
      // strands the wheel in the Phase-3 FOV regime where zoom-out visibly
      // does nothing (#1865).
      targetCenter.setFromMatrixPosition(target.matrixWorld);
      distance = FOCUS_EMPTY_BBOX_DISTANCE_METRES;
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

  // Smoothly return the camera to a stored snapshot pose (#1605) — the
  // ExperimentalControls port of EditorControls.focusCameraState (the
  // snapshot gallery's "focus on pose" glide). Same look-at reconstruction
  // as the legacy version, but the glide runs through the committed-motion
  // runner (teleport ownership) so it obeys the single-writer/interrupt
  // discipline and settles grounded/legit/context state like every other
  // committed tween.
  focusCameraState(cameraState) {
    if (this._disabledByOrtho || !cameraState) return;
    const camera = this._camera;
    const pos = cameraState.position || {};
    const rot = cameraState.rotation || {};
    const endPos = new THREE.Vector3(
      pos.x != null ? pos.x : 0,
      pos.y != null ? pos.y : 15,
      pos.z != null ? pos.z : 30
    );
    const { look: endLookAt, quaternion: endQuat } = this._snapshotLookAt(
      endPos,
      rot
    );
    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();
    const fromFov = camera.fov;
    const toFov = cameraState.zoom || fromFov;
    this._runner.run({
      ownership: 'teleport',
      durationMs: 1000,
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
        this.center.copy(endLookAt);
      },
      settle: {
        grounded: 'derive',
        reseedLegit: true
      }
    });
  }

  resetZoom() {
    if (this._disabledByOrtho) return;
    const camera = this._camera;
    this.center.set(0, 1.6, 0);
    camera.position.set(0, 15, 30);
    camera.lookAt(this.center);
    camera.updateMatrixWorld();
    // Invalidate the legit-pose snapshot so a subsequent
    // recovery never tweens back to the pre-reset pose. It re-seeds on the
    // next legit tick.
    this._sensor.lastLegitPose = null;
    // Re-derive grounded from the post-reset pose (the reset
    // camera at (0,15,30) is high → not-grounded unless a floor sits near it).
    this._groundedState.deriveFromPose();
    // A reset/new-scene wipes all nav state: a non-wheel move → invalidate the
    // wheel zoom-undo memory, then dispatch.
    this._funnel.commitMove('reset');
  }

  // Reconstruct the look-at target of a stored pose (position + Euler
  // rotation): cast the pose's forward ray and, where it dips below the
  // horizon, intersect the ground plane — the legacy EditorControls
  // heuristic, so arrival orbit centers match saved vantages. Returns the
  // look point and the pose's world quaternion.
  _snapshotLookAt(endPos, rot) {
    const scratch = new THREE.PerspectiveCamera();
    scratch.position.copy(endPos);
    scratch.rotation.set(rot.x || 0, rot.y || 0, rot.z || 0);
    scratch.updateMatrixWorld();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(
      scratch.quaternion
    );
    let t = 30;
    if (Math.abs(forward.y) > 0.001) {
      const ground = -endPos.y / forward.y;
      if (ground > 0 && ground <= 1000) t = ground;
    }
    const look = endPos.clone().addScaledVector(forward, t);
    if (look.y < 0) look.y = 0;
    return { look, quaternion: scratch.quaternion.clone() };
  }

  newSceneCameraZoom(snapshotCameraState) {
    if (this._disabledByOrtho) {
      this.resetZoom();
      return;
    }
    const camera = this._camera;
    // Scene-load fly-in (legacy EditorControls parity): a 3 s easeOutCubic
    // glide from the fixed intro vantage to the scene's saved pose — or the
    // default overview when none is saved — honoring the saved fov (`zoom`,
    // the ?camera= deep-link's 7th param). Runs through the runner so it
    // obeys the single-writer discipline: any committed user motion or the
    // mode-manager enabled=false handoff cancels it like every other tween.
    const startPos = new THREE.Vector3(0, 30, 60);
    const startLookAt = new THREE.Vector3(0, 1.6, 0);
    let endPos;
    let endLookAt;
    if (snapshotCameraState) {
      const pos = snapshotCameraState.position || {};
      endPos = new THREE.Vector3(
        pos.x != null ? pos.x : 0,
        pos.y != null ? pos.y : 15,
        pos.z != null ? pos.z : 30
      );
      endLookAt = this._snapshotLookAt(
        endPos,
        snapshotCameraState.rotation || {}
      ).look;
    } else {
      endPos = new THREE.Vector3(0, 15, 30);
      endLookAt = startLookAt.clone();
    }
    const fromFov = camera.fov;
    const toFov = (snapshotCameraState && snapshotCameraState.zoom) || fromFov;
    const curPos = new THREE.Vector3();
    const curLook = new THREE.Vector3();
    const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
    this._runner.run({
      ownership: 'teleport',
      durationMs: 3000,
      ease: easeOutCubic,
      onTick: (eased) => {
        curPos.lerpVectors(startPos, endPos, eased);
        curLook.lerpVectors(startLookAt, endLookAt, eased);
        camera.position.copy(curPos);
        this.center.copy(curLook);
        camera.up.set(0, 1, 0);
        camera.lookAt(curLook);
        if (toFov !== fromFov) {
          camera.fov = fromFov + (toFov - fromFov) * eased;
          camera.updateProjectionMatrix();
        }
        camera.updateMatrixWorld();
      },
      commitPose: () => {
        camera.position.copy(endPos);
        this.center.copy(endLookAt);
        camera.up.set(0, 1, 0);
        camera.lookAt(endLookAt);
        camera.fov = toFov;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
      },
      // Settle: derive grounded from the landed pose and reseed the
      // legit-pose snapshot (a scene load is a teleport edge) — the terminal
      // dispatch also clears wheel zoom-undo, matching the old snap's
      // commitMove('reset').
      settle: {
        grounded: 'derive',
        reseedLegit: true
      }
    });
  }

  zoomInStart() {
    if (this._disabledByOrtho) return;
    // Clear any prior timer first — a second start without an intervening stop
    // (e.g. a mouseup lost to a window blur mid-press) would otherwise orphan it.
    this.zoomInStop();
    captureNavDiscovery('zoom');
    this._zoomInInterval = setInterval(
      () => this._transition.zoomActionBar(-1),
      50
    );
  }
  zoomInStop() {
    clearInterval(this._zoomInInterval);
    this._zoomInInterval = null;
  }
  zoomOutStart() {
    if (this._disabledByOrtho) return;
    // Clear any prior timer first (see zoomInStart).
    this.zoomOutStop();
    captureNavDiscovery('zoom');
    this._zoomOutInterval = setInterval(
      () => this._transition.zoomActionBar(1),
      50
    );
  }
  zoomOutStop() {
    clearInterval(this._zoomOutInterval);
    this._zoomOutInterval = null;
  }

  // Set the live tilt threshold T. Clamped to a sane range
  // (5–45°). Re-resolves the LB-mode after storing: changing T while the
  // camera sits at a fixed tilt can flip the comparator (e.g. pan-truck →
  // pan-pedestal) without any mouse-move — a fixed-pose flip with no camera
  // write for the funnel to ride, so it is resolved directly (exact T). The
  // resolve is a no-op when the comparator result is unchanged, so it is cheap.
  setTiltThreshold(deg) {
    if (typeof deg !== 'number' || !isFinite(deg)) return;
    this._tiltThreshold = THREE.MathUtils.clamp(deg, 5, 45);
    this._drag.resolveLetterbox();
  }

  // Live-tunable Map-pivot bounds radius (metres
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

  // Live-tunable LOWER BOUND of the wheel-zoom
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
    // tilt (pedestal ↔ truck) — resolve directly (exact T, no camera write to
    // ride) so the letterbox updates without waiting for the next interaction
    // (same reasoning as setTiltThreshold).
    this._drag.resolveLetterbox();
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

  // Live-tunable Shift+LB rotation speed
  // (radians per pixel). Relayed from the tuning component.
  setRotationSpeed(radPerPx) {
    if (typeof radPerPx !== 'number' || !isFinite(radPerPx) || radPerPx <= 0) {
      return;
    }
    this.rotationSpeed = radPerPx;
  }

  dispose() {
    // Drop any in-flight compass tween/queue (belt-and-braces;
    // the derived gate already self-heals).
    this._compass.cancelPending();
    this._detach();
    if (this._unsubscribeTick) this._unsubscribeTick();
    this._modifiers.dispose();
    this._bounds.dispose();
    this._probeTargets.dispose();
    if (this._cursorAnchor) this._cursorAnchor.dispose();
    if (this._drag) this._drag.dispose();
    if (this._tick) this._tick.dispose();
    // Remove the tuning component this controls instance
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
      // Wrap the change callback so a focus-animation tween that crosses the
      // tilt boundary updates the visual indicator mid-animation. The callback's
      // terminal `funnel.dispatch()` resolves the letterbox at exact T every
      // frame (emit-on-change, one asin + compare), so the indicator updates
      // *during* the tween rather than at its end — no explicit resolve needed
      // here. (Focus is a point-to-point tween that crosses T at most once, so
      // exact T is correct; the runner-tween hysteresis does not apply.)
      const callback = () => {
        // Focus-to-object moves the camera via the A-Frame
        // focus-animation component — a non-wheel move. Invalidate the
        // zoom-undo memory on its change hook (fires each frame of the
        // transition; idempotent).
        this._funnel.invalidateWheelMemory('focus');
        // Reseed the legit-pose snapshot once the focus
        // (double-click teleport) animation has settled, so recovery can't
        // ease back to the pre-teleport pose. The component sets
        // `transitioning = false` on its final frame.
        if (this._focusAnimation && !this._focusAnimation.transitioning) {
          this._sensor.reseedLegitPose();
        }
        this._funnel.dispatch();
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
    // Subscribe to the signals that mean "solid geometry under/around
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
    // Tear down the scene-geometry-dirty listeners added in _attach.
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
      this._compass.planViewActive ||
      this._compass.isCompassAnimating()
    );
  }

  _emitModeChange(mode) {
    // The letterbox mode indicator subscribes via the sceneEl event bus (KD-30);
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

  // "a camera-owning tween is in flight" — the recovery
  // ease-back OR the double-click teleport. The PASSIVE input gates (wheel,
  // WASD, toolbar zoom, the legit-snapshot) read this so neither races the tween.
  // NOT used by `_onMouseDown` (an active grab must still reach the abort).
  // Delegates to the runner, which owns the ownership flags.
  _tweenOwnsCamera() {
    return this._runner.ownsCamera();
  }

  // Cancel whatever camera-owning tween is in flight and clear
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

  // Frozen public surface (the React context-view button polls the resolver and
  // fires the trigger; Space also routes through the trigger). Delegate to the
  // transition controller, which owns the resolver + the preset motions.
  resolveContextAction() {
    return this._transition.resolveContextAction();
  }

  triggerContextAction() {
    return this._transition.triggerContextAction();
  }

  // Frozen public surface: viewport.js calls this on the
  // `nav-experimental:doubleclick` event. Delegates to the double-click nav.
  navigateDoubleClick(payload) {
    return this._dblclick.navigateDoubleClick(payload);
  }

  // Frozen public surface: viewport.js (key-4 / menu) triggers plan view; the
  // Compass widget fires the body-click and rotate arrows. Delegate to the
  // compass controller.
  handlePlanViewRequest(opts = {}) {
    return this._compass.handlePlanViewRequest(opts);
  }

  handleCompassBodyClick() {
    return this._compass.handleCompassBodyClick();
  }

  handleCompassRotate(sign) {
    return this._compass.handleCompassRotate(sign);
  }

  // Mouse gesture entry points. These stay named on the orchestrator (the
  // window listeners bind their identity) but are thin routers over the drag
  // controller: the orchestrator owns only the passive-input guard, the
  // window-listener attach/detach, the mid-tween abort, and the gesture-end
  // recovery call.
  _onMouseDown(event) {
    if (this._isInactive()) return;
    const mode = this._drag.decideMouseMode(event);
    if (!mode) return;
    // A fresh press mid-tween would otherwise
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
    // Gesture-end correction — the one bounded automatic motion
    // the principle allows. If a camera-drag (pan/rotate) ended with the camera
    // inside a building (not legit), ease it back to the most recent legit pose
    // (or pop to the roof if none / no longer valid).
    if (
      (endedMode === 'pan' || endedMode === 'rotate') &&
      !this._runner.isRecovering()
    ) {
      this._recovery.maybeRecoverAtGestureEnd();
    }
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

  _onWheel(event) {
    // A camera-owning tween (recovery or teleport) owns the
    // camera — passive wheel input is ignored, not raced. Input plumbing
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
      // Hide the ring on a window blur (e.g. Alt-Tab
      // mid-orbit) so it can't leak visible.
      this._drag.hideIndicator();
    }
  }

  _onKeyDown(event) {
    // First line, before every other guard, so keydown
    // and keyup are symmetric and the Shift sync isn't swallowed by the
    // typing/modifier/WASD early returns below.
    this._drag.syncDragModeToShift(event.shiftKey);
    // Space focus-yield. `_onKeyDown` is a
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
    // remapped to T/L/C in shortcuts.js so WASD is free
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

    // Space — discrete context-action key (not a
    // held key). Only reached when focus is NOT on an interactive control (the
    // focus-yield guard above handles that case) — i.e. the canvas/body has
    // focus, so Space is the nav key here: preventDefault (suppress scroll) +
    // dispatch. Routes through the SAME resolver + dispatch as the view button,
    // so the two never disagree (one resolver, two triggers).
    // `triggerContextAction` owns the full gate (busy = inactive / animating /
    // recovery), so an un-gated Space mid-tween can no longer cancel/restart a
    // motion. This adds the third rung Space previously lacked: at street
    // level Space now rises to drone view (was a no-op).
    if (k === 'Space') {
      event.preventDefault(); // stop page scroll
      // Space now routes through the shared context resolver (the view-button
      // action), superseding its earlier Space→fall behaviour. Its `busy` gate
      // includes `_tick.isAnimating()`, so Space is inert during a double-click
      // teleport tween — no separate guard needed here.
      this.triggerContextAction();
    }
  }

  _onKeyUp(event) {
    // Symmetric with `_onKeyDown` — same first-line sync.
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

  // A SUPERSET of `_isTypingTarget` — any focusable
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
    this._wasd.stepFlight(deltaMs);
    // Legit-pose snapshot + discoverability cue. Runs
    // after the drains so it captures the post-move pose. Suppressed while a
    // recovery OR teleport tween owns the camera — the
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
}
