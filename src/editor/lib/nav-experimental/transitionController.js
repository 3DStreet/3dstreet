/* global THREE */

import {
  DEFAULT_DRONE_HEIGHT,
  DEFAULT_FOV_DEGREES,
  DEFAULT_OVERVIEW_TILT_DEGREES,
  EYE_MARGIN_METRES,
  FALL_DURATION_MS,
  POP_TO_ROOF_DURATION_MS,
  ROOF_CLEARANCE,
  CAMERA_FAR_PLANE_MIN_METRES,
  CAMERA_FAR_PLANE_MAX_METRES,
  CAMERA_FAR_PLANE_DISTANCE_FACTOR
} from './constants.js';
import { cameraTiltDegrees } from './navMath.js';

const DEG2RAD = Math.PI / 180;

// The transition controller — the preset-pose camera motions and the
// context-view-button resolver. Owns the four "go somewhere" motions
// (pop-to-roof / daylight, swoop-to-street, rise-to-drone, fall-to) plus the
// ActionBar +/- zoom. Each preset computes its start->end pose math here and
// hands the tween to the committed-motion runner (ctx.runner.run) — the runner
// owns the tween loop, per-tick commit, and settle. Also owns
// resolveContextAction / triggerContextAction: the single resolver + dispatch
// the React context button AND the Space key both funnel through.
//
// Reads the live camera / services through the shared controls context; carries
// its own dolly scratch. `popToRoof` is public because it is also the recovery
// service's ease-back hand-off target.
export class TransitionController {
  constructor(ctx) {
    this._ctx = ctx;
    // Last resolved context-button kind, held greyed across a busy frame.
    this._lastResolvedKind = 'drone';
    // ActionBar dolly scratch.
    this._delta = new THREE.Vector3();
    this._normalMatrix = new THREE.Matrix3();
  }

  // Pop-to-daylight. One up-ray collects accepted overhead
  // solids in the camera column; target just above the HIGHEST one
  // (+ EYE_MARGIN) so a single press clears a multi-slab / nested stack.
  // Vertical only (preserve yaw/pitch). Probe-miss → no-op (don't
  // bury at a stale height).
  popToRoof() {
    const camera = this._ctx.camera;
    const probe = this._ctx.sensor.enclosureProbe();
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
    const startCenterY = this._ctx.center.y;
    // Single mid-tween retarget. If a higher overhead slab streams
    // in during the pop, the original target would surface still enclosed;
    // raise the target once (a single hand-off — guarded by a small
    // threshold so it can't oscillate).
    const RETARGET_EPS = 0.1; // metres
    let retargeted = false;
    // Committed via Runner Door 2 (preset motion — glossary: Runner entry
    // modes). y-delta center follow; per-tick commit.
    // Settle: a pop-to-roof / pop-to-daylight lands you standing on that roof →
    // grounded; reseed; refresh the context snapshot. The letterbox is resolved
    // at exact T by the runner's terminal funnel.dispatch() (a no-op here — pop
    // preserves pitch — but the exact-T resolve is uniform across every settle;
    // KD-05 / KD-30).
    this._ctx.runner.run({
      ownership: 'recovery',
      durationMs: POP_TO_ROOF_DURATION_MS,
      onTick: (eased) => {
        if (!retargeted) {
          const reprobe = this._ctx.sensor.enclosureProbe();
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
        this._ctx.center.y = startCenterY + (y - startY);
        camera.updateMatrixWorld();
      },
      commitPose: () => {
        camera.position.y = targetY;
        this._ctx.center.y = startCenterY + (targetY - startY);
        camera.updateMatrixWorld();
      },
      settle: {
        grounded: 'force-true',
        reseedLegit: true
      }
    });
  }

  // The shared context resolver — a PURE READ of the per-tick
  // `_contextSnapshot` (it does NOT probe). Returns { kind, enabled, busy }:
  //   kind    — 'daylight' | 'street' | 'drone' (the destination state; the
  //             icon shows where the button will take you).
  //   enabled — false = the no-op grey-out (no valid target for `kind`).
  //   busy    — a tween is in flight or the controls are inactive; both
  //             triggers are inert and the button holds its last icon greyed.
  // The resolver is the SINGLE authority on busy/enabled — the button never
  // independently inspects `_tick`. Precedence ladder (fixed
  // order — load-bearing): enclosed → daylight; elevated → street;
  // else (at street level) → drone.
  resolveContextAction() {
    const s = this._ctx.sensor.contextSnapshot;
    const camY = this._ctx.camera.position.y;
    const busy =
      this._ctx.isInactive() ||
      this._ctx.tick.isAnimating() ||
      this._ctx.runner.isRecovering();
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
      if (!this._ctx.streetLevelEnabled) {
        this._lastResolvedKind = 'none';
        return { kind: 'none', enabled: false, busy: false };
      }
      // Street view. Enabled mirrors `_swoopToStreet` EXACTLY: it swoops to
      // the camera-centre look-at when tilted past T, else drops vertically to
      // the floor below. So it has a target — and the button is enabled — when
      // EITHER the look-at swoop (tilt > T, a per-column floor at the look-at
      // below us) OR the vertical drop (a floor below us) would move. Grey out
      // only when neither does (over the void with nothing in view). This
      // is why a fresh load looking down at the street from over the scene edge
      // is correctly ENABLED even though nothing is directly below.
      kind = 'street';
      const tiltedToGround =
        cameraTiltDegrees(this._ctx.camera) > this._ctx.tiltThreshold;
      const lookAtOk =
        s.lookAtFloorY != null && s.lookAtFloorY + EYE_MARGIN_METRES < camY;
      const belowOk =
        s.floorY != null &&
        isFinite(s.floorY) &&
        s.floorY + EYE_MARGIN_METRES < camY;
      enabled = (tiltedToGround && lookAtOk) || belowOk;
    } else {
      // Drone view: rise. Never greys — it always targets a height above the
      // surface below, rising past an overhang if need be.
      kind = 'drone';
      enabled = true;
    }
    this._lastResolvedKind = kind; // hold across the next busy frame
    return { kind, enabled, busy: false };
  }

