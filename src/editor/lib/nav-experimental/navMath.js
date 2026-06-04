/* global THREE */

// Phase 2 pure-math helpers for `ExperimentalControls`. Lifted out of the
// class so each piece can be unit-tested without instantiating an
// A-Frame scene. See claude/specs/001-phase-2-plan.md.

import {
  TILT_THRESHOLD_DEFAULT_DEGREES,
  FALLBACK_FORWARD_DIST,
  MIN_TILT_DEGREES,
  MAX_TILT_DEGREES,
  SWOOP_PHASE2_ENTRY_ELEVATION_METRES,
  SWOOP_PHASE2_EXIT_ELEVATION_METRES,
  SWOOP_PHASE2_STEP,
  EYE_MARGIN_METRES,
  BLOCK_SLOPE_MIN_DEGREES,
  BLOCK_HEIGHT_MIN_METRES,
  WASD_FACING_MIN,
  WASD_FACING_HYSTERESIS,
  DISCOVERABILITY_CUE_SHOW_METRES,
  DISCOVERABILITY_CUE_HIDE_METRES
} from './constants.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Camera tilt in degrees below horizontal. 0° = horizontal, +90° =
// straight down, -90° = straight up. Caller passes in the camera so the
// helper stays pure.
export function cameraTiltDegrees(camera) {
  // camera.getWorldDirection returns the camera's -Z direction (its
  // "look" vector). Tilt-down is `-y`-component, so:
  //   sin(tilt) = -fwd.y
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  const sin = THREE.MathUtils.clamp(-fwd.y, -1, 1);
  return Math.asin(sin) * RAD2DEG;
}

// LB-mode dispatch. Cuts on absolute angle from horizontal: looking up
// by any amount = pedestal. Only "looking down by more than the
// threshold" gets truck/dolly. `threshold` defaults to T so the helper
// stays usable bare; callers in the controls pass the live
// `_tiltThreshold`. Boundary convention: exactly-T → pan-pedestal
// (Street side), matching the rotation regime's `tilt > T → Map`.
export function decideLbMode(
  tiltDeg,
  threshold = TILT_THRESHOLD_DEFAULT_DEGREES
) {
  return tiltDeg > threshold ? 'pan-truck' : 'pan-pedestal';
}

// TASK-010 (live-Shift, B6): pure decision for whether an in-progress LB
// drag should switch sub-gesture given the live Shift state. Returns the
// sub-mode to switch *to* ('pan' | 'rotate'), or null for no change.
// Only LB gestures ('pan' | 'rotate') switch; any other latch mode (e.g.
// a wheel gesture, which is never latched here anyway) returns null.
// This is where the H1/H2/H3 symmetry/idempotency correctness lives, so
// it is extracted for unit testing without a DOM or constructed controls.
export function decideDragModeSwitch(currentMode, shiftHeld) {
  if (currentMode !== 'pan' && currentMode !== 'rotate') return null;
  const desired = shiftHeld ? 'rotate' : 'pan';
  return desired === currentMode ? null : desired;
}

// TASK-010 (D5 + far-ground cap): clamp the orbit pivot to a sane radius
// from the camera. **Moves the pivot, never the camera** — moving the
// camera at gesture start would be a visible teleport, whereas moving the
// pivot only changes what we orbit. Let `v = pivot − camPos`, `r = |v|`.
//   r === 0 (degenerate, pivot coincident with camera):
//       camPos + fallbackDir.normalized() × minR
//   r < minR: push the pivot *out* along the camera→pivot ray to minR.
//   r > maxR: pull the pivot *in* along the same ray to maxR.
//   else: pivot unchanged.
// In the clamped cases the returned pivot is a point along the same view
// ray at a clamped depth — no longer exactly the world point the cursor
// grabbed (intentional; see decision log D-R1-1/2). Returns a new
// THREE.Vector3.
export function clampOrbitRadius(camPos, pivot, minR, maxR, fallbackDir) {
  const v = new THREE.Vector3(
    pivot.x - camPos.x,
    pivot.y - camPos.y,
    pivot.z - camPos.z
  );
  const r = v.length();
  if (r === 0) {
    const dir = new THREE.Vector3(
      fallbackDir.x,
      fallbackDir.y,
      fallbackDir.z
    ).normalize();
    return new THREE.Vector3(
      camPos.x + dir.x * minR,
      camPos.y + dir.y * minR,
      camPos.z + dir.z * minR
    );
  }
  if (r < minR) {
    const k = minR / r;
    return new THREE.Vector3(
      camPos.x + v.x * k,
      camPos.y + v.y * k,
      camPos.z + v.z * k
    );
  }
  if (r > maxR) {
    const k = maxR / r;
    return new THREE.Vector3(
      camPos.x + v.x * k,
      camPos.y + v.y * k,
      camPos.z + v.z * k
    );
  }
  return new THREE.Vector3(pivot.x, pivot.y, pivot.z);
}

