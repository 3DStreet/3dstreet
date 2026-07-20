/* global THREE */

// Pure-math helpers for `ExperimentalControls`. Lifted out of the class so
// each piece can be unit-tested without instantiating an A-Frame scene. The
// pure-math layering (THREE-free at module scope) is KD-31; canonical values
// live in docs/03-configurable-thresholds.md.

import {
  TILT_THRESHOLD_DEFAULT_DEGREES,
  MIN_TILT_DEGREES,
  MAX_TILT_DEGREES,
  SWOOP_PHASE2_ENTRY_ELEVATION_METRES,
  SWOOP_PHASE2_EXIT_ELEVATION_METRES,
  SWOOP_PHASE2_STEP,
  WHEEL_UNITS_PER_NOMINAL_TICK,
  LINE_HEIGHT_PX,
  WHEEL_MAX_TICKS_PER_EVENT,
  EYE_MARGIN_METRES,
  BLOCK_SLOPE_MIN_DEGREES,
  BLOCK_HEIGHT_MIN_METRES,
  WASD_FACING_MIN,
  WASD_FACING_HYSTERESIS,
  DISCOVERABILITY_CUE_SHOW_METRES,
  DISCOVERABILITY_CUE_HIDE_METRES,
  DOUBLECLICK_LANE_STANDOFF_METRES,
  DOUBLECLICK_OBJECT_STANDOFF_RADII,
  DOUBLECLICK_BUILDING_STANDOFF_DIAG,
  DOUBLECLICK_BUILDING_VIEW_HEIGHT_FRAC,
  DOUBLECLICK_MAX_FRAMING_PITCH_DEGREES
} from './constants.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// Hot-path scratch is held in each function's own closure and allocated LAZILY on
// first call, so this pure-math module stays THREE-free at module scope: its unit
// tests import it without a THREE global, and a module-scope `new THREE.*` would
// break that (the pure-math layering invariant, KD-31 — see docs/02-key-decisions.md).
// The IIFE bodies below run at import but only declare `let` bindings — no THREE —
// while the `new THREE.*` is deferred to the first call, keeping the allocate-once
// win. Each scratch vector is private to one function (no cross-function or
// cross-call aliasing); escaping/retained returns are NOT pooled — they take an
// optional caller-owned `target` instead.

// Camera tilt in degrees below horizontal. 0° = horizontal, +90° =
// straight down, -90° = straight up. Caller passes in the camera so the
// helper stays pure.
export const cameraTiltDegrees = (() => {
  let fwd; // closure-private scratch, lazily allocated on first call
  return function cameraTiltDegrees(camera) {
    // camera.getWorldDirection returns the camera's -Z direction (its
    // "look" vector). Tilt-down is `-y`-component, so:
    //   sin(tilt) = -fwd.y
    if (!fwd) fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const sin = THREE.MathUtils.clamp(-fwd.y, -1, 1);
    return Math.asin(sin) * RAD2DEG;
  };
})();

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

// The hysteresis variant of `decideLbMode` (dead-band δ = TH-73), used ONLY
// for the letterbox indicator DURING a committed-motion-runner tween. A
// dead-band δ around T holds the current mode across the boundary so a tween
// that settles on / runs along T can't strobe the indicator: flip to
// 'pan-truck' (Map) only above T+δ, flip to 'pan-pedestal' (Street) only below
// T−δ, otherwise keep the current mode. Seeds via exact `decideLbMode` when
// `currentMode` is null (the tween is the first camera motion and nothing has
// established the anchor yet). Regime CONTROL never uses this (KD-05/KD-30) —
// only the indicator, only inside a tween.
export function decideLbModeHysteresis(tiltDeg, threshold, delta, currentMode) {
  if (currentMode === 'pan-truck') {
    return tiltDeg < threshold - delta ? 'pan-pedestal' : 'pan-truck';
  }
  if (currentMode === 'pan-pedestal') {
    return tiltDeg > threshold + delta ? 'pan-truck' : 'pan-pedestal';
  }
  return decideLbMode(tiltDeg, threshold);
}

// Live-Shift (KD-06): pure decision for whether an in-progress LB drag should
// switch sub-gesture given the live Shift state. Returns the sub-mode to
// switch *to* ('pan' | 'rotate'), or null for no change. Only LB gestures
// ('pan' | 'rotate') switch; any other latch mode (e.g. a wheel gesture, which
// is never latched here anyway) returns null. This is where the
// symmetry/idempotency correctness lives, so it is extracted for unit testing
// without a DOM or constructed controls.
export function decideDragModeSwitch(currentMode, shiftHeld) {
  if (currentMode !== 'pan' && currentMode !== 'rotate') return null;
  const desired = shiftHeld ? 'rotate' : 'pan';
  return desired === currentMode ? null : desired;
}

// Clamp the orbit pivot to a sane radius from the camera (min radius TH-04;
// KD-03). **Moves the pivot, never the camera** — moving the
// camera at gesture start would be a visible teleport, whereas moving the
// pivot only changes what we orbit. Let `v = pivot − camPos`, `r = |v|`.
//   r === 0 (degenerate, pivot coincident with camera):
//       camPos + fallbackDir.normalized() × minR
//   r < minR: push the pivot *out* along the camera→pivot ray to minR.
//   r > maxR: pull the pivot *in* along the same ray to maxR.
//   else: pivot unchanged.
// In the clamped cases the returned pivot is a point along the same view
// ray at a clamped depth — no longer exactly the world point the cursor
// grabbed (intentional). Returns a new THREE.Vector3.
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

// WASD forward-ray step classifier (KD-18). Pure decision —
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
//     used to make the down-step decision reach-invariant.
//   targetDir — { x, z } normalized horizontal travel direction (for the
//     facing dot, TH-44).
//   lastBlocked — previous frame's block state, for a small facing-dot
//     hysteresis dead-band (TH-45). Never holds a block when the forward
//     ray is clear or non-facing.
// Returns 'block' | 'step-up' | 'follow' | 'hover'.
export function classifyWasdStep({
  floorNow,
  floorDest,
  forwardHit,
  reach,
  targetDir,
  lastBlocked
}) {
  const delta = floorDest.y - floorNow.y;
  const slopeMinRad = BLOCK_SLOPE_MIN_DEGREES * DEG2RAD;

  // Forward-ray facing test (TH-44): only a wall that FACES travel can block.
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
        // Facing hysteresis (TH-45): once blocked, hold the block through
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

  // No block — a TOTAL split over the remaining cases (up-step / down-step).
  if (delta > 0) {
    // Every non-blocked up-step mounts the step/ledge (step-up == follow in
    // y outcome). Catch-all; cannot fall through.
    return 'step-up';
  }
  if (delta < 0) {
    // Down-step: hover iff the descent is BOTH steep (angle, reach-invariant)
    // AND a real drop. Else follow (gentle ramps follow at any fly-speed).
    const descentAngle = Math.atan2(-delta, Math.max(reach, 1e-6));
    if (descentAngle >= slopeMinRad && -delta >= BLOCK_HEIGHT_MIN_METRES) {
      return 'hover';
    }
    return 'follow';
  }
  // Flat.
  return 'follow';
}