  // The single dispatch both the button click and Space funnel into.
  // One gate (busy || !enabled), shared by both triggers, so neither can
  // interrupt an in-flight camera tween or click into a no-op.
  triggerContextAction() {
    const { kind, enabled, busy } = this.resolveContextAction();
    if (busy || !enabled) return;
    if (kind === 'daylight') return this.popToRoof();
    if (kind === 'street') return this._swoopToStreet();
    if (kind === 'drone') return this._riseToDrone();
    return undefined;
  }

  // Street view is a DESCENDING SWOOP to the point you
  // are LOOKING AT, not the point directly below. Anchor = the camera-center
  // ground hit (`probe.centerRayGroundHit`, a forward raycast to the collision
  // floor). The motion is the preset TWEEN MECHANISM (pre-computed
  // start→end pose + linear position lerp + quaternion slerp) — NOT a cursor
  // dolly (whose lateral cap can't reach a distant look-at point) and NOT the
  // wheel tilt-coupling (welded to wheel accumulator state). The END POSE: when
  // the look-at hit `P` is non-null, we land at street eye-height AT `P` (not
  // straight down). The combined down+forward translation + the tilt slerp gives
  // the forward-and-down swoop arc to the spot you were looking at — "drop the
  // pegman where I am looking".
  _swoopToStreet() {
    if (!this._ctx.streetLevelEnabled) return; // gated upstream; belt-and-braces
    const cam = this._ctx.camera;
    const P = this._ctx.probe.centerRayGroundHit();
    // Discriminate the two street-view cases by HOW STEEPLY you are looking
    // down. The look-at point sits on the view ray, so the swoop's
    // descent-path angle IS the camera pitch: a shallow gaze means "big
    // horizontal / tiny drop" = a lurch. So swoop to the look-at ONLY when
    // pitched down past the low-tilt threshold (`_tiltThreshold`, the SAME T the
    // wheel-zoom / Map-mode boundary uses — "are you looking down enough to be
    // targeting the ground"); otherwise drop straight down to settle back where
    // you were. This makes the drone→street toggle (steep, ~60°) swoop to your
    // start, while a small pedestal-up-looking-forward just drops vertically.
    const lookingDownEnough = cameraTiltDegrees(cam) > this._ctx.tiltThreshold;
    if (P && lookingDownEnough) {
      // Look-at swoop: end at street eye-height above the look-at point P.
      const floorAtP = this._ctx.probe.collisionFloorAt(P.x, P.z);
      // Prefer the per-column collision floor at P (slope-safe); if that misses
      // (P sits over a void seam), fall back to P.y itself (the ray hit).
      const groundYAtP = floorAtP.source !== 'cache' ? floorAtP.y : P.y;
      const targetY = groundYAtP + EYE_MARGIN_METRES;
      // Only swoop if the target is strictly below the camera (else the click
      // would be a silent no-op though the button reads enabled);
      // otherwise fall through to the vertical drop.
      if (targetY < cam.position.y) {
        this._swoopTo(P.x, targetY, P.z);
        return;
      }
    }
    // P null (looking at sky / off-scene), a shallow gaze (looking out, not down
    // at a spot), or an unsuitable look-at (above the camera): fall back to the
    // VERTICAL drop to the surface directly below, leveling out — gives
    // the "settle back down where I was" feel for a small pedestal.
    const floor = this._ctx.probe.collisionFloorAt(
      cam.position.x,
      cam.position.z
    );
    if (floor.source === 'cache') return; // no surface below either → no-op
    const targetY = floor.y + EYE_MARGIN_METRES;
    if (targetY >= cam.position.y) return; // already at/below
    this._fallTo(targetY, /* levelOut = */ true); // vertical level-out swoop
  }

