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
  SWOOP_PHASE2_STEP
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

// TASK-010 (D4): underground guard for the Map-mode orbit. Keeps an
// orbiting camera at or above `floorY` **without changing the orbit
// radius and without changing the view orientation**. Let
// `R = |pos − centre|` (orbit radius), `dy = floorY − centre.y`.
//   pos.y >= floorY: unchanged.
//   else: re-project `pos` onto the orbit sphere (centre `centre`,
//     radius `R`) at the floor height, keeping the same azimuth:
//       a   = atan2(pos.z − centre.z, pos.x − centre.x)
//       rho = sqrt(R² − dy²)              (the floor-circle radius)
//       newPos = (centre.x + rho·cos a, floorY, centre.z + rho·sin a)
//     and shift lookTarget by the same delta so the view direction
//     (lookTarget − pos) is bit-identical → orientation unchanged.
// Re-projecting (rather than flattening pos.y) preserves the radius, so
// the per-frame `rotate → clamp` pipeline neither shrinks the orbit nor
// spirals (shiftRotateStep re-derives the offset from camera.position
// each move and preserves |offset|; this preserves it too). Idempotent:
// applied twice with no rotation between, the second call sees
// pos.y === floorY (not < floorY) and is a no-op.
//   Camera exactly over the pivot (pos.x===centre.x, pos.z===centre.z):
//     atan2(0,0) === 0 in JS, so the re-projection lands at azimuth 0 —
//     arbitrary but valid; only reachable in the near-degenerate
//     straight-down-tiny-radius case.
//   Degenerate (R < |dy|, sphere never reaches floorY — only possible
//     for a high pivot with a tiny radius, which D5's minR makes
//     vanishingly rare): fall back to a plain pos.y = floorY clamp with
//     the same lookTarget delta. Accept the small radius change.
// Returns { pos, lookTarget }, both new THREE.Vector3.
export function applyGroundFloor(pos, lookTarget, centre, floorY) {
  if (pos.y >= floorY) {
    return {
      pos: new THREE.Vector3(pos.x, pos.y, pos.z),
      lookTarget: new THREE.Vector3(lookTarget.x, lookTarget.y, lookTarget.z)
    };
  }
  const R = Math.hypot(pos.x - centre.x, pos.y - centre.y, pos.z - centre.z);
  const dy = floorY - centre.y;
  let newPos;
  if (R < Math.abs(dy)) {
    // Degenerate: sphere never reaches the floor. Plain y-clamp.
    newPos = new THREE.Vector3(pos.x, floorY, pos.z);
  } else {
    const a = Math.atan2(pos.z - centre.z, pos.x - centre.x);
    const rho = Math.sqrt(R * R - dy * dy);
    newPos = new THREE.Vector3(
      centre.x + rho * Math.cos(a),
      floorY,
      centre.z + rho * Math.sin(a)
    );
  }
  const delta = new THREE.Vector3(
    newPos.x - pos.x,
    newPos.y - pos.y,
    newPos.z - pos.z
  );
  const newLookTarget = new THREE.Vector3(
    lookTarget.x + delta.x,
    lookTarget.y + delta.y,
    lookTarget.z + delta.z
  );
  return { pos: newPos, lookTarget: newLookTarget };
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
export function shiftRotateStep({
  camPos,
  viewDir,
  centre,
  dxPx,
  dyPx,
  speed
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
  const clampedTilt = THREE.MathUtils.clamp(wantTilt, MIN_TILT, MAX_TILT);
  const dTilt = clampedTilt - curTilt;

  // (3) Compose the single rotation R = yaw(worldUp) ∘ pitch(right).
  const R = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, dTheta);
  if (rightLen > 1e-6 && dTilt !== 0) {
    right.multiplyScalar(1 / rightLen);
    // Rotation about `right` by β changes tilt by −β, so β = −dTilt.
    const qPitch = new THREE.Quaternion().setFromAxisAngle(right, -dTilt);
    R.multiply(qPitch);
  }

  // (4) Apply the *same* R to the position offset and the view dir.
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
}