// TASK-024 (D1/N2/N3): WASD forward-ray step classifier. Pure decision —
// given the collision floor under the camera now and at the destination
// column, plus the first solid-floor forward-ray hit, decide whether the
// horizontal step is blocked, steps up onto a ledge, follows the surface,
// or hovers off a drop. Steepness is read from the FORWARD-ray hit normal
// (the wall the ray actually struck), never a lone destination-column
// normal.
//
// Inputs:
//   floorNow  — { y, normal? } collision floor under the camera now.
//   floorDest — { y, normal? } collision floor at the destination column.
//   forwardHit — { hit, dist?, normalY?, normalH? }: the first solid-floor
//     hit along the horizontal travel ray. `normalY` is the world normal's
//     y-component, `normalH` a THREE.Vector3-like horizontal component (for
//     the facing test). `{ hit: false }` when the forward ray is clear.
//   reach     — forward-ray length this frame (stepThisFrame + radius),
//     used to make the down-step decision reach-invariant (N2-b).
//   targetDir — { x, z } normalized horizontal travel direction (for the
//     facing dot, N3).
//   currentEnclosed — true if the camera's own column is enclosed (D5 /
//     WE-13): never block, always follow (drive out).
//   lastBlocked — previous frame's block state, for a small height
//     hysteresis dead-band (WE-3b). Never holds a block when the forward
//     ray is clear or non-facing.
// Returns 'block' | 'step-up' | 'follow' | 'hover'.
export function classifyWasdStep({
  floorNow,
  floorDest,
  forwardHit,
  reach,
  targetDir,
  currentEnclosed,
  lastBlocked
}) {
  // WE-13 / H2: a camera inside a building must be able to drive out.
  if (currentEnclosed) return 'follow';

  const delta = floorDest.y - floorNow.y;
  const slopeMinRad = BLOCK_SLOPE_MIN_DEGREES * DEG2RAD;

  // Forward-ray facing test (N3): only a wall that FACES travel can block.
  // A grazing/tangential skim has its normal ~perpendicular to travel.
  let facing = false;
  let forwardSteep = false;
  if (forwardHit && forwardHit.hit) {
    const nh = forwardHit.normalH;
    if (nh && targetDir) {
      // dot(travelDir, -wallNormalH). Normalize the horizontal normal.
      const nhLen = Math.hypot(nh.x, nh.z);
      if (nhLen > 1e-6) {
        const dot =
          targetDir.x * (-nh.x / nhLen) + targetDir.z * (-nh.z / nhLen);
        // Facing hysteresis (WE-3b): once blocked, hold the block through
        // minor dot wobble while skimming a façade, to damp block/pass
        // stutter. A clearly non-facing (tangent) hit still passes.
        const facingMin = lastBlocked
          ? WASD_FACING_MIN - WASD_FACING_HYSTERESIS
          : WASD_FACING_MIN;
        facing = dot >= facingMin;
      }
    }
    const ny = THREE.MathUtils.clamp(
      forwardHit.normalY != null ? forwardHit.normalY : 1,
      -1,
      1
    );
    forwardSteep = Math.acos(ny) >= slopeMinRad;
  }

  // Block: a facing, near-vertical solid at eye height ahead (wall / façade
  // / cliff). The forward ray is cast at the camera's eye height, so it only
  // strikes obstructions reaching ~eye level — that geometry IS the height
  // filter (a kerb below eye height is missed → handled as step-up below).
  // There is deliberately NO floor-delta gate: a wall standing on FLAT
  // ground has delta≈0 (the ground ahead is level with the ground under the
  // camera) yet must still block. The earlier `delta >= BLOCK_HEIGHT_MIN`
  // gate measured the wrong thing (the ground under the destination, not the
  // obstruction's height) and let the camera walk straight through buildings.
  if (forwardSteep && facing) {
    return 'block';
  }

  // No block — a TOTAL split over the remaining cases (N2-a / N2-b).
  if (delta > 0) {
    // Every non-blocked up-step mounts the step/ledge (step-up == follow in
    // y outcome). Catch-all; cannot fall through (N2-a).
    return 'step-up';
  }
  if (delta < 0) {
    // Down-step: hover iff the descent is BOTH steep (angle, reach-invariant
    // — N2-b) AND a real drop. Else follow (gentle ramps follow at any
    // fly-speed; WE-4 vs WE-5).
    const descentAngle = Math.atan2(-delta, Math.max(reach, 1e-6));
    if (descentAngle >= slopeMinRad && -delta >= BLOCK_HEIGHT_MIN_METRES) {
      return 'hover';
    }
    return 'follow';
  }
  // Flat.
  return 'follow';
}