// The camera y for a 'follow'/'step-up' WASD step (KD-19, grounded). W must
// NEVER pin the camera to eye-height — that discarded a deliberate
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

// Pure vertical rule for a WASD follow/step-up step (KD-19). Returns the new
// camera y.
//   grounded (or H == null) -> collision-follow (`wasdFollowY`): walking hugs
//     the surface directly, NOT rate-limited (terrain follow is immediate).
//   not-grounded            -> the flying cruise-height rule (KD-19): ease
//     toward the absolute cruise target `max(H, collisionFloorDest + eye)`,
//     rate-limited per tick.
//
// (Two earlier candidate rules were retired in live A/B — they jumped the
// camera by the full building height when crossing onto a footprint.) The
// flying rule above is the sole flying behaviour: the forward ray blocks
// approach to any building taller than flight height, so the clamp only ever
// lifts ≤ eye-margin.
//
// The vertical move is ANIMATED in BOTH directions (rate TH-41). Rather than snap
// `newY = target`, we step toward it by at most `maxStep = rate * dtSeconds`
// this frame, so the lift onto a roof (up) and the settle back to cruise H
// (down) both ease over ~0.3-0.4 s and compose with continuous per-frame WASD
// (NOT a discrete tween that would fight the held-key motion). A hard safety
// floor (`>= collisionFloorDest`) after the rate clamp guarantees a fast
// cross-on can never clip the roof mid-ease.
//
// `floorNowY` is consumed by the grounded collision-follow branch (preserve
// AGL). `H == null` falls back to collision-follow so the helper never returns
// NaN (defensive; the caller lazily captures H first). Pure — never touches
// `grounded` (terrain rising must not ground).
//
// Solid-geometry guard: `destFloorHit` is false when the
// destination-column probe MISSED (source 'cache' = stale last-known ground,
// no real surface ahead — outside a finite scene's bounds). In that case
// `collisionFloorDestY` is meaningless: the not-grounded path eases toward H
// only (NO `max(H, floorDest+eye)` lift, NO `max(eased, floorDest)` safety
// floor), so the camera is never spuriously lifted to a stale-high floor nor
// blocked from descending outside bounds. Defaults to true so existing callers
// (and the grounded branch, unaffected) behave exactly as before.
export function wasdVerticalY({
  grounded,
  camY,
  floorNowY,
  collisionFloorDestY,
  destFloorHit = true,
  H,
  eyeMargin,
  dtSeconds,
  rateMps
}) {
  if (grounded || H == null) {
    return wasdFollowY(camY, floorNowY, collisionFloorDestY, eyeMargin);
  }
  // Not grounded, no floor ahead (outside bounds): ease toward H only — no
  // floor clamp, no safety floor (there is no geometry to clip).
  if (!destFloorHit) {
    const maxStep = rateMps * dtSeconds;
    const delta = THREE.MathUtils.clamp(H - camY, -maxStep, maxStep);
    return camY + delta;
  }
  // Not grounded: ease toward the flying cruise-height target (KD-19), rate-limited.
  const target = Math.max(H, collisionFloorDestY + eyeMargin);
  const maxStep = rateMps * dtSeconds;
  const delta = THREE.MathUtils.clamp(target - camY, -maxStep, maxStep);
  const eased = camY + delta;
  // Hard safety floor: never clip the roof mid-ease.
  return Math.max(eased, collisionFloorDestY);
}

// Pure initial-grounded predicate from a load/teleport pose (KD-19).
// Grounded iff the collision-floor probe HIT (not a cache miss) AND the
// camera sits within eye-margin (inclusive) of that floor. A cache-miss
// (scene graph not yet populated) reads not-grounded — a safe high, flying
// reading (KD-19) that self-heals on the first deliberate descent.
export function groundedAtLoad({ camY, floorY, source, eyeMargin }) {
  if (source === 'cache') return false;
  return camY - floorY <= eyeMargin + 1e-6;
}

// Legit-pose predicate (KD-17). A pose is legit iff BOTH (not enclosed) AND
// (camera.y >= collision floor under it + eye margin, TH-46). Neither alone
// (enclosure-only accepts grazing under an overhang; floor-only accepts tucked
// under an arch). Pure.
export function isLegitPose({ enclosed, camY, floorY }) {
  if (enclosed) return false;
  if (floorY == null || !isFinite(floorY)) return true; // no floor = open sky
  return camY >= floorY + EYE_MARGIN_METRES;
}

// Discoverability-cue show/hide hysteresis (TH-52/TH-53; KD-21). `prevShown` is
// the previous shown state; returns the next shown state. Enclosure forces
// show; otherwise show above SHOW metres, hide below HIDE metres, and hold
// between (no strobe). Pure.
export function cueState(prevShown, aglAboveCollisionFloor, enclosed) {
  if (enclosed) return true;
  if (aglAboveCollisionFloor > DISCOVERABILITY_CUE_SHOW_METRES) return true;
  if (aglAboveCollisionFloor < DISCOVERABILITY_CUE_HIDE_METRES) return false;
  return prevShown;
}

// Elevated↔street-level hysteresis tracker for the context view button
// (KD-21; entry TH-67, exit TH-68). `prev` is the previous state ('street' |
// 'elevated'); `agl` is the height above the collision floor directly below
// the camera, or NULL on a probe miss. Above `exitM` → 'elevated'; at/below
// `entryM` → 'street'; in the dead band between → hold `prev` (anti-flicker).
// A null agl (probe miss — e.g. over the void at a scene edge) HOLDS the
// previous state rather than collapsing it, mirroring the collision-floor
// cache's hold-on-miss. Pure.
export function elevationState(prev, agl, entryM, exitM) {
  if (agl == null) return prev; // probe miss — hold
  if (agl >= exitM) return 'elevated';
  if (agl <= entryM) return 'street';
  return prev; // dead band — hold
}

