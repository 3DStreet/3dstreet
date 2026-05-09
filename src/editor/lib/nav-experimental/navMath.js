/* global THREE */

// Phase 2 pure-math helpers for `ExperimentalControls`. Lifted out of the
// class so each piece can be unit-tested without instantiating an
// A-Frame scene. See claude/specs/001-phase-2-plan.md.

import {
  TRUCK_PEDESTAL_CUTOFF_DEGREES,
  ROTATION_BLEND_LOW_DEGREES,
  ROTATION_BLEND_HIGH_DEGREES,
  ROTATION_CENTER_EYE_HEIGHT_METRES,
  CYLINDER_FEATHER_FRACTION
} from './constants.js';

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

// Compute the Rule 2/3 rotation-center position with cylinder-edge
// feathering. Pure: takes the raw camera position and the bounds object
// returned by `SceneBounds.getBounds()`. Returns a new THREE.Vector3.
//
// Rule 2 (outside cylinder, bounded scene): diorama center @ eye height.
// Rule 3 (inside cylinder, or unbounded scene): camera position.
// Within ±feather*radius of the cylinder edge: smoothstep lerp between
// Rule 3 (inside) and Rule 2 (outside).
export function computeRuleAB(camPos, bounds) {
  if (!bounds || !bounds.bounded) {
    return new THREE.Vector3(camPos.x, camPos.y, camPos.z);
  }
  const cx = bounds.center.x;
  const cz = bounds.center.z;
  const r = bounds.radius;
  const dist = Math.hypot(camPos.x - cx, camPos.z - cz);
  const featherWidth = Math.max(1e-6, r * CYLINDER_FEATHER_FRACTION);
  // u = 0 at the cylinder edge (dist = r), u = 1 at (r + featherWidth)
  // and beyond. Inside the cylinder: clamp to 0 (full Rule 3,
  // rotate-in-place). Matches the plan prose at
  // 001-phase-2-plan.md:68 — feather extends *outward* from the edge,
  // so a camera exactly at the boundary still rotates in place and
  // only fully-Rule-2 (diorama center) once it's a feather-width
  // outside. Intuition: "I'm in/at the scene → rotate in place; I'm
  // well clear of the scene → orbit the diorama".
  const u = THREE.MathUtils.clamp((dist - r) / featherWidth, 0, 1);
  const w = smoothstep(u); // 0 inside-or-at-edge (Rule 3), 1 outside (Rule 2)
  const cam = new THREE.Vector3(camPos.x, camPos.y, camPos.z);
  const dioramaCenter = new THREE.Vector3(
    cx,
    ROTATION_CENTER_EYE_HEIGHT_METRES,
    cz
  );
  return new THREE.Vector3().lerpVectors(cam, dioramaCenter, w);
}

// Combined latch-time computation. Returns the fields that should be
// stored on the GestureLatch:
//   { center, screenHit, blend, liveRuleAB }
// `screenHitOrNull` is the world-space screen-center raycast hit, or
// null if there was no scene/ground hit (sky raycast miss). When null,
// the rotation center collapses to `ruleAB` regardless of blend weight
// (per A3).
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
    blend,
    // Rule 3 == camera position when the scene is unbounded; the live
    // recompute is a no-op in that case so short-circuit it.
    liveRuleAB: !!(bounds && bounds.bounded)
  };
}