// TASK-024 (live-test fix): the camera y for a 'follow'/'step-up' WASD step.
// W must NEVER pin the camera to eye-height — that discarded a deliberate
// elevation (LB+up to 2 m, then W snapped back to 1.5 m) and made a hard
// "walking band" cliff. Instead PRESERVE the camera's current height above
// the ground by tracking the floor's change (so flat ground at any altitude
// keeps y; a slope carries you up/down at the same clearance), while never
// letting the camera sit closer than `eyeMargin` to the floor ahead (a
// push-up-only clamp — prevention / step-up onto a ledge). Pure.
export function wasdFollowY(camY, floorNowY, floorDestY, eyeMargin) {
  const tracked = camY + (floorDestY - floorNowY); // preserve current AGL
  return Math.max(tracked, floorDestY + eyeMargin); // but keep min clearance
}

// TASK-024a (D3/D4): pure not-grounded vertical rule for a WASD
// follow/step-up step. Returns the new camera y.
//   grounded     -> collision-follow (option-1 math); the flag is a no-op (D2)
//   option 1     -> collision-follow (terrain/rooftop hug)
//   option 2     -> max(travelHeightDest + H, collisionFloorDest + eye)
//   option 3     -> max(H,                    collisionFloorDest + eye)
// The single `max(target(H), collisionFloor + eye)` IS the obstacle-lift +
// automatic drop-back (D4); no path history. `floorNowY` is unused by the
// held-height branches (collision-follow needs it) — kept so the grounded /
// option-1 branch is exact. `H == null` falls back to collision-follow so the
// helper never returns NaN (defensive; the caller lazily captures H first).
// Pure — never touches `grounded` (terrain rising must not ground, D1/H3).
export function wasdVerticalY({
  option,
  grounded,
  camY,
  floorNowY,
  collisionFloorDestY,
  travelHeightDestY,
  H,
  eyeMargin
}) {
  if (grounded || option === 1 || H == null) {
    return wasdFollowY(camY, floorNowY, collisionFloorDestY, eyeMargin);
  }
  const floorClamp = collisionFloorDestY + eyeMargin;
  const target = option === 2 ? travelHeightDestY + H : H;
  return Math.max(target, floorClamp); // SPEC D4 single clamp
}

// TASK-024a (D1): pure initial-grounded predicate from a load/teleport pose.
// Grounded iff the collision-floor probe HIT (not a cache miss) AND the
// camera sits within eye-margin (inclusive, M3) of that floor. A cache-miss
// (scene graph not yet populated) reads not-grounded — a safe high/option-3
// reading that self-heals on the first deliberate descent.
export function groundedAtLoad({ camY, floorY, source, eyeMargin }) {
  if (source === 'cache') return false;
  return camY - floorY <= eyeMargin + 1e-6;
}