// One wheel-zoom dolly step toward a fixed `hit` (KD-09), with the HORIZONTAL
// component of the translation capped to `lateralCapMetres` (the cap is
// TH-16/TH-17; KD-15). Returns the NEW camera position (THREE.Vector3), or
// `null` if the step is non-finite (the caller then falls through to the
// level-forward fallback).
//
// Step shape (matches _applyAnchoredDollyStep's algebra, re-expressed as a
// translation): newPos = hit + factor·(camPos − hit), i.e.
//   step = newPos − camPos = (1 − factor)·(hit − camPos).
// factor = (1 − alpha) for zoom-in (sign<0, step toward hit) and
// 1/(1 − alpha) for zoom-out (sign>0, step away from hit).
//
// The cap acts on the HORIZONTAL part h = hypot(step.x, step.z) (NOT
// |step|), and when it fires it scales the WHOLE vector
// (x, y, z together) by lateralCapMetres / h. This preserves the H:V ratio
// so the move stays on the camera→hit ray — just shorter — keeping the
// target locked under the cursor and reversibility exact. A straight-down
// step has h ≈ 0 so the cap never fires (full exponential descent survives).
//
// Reversibility: the applied cap is `±(cap/H)·(hit − camPos)` where
// H = hypot((hit−camPos).xz) is a pure function of camera position about a
// FIXED hit, so each elementary step is position-invertible about hit; an
// in/out pair on the same side of the cap threshold composes to identity.
//
// `minAnchorDistMetres` (optional; TH-80, #1865): zoom-out escape floor.
// When zooming OUT (f > 1) with the camera closer to the anchor than this,
// the step is sized as if the anchor were `minAnchorDistMetres` away (the
// step vector is scaled up along the same camera→hit ray), so a camera
// parked (near-)on its anchor — e.g. after focusing an empty-bbox entity —
// still escapes at a usable rate instead of 5%-of-millimetres per tick.
// Zoom-in is untouched (stays asymptotic; never shoots through the anchor).
// This deliberately breaks exact in/out reversibility inside the floor
// radius — never-stuck beats exact retrace there. Omitted/0 → old behaviour.
// Pure.
export function cappedDollyStep(
  { camPos, hit, sign, alpha, factor, lateralCapMetres, minAnchorDistMetres },
  target
) {
  // Continuous-accumulator merge (KD-09): accept a precomputed CONTINUOUS
  // `factor` (from dollyFactorForTicks) for the fractional single-drain path; fall back
  // to the per-whole-tick factor from sign+alpha for the swoop hand-off
  // callers. Either way the lateral-cap algebra below is identical.
  const f = factor != null ? factor : sign < 0 ? 1 - alpha : 1 / (1 - alpha);
  const oneMinusFactor = 1 - f;
  let stepX = oneMinusFactor * (hit.x - camPos.x);
  let stepY = oneMinusFactor * (hit.y - camPos.y);
  let stepZ = oneMinusFactor * (hit.z - camPos.z);

  // Zoom-out escape floor (TH-80): scale the step up to what a
  // minAnchorDistMetres-away anchor would have produced. Applied before the
  // lateral cap so the cap still bounds the result. A zero camera→hit
  // distance has no ray direction to scale along — leave the (zero) step.
  if (f > 1 && minAnchorDistMetres > 0) {
    const d = Math.hypot(hit.x - camPos.x, hit.y - camPos.y, hit.z - camPos.z);
    if (d > 1e-9 && d < minAnchorDistMetres) {
      const k = minAnchorDistMetres / d;
      stepX *= k;
      stepY *= k;
      stepZ *= k;
    }
  }

  const h = Math.hypot(stepX, stepZ);

  // Non-finite guard: a near-parallel grazing ray (now reachable
  // with the raised wheel-path reach ceiling) can return a `hit` near
  // Float.MAX whose step overflows. Bail so the caller falls to
  // level-forward rather than NaN the camera.
  if (
    !Number.isFinite(stepX) ||
    !Number.isFinite(stepY) ||
    !Number.isFinite(stepZ) ||
    !Number.isFinite(h)
  ) {
    return null;
  }

  if (lateralCapMetres > 0 && h > lateralCapMetres) {
    const k = lateralCapMetres / h;
    stepX *= k;
    stepY *= k;
    stepZ *= k;
  }

  // Escaping return (applied to camera.position). Fill the caller's `target`
  // when supplied — the hot wheel path passes an engine-owned scratch it copies
  // out of immediately — otherwise a fresh Vector3 keeps pure callers unchanged.
  const out = target || new THREE.Vector3();
  return out.set(camPos.x + stepX, camPos.y + stepY, camPos.z + stepZ);
}

// Level-forward synthetic anchor for the no-real-hit wheel-zoom case (cursor
// ray hit nothing — open sky), so the swoop's forward dolly (KD-08) still has
// a target. Returns a point `dist` (TH-21) metres ahead of the camera along
// its YAW HEADING (forward projected to horizontal), held at the camera's OWN
// y so the resulting dolly is level — zoom-in advances forward at constant
// height instead of drifting up into empty sky (which would read as zoom-out).
//
// Uses the yaw heading (not raw camera-forward) so it stays well-defined at
// any pitch: looking near-vertically, forward.xz → 0 and a forward-based
// "ahead" would be degenerate/jittery. Returns `null` only when the
// horizontal heading is genuinely undefined (|forward.xz| < 1e-6 — true
// vertical), which the ±89° tilt clamp prevents in live use; the caller
// no-ops that tick. Pure.
export const levelForwardAnchor = (() => {
  let fwd; // closure-private scratch, lazily allocated on first call
  return function levelForwardAnchor(camera, dist, target) {
    if (!fwd) fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const h = Math.hypot(fwd.x, fwd.z);
    if (h < 1e-6) return null; // near-straight-up/down: yaw undefined
    const dirX = fwd.x / h;
    const dirZ = fwd.z / h;
    const camPos = camera.position;
    // Escaping return (feeds the wheel dolly). Fill the caller's `target` when
    // supplied, else a fresh Vector3 for pure callers. `null` early-outs above
    // stay null regardless of `target`.
    const out = target || new THREE.Vector3();
    return out.set(
      camPos.x + dirX * dist,
      camPos.y, // level: hold the camera's own height
      camPos.z + dirZ * dist
    );
  };
})();

// ---------------------------------------------------------------------------
// Double-click navigation — pure pose math (KD-23). THREE in, THREE out; no
// scene access (the controls do the raycasts and feed the results in). See
// docs/02-key-decisions.md.
// ---------------------------------------------------------------------------

