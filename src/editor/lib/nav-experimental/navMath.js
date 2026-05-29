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
// Spherical phi is angle from +Y. Elevation = 90° - phi.
//   MIN_TILT_DEGREES (-89°, looking up)  -> phi = 179°  (MAX_SPHERICAL_PHI)
//   MAX_TILT_DEGREES (+89°, looking down) -> phi =   1°  (MIN_SPHERICAL_PHI)
const MAX_SPHERICAL_PHI = (90 - MIN_TILT_DEGREES) * DEG2RAD;
const MIN_SPHERICAL_PHI = (90 - MAX_TILT_DEGREES) * DEG2RAD;

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

// Decide which of the 3 swoop phases applies, from camera elevation.
//   y > 10m         -> 'phase1'  (cursor-anchored dolly, tilt-conditional)
//   1.5m < y ≤ 10m  -> 'phase2'  (pedestal + tilt-toward-horizontal)
//   y ≤ 1.5m        -> 'phase3'  (FOV-only zoom)
// Pure.
export function decideSwoopPhase(y) {
  if (y > SWOOP_PHASE2_ENTRY_ELEVATION_METRES) return 'phase1';
  if (y > SWOOP_PHASE2_EXIT_ELEVATION_METRES) return 'phase2';
  return 'phase3';
}

// Phase 2 tilt lerp: θ(y) = θ_stored × (y - 1.5) / 8.5.
// Linear in y from θ_stored at y=10 to 0° at y=1.5. Both ends inclusive.
// Outside the Phase 2 band the helper clamps: y ≥ 10 → θ_stored;
// y ≤ 1.5 → 0°. Pure.
export function phase2TargetTilt(y, storedTiltDeg) {
  const yHi = SWOOP_PHASE2_ENTRY_ELEVATION_METRES;
  const yLo = SWOOP_PHASE2_EXIT_ELEVATION_METRES;
  if (y >= yHi) return storedTiltDeg;
  if (y <= yLo) return 0;
  return (storedTiltDeg * (y - yLo)) / (yHi - yLo);
}

// Phase 2 elevation step.
//   sign < 0 (zoom-in):  y_next = y - α × (y - 1.5)  -- exponential approach
//                                                       to 1.5m floor.
//   sign > 0 (zoom-out): y_next = 1.5 + (y - 1.5) / (1 - α)  -- exact
//                                                                multiplicative
//                                                                inverse.
// Per H2 of `claude/reports/007-phase-3-plan-review.md`: the zoom-out
// formula has `(y - 1.5)` in the numerator, so for y < 1.5 it produces
// y_next < y (further down — wrong direction). Caller must clamp y up to
// 1.5 *before* invoking on zoom-out if camera is below the floor (e.g.
// saved-scene-at-street-level case). Pure.
export function phase2NextElevation(y, sign, alpha = SWOOP_PHASE2_STEP) {
  const yLo = SWOOP_PHASE2_EXIT_ELEVATION_METRES;
  if (sign < 0) {
    return y - alpha * (y - yLo);
  }
  return yLo + (y - yLo) / (1 - alpha);
}

// Compute one Shift+LB rotation step. Pure: takes camera position +
// view direction + rotation centre + per-event deltas, returns new
// camera position + lookAt target. Caller writes back to the camera.
//
// Implements the "museum diorama" rotation (per
// `claude/specs/001-shiftrotate-decoupled-view.md`): yaw/tilt deltas
// apply to *both* the position-offset-from-centre (camera orbits the
// scene) and the camera's view direction (independently). Preserves
// the user's angular relationship to the centre across the rotation
// — if the scene was in periphery at gesture start, it stays in
// periphery; if it was at view centre, it stays at view centre.
//
// No `camera.lookAt(centre)` semantics: that's what produced the
// first-move "focus grab" snap when the user wasn't aimed at centre.
//
// Inputs:
//   camPos   — current camera world position (THREE.Vector3-like).
//   viewDir  — current camera view direction, unit (THREE.Vector3-like).
//   centre   — latched rotation centre (THREE.Vector3-like).
//   dxPx, dyPx — per-event mouse pixel deltas.
//   speed    — radians per pixel (typically `controls.rotationSpeed`).
//
// Output:
//   { pos, lookTarget }, both THREE.Vector3. `pos` may equal `camPos`
//   when offset is degenerate (rotate-in-place case).
//
// Tilt clamp: gated by the view-direction's phi (= camera view tilt).
// `dPhi` is reduced to whatever doesn't push view tilt outside
// [MIN_TILT_DEGREES, MAX_TILT_DEGREES]. The same gated dPhi is then
// applied to the position-offset, so position and view stay
// consistent.
export function shiftRotateStep({
  camPos,
  viewDir,
  centre,
  dxPx,
  dyPx,
  speed
}) {
  // (1) Position offset from centre.
  const offsetPos = new THREE.Vector3(
    camPos.x - centre.x,
    camPos.y - centre.y,
    camPos.z - centre.z
  );
  const hasPositionOrbit = offsetPos.lengthSq() >= 1e-6;
  // Rotate-in-place case: centre coincides with camera (Rule 3 /
  // unbounded scene). Position doesn't move; only view direction
  // rotates.

  // (2) View-direction virtual offset = -viewDir (unit length).
  //     Spherical phi of this vector reads as the camera's view tilt:
  //       view tilt 0° (horizontal) → -viewDir.y = 0  → phi = π/2
  //       view tilt +89° (looking down) → -viewDir.y ≈ +1 → phi ≈ 0
  //       view tilt -89° (looking up)   → -viewDir.y ≈ -1 → phi ≈ π
  const offsetView = new THREE.Vector3(-viewDir.x, -viewDir.y, -viewDir.z);
  const sphView = new THREE.Spherical().setFromVector3(offsetView);

  // (3) Tilt clamp via view-direction phi.
  const wantDPhi = -dyPx * speed;
  const newPhi = sphView.phi + wantDPhi;
  let actualDPhi = wantDPhi;
  if (newPhi < MIN_SPHERICAL_PHI) {
    actualDPhi = MIN_SPHERICAL_PHI - sphView.phi;
  } else if (newPhi > MAX_SPHERICAL_PHI) {
    actualDPhi = MAX_SPHERICAL_PHI - sphView.phi;
  }
  const dTheta = -dxPx * speed;

  // (4) Apply to view direction.
  sphView.theta += dTheta;
  sphView.phi += actualDPhi;
  const newOffsetView = new THREE.Vector3().setFromSpherical(sphView);

  // (5) Apply to position offset (only when not rotate-in-place).
  let pos;
  if (hasPositionOrbit) {
    const sphPos = new THREE.Spherical().setFromVector3(offsetPos);
    sphPos.theta += dTheta;
    sphPos.phi += actualDPhi;
    // No separate phi clamp on position — view-tilt clamp above gates
    // dPhi for both.
    const newOffsetPos = new THREE.Vector3().setFromSpherical(sphPos);
    pos = new THREE.Vector3(
      centre.x + newOffsetPos.x,
      centre.y + newOffsetPos.y,
      centre.z + newOffsetPos.z
    );
  } else {
    pos = new THREE.Vector3(camPos.x, camPos.y, camPos.z);
  }

  // (6) Look target. newOffsetView is the virtual offset (= -newViewDir,
  //     unit length), so lookTarget = pos + newViewDir = pos - newOffsetView.
  const lookTarget = new THREE.Vector3(
    pos.x - newOffsetView.x,
    pos.y - newOffsetView.y,
    pos.z - newOffsetView.z
  );

  return { pos, lookTarget };
}