// TASK-024 (3d): pure precedence decision for the Space fall/pop key.
// States overlap (enclosed + looking down), so order is load-bearing:
//   1. enclosed             -> 'pop'   (wins regardless of tilt)
//   2. elevated + down      -> 'swoop'
//   3. elevated + ~horiz    -> 'fall'
//   no surface below        -> 'noop'
// `floorY` is the collision floor below (null/undefined = probe miss).
// `aboveFloor` lets the caller decide "elevated" (camY - floorY > margin).
export function classifyFallAction({ enclosed, camY, floorY, tiltDeg }) {
  if (enclosed) return 'pop';
  if (floorY == null || !isFinite(floorY)) return 'noop';
  const agl = camY - floorY;
  if (agl <= EYE_MARGIN_METRES) return 'noop'; // already at the surface
  if (tiltDeg > TILT_THRESHOLD_DEFAULT_DEGREES) return 'swoop';
  return 'fall';
}

// TASK-024 (3a / H-B / WE-8a): legit-pose predicate. A pose is legit iff
// BOTH (not enclosed) AND (camera.y >= collision floor under it + eye
// margin). Neither alone (enclosure-only accepts grazing under an overhang;
// floor-only accepts tucked under an arch). Pure.
export function isLegitPose({ enclosed, camY, floorY }) {
  if (enclosed) return false;
  if (floorY == null || !isFinite(floorY)) return true; // no floor = open sky
  return camY >= floorY + EYE_MARGIN_METRES;
}

// TASK-024 (D7): discoverability-cue show/hide hysteresis. `prevShown` is
// the previous shown state; returns the next shown state. Enclosure forces
// show; otherwise show above SHOW metres, hide below HIDE metres, and hold
// between (no strobe). Pure.
export function cueState(prevShown, aglAboveCollisionFloor, enclosed) {
  if (enclosed) return true;
  if (aglAboveCollisionFloor > DISCOVERABILITY_CUE_SHOW_METRES) return true;
  if (aglAboveCollisionFloor < DISCOVERABILITY_CUE_HIDE_METRES) return false;
  return prevShown;
}

// Synthetic wheel-zoom anchor for the low-tilt branch (per
// `claude/specs/001-tilt-conditional-zoom.md`): a point
// `FALLBACK_FORWARD_DIST` metres along the camera's view direction.
// Reused as the "hit point" in the existing orbit-step math in
// `_applyWheelTick`, giving a 3m-per-tick forward dolly
// (ZOOM_PER_WHEEL_TICK × FALLBACK_FORWARD_DIST) — no cursor anchoring.
// Pure.
export function computeLowTiltWheelHit(camera) {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  return new THREE.Vector3()
    .copy(camera.position)
    .addScaledVector(fwd, FALLBACK_FORWARD_DIST);
}

// Phase 3 swoop helpers. See claude/specs/001-phase-3-plan.md.

// Decide which of the 3 swoop phases applies, from camera elevation
// **above ground (AGL)** = camera.y − groundY (TASK-013). Callers pass
// AGL; the function is otherwise unchanged (the 20 / 1.5 thresholds are
// now AGL thresholds, not absolute-y).
//   AGL > 20m         -> 'phase1'  (cursor-anchored dolly, tilt-conditional)
//   1.5m < AGL ≤ 20m  -> 'phase2'  (pedestal + tilt-toward-horizontal)
//   AGL ≤ 1.5m        -> 'phase3'  (FOV-only zoom)
// Pure.
export function decideSwoopPhase(yAgl) {
  if (yAgl > SWOOP_PHASE2_ENTRY_ELEVATION_METRES) return 'phase1';
  if (yAgl > SWOOP_PHASE2_EXIT_ELEVATION_METRES) return 'phase2';
  return 'phase3';
}