// Snap a heading bearing (degrees, 0 = North = +X, increasing toward +Z)
// to the nearest cardinal of {0, 90, 180, 270}. Returns the snapped bearing
// in [0, 360). Bounds rotation at ≤ 45° per click and removes any dependence
// on objects defining a "front". No hysteresis (feel-test first).
export function cardinalSnapYaw(bearingDeg) {
  const snapped = Math.round(bearingDeg / 90) * 90;
  return ((snapped % 360) + 360) % 360;
}

// Horizontal unit direction for a cardinal bearing (the convention above):
// 0 → +X, 90 → +Z, 180 → −X, 270 → −Z. Returns { x, z }.
export function cardinalDir(bearingDeg) {
  const r = bearingDeg * DEG2RAD;
  return { x: Math.cos(r), z: Math.sin(r) };
}

// Map an owning-entity kind (from cursorAnchor.classifyHitEntity) to a
// double-click category (KD-23): segment/tiles → A (lane/ground surface point),
// building → B, scatter → C, null → D (empty space / no hit → no-op).
export function classifyDoubleClick(kind) {
  if (kind === 'segment' || kind === 'tiles') return 'A';
  if (kind === 'building') return 'B';
  if (kind === 'scatter') return 'C';
  return 'D';
}

// Never-raise (KD-23): a double-click may lower or keep the camera height
// but never raise it. Absolute world height, full stop.
export function neverRaiseY(targetY, currentCamY) {
  return Math.min(targetY, currentCamY);
}

// One standoff-clearance pull-back step (KD-23; step TH-65, ceiling TH-66):
// move `pos` horizontally toward `target` by up to `stepMetres` (the B/C
// clearance search pulls the camera inward — toward the look target — when its
// column is blocked or void). Y is held (never lifts above the pre-click
// height). Returns { x, y, z }.
export function pullBackTowardTarget(pos, target, stepMetres) {
  const dx = target.x - pos.x;
  const dz = target.z - pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return { x: pos.x, y: pos.y, z: pos.z };
  const k = Math.min(stepMetres, d) / d;
  return { x: pos.x + dx * k, y: pos.y, z: pos.z + dz * k };
}

// Compute the DESIRED double-click pose (before never-raise + clearance
// resolution, which the controls apply against the live scene). Pure: takes
// the hit-point, the owning object's box (B/C), the pre-click heading bearing
// and the eye height; returns { position, lookTarget } (both THREE.Vector3).
// Returns null for Category D (caller no-ops before calling).
//
//   A (lane/ground): look at the hit-point; stand off ~LANE_STANDOFF back
//     along the snapped heading at eye height. The standoff ≫ eye height so
//     the down-look stays below the mode threshold T (Street mode).
//   B (building): look at the building CENTRE (not the hit-point); stand off
//     ~DIAG×footprint-diagonal back along the heading at a fraction of the
//     building height. The look angle falls out of the camera height (gentle
//     from above, steep from the street); the framing-pitch cap is the
//     backstop, moving the aim point TOWARD camera height if it would otherwise
//     crane past MAX_FRAMING_PITCH (TH-64).
//   C (generic): look at the object centre; stand off ~RADII×bounding-radius
//     back along the heading at centre height.
export function desiredDoubleClickPose({
  category,
  hitPoint,
  objectBox,
  currentYaw,
  eyeHeight
}) {
  if (category === 'D') return null;
  const dir = cardinalDir(cardinalSnapYaw(currentYaw));

  if (category === 'A') {
    const lookTarget = new THREE.Vector3(hitPoint.x, hitPoint.y, hitPoint.z);
    const s = DOUBLECLICK_LANE_STANDOFF_METRES;
    const position = new THREE.Vector3(
      hitPoint.x - dir.x * s,
      hitPoint.y + eyeHeight,
      hitPoint.z - dir.z * s
    );
    return { position, lookTarget };
  }

  // B/C need the object box. Derive centre + size from min/max (works for a
  // real THREE.Box3 or a plain { min, max } — keeps the helper pure/testable).
  const cx = (objectBox.min.x + objectBox.max.x) / 2;
  const cz = (objectBox.min.z + objectBox.max.z) / 2;
  const sx = objectBox.max.x - objectBox.min.x;
  const sy = objectBox.max.y - objectBox.min.y;
  const sz = objectBox.max.z - objectBox.min.z;

  if (category === 'C') {
    const cy = (objectBox.min.y + objectBox.max.y) / 2;
    const radius = 0.5 * Math.hypot(sx, sy, sz);
    const s = radius * DOUBLECLICK_OBJECT_STANDOFF_RADII;
    const lookTarget = new THREE.Vector3(cx, cy, cz);
    const position = new THREE.Vector3(cx - dir.x * s, cy, cz - dir.z * s);
    return { position, lookTarget };
  }

  // Category B (building). Look at the building's CENTRE — NOT the clicked
  // hit-point. The camera height is set elsewhere (⅓ building height from
  // above, front-door height from the street via AGL never-raise), so aiming at
  // a FIXED point lets the look angle fall out of that height automatically:
  // gentle from above, steep-but-pitch-capped from the street (TH-64; KD-24).
  // There is no need to distinguish "from the air" from "street → tall tower" —
  // the distinction is already encoded in the resulting camera height. Aiming
  // at the moving hit-point instead coupled the look to where you clicked, so
  // an aerial click (which lands on the roof) craned up at the roof. (KD-24:
  // the pitch cap is the backstop, not the primary mechanism.)
  const camY = objectBox.min.y + sy * DOUBLECLICK_BUILDING_VIEW_HEIGHT_FRAC;
  const diag = Math.hypot(sx, sz);
  const s = diag * DOUBLECLICK_BUILDING_STANDOFF_DIAG;
  const position = new THREE.Vector3(cx - dir.x * s, camY, cz - dir.z * s);
  const lookTarget = new THREE.Vector3(cx, objectBox.min.y + sy / 2, cz);
  // Framing-pitch cap (first pass, against the DESIRED height). This is a
  // convenience pass only — the camera height is lowered again by never-raise
  // and standoff resolution in the controls, so the AUTHORITATIVE cap is
  // re-applied post-clearance via `clampFramingPitch` against the FINAL
  // position (the cap must hold at the height the camera actually
  // lands, which for a street-level look-up at a tall tower is well below
  // `camY`). Keeping it here too is harmless (idempotent) and gives a sane
  // first-pass look target.
  return {
    position,
    lookTarget: clampFramingPitch(
      position,
      lookTarget,
      DOUBLECLICK_MAX_FRAMING_PITCH_DEGREES
    )
  };
}

