/* global THREE */

// Phase 2 pure-math helpers for `ExperimentalControls`. Lifted out of the
// class so each piece can be unit-tested without instantiating an
// A-Frame scene. See claude/specs/001-phase-2-plan.md.

import {
  TRUCK_PEDESTAL_CUTOFF_DEGREES,
  ROTATION_BLEND_LOW_DEGREES,
  ROTATION_BLEND_HIGH_DEGREES,
  ROTATION_CENTER_EYE_HEIGHT_METRES,
  SCENE_FEATHER_METRES
} from './constants.js';

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
