/* global THREE */

import { isSolidFloorHit, worldHitNormal } from './cursorAnchor.js';
import {
  WASD_SPEED_HEIGHT_FACTOR,
  WASD_MIN_SPEED,
  WASD_MAX_SPEED,
  WASD_RAMP_UP_MS,
  WASD_VERTICAL_LIFT_RATE_MPS,
  EYE_MARGIN_METRES,
  WASD_CAMERA_RADIUS_METRES
} from './constants.js';
import { classifyWasdStep, wasdVerticalY } from './navMath.js';

// The held-key WASD flight controller. Owns the held-key set, the ramped flight
// velocity, and the per-tick move: yaw-projected horizontal motion with the
// forward-ray step classifier (block / step-up / follow / hover) and the
// grounded-vs-flying vertical policy. The orchestrator's key routers feed the
// held-key set via the accessors below; `_onTick` drives the move via `drain`.
//
// Reads the live camera/scene/services through the shared controls context and
// carries its own scratch + raycaster. An advancing step commits through the
// write funnel (a non-wheel move: invalidate zoom-undo, then dispatch).
export const MOVEMENT_KEY_CODES = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight'
]);

export class WasdFlight {
  constructor(ctx) {
    this._ctx = ctx;
    // WASD held-key set; drained per tick.
    this._heldKeys = new Set();
    // Current WASD velocity in the world horizontal plane (m/s). Ramps toward
    // the target while keys are held; snaps to zero on release.
    this._wasdVelocity = new THREE.Vector3();
    // WASD block hysteresis carry.
    this._lastWasdBlocked = false;

    // Own scratch + raycaster — never aliases another gesture's.
    this._tmpV3a = new THREE.Vector3();
    this._tmpV3b = new THREE.Vector3();
    this._tmpV3c = new THREE.Vector3();
    this._raycaster = new THREE.Raycaster();
  }

  // Held-key accessors used by the orchestrator's keydown/keyup/blur routers
  // (input plumbing stays on O; the held-key STATE lives here).
  clearHeldKeys() {
    this._heldKeys.clear();
  }
  noHeldKeys() {
    return this._heldKeys.size === 0;
  }
  addHeldKey(k) {
    this._heldKeys.add(k);
  }
  hasHeldKey(k) {
    return this._heldKeys.has(k);
  }
  deleteHeldKey(k) {
    this._heldKeys.delete(k);
  }

  // Is the camera moving under WASD? (Feeds the situation-sensor idle gate.)
  isMoving() {
    return this._wasdVelocity.lengthSq() > 0;
  }

  drain(deltaMs) {
    const camera = this._ctx.camera;
    // A recovery OR teleport tween owns the
    // camera — held keys must not fight it. Snap velocity to zero and suspend.
    if (this._ctx.runner.ownsCamera()) {
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

    // WASD fly-speed scales by TRAVEL HEIGHT (height above the
    // land/ground beneath buildings), NOT the collision floor — so speed
    // doesn't crawl over a building roof.
    const groundY = this._ctx.probe.travelHeightFloorYBelow();
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

    // Forward-ray step classifier. Decide block / step-up /
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
    this._ctx.center.x += move.x;
    this._ctx.center.z += move.z;
    // An advancing WASD step is a non-wheel camera move → clear the
    // zoom-undo memory. The `block` outcome early-returns above (zero-delta —
    // no clear); a hover/step-up that changes only y still moved → clear.
    this._ctx.funnel.invalidateWheelMemory('wasd');

    if (outcome.kind === 'step-up' || outcome.kind === 'follow') {
      // Grounded collision-follow (preserve AGL,
      // push-up clamp — walking hugs the surface); not-grounded eases toward
      // the absolute target `max(H, collisionFloorDest + eye)`,
      // rate-limited per tick so the lift/settle composes with continuous WASD.
      // Lazily seed H if we are flying but never captured it (scene loaded
      // not-grounded). The helper only READS H. `distMetres` (== deltaMs/1000)
      // is the per-tick dt in seconds; reuse it for the rate limit.
      if (!this._ctx.grounded.grounded && this._ctx.grounded.H == null) {
        this._ctx.grounded.captureH();
      }
      const newY = wasdVerticalY({
        grounded: this._ctx.grounded.grounded,
        camY: camera.position.y,
        floorNowY: outcome.floorNowY,
        collisionFloorDestY: outcome.floorDestY,
        destFloorHit: outcome.destFloorHit,
        H: this._ctx.grounded.H,
        eyeMargin: EYE_MARGIN_METRES,
        dtSeconds: distMetres,
        rateMps: WASD_VERTICAL_LIFT_RATE_MPS
      });
      const dy = newY - camera.position.y;
      camera.position.y = newY;
      this._ctx.center.y += dy;
    } else if (outcome.kind === 'hover') {
      // Walking off a sharp drop floats the camera
      // off the surface — the ground is now far below; un-ground and capture H
      // at the roof height so the next W holds altitude over the street rather
      // than terrain-following down. Only the grounded→not-grounded transition
      // matters. y itself is held (no plunge); centre y unchanged.
      if (this._ctx.grounded.grounded) {
        this._ctx.grounded.grounded = false;
        this._ctx.grounded.captureH();
      }
    }

    camera.updateMatrixWorld();
    this._ctx.funnel.dispatch();
  }

  // Run the WASD forward-ray + destination-floor probes and
  // classify the step. Returns { kind, floorDestY }. `kind` is
  // 'block' | 'step-up' | 'follow' | 'hover'. Gated to held-WASD-with-input
  // (the caller only invokes it inside the hasInput branch), so idle frames
  // cost nothing.
  _classifyWasdMove(dirX, dirZ, stepThisFrame) {
    const camera = this._ctx.camera;
    const reach = stepThisFrame + WASD_CAMERA_RADIUS_METRES;

    // Floor under the camera now (collision floor).
    const floorNow = this._ctx.probe.collisionFloorAt(
      camera.position.x,
      camera.position.z
    );
    // Destination column floor.
    const destX = camera.position.x + dirX * reach;
    const destZ = camera.position.z + dirZ * reach;
    const floorDest = this._ctx.probe.collisionFloorAt(destX, destZ);

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

  // Cast a forward (horizontal) ray of length `reach` along
  // (dirX, 0, dirZ) and return the first accepted solid-floor hit as
  // { hit, dist, normalY, normalH } — or { hit: false } when clear.
  _forwardRayHit(dirX, dirZ, reach) {
    const sceneEl = this._ctx.sceneEl;
    if (!sceneEl || !sceneEl.object3D) return { hit: false };
    this._tmpV3a.set(dirX, 0, dirZ);
    if (this._tmpV3a.lengthSq() < 1e-9) return { hit: false };
    this._tmpV3a.normalize();
    this._raycaster.set(this._ctx.camera.position, this._tmpV3a);
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
}