// Framing-pitch cap (pure): clamp the look target's vertical angle from
// `position` to ±maxDeg by moving the look target's Y TOWARD the camera's own
// height — reducing |dy| (down for a steep look-up, up for a steep look-down).
// Returns a new THREE.Vector3 look target (x/z unchanged). The controls call
// this AFTER never-raise + standoff resolution so the cap holds at the final
// landing height, not the desired one (TH-64; KD-24).
export function clampFramingPitch(position, lookTarget, maxDeg) {
  const out = new THREE.Vector3(lookTarget.x, lookTarget.y, lookTarget.z);
  const hdist = Math.hypot(out.x - position.x, out.z - position.z);
  const dy = out.y - position.y;
  const maxDy = hdist * Math.tan(maxDeg * DEG2RAD);
  if (Math.abs(dy) > maxDy) {
    out.y = position.y + THREE.MathUtils.clamp(dy, -maxDy, maxDy);
  }
  return out;
}

// ── Wheel input-plumbing pure helpers (KD-09) ───────────────────────────

// Normalise a raw wheel event to a signed, magnitude-clamped "nominal
// tick" count.
//   deltaMode: 0 = pixel, 1 = line (~LINE_HEIGHT_PX px), 2 = page
//     (viewport height).
//   One mouse detent (deltaY ≈ 100 px) ≈ 1.0 tick.
//   Sign: deltaY > 0 → +t → zoom OUT (preserves the existing convention).
// Clamps a single pathological event to ±WHEEL_MAX_TICKS_PER_EVENT so the
// continuous per-frame step can never apply an unbounded factor in one
// frame (page-mode multiplies by ~viewport height; some trackpads emit
// deltaY in the thousands). `viewportH` guards a NaN when page-mode events
// arrive without a known viewport. Pure.
export function wheelDeltaToTicks(deltaY, deltaMode, viewportH = 800) {
  let dy = deltaY;
  if (deltaMode === 1) {
    dy *= LINE_HEIGHT_PX;
  } else if (deltaMode === 2) {
    dy *= viewportH || 800;
  }
  const t = dy / WHEEL_UNITS_PER_NOMINAL_TICK;
  const max = WHEEL_MAX_TICKS_PER_EVENT;
  return Math.max(-max, Math.min(max, t));
}

// Anchored-dolly distance-to-anchor multiplier for `t` nominal ticks.
// Generalises the per-whole-tick factor (1 − α in / 1/(1 − α) out) to a
// real, signed tick count, exactly reversible for all t:
//   t < 0 zoom-in  → factor = (1 − α)^(−t) < 1  (closer to anchor)
//   t > 0 zoom-out → factor = (1 − α)^(−t) > 1  (farther)
//   t = −1 → (1 − α)  (identical to the old per-tick zoom-in)
//   factor(t) · factor(−t) = 1  (reversibility, exact to ~1 ULP)
// The exponential is the unique continuous extension of the existing
// multiplicative step that stays exactly reversible (a linear 1 − α·t
// breaks reversibility for |t| ≠ 1 and can go non-positive). Pure.
export function dollyFactorForTicks(t, alpha) {
  return Math.pow(1 - alpha, -t);
}

// FOV multiplier for `t` nominal ticks. Generalises the per-whole-tick
// factor (1/(1 + β) in / (1 + β) out):
//   t < 0 zoom-in  → (1 + β)^t < 1  (narrower FOV)
//   t > 0 zoom-out → (1 + β)^t > 1  (wider FOV)
//   t = −1 → 1/(1 + β)  (identical to the old per-tick zoom-in)
//   factor(t) · factor(−t) = 1  (reversibility). Pure.
export function fovFactorForTicks(t, beta) {
  return Math.pow(1 + beta, t);
}

// Swoop helpers (KD-08). See docs/02-key-decisions.md.

// Decide which of the 3 swoop phases applies (KD-08), from camera elevation
// **above ground (AGL)** = camera.y − groundY. Callers pass AGL.
//   AGL > TH-22           -> 'phase1'  (cursor-anchored dolly, tilt-conditional)
//   TH-23 < AGL ≤ TH-22   -> 'phase2'  (pedestal + tilt-toward-horizontal)
//   AGL ≤ TH-23           -> 'phase3'  (FOV-only zoom)
// Pure.
export function decideSwoopPhase(yAgl) {
  if (yAgl > SWOOP_PHASE2_ENTRY_ELEVATION_METRES) return 'phase1';
  if (yAgl > SWOOP_PHASE2_EXIT_ELEVATION_METRES) return 'phase2';
  return 'phase3';
}

// Phase-2 height fraction (KD-08). 1 at the ceiling (AGL TH-22), 0 at the
// floor (AGL TH-23), clamped outside the band. Single source of truth for
// the descent tilt, the ascent tilt, and the landing FOV ramp. Pure.
export function phase2HeightFrac(yAgl) {
  const yHi = SWOOP_PHASE2_ENTRY_ELEVATION_METRES; // 20
  const yLo = SWOOP_PHASE2_EXIT_ELEVATION_METRES; // 1.5
  return THREE.MathUtils.clamp((yAgl - yLo) / (yHi - yLo), 0, 1);
}

// Phase 2 (descent / swoop-IN) tilt lerp: θ(yAgl) = θ_stored × frac, where
// frac = phase2HeightFrac(yAgl). Linear in AGL from θ_stored at AGL=TH-22 to
// 0° at AGL=TH-23. Both ends inclusive. Outside the Phase 2 band the helper
// clamps: AGL ≥ TH-22 → θ_stored; AGL ≤ TH-23 → 0°. Input is AGL. Pure.
// Routed through phase2HeightFrac so the descent and the swoop-OUT ascent
// (phase2AscentTilt) read the SAME frac at the SAME height (KD-11) — the
// reverse can't drift by a ULP at the band boundaries. Numerically identical
// to the old inline `(yAgl - yLo)/(yHi - yLo)` form.
export function phase2TargetTilt(yAgl, storedTiltDeg) {
  return storedTiltDeg * phase2HeightFrac(yAgl);
}