// Phase 2 tilt lerp: θ(yAgl) = θ_stored × (yAgl - 1.5) / 18.5.
// Linear in AGL from θ_stored at AGL=20 to 0° at AGL=1.5. Both ends
// inclusive. Outside the Phase 2 band the helper clamps: AGL ≥ 20 →
// θ_stored; AGL ≤ 1.5 → 0°. Input is AGL (TASK-013). Pure.
export function phase2TargetTilt(yAgl, storedTiltDeg) {
  const yHi = SWOOP_PHASE2_ENTRY_ELEVATION_METRES;
  const yLo = SWOOP_PHASE2_EXIT_ELEVATION_METRES;
  if (yAgl >= yHi) return storedTiltDeg;
  if (yAgl <= yLo) return 0;
  return (storedTiltDeg * (yAgl - yLo)) / (yHi - yLo);
}

// Phase 2 elevation step. Input/output are AGL (TASK-013).
//   sign < 0 (zoom-in):  yAgl_next = yAgl - α × (yAgl - 1.5)  -- exponential
//                                                       approach to 1.5m AGL
//                                                       floor.
//   sign > 0 (zoom-out): yAgl_next = 1.5 + (yAgl - 1.5) / (1 - α)  -- exact
//                                                                multiplicative
//                                                                inverse.
// Per H2 of `claude/reports/007-phase-3-plan-review.md`: the zoom-out
// formula has `(yAgl - 1.5)` in the numerator, so for yAgl < 1.5 it
// produces yAgl_next < yAgl (further down — wrong direction). Caller must
// clamp yAgl up to 1.5 *before* invoking on zoom-out if camera is below
// the floor (e.g. saved-scene-at-street-level case). Pure.
export function phase2NextElevation(yAgl, sign, alpha = SWOOP_PHASE2_STEP) {
  const yLo = SWOOP_PHASE2_EXIT_ELEVATION_METRES;
  if (sign < 0) {
    return yAgl - alpha * (yAgl - yLo);
  }
  return yLo + (yAgl - yLo) / (1 - alpha);
}

