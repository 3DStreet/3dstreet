/* global THREE */

// Phase 2 pure-math helpers for `ExperimentalControls`. Lifted out of the
// class so each piece can be unit-tested without instantiating an
// A-Frame scene. See claude/specs/001-phase-2-plan.md.

import {
  TRUCK_PEDESTAL_CUTOFF_DEGREES,
  ROTATION_BLEND_LOW_DEGREES,
  ROTATION_BLEND_HIGH_DEGREES,
  ROTATION_CENTER_EYE_HEIGHT_METRES,
  SCENE_FEATHER_METRES,
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

// Signed-positive distance from a horizontal point (px, pz) to an
// axis-aligned scene rectangle. Returns 0 when the point is inside the
// rectangle, otherwise the Euclidean distance to the nearest edge.
// Pure helper — exported for testing; not used outside this module.
export function distanceToAabbXZ(px, pz, aabb) {
  const dx = Math.max(aabb.minX - px, 0, px - aabb.maxX);
  const dz = Math.max(aabb.minZ - pz, 0, pz - aabb.maxZ);
  return Math.hypot(dx, dz);
}

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
// by any amount = pedestal. Only "looking down by more than the cutoff"
// gets truck/dolly.
export function decideLbMode(tiltDeg) {
  return tiltDeg > TRUCK_PEDESTAL_CUTOFF_DEGREES ? 'pan-truck' : 'pan-pedestal';
}

// Cubic smoothstep on an unclamped t.
function smoothstep(t) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

// Tilt-blend weight: 1 = fully Rule 2/3 (ruleAB); 0 = fully Rule 1
// (screen-center hit). Latched once at gesture start.
//
//   tilt >= HIGH (e.g. >=30°)  -> 0  (all rule 1, inclusive at HIGH)
//   tilt <= LOW  (e.g. <=20°)  -> 1  (all rule 2/3, inclusive at LOW;
//                                     covers all looking-up tilts)
//   in between                 -> smoothstep ramp
//
// Endpoint convention: both ends inclusive — tiltBlendWeight(LOW) === 1
// and tiltBlendWeight(HIGH) === 0. Matches smoke item R5b ("Tilt = -25°
// is *not* in the blend zone — pure ruleAB").
export function tiltBlendWeight(
  tiltDeg,
  lo = ROTATION_BLEND_LOW_DEGREES,
  hi = ROTATION_BLEND_HIGH_DEGREES
) {
  if (tiltDeg >= hi) return 0;
  if (tiltDeg <= lo) return 1;
  const t = (tiltDeg - lo) / (hi - lo); // 0 at LOW, 1 at HIGH
  return 1 - smoothstep(t);
}

// Compute the Rule 2/3 rotation-center position with scene-edge
// feathering. Pure: takes the raw camera position and the bounds
// object returned by `SceneBounds.getBounds()`. Returns a new
// THREE.Vector3.
//
// Inside / outside is tested against the scene's *AABB* (the actual
// horizontal footprint), not the cylinder. A camera 5m off the side of
// a 5m-wide × 100m street is correctly "outside the scene" — it
// orbits the diorama center — rather than being deemed "inside" by a
// 50m-radius cylinder.
//
//   Inside the AABB     -> Rule 3: camera position (rotate in place)
//   Outside, far away   -> Rule 2: diorama center @ eye height
//   In the feather zone -> smoothstep lerp from Rule 3 to Rule 2 over
//                          `SCENE_FEATHER_METRES` extending outward
//                          from the AABB boundary.
//
// Unbounded scenes (`bounded === false`) always get Rule 3.
export function computeRuleAB(camPos, bounds) {
  if (!bounds || !bounds.bounded || !bounds.aabb) {
    return new THREE.Vector3(camPos.x, camPos.y, camPos.z);
  }
  const dist = distanceToAabbXZ(camPos.x, camPos.z, bounds.aabb);
  const featherWidth = Math.max(1e-6, SCENE_FEATHER_METRES);
  // u = 0 at the AABB boundary, u = 1 at (boundary + featherWidth) and
  // beyond. Inside the AABB: dist = 0, clamps to 0 → full Rule 3.
  const u = THREE.MathUtils.clamp(dist / featherWidth, 0, 1);
  const w = smoothstep(u); // 0 inside-or-at-edge (Rule 3), 1 outside (Rule 2)
  const cam = new THREE.Vector3(camPos.x, camPos.y, camPos.z);
  const dioramaCenter = new THREE.Vector3(
    bounds.center.x,
    ROTATION_CENTER_EYE_HEIGHT_METRES,
    bounds.center.z
  );
  return new THREE.Vector3().lerpVectors(cam, dioramaCenter, w);
}

// Combined latch-time computation. Returns the fields that should be
// stored on the GestureLatch:
//   { center, screenHit, blend }
// `screenHitOrNull` is the world-space screen-center raycast hit, or
// null if there was no scene/ground hit (sky raycast miss). When null,
// the rotation center collapses to `ruleAB` regardless of blend weight
// (per A3).
//
// The center is fully latched once computed — no per-move recompute.
// An earlier revision returned a `liveRuleAB` flag intended for
// per-move re-evaluation of Rule 2 ↔ Rule 3, but during a Shift+LB
// rotate the camera position only changes via the orbit math, and
// feeding that back into the center produced visible judder near the
// AABB edge. See ExperimentalControls._latchRotationCenter.
export function latchedRotationCenter(camera, bounds, screenHitOrNull) {
  const tiltDeg = cameraTiltDegrees(camera);
  const blend = tiltBlendWeight(tiltDeg);
  const ruleAB = computeRuleAB(camera.position, bounds);

  // No-screenHit fallback: collapse to ruleAB.
  const effectiveScreenHit = screenHitOrNull
    ? new THREE.Vector3(screenHitOrNull.x, screenHitOrNull.y, screenHitOrNull.z)
    : ruleAB.clone();

  const center = new THREE.Vector3().lerpVectors(
    effectiveScreenHit,
    ruleAB,
    blend
  );

  return {
    center,
    screenHit: effectiveScreenHit,
    blend
  };
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