// Swoop-OUT Phase-2 tilt (KD-11). Linear in height fraction, anchored
// through (startFrac, startTilt) captured when this ascent began and
// (1, targetTilt) at the ceiling. frac = phase2HeightFrac(yAgl): 1 at the
// ceiling (AGL TH-22), 0 at the floor (AGL TH-23). Reaches startTilt at the
// start height (no jump) and target at the ceiling. Pure.
//
// For the immediate-undo case (startFrac=0, startTilt=0, target=entryTilt)
// this reduces to `entryTilt × frac` — the SAME curve phase2TargetTilt
// drew on the way down, so the ascent retraces the descent exactly. The
// general anchored form handles the interrupted / default case (started
// mid-band at an arbitrary startTilt/startFrac, target = default TH-28).
// There is exactly ONE formula; immediate-undo is its startFrac=startTilt=0
// special case (no separate "ease onto rail" branch).
export function phase2AscentTilt(yAgl, startFrac, startTilt, targetTilt) {
  const frac = phase2HeightFrac(yAgl);
  if (startFrac >= 1) return targetTilt;
  const t = THREE.MathUtils.clamp((frac - startFrac) / (1 - startFrac), 0, 1);
  return startTilt + (targetTilt - startTilt) * t;
}

// Zoom-undo state reducer (KD-11). Pure. `state` is {valid, tilt, fov};
// `event` is one of:
//   'wheel-in-crossing' — wheel zoom-in crossed AGL 20 downward; capture.
//       payload {tilt, fov} = the camera attitude at the crossing.
//   'wheel-tick'        — any other wheel activity (in/out/FOV); preserve.
//   'non-wheel-move'    — an ACTUAL non-wheel camera move committed; clear.
//   'noop-input'        — an input event that committed no move; preserve.
// Returns the next {valid, tilt, fov}. Never mutates `state`.
export function nextZoomUndo(state, event) {
  switch (event.type) {
    case 'wheel-in-crossing':
      return { valid: true, tilt: event.tilt, fov: event.fov };
    case 'non-wheel-move':
      return { valid: false, tilt: state.tilt, fov: state.fov };
    case 'wheel-tick':
    case 'noop-input':
    default:
      return state;
  }
}