  // The look-at descending swoop tween. End pose =
  // (endX, endY, endZ) at street eye-height over the look-at point, yaw kept,
  // pitch leveled to ~0° (the street landing). Position is interpolated
  // LINEARLY start→end (x and z change too, unlike `_fallTo`'s y-only lerp) and
  // the quaternion is slerped to a level orientation. Uses the standard
  // grounded-landing settle (grounded=true, reseed legit-pose, refresh the
  // context snapshot; KD-22). No mid-tween floor retarget here
  // (the target column is the look-at point, fixed at commit; the destination is
  // street level and clear by construction — the committed motion permits
  // passing through solid mid-swoop, forbidding only ending inside).
  _swoopTo(endX, endY, endZ) {
    const cam = this._ctx.camera;
    const startPos = cam.position.clone();
    const startCenter = this._ctx.center.clone();
    const startQuat = cam.quaternion.clone();
    // Level (tilt=0) end orientation preserving yaw, the same way `_fallTo`'s
    // levelOut builds it: scratch camera at the end position, looking 1 m ahead
    // along the live horizontal forward.
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
    // Committed via Runner Door 2 (preset motion — glossary: Runner entry
    // modes). Full-vector center lerp; per-tick commit;
    // lands at collisionFloor + eye-margin → grounded by construction, mirroring
    // `_fallTo`'s street landing (reseed, re-eval letterbox, refresh snapshot).
    this._ctx.runner.run({
      ownership: 'recovery',
      durationMs: FALL_DURATION_MS,
      onTick: (eased) => {
        cam.position.lerpVectors(startPos, endPos, eased);
        this._ctx.center.lerpVectors(startCenter, endCenter, eased);
        cam.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        cam.updateMatrixWorld();
      },
      commitPose: () => {
        cam.position.set(endX, endY, endZ);
        this._ctx.center.copy(endCenter);
        cam.quaternion.copy(endQuat);
        cam.updateMatrixWorld();
      },
      settle: {
        grounded: 'force-true',
        reseedLegit: true
      }
    });
  }

