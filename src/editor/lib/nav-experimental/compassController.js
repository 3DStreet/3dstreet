/* global THREE */

import {
  NORTH_AXIS,
  NORTH_BEARING_FROM_MINUS_Z,
  COMPASS_TOPDOWN_TOLERANCE_DEGREES,
  COMPASS_NORTH_TOLERANCE_DEGREES,
  COMPASS_ROTATE_STEP_DEGREES,
  PLAN_VIEW_DURATION_MS
} from './constants.js';
import { cameraTiltDegrees, viewRayGroundPoint } from './navMath.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Normalize an angle in degrees to (-180, 180].
function normalizeDeg(deg) {
  let d = deg % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

// On-screen angle (degrees, 0 = up/12-o'clock, positive = clockwise) at which to
// draw the north needle, derived from camera YAW ALONE (no 3D projection, so it
// never jitters near top-down). Shared by the compass React widget (needle
// render) and the north-up pose test, so the visual and the decision can never
// disagree. Re-exported from ExperimentalControls.js for the Compass widget's
// frozen import path. Near top-down the horizontal forward vanishes, so fall
// back to the camera up-vector's horizontal projection (same heading); last
// resort face -Z.
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

// Arrow sign -> yaw delta sign. Right arrow (sign=+1, CW arc) rotates the VIEW
// clockwise (+90 yaw about world +Y); left (sign=-1) counter-clockwise.
function signToYaw(sign) {
  return sign > 0 ? 1 : -1;
}

// The compass + plan-view controller. Owns the plan-view tween (top-down N-up
// framing) and the compass body-click / rotate-arrow actions, plus the single
// shared yaw-about-pivot tween primitive and the at-most-one queued-action drain.
// These motions keep their OWN TickAnimator subscription + ownership flags
// (_planViewActive / _compassAnimating feed the orchestrator's _isInactive) — they
// do NOT enter the committed-motion runner. Camera writes commit through the write
// funnel. Reads the live camera / scene-bounds / services through the context.
export class CompassController {
  constructor(ctx) {
    this._ctx = ctx;
    // Plan-view tween in flight — input ignored while true.
    this._planViewActive = false;
    this._planViewHandle = null;
    // Compass tween handle + at-most-one queued action ({kind, sign?}).
    // _compassAnimating (a derived getter) reads _compassHandle.isActive(), so any
    // external animate()/cancel() self-heals the input gate.
    this._compassHandle = null;
    this._compassPending = null;
    // Screen-centre view-ray scratch.
    this._tmpV3c = new THREE.Vector3();
  }

  // Plan-view active? (feeds the orchestrator's _isInactive gate).
  get planViewActive() {
    return this._planViewActive;
  }

  // Drop any in-flight compass tween/queue (camera-swap / dispose cleanup; the
  // derived gate already self-heals — this just clears a stale pending slot).
  cancelPending() {
    this._compassHandle = null;
    this._compassPending = null;
  }

  // Phase 1 entry point used by viewport.js when the user triggers Plan
  // View (App menu / toolbar / keyboard) in flag-on mode. The camera was
  // briefly swapped to ortho by cameras.js; viewport.js reverts it back to
  // the perspective camera before calling this.
  handlePlanViewRequest(opts = {}) {
    if (this._ctx.disabledByOrtho) return;
    const camera = this._ctx.camera;
    if (!camera || camera.type !== 'PerspectiveCamera') return;

    // When an EXTERNAL plan view (key-4 / menu) pre-empts a live
    // compass tween, drop the compass queue so it can't resurrect. The
    // derived `_compassAnimating` already goes false when this method's
    // `_tick.animate()` cancels the compass tween below; this just clears
    // the pending slot. Existing callers pass no opts ⇒ no-op unless a
    // compass tween is live.
    if (this.isCompassAnimating() && !opts.fromCompass) {
      this._compassHandle = null;
      this._compassPending = null;
    }

    const startPos = camera.position.clone();
    const startQuat = camera.quaternion.clone();

    // End pose target XZ: scene-bounds centre when bounded, else stay
    // over current XZ. Either way, lift to a height that frames the
    // whole scene (or a sensible default for unbounded scenes).
    const bounds = this._ctx.bounds.getBounds();
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

    // Recenter "this._ctx.center" to be on the ground beneath the end pose.
    this._ctx.center.set(endPos.x, 0, endPos.z);

    // A recovery/teleport tween may own the camera (e.g. Plan
    // View pre-empting a gesture-end recovery). Cancel it and clear its flags
    // first so `_tick.animate` below doesn't drop the prior tween's onDone and
    // strand `_recoveryActive`/`_teleportActive` true.
    this._ctx.runner.cancel();

    this._planViewActive = true;
    // 'plan-view' is a forward-hook payload — no Phase 2 consumer reads
    // it (`useNavMode` filters to pan-truck/pan-pedestal only). Phase 3
    // / future indicator work may key off it; left dispatched so the
    // tween bracket is symmetric with the closing `null` emission.
    this._ctx.emitModeChange('plan-view');
    this._planViewHandle = this._ctx.tick.animate({
      durationMs: PLAN_VIEW_DURATION_MS,
      onTick: (eased) => {
        camera.position.lerpVectors(startPos, endPos, eased);
        camera.quaternion.slerpQuaternions(startQuat, endQuat, eased);
        camera.updateMatrixWorld();
        // Plan View moves the camera by a non-wheel mechanism →
        // clear the zoom-undo memory. In onTick (idempotent) so it's gone the
        // instant the tween starts moving — a tween pre-empted at frame 0
        // never ticks, correctly leaving the memory intact.
        this._ctx.funnel.invalidateWheelMemory('compass');
        this._ctx.funnel.dispatch();
      },
      onDone: () => {
        camera.position.copy(endPos);
        camera.quaternion.copy(endQuat);
        camera.updateMatrixWorld();
        this._ctx.funnel.invalidateWheelMemory('compass'); // (idempotent; closes the onTick window)
        this._planViewActive = false;
        this._planViewHandle = null;
        // Reseed the legit-pose snapshot from the committed
        // plan-view pose so recovery can never ease back to a pre-teleport
        // pose.
        this._ctx.sensor.reseedLegitPose();
        this._ctx.emitModeChange(null);
        // Plan View ends at near-90° tilt — guaranteed truck-mode. The terminal
        // `funnel.dispatch()` resolves the letterbox at exact T, so users who
        // never touch Shift+LB still see the correct toolbar state.
        this._ctx.funnel.dispatch();
        // When this plan view was the compass's stage 1, null the
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

  // Derived "compass tween in flight" state. Reads TickAnimator's real
  // current-tween state, so ANY external animate()/cancel() flips it to
  // false automatically — the input gate can never be orphaned by a missed
  // teardown.
  isCompassAnimating() {
    return this._compassHandle != null && this._compassHandle.isActive();
  }

  // Body click — pose dispatcher. Top-down test FIRST, then north test,
  // then strict no-op. Decided from the LIVE camera
  // pose at click time, so it stays correct if the user moved between
  // clicks.
  handleCompassBodyClick() {
    if (this._ctx.disabledByOrtho) return;
    const camera = this._ctx.camera;
    if (!camera || camera.type !== 'PerspectiveCamera') return;
    if (this.isCompassAnimating()) {
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
  // CW; sign=-1 (left) = 90° CCW.
  handleCompassRotate(sign) {
    if (this._ctx.disabledByOrtho) return;
    const camera = this._ctx.camera;
    if (!camera || camera.type !== 'PerspectiveCamera') return;
    if (this.isCompassAnimating()) {
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
    // (This replaces a call to a never-implemented
    // _screenCenterHit() that threw on every non-top-down click.)
    // Street-level mode off: always the Map turn (orbit the screen-centre
    // ground point). At/above the horizon that point is null and the code
    // below already falls through to spin-in-place — the one pose where
    // there is no ground feature to pivot.
    const isMap =
      !this._ctx.streetLevelEnabled ||
      cameraTiltDegrees(camera) > this._ctx.tiltThreshold;
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
    const camera = this._ctx.camera;
    const endPos = camera.position.clone(); // same XZ + altitude
    const scratch = new THREE.PerspectiveCamera();
    scratch.position.copy(endPos);
    scratch.up.set(NORTH_AXIS.x, 0, NORTH_AXIS.z); // = (1,0,0) for +X north
    scratch.lookAt(endPos.x, 0, endPos.z); // straight down (-Y)
    const endQuat = scratch.quaternion.clone();
    // pivot=null ⇒ position fixed; orientation slerps start→end the short
    // way by construction. The onDone sets this._ctx.center under the camera.
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
    const camera = this._ctx.camera;
    // A compass action can pre-empt a recovery/teleport tween
    // (those are not in `_compassAnimating`). Cancel + clear flags first so
    // `_tick.animate` doesn't strand `_recoveryActive`/`_teleportActive`.
    this._ctx.runner.cancel();
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
      // Compass rotate / align / body-click top-down all route here
      // — a non-wheel camera move. Clear the zoom-undo memory.
      this._ctx.funnel.invalidateWheelMemory('compass');
      this._ctx.funnel.dispatch();
      // this._ctx.center: the orbit pivot, or the ground point under the camera
      // for a spin/align in place. Downstream wheel-zoom references it, so
      // it must be under the camera, not a stale pivot.
      if (orbiting) {
        this._ctx.center.copy(pivot);
      } else {
        this._ctx.center.set(camera.position.x, 0, camera.position.z);
      }
      this._compassHandle = null;
      this._drainCompassPending();
    };

    return this._ctx.tick.animate({
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
        // Clear the instant the tween starts moving (idempotent).
        this._ctx.funnel.invalidateWheelMemory('compass');
        this._ctx.funnel.dispatch();
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
}