// Phase 2 elevation step. Input/output are AGL.
//   sign < 0 (zoom-in):  yAgl_next = yAgl - α × (yAgl - yFloor)  -- exponential
//                                                       approach to the TH-23
//                                                       AGL floor.
//   sign > 0 (zoom-out): yAgl_next = yFloor + (yAgl - yFloor)/(1 - α)  -- exact
//                                                                multiplicative
//                                                                inverse.
// The zoom-out formula has `(yAgl - yFloor)` in the numerator, so for
// yAgl < yFloor it produces yAgl_next < yAgl (further down — wrong direction).
// Caller must clamp yAgl up to yFloor (TH-23) *before* invoking on zoom-out if
// the camera is below the floor (e.g. saved-scene-at-street-level case). Pure.
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
// **Rigid orbit about the latched centre** (KD-03). The yaw + pitch
// deltas are composed into a *single* rotation `R`, which is applied to
// **both** the camera's position-offset-from-centre **and** its view
// direction. Because the camera basis and the camera→centre vector
// rotate by the same `R`, the centre's position in the camera's frame
// is invariant — so the latched point stays pinned on screen (under the
// cursor) at *any* tilt.
//
// This replaces the earlier "museum diorama" math (the whole diorama
// concept was later removed, KD-02), which applied the same spherical
// (dTheta, dPhi) increments to the position-offset and the view-direction
// *independently*. That is only a single rotation when the two vectors
// share a meridian (camera looking straight down the offset, i.e.
// top-down); at any other tilt the pitch component rotated each vector
// about a different horizontal axis and the pivot drifted across the
// screen.
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
//   camRight — (optional) the camera's current screen-right axis in world
//              space (local +X rotated by camera.quaternion). Used as the
//              pitch axis ONLY when `view × up` degenerates at exact nadir
//              (where the horizontal heading — and hence `view × up` — is
//              undefined). camRight stays well-defined and horizontal at
//              nadir and equals `view × up` off-nadir (no roll), so it is a
//              continuous fallback that also resolves the nadir tilt-
//              direction ambiguity toward screen-up. Omit it and the
//              degenerate case falls back to skipping pitch (legacy
//              behaviour) — which leaves tilt dead at exact nadir.
//
// Output:
//   { pos, lookTarget, R }. `pos`/`lookTarget` are both THREE.Vector3;
//   `pos` equals `camPos` in the rotate-in-place case (centre coincident
//   with camera → zero offset → unrotated).
//   R        — the world-frame rotation quaternion applied this step
//              (THREE.Quaternion). Apply to camera orientation with
//              camera.quaternion.premultiply(R) for a singularity-free,
//              roll-preserving update. pos/lookTarget are the same
//              rotation expressed positionally and are kept for callers
//              that still need an explicit look target.
//
// Tilt clamp: the pitch is reduced so the resulting view tilt stays in
// [MIN_TILT_DEGREES, MAX_TILT_DEGREES]. The same clamped pitch drives
// both position and view, so they stay consistent.
//
// Optional `floorY` adds a reversible underground guard for the Map-orbit
// regime (KD-29). The constraint is on the RESULTING camera
// height (`pos.y >= floorY + EYE_MARGIN_METRES`), not on view-tilt —
// `shiftRotateStep`'s pivot sits under the cursor (not screen-centre), so
// view-tilt and the position-elevation angle are decoupled and the clean
// asin→tilt substitution is only exact when the camera looks along the
// offset. We therefore clamp on `pos.y` by numerically tightening the
// down-tilt input bound (capping the *input* tilt, so over-drag past the
// floor never accumulates → reversing the drag retraces exactly). The
// street regime (rotate-in-place) passes no `floorY`.
export const shiftRotateStep = (() => {
  // closure-private scratch, lazily allocated on first call
  let srsView, srsRight, worldUp;
  // Interior evalAtTilt scratch — pure-local temps fully consumed within one
  // evalAtTilt call, never escaping (offset, the rotated view, the normalised
  // pitch axis, the pitch quaternion), plus the interior POSE buffers the
  // throwaway floor-probe candidate and every bisection iteration write into
  // (only their `.pos.y` is read, immediately). All pooled: the whole
  // re-entrant bisection allocates nothing.
  let srsOffset, srsNewView, srsPitchAxis, srsQPitch, srsIPos, srsILook, srsIR;
  return function shiftRotateStep({
    camPos,
    viewDir,
    centre,
    dxPx,
    dyPx,
    speed,
    floorY,
    camRight,
    // Optional caller-owned targets for the single escaping final pose (the
    // three.js `crossVectors(a, b, target)` idiom — the scratch convention at
    // the top of this file: escaping returns take a caller-owned target). Pass
    // ALL THREE or NONE, and each must be a distinct object; `outPos` must NOT
    // be the same object as `camPos`. When omitted (e.g. unit tests) the final
    // pose is freshly allocated, so returned poses are independent objects.
    outPos,
    outLookTarget,
    outR
  }) {
    // The bisection's interior temps used to stay freshly allocated on the
    // theory that pooling a re-entrant bisection's temps risked aliasing for a
    // near-zero saving. The steady-state allocation measurement falsified the
    // "near-zero": this one function was ~90% of the recurring per-frame THREE
    // allocation on the shift-orbit path. The aliasing concern is real but
    // manageable — the bisection is SEQUENTIAL, not recursive, and every
    // interior result is consumed (`.pos.y`) before the next overwrites it — so
    // the interior temps are now pooled closure scratch (below), and only the
    // single accepted final pose escapes, via a caller-owned target.
    if (!srsView) {
      srsView = new THREE.Vector3();
      srsRight = new THREE.Vector3();
      worldUp = Object.freeze(new THREE.Vector3(0, 1, 0));
      srsOffset = new THREE.Vector3();
      srsNewView = new THREE.Vector3();
      srsPitchAxis = new THREE.Vector3();
      srsQPitch = new THREE.Quaternion();
      srsIPos = new THREE.Vector3();
      srsILook = new THREE.Vector3();
      srsIR = new THREE.Quaternion();
    }
    const view = srsView.set(viewDir.x, viewDir.y, viewDir.z).normalize();

    // (1) Yaw about world up.
    const dTheta = -dxPx * speed;

    // (2) Pitch about the camera's horizontal right axis. `view × up` is
    //     horizontal and perpendicular to the view azimuth, so a rotation
    //     about it by β changes the view tilt by exactly −β regardless of
    //     the current tilt. At *exact* nadir `view ∥ up` so `view × up` → 0
    //     and the horizontal heading is undefined; fall back to the camera's
    //     own screen-right axis (camRight), which is well-defined and
    //     horizontal there. This is what lets you tilt *out* of exact nadir
    //     (KD-28) — without it the pitch term is skipped and tilt is dead
    //     at top-down. Off-nadir, `view × up` is well-defined and used as
    //     before (no behaviour change).
    const right = srsRight.crossVectors(view, worldUp);
    let rightLen = right.length();
    if (rightLen <= 1e-6 && camRight) {
      right.set(camRight.x, camRight.y, camRight.z);
      rightLen = right.length();
    }

    const curTilt = Math.asin(THREE.MathUtils.clamp(-view.y, -1, 1));
    const MIN_TILT = MIN_TILT_DEGREES * DEG2RAD;
    const MAX_TILT = MAX_TILT_DEGREES * DEG2RAD;
    const wantTilt = curTilt + dyPx * speed; // drag-down (+dyPx) → tilt down
    let clampedTilt = THREE.MathUtils.clamp(wantTilt, MIN_TILT, MAX_TILT);

    // Build the rotated pose for a candidate absolute tilt value into the
    // caller-supplied buffers (pos, look, r), applying the SAME single
    // rotation R to the offset and the view dir. Every temp is pooled
    // closure scratch; `right`/`rightLen` are the raw `view × up` cross
    // product and its length, read-only for the whole call INCLUDING every
    // bisection iteration (each call re-derives `r = right / rightLen`) — do
    // not normalise `srsRight` in place; `srsPitchAxis` is a distinct buffer.
    const evalAtTilt = (tiltValue, pos, look, R) => {
      const dTilt = tiltValue - curTilt;
      R.setFromAxisAngle(worldUp, dTheta);
      if (rightLen > 1e-6 && dTilt !== 0) {
        const axis = srsPitchAxis.copy(right).multiplyScalar(1 / rightLen);
        const qPitch = srsQPitch.setFromAxisAngle(axis, -dTilt);
        R.multiply(qPitch);
      }
      const offset = srsOffset
        .set(camPos.x - centre.x, camPos.y - centre.y, camPos.z - centre.z)
        .applyQuaternion(R);
      pos.set(centre.x + offset.x, centre.y + offset.y, centre.z + offset.z);
      const newView = srsNewView.copy(view).applyQuaternion(R);
      look.set(pos.x + newView.x, pos.y + newView.y, pos.z + newView.z);
      // R is returned so the caller can apply it via
      // `camera.quaternion.premultiply(R)` (KD-28 — continuous at nadir),
      // instead of re-deriving orientation from lookTarget via lookAt.
      return { pos, lookTarget: look, R };
    };

    // Numeric down-tilt floor bound (KD-29). Tilting further down
    // (larger tilt) on an above-pivot orbit lowers the camera. If the wanted
    // tilt would dip `pos.y` below `floorY + EYE_MARGIN`, bisect between the
    // current tilt (known clear — the camera is there now, presumed legit)
    // and the wanted tilt to find the lowest input tilt that keeps the
    // resulting height at or above the bound.
    if (floorY != null && isFinite(floorY) && clampedTilt > curTilt) {
      const bound = floorY + EYE_MARGIN_METRES;
      // Probe into the pooled interior buffers — only `.pos.y` is read, and
      // immediately, before the next evalAtTilt overwrites them.
      const candidate = evalAtTilt(clampedTilt, srsIPos, srsILook, srsIR);
      if (candidate.pos.y < bound) {
        // Tilting down breaches the floor. Bisect [curTilt, clampedTilt].
        let lo = curTilt; // assumed to clear the bound (current pose)
        let hi = clampedTilt; // breaches the bound
        for (let i = 0; i < 24; i++) {
          const mid = (lo + hi) / 2;
          if (evalAtTilt(mid, srsIPos, srsILook, srsIR).pos.y >= bound) {
            lo = mid;
          } else hi = mid;
        }
        clampedTilt = lo;
      }
    }

    // Merge (KD-28 × KD-29): evalAtTilt applies the same single
    // rotation R to the offset and view and now returns it, so the
    // floor-bounded `clampedTilt` yields a consistent { pos, lookTarget, R }.
    // The caller applies R via `premultiply` (continuous at nadir). This is the
    // single accepted final pose that escapes: write it into the caller-owned
    // targets, or freshly allocate independent objects when none were supplied.
    return evalAtTilt(
      clampedTilt,
      outPos || new THREE.Vector3(),
      outLookTarget || new THREE.Vector3(),
      outR || new THREE.Quaternion()
    );
  };
})();

// ---------------------------------------------------------------------------
// Final zoom polish helpers (pure).
// ---------------------------------------------------------------------------