  // Drone view — an ASCENDING / REVERSE SWOOP. The
  // camera pulls UP-AND-BACK along its horizontal heading to a canonical height
  // H, ending at the 60° overview attitude LOOKING AT the feet point F (so the
  // round-trip closes: from drone, the center-ray hit ≈ F, and street swoops
  // back down to F). Anchor = the FEET (`collisionFloorAt` below the camera),
  // which is ALWAYS defined → drone has no null case (drone never
  // greys). The TWEEN MECHANISM (pre-computed start→end pose + linear
  // position lerp + quaternion slerp + FOV lerp) with a CLOSED-FORM end pose —
  // NOT a cursor dolly, NOT the wheel tilt-coupling. A separate method from
  // `_fallTo` (opposite grounded semantics: drone leaves the surface upward →
  // ungrounded + capture cruise height).
  _riseToDrone() {
    const cam = this._ctx.camera;
    // Anchor = the feet (surface directly below). Feet-miss fallback:
    // `collisionFloorAt` returns source 'cache' on a miss (over a
    // void); substitute the travel-height ground for F.y so the void case
    // degrades to a sane pose. `collisionFloorAt` refreshes the floor cache
    // (refreshCache: true) — NOT a pure read; call it exactly once. The `busy`
    // gate prevents interleave with an in-flight `_fallTo` retarget.
    const groundLevel = this._ctx.probe.travelHeightFloorBelowCamera();
    const floor = this._ctx.probe.collisionFloorAt(
      cam.position.x,
      cam.position.z
    );
    // surfaceBelow = the collision floor directly below (the roof you stand on,
    // for the ROOF_CLEARANCE term) AND the feet point the drone looks AT / offsets
    // back from. On a feet-miss (cache, over a void) substitute groundLevel so the
    // back-offset and lookAt target stay sane. Same value for both uses.
    const surfaceBelow = floor.source !== 'cache' ? floor.y : groundLevel;
    const feetY = surfaceBelow;
    const camX = cam.position.x;
    const camZ = cam.position.z;
    // Canonical target height — the max(...) below: default drone height above GROUND
    // LEVEL (travel height — looks past tall buildings to the ground between
    // them), OR a fixed clearance above the ROOF directly below when atop a
    // building taller than that. Both per-column raycasts (slope-safe). Keeps
    // the drone reliably "elevated" for the toggle.
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

    // Overhang end-pose check: the rise may pass THROUGH solid mid-motion
    // (the committed motion permits that), but the END pose must be clear. If the end column is
    // itself enclosed (overhead solid above targetY — multiple floors), raise
    // the target to just above the highest overhead solid there (a daylight-
    // style pop). One extra raycast at commit time only. Keeps drone's "never
    // greys" property — it always ends in open air. (Probe the END (x,z), which
    // is offset back from the camera column.) Streaming-in-overhead mid-rise
    // retarget is deferred polish — the rise is short (600 ms).
    let endXZ = computeEndXZ(targetY);
    const endProbe = this._ctx.sensor.enclosureProbeAt(
      endXZ.x,
      targetY,
      endXZ.z
    );
    if (endProbe.overheadHits.length) {
      const popTargetY =
        endProbe.overheadHits[endProbe.overheadHits.length - 1] +
        EYE_MARGIN_METRES;
      targetY = Math.max(targetY, popTargetY);
      endXZ = computeEndXZ(targetY); // recompute back-offset for the raised H
    }

    if (targetY <= cam.position.y) return; // already at/above canonical height

    const startPos = cam.position.clone();
    const startCenter = this._ctx.center.clone();
    const startFov = cam.fov;
    const startQuat = cam.quaternion.clone();

    // End quaternion: a scratch camera at the end position looking AT the feet
    // point F = (camX, feetY, camZ), up=+Y. At 60° there is no nadir/roll
    // singularity (the nadir handling is about the straight-down case only). Yaw is
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

    // Committed via Runner Door 2 (preset motion — glossary: Runner entry
    // modes). Full-vector center lerp + FOV lerp;
    // per-tick commit; suspends WASD / holds the busy gate via the 'recovery'
    // ownership. Settle: drone deliberately leaves the surface upward → flying,
    // re-capture the cruise height (the ungrounded rise path), reseed, and
    // refresh the context snapshot (flip icon drone→street). The letterbox is
    // resolved at exact T by the runner's terminal funnel.dispatch(): the rise
    // ends at the ~60° overview attitude (TH-28, > T = Map), so the indicator
    // now flips to Map at settle instead of lagging until the next input
    // (KD-05 / KD-30).
    this._ctx.runner.run({
      ownership: 'recovery',
      durationMs: FALL_DURATION_MS,
      onTick: (eased) => {
        cam.position.lerpVectors(startPos, endPos, eased);
        this._ctx.center.lerpVectors(startCenter, endCenter, eased);
        cam.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        cam.fov = startFov + (DEFAULT_FOV_DEGREES - startFov) * eased;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
      },
      commitPose: () => {
        cam.position.copy(endPos);
        this._ctx.center.copy(endCenter);
        cam.quaternion.copy(endQuat);
        cam.fov = DEFAULT_FOV_DEGREES;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
      },
      settle: {
        grounded: 'force-false-captureH',
        reseedLegit: true
      }
    });
  }