// Compute one Shift+LB rotation step. Pure: takes camera position +
// view direction + rotation centre + per-event deltas, returns new
// camera position + lookAt target. Caller writes back to the camera.
//
// **Rigid orbit about the latched centre** (TASK-010). The yaw + pitch
// deltas are composed into a *single* rotation `R`, which is applied to
// **both** the camera's position-offset-from-centre **and** its view
// direction. Because the camera basis and the camera→centre vector
// rotate by the same `R`, the centre's position in the camera's frame
// is invariant — so the latched point stays pinned on screen (under the
// cursor) at *any* tilt.
//
// This replaces the earlier "museum diorama" math, which applied the
// same spherical (dTheta, dPhi) increments to the position-offset and
// the view-direction *independently*. That is only a single rotation
// when the two vectors share a meridian (camera looking straight down
// the offset, i.e. top-down); at any other tilt the pitch component
// rotated each vector about a different horizontal axis and the pivot
// drifted across the screen (reports/010-testing.md #1).
//
//   • Yaw  — rotation about world up (0,1,0) by `dTheta = -dxPx*speed`
//            (matches the prior azimuth sign).
//   • Pitch— rotation about the camera's horizontal right axis
//            `normalize(viewDir × up)` so it is a true shared rotation,
//            not a per-vector spherical pitch. Drag-down (dyPx > 0)
//            tilts further down, preserving the prior feel.
//
// Inputs:
//   camPos   — current camera world position (THREE.Vector3-like).
//   viewDir  — current camera view direction, unit (THREE.Vector3-like).
//   centre   — latched rotation centre (THREE.Vector3-like).
//   dxPx, dyPx — per-event mouse pixel deltas.
//   speed    — radians per pixel (typically `controls.rotationSpeed`).
//
// Output:
//   { pos, lookTarget }, both THREE.Vector3. `pos` equals `camPos` in
//   the rotate-in-place case (centre coincident with camera → zero
//   offset → unrotated).
//
// Tilt clamp: the pitch is reduced so the resulting view tilt stays in
// [MIN_TILT_DEGREES, MAX_TILT_DEGREES]. The same clamped pitch drives
// both position and view, so they stay consistent.
//
// TASK-024 (D8/C3): optional `floorY` adds a reversible underground guard
// for the Map-orbit regime. The constraint is on the RESULTING camera
// height (`pos.y >= floorY + EYE_MARGIN_METRES`), not on view-tilt —
// `shiftRotateStep`'s pivot sits under the cursor (not screen-centre), so
// view-tilt and the position-elevation angle are decoupled and the clean
// asin→tilt substitution is only exact when the camera looks along the
// offset. We therefore clamp on `pos.y` by numerically tightening the
// down-tilt input bound (capping the *input* tilt, so over-drag past the
// floor never accumulates → reversing the drag retraces exactly). The
// street regime (rotate-in-place) passes no `floorY`.
export function shiftRotateStep({
  camPos,
  viewDir,
  centre,
  dxPx,
  dyPx,
  speed,
  floorY
}) {
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  const view = new THREE.Vector3(viewDir.x, viewDir.y, viewDir.z).normalize();

  // (1) Yaw about world up.
  const dTheta = -dxPx * speed;

  // (2) Pitch about the camera's horizontal right axis. `view × up` is
  //     horizontal and perpendicular to the view azimuth, so a rotation
  //     about it by β changes the view tilt by exactly −β regardless of
  //     the current tilt. Near-vertical view (|right| → 0) only at the
  //     ±89° clamp; guard against the degenerate normalize.
  const right = new THREE.Vector3().crossVectors(view, WORLD_UP);
  const rightLen = right.length();

  const curTilt = Math.asin(THREE.MathUtils.clamp(-view.y, -1, 1));
  const MIN_TILT = MIN_TILT_DEGREES * DEG2RAD;
  const MAX_TILT = MAX_TILT_DEGREES * DEG2RAD;
  const wantTilt = curTilt + dyPx * speed; // drag-down (+dyPx) → tilt down
  let clampedTilt = THREE.MathUtils.clamp(wantTilt, MIN_TILT, MAX_TILT);

  // Build the rotated pose for a candidate absolute tilt value. Returns
  // { pos, lookTarget } applying the SAME single rotation R to the offset
  // and the view dir.
  const evalAtTilt = (tiltValue) => {
    const dTilt = tiltValue - curTilt;
    const R = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, dTheta);
    if (rightLen > 1e-6 && dTilt !== 0) {
      const r = right.clone().multiplyScalar(1 / rightLen);
      const qPitch = new THREE.Quaternion().setFromAxisAngle(r, -dTilt);
      R.multiply(qPitch);
    }
    const offset = new THREE.Vector3(
      camPos.x - centre.x,
      camPos.y - centre.y,
      camPos.z - centre.z
    ).applyQuaternion(R);
    const pos = new THREE.Vector3(
      centre.x + offset.x,
      centre.y + offset.y,
      centre.z + offset.z
    );
    const newView = view.clone().applyQuaternion(R);
    const lookTarget = new THREE.Vector3(
      pos.x + newView.x,
      pos.y + newView.y,
      pos.z + newView.z
    );
    return { pos, lookTarget };
  };

  // TASK-024 (D8): numeric down-tilt floor bound. Tilting further down
  // (larger tilt) on an above-pivot orbit lowers the camera. If the wanted
  // tilt would dip `pos.y` below `floorY + EYE_MARGIN`, bisect between the
  // current tilt (known clear — the camera is there now, presumed legit)
  // and the wanted tilt to find the lowest input tilt that keeps the
  // resulting height at or above the bound.
  if (floorY != null && isFinite(floorY) && clampedTilt > curTilt) {
    const bound = floorY + EYE_MARGIN_METRES;
    const candidate = evalAtTilt(clampedTilt);
    if (candidate.pos.y < bound) {
      // Tilting down breaches the floor. Bisect [curTilt, clampedTilt].
      let lo = curTilt; // assumed to clear the bound (current pose)
      let hi = clampedTilt; // breaches the bound
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (evalAtTilt(mid).pos.y >= bound) lo = mid;
        else hi = mid;
      }
      clampedTilt = lo;
    }
  }

  return evalAtTilt(clampedTilt);
}