// Per-tick horizontal lurch cap (KD-15). Scales with height above ground so
// the lurch is bounded proportionally rather than by a fixed metre value; a
// lower bound keeps it usable near the ground and on the no-AGL Ctrl+wheel /
// out-of-bounds path (where `yAgl` is non-finite). Pure.
export function lateralCap(yAgl, lowerBound, coeff) {
  if (!Number.isFinite(yAgl)) return lowerBound;
  return Math.max(lowerBound, coeff * yAgl);
}

// Swoop FOV as a PURE FUNCTION OF HEIGHT (KD-12), both legs. FOV eases from
// `narrowFov` (at/above the ceiling) to the landing FOV (at the floor),
// back-loaded into the final stretch by the exponent so the "opening up" reads
// as an arrival rather than rushing at the top of the descent.
//   wide = max(narrowFov, landingFov) — an already-wide camera never NARROWS.
//   open = (1 − heightFrac)^exponent  — 0 at the ceiling, 1 at the floor.
//   FOV  = narrowFov + (wide − narrowFov)·open.
// Because it is a pure function of height, the descent (narrow = entry FOV) and
// an immediate-undo ascent (narrow = captured entry FOV) evaluate the SAME
// curve at the same height → exact retrace, with no anchor and no jump if the
// ascent starts mid-band. A cleared-memory ascent passes the default map FOV as
// `narrowFov` (eases to the default by the ceiling). Pure.
export function swoopLandingFov(yAgl, narrowFov, landingFov, exponent) {
  const wide = Math.max(narrowFov, landingFov);
  const open = Math.pow(1 - phase2HeightFrac(yAgl), exponent);
  return narrowFov + (wide - narrowFov) * open;
}

// Decide the Phase-2-band zoom-IN regime from the resolved cursor anchor
// (KD-14). Break out of the swoop ('dolly') ONLY when the user is craning UP at
// something they can't land on and clearly want to approach — a solid building
// WALL/façade, or open sky/horizon. In EVERY other case continue the 'swoop':
//   - looking DOWN or level → always 'swoop' (you are descending; a façade or
//     sky the cursor grazes on the way down must not abort the descent — this
//     is the refinement: only an *upward* look at a façade breaks
//     out, a downward look keeps swooping);
//   - looking up at scatter (car/tree/sign — not a solid floor) → 'swoop'
//     (scatter must never break the swoop);
//   - looking up at ground/rooftop (near-horizontal) → 'swoop'.
// Only `lookingUp AND (open sky OR a solid near-vertical wall)` breaks out.
// `Math.abs(normalY)`: an up/down-facing horizontal surface both read as
// non-wall; a wall's normalY ≈ 0 → slope ≈ 90°. Pure.
export function classifySwoopTickTarget({
  source,
  normalY,
  isSolidFloor,
  lookingUp
}) {
  if (!lookingUp) return 'swoop'; // descending / level → always swoop
  if (source === 'fallback') return 'dolly'; // up at open sky/horizon
  if (source === 'ground') return 'swoop';
  if (normalY == null) return 'swoop';
  const slopeDeg =
    Math.acos(THREE.MathUtils.clamp(Math.abs(normalY), 0, 1)) * RAD2DEG;
  if (isSolidFloor && slopeDeg >= BLOCK_SLOPE_MIN_DEGREES) return 'dolly';
  return 'swoop';
}

// The broke-out dolly is a BOUNDED EXCURSION (KD-14), implemented directly in
// ExperimentalControls' continuous drain loop as a float dolly-depth that
// zoom-out unwinds before resuming the swoop — there is no separate pure
// decision helper under the continuous model.

// Re-aim continuity weight (KD-13; fade band TH-34→TH-35). 1 for near cursor targets, ramps
// linearly to 0 by `far`, so the cursor-lock re-aim magnitude falls to zero
// continuously as the target recedes toward the horizon — no jump crossing
// into the no-real-hit fallback at the rooftop/sky edge. Pure.
export function reaimWeight(distance, near, far) {
  if (!Number.isFinite(distance)) return 0;
  return THREE.MathUtils.clamp((far - distance) / (far - near), 0, 1);
}

// Cursor-lock re-aim quaternion (KD-13; pure, extracted for unit testing).
// Given the captured baseline orientation/fov and the cursor world point P,
// returns the camera quaternion that, at `fovAfter`, holds P pinned under the
// cursor pixel `ndc`. Computed ABSOLUTELY from the baseline (not composed
// per-tick) so it is a pure function of fov → exactly reversible, and reduces
// to `baselineQuat` at fovAfter === baselineFov (the unwind contract).
//
// `weight` scales the minimal-arc rotation via slerp from identity (NOT a
// direction lerp — that would change the rotation axis with the weight and
// break reversibility). Builds a throwaway PerspectiveCamera internally so it
// needs no live scene. Returns a new THREE.Quaternion.
export function reaimQuatForFov({
  baselineQuat,
  ndc,
  P,
  camPos,
  fovAfter,
  aspect,
  weight = 1
}) {
  const cam = new THREE.PerspectiveCamera(fovAfter, aspect, 0.1, 1000);
  cam.position.set(camPos.x, camPos.y, camPos.z);
  cam.quaternion.copy(baselineQuat);
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), cam);
  const rayDir = ray.ray.direction.clone().normalize();
  const toP = new THREE.Vector3(
    P.x - camPos.x,
    P.y - camPos.y,
    P.z - camPos.z
  ).normalize();
  const fullArc = new THREE.Quaternion().setFromUnitVectors(rayDir, toP);
  const delta = new THREE.Quaternion().identity().slerp(fullArc, weight);
  return delta.multiply(baselineQuat).normalize();
}

// The point where the camera's view-direction ray meets the ground plane y=0,
// or null if it points at/above the horizon. Pure given the camera position +
// unit view direction. Shared by the Map-orbit pivot and the compass plan-view
// pivot, so it lives here rather than on either controller.
//
// Rejects a non-forward intersection: if the camera sits below y=0 (camPos.y <
// 0), t is negative and the plane meets the ray *behind* the camera. Returning
// that point would make callers orbit/anchor on a behind-camera pivot (a fling).
// t <= 0 → null; callers fall back to their no-pivot path (KD-26/KD-02).
export function viewRayGroundPoint(camPos, fwd) {
  if (fwd.y >= -1e-4) return null;
  const t = camPos.y / -fwd.y; // along-ray distance to y=0
  if (t <= 0) return null;
  return new THREE.Vector3(camPos.x + fwd.x * t, 0, camPos.z + fwd.z * t);
}