  // Vertical descent tween to `targetY`. When `levelOut`,
  // lerp the camera tilt toward horizontal during the descent (swoop feel);
  // otherwise preserve orientation (straight fall). Owns `_recoveryActive`.
  _fallTo(targetY, levelOut) {
    const camera = this._ctx.camera;
    const startY = camera.position.y;
    const startCenterY = this._ctx.center.y;
    const startQuat = camera.quaternion.clone();
    let endQuat = null;
    if (levelOut) {
      // Build a level (tilt=0) target orientation preserving yaw. The level
      // look is independent of the target height, so a mid-fall retarget of
      // `targetY` retarget leaves this orientation valid.
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
    // Single mid-fall retarget. If a closer solid surface streams in
    // ABOVE the original floor target during the descent, halt higher so the
    // camera doesn't sink through it. One hand-off — guarded by a threshold
    // so it can't oscillate. The level-out orientation above stays valid.
    const RETARGET_EPS = 0.1; // metres
    let retargeted = false;
    // Committed via Runner Door 2 (preset motion — glossary: Runner entry
    // modes). Per-tick commit (clears zoom-undo + the
    // Space fall / level-out swoop is a non-wheel descent — callers early-return
    // on noop/pop/already-below, so a no-op Space never reaches here). Settle:
    // grounded by construction (lands at collisionFloor + eye-margin), reseed,
    // re-eval letterbox, refresh the context snapshot.
    this._ctx.runner.run({
      ownership: 'recovery',
      durationMs: FALL_DURATION_MS,
      onTick: (eased) => {
        if (!retargeted) {
          const floor = this._ctx.probe.collisionFloorAt(
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
        this._ctx.center.y = startCenterY + (y - startY);
        if (endQuat) {
          camera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        }
        camera.updateMatrixWorld();
      },
      commitPose: () => {
        camera.position.y = targetY;
        this._ctx.center.y = startCenterY + (targetY - startY);
        if (endQuat) camera.quaternion.copy(endQuat);
        camera.updateMatrixWorld();
      },
      settle: {
        grounded: 'force-true',
        reseedLegit: true
      }
    });
  }

  // --- ActionBar zoom buttons (held-down repeat) ---
  // A center-anchored dolly, deliberately distinct from the wheel swoop, so the
  // toolbar zoom buttons keep their own simple in/out feel.
  zoomActionBar(sign) {
    // Suspend the toolbar zoom while a camera-owning tween
    // (recovery or teleport) is in flight.
    if (this._ctx.isInactive() || this._ctx.runner.ownsCamera()) return;
    const camera = this._ctx.camera;
    const distance = camera.position.distanceTo(this._ctx.center);
    camera.far = Math.min(
      CAMERA_FAR_PLANE_MAX_METRES,
      Math.max(
        CAMERA_FAR_PLANE_MIN_METRES,
        distance * CAMERA_FAR_PLANE_DISTANCE_FACTOR
      )
    );
    camera.updateProjectionMatrix();
    const delta = this._delta.set(0, 0, sign);
    delta.multiplyScalar(
      Math.max(this._ctx.minSpeedFactor, distance) * this._ctx.zoomSpeed
    );
    delta.applyMatrix3(this._normalMatrix.getNormalMatrix(camera.matrix));
    // The toolbar zoom buttons move camera.y but do
    // NOT route through _drainWheel, so the wheel-pass un-ground check misses
    // them. Apply the same net-y-rise check here so a toolbar zoom-out-up
    // un-grounds (else the next W terrain-follows down instead of holding).
    const zoomStartY = camera.position.y;
    camera.position.add(delta);
    this._ctx.grounded.checkUngroundOnRise(zoomStartY);
    // The toolbar zoom buttons move the camera by a non-wheel mechanism →
    // invalidate the wheel memory (delta is non-zero while a button is held), then
    // dispatch.
    this._ctx.funnel.invalidateWheelMemory('action-bar');
    camera.updateMatrixWorld();
    this._ctx.funnel.dispatch();
  }
}
