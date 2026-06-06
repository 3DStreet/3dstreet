/* global THREE */

// Phase 2 pure-math helpers for `ExperimentalControls`. Lifted out of the
// class so each piece can be unit-tested without instantiating an
// A-Frame scene. See claude/specs/001-phase-2-plan.md.

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
  lastBlocked
}) {
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

// TASK-024a (DEC-A/DEC-B): pure vertical rule for a WASD follow/step-up step.
// Returns the new camera y.
//   grounded (or H == null) -> collision-follow (`wasdFollowY`): walking hugs
//     the surface directly, NOT rate-limited (terrain follow is immediate).
//   not-grounded            -> "option 3": ease toward the absolute cruise
//     target `max(H, collisionFloorDest + eye)`, rate-limited per tick.
//
// The 3-way toggle and options 1 & 2 are RETIRED (live A/B: they jumped the
// camera by the full building height when crossing onto a footprint). Option 3
// is the sole flying behaviour: the forward ray blocks approach to any building
// taller than flight height, so the clamp only ever lifts ≤ eye-margin.
//
// DEC-B — the vertical move is ANIMATED in BOTH directions. Rather than snap
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
// `grounded` (terrain rising must not ground, D1/H3).
//
// TASK-024a (solid-geometry guard): `destFloorHit` is false when the
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
  // Not grounded: ease toward the option-3 absolute target, rate-limited.
  const target = Math.max(H, collisionFloorDestY + eyeMargin);
  const maxStep = rateMps * dtSeconds;
  const delta = THREE.MathUtils.clamp(target - camY, -maxStep, maxStep);
  const eased = camY + delta;
  // Hard safety floor: never clip the roof mid-ease.
  return Math.max(eased, collisionFloorDestY);
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

// TASK-014d (D-P1/D-P2): one wheel-zoom dolly step toward a fixed `hit`,
// with the HORIZONTAL component of the translation capped to
// `lateralCapMetres`. Returns the NEW camera position (THREE.Vector3), or
// `null` if the step is non-finite (the caller then falls through to the
// level-forward fallback).
//
// Step shape (matches _applyAnchoredDollyStep's algebra, re-expressed as a
// translation): newPos = hit + factor·(camPos − hit), i.e.
//   step = newPos − camPos = (1 − factor)·(hit − camPos).
// factor = (1 − alpha) for zoom-in (sign<0, step toward hit) and
// 1/(1 − alpha) for zoom-out (sign>0, step away from hit).
//
// The cap acts on the HORIZONTAL part h = hypot(step.x, step.z) (spec
// Decision 5 — NOT |step|), and when it fires it scales the WHOLE vector
// (x, y, z together) by lateralCapMetres / h. This preserves the H:V ratio
// so the move stays on the camera→hit ray — just shorter — keeping the
// target locked under the cursor and reversibility exact. A straight-down
// step has h ≈ 0 so the cap never fires (full exponential descent survives).
//
// Reversibility: the applied cap is `±(cap/H)·(hit − camPos)` where
// H = hypot((hit−camPos).xz) is a pure function of camera position about a
// FIXED hit, so each elementary step is position-invertible about hit; an
// in/out pair on the same side of the cap threshold composes to identity.
// Pure.
export function cappedDollyStep({
  camPos,
  hit,
  sign,
  alpha,
  factor,
  lateralCapMetres
}) {
  // TASK-014a (#6 Option B merge): accept a precomputed CONTINUOUS `factor`
  // (from dollyFactorForTicks) for the fractional single-drain path; fall back
  // to the per-whole-tick factor from sign+alpha for the swoop hand-off
  // callers. Either way the lateral-cap algebra below is identical.
  const f = factor != null ? factor : sign < 0 ? 1 - alpha : 1 / (1 - alpha);
  const oneMinusFactor = 1 - f;
  let stepX = oneMinusFactor * (hit.x - camPos.x);
  let stepY = oneMinusFactor * (hit.y - camPos.y);
  let stepZ = oneMinusFactor * (hit.z - camPos.z);

  const h = Math.hypot(stepX, stepZ);

  // Non-finite guard (AR #2): a near-parallel grazing ray (now reachable
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

  return new THREE.Vector3(
    camPos.x + stepX,
    camPos.y + stepY,
    camPos.z + stepZ
  );
}

// TASK-014d (D-P5): level-forward synthetic anchor for the no-real-hit
// wheel-zoom case (cursor ray hit nothing — open sky). Returns a point
// `dist` metres ahead of the camera along its YAW HEADING (forward
// projected to horizontal), held at the camera's OWN y so the resulting
// dolly is level — zoom-in advances forward at constant height instead of
// drifting up into empty sky (which would read as zoom-out).
//
// Uses the yaw heading (not raw camera-forward) so it stays well-defined at
// any pitch: looking near-vertically, forward.xz → 0 and a forward-based
// "ahead" would be degenerate/jittery. Returns `null` only when the
// horizontal heading is genuinely undefined (|forward.xz| < 1e-6 — true
// vertical), which the ±89° tilt clamp prevents in live use; the caller
// no-ops that tick. Pure.
export function levelForwardAnchor(camera, dist) {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  const h = Math.hypot(fwd.x, fwd.z);
  if (h < 1e-6) return null; // near-straight-up/down: yaw undefined
  const dirX = fwd.x / h;
  const dirZ = fwd.z / h;
  const camPos = camera.position;
  return new THREE.Vector3(
    camPos.x + dirX * dist,
    camPos.y, // level: hold the camera's own height
    camPos.z + dirZ * dist
  );
}

// ── TASK-014a (#6 Option B): wheel input-plumbing pure helpers ──────────

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

// TASK-022: Phase-2 height fraction. 1 at the ceiling (AGL 20), 0 at the
// floor (AGL 1.5), clamped outside the band. Single source of truth for
// the descent tilt, the ascent tilt, and (future) the 014b FOV ramp. Pure.
export function phase2HeightFrac(yAgl) {
  const yHi = SWOOP_PHASE2_ENTRY_ELEVATION_METRES; // 20
  const yLo = SWOOP_PHASE2_EXIT_ELEVATION_METRES; // 1.5
  return THREE.MathUtils.clamp((yAgl - yLo) / (yHi - yLo), 0, 1);
}

// Phase 2 (descent / swoop-IN) tilt lerp: θ(yAgl) = θ_stored × frac, where
// frac = phase2HeightFrac(yAgl). Linear in AGL from θ_stored at AGL=20 to
// 0° at AGL=1.5. Both ends inclusive. Outside the Phase 2 band the helper
// clamps: AGL ≥ 20 → θ_stored; AGL ≤ 1.5 → 0°. Input is AGL (TASK-013).
// Pure. TASK-022: routed through phase2HeightFrac so the descent and the
// swoop-OUT ascent (phase2AscentTilt) read the SAME frac at the SAME
// height — the C1 reverse can't drift by a ULP at the band boundaries.
// Numerically identical to the old inline `(yAgl - yLo)/(yHi - yLo)` form.
export function phase2TargetTilt(yAgl, storedTiltDeg) {
  return storedTiltDeg * phase2HeightFrac(yAgl);
}

// TASK-022: swoop-OUT Phase-2 tilt. Linear in height fraction, anchored
// through (startFrac, startTilt) captured when this ascent began and
// (1, targetTilt) at the ceiling. frac = phase2HeightFrac(yAgl): 1 at the
// ceiling (AGL 20), 0 at the floor (AGL 1.5). Reaches startTilt at the
// start height (no jump — WE-5) and target at the ceiling. Pure.
//
// For the immediate-undo case (startFrac=0, startTilt=0, target=entryTilt)
// this reduces to `entryTilt × frac` — the SAME curve phase2TargetTilt
// drew on the way down, so the ascent retraces the descent exactly (C1).
// The general anchored form handles the interrupted / default case (started
// mid-band at an arbitrary startTilt/startFrac, target = default 60°).
// There is exactly ONE formula; immediate-undo is its startFrac=startTilt=0
// special case (no separate "ease onto rail" branch).
export function phase2AscentTilt(yAgl, startFrac, startTilt, targetTilt) {
  const frac = phase2HeightFrac(yAgl);
  if (startFrac >= 1) return targetTilt;
  const t = THREE.MathUtils.clamp((frac - startFrac) / (1 - startFrac), 0, 1);
  return startTilt + (targetTilt - startTilt) * t;
}

// TASK-022: zoom-undo state reducer. Pure. `state` is {valid, tilt, fov};
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
  floorY,
  camRight
}) {
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  const view = new THREE.Vector3(viewDir.x, viewDir.y, viewDir.z).normalize();

  // (1) Yaw about world up.
  const dTheta = -dxPx * speed;

  // (2) Pitch about the camera's horizontal right axis. `view × up` is
  //     horizontal and perpendicular to the view azimuth, so a rotation
  //     about it by β changes the view tilt by exactly −β regardless of
  //     the current tilt. At *exact* nadir `view ∥ up` so `view × up` → 0
  //     and the horizontal heading is undefined; fall back to the camera's
  //     own screen-right axis (camRight), which is well-defined and
  //     horizontal there. This is what lets you tilt *out* of exact nadir
  //     (TASK-023) — without it the pitch term is skipped and tilt is dead
  //     at top-down. Off-nadir, `view × up` is well-defined and used as
  //     before (no behaviour change).
  const right = new THREE.Vector3().crossVectors(view, WORLD_UP);
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
    // R is returned so the caller can apply it via
    // `camera.quaternion.premultiply(R)` (TASK-023 — continuous at nadir),
    // instead of re-deriving orientation from lookTarget via lookAt.
    return { pos, lookTarget, R };
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

  // Merge (TASK-023 × TASK-024): evalAtTilt applies the same single
  // rotation R to the offset and view and now returns it, so the
  // floor-bounded `clampedTilt` yields a consistent { pos, lookTarget, R }.
  // The caller applies R via `premultiply` (continuous at nadir).
  return evalAtTilt(clampedTilt);
}

// ---------------------------------------------------------------------------
// TASK-027 — final zoom polish helpers (pure).
// ---------------------------------------------------------------------------

// Part F — per-tick horizontal lurch cap. Scales with height above ground so
// the lurch is bounded proportionally rather than by a fixed metre value; a
// lower bound keeps it usable near the ground and on the no-AGL Ctrl+wheel /
// out-of-bounds path (where `yAgl` is non-finite). Pure.
export function lateralCap(yAgl, lowerBound, coeff) {
  if (!Number.isFinite(yAgl)) return lowerBound;
  return Math.max(lowerBound, coeff * yAgl);
}

// Part A — swoop FOV as a PURE FUNCTION OF HEIGHT (both legs). FOV eases from
// `narrowFov` (at/above the ceiling) to the landing FOV (at the floor),
// back-loaded into the final stretch by the exponent so the "opening up" reads
// as an arrival rather than rushing at the top of the descent (live-test #2).
//   wide = max(narrowFov, landingFov) — an already-wide camera never NARROWS.
//   open = (1 − heightFrac)^exponent  — 0 at the ceiling, 1 at the floor.
//   FOV  = narrowFov + (wide − narrowFov)·open.
// Because it is a pure function of height, the descent (narrow = entry FOV) and
// an immediate-undo ascent (narrow = captured entry FOV) evaluate the SAME
// curve at the same height → exact retrace, with no anchor and no jump if the
// ascent starts mid-band. A cleared-memory ascent passes the default map FOV as
// `narrowFov` (C2 — eases to the default by the ceiling). Pure.
export function swoopLandingFov(yAgl, narrowFov, landingFov, exponent) {
  const wide = Math.max(narrowFov, landingFov);
  const open = Math.pow(1 - phase2HeightFrac(yAgl), exponent);
  return narrowFov + (wide - narrowFov) * open;
}

// Part C — decide the Phase-2-band zoom-IN regime from the resolved cursor
// anchor. Break out of the swoop ('dolly') ONLY when the user is craning UP at
// something they can't land on and clearly want to approach — a solid building
// WALL/façade, or open sky/horizon. In EVERY other case continue the 'swoop':
//   - looking DOWN or level → always 'swoop' (you are descending; a façade or
//     sky the cursor grazes on the way down must not abort the descent — this
//     is the live-test #2 refinement: only an *upward* look at a façade breaks
//     out, a downward look keeps swooping);
//   - looking up at scatter (car/tree/sign — not a solid floor) → 'swoop'
//     (live-test #1: scatter must never break the swoop);
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

// Part C-add-2 ("B": a broke-out dolly is a BOUNDED EXCURSION) is implemented
// directly in ExperimentalControls' continuous drain loop (TASK-014a) as a
// float dolly-depth that zoom-out unwinds before resuming the swoop — there is
// no separate pure decision helper under the continuous model.

// Part B (M4) — re-aim continuity weight. 1 for near cursor targets, ramps
// linearly to 0 by `far`, so the cursor-lock re-aim magnitude falls to zero
// continuously as the target recedes toward the horizon — no jump crossing
// into the no-real-hit fallback at the rooftop/sky edge. Pure.
export function reaimWeight(distance, near, far) {
  if (!Number.isFinite(distance)) return 0;
  return THREE.MathUtils.clamp((far - distance) / (far - near), 0, 1);
}

// Part B — cursor-lock re-aim quaternion (pure; extracted for unit testing).
// Given the captured baseline orientation/fov and the cursor world point P,
// returns the camera quaternion that, at `fovAfter`, holds P pinned under the
// cursor pixel `ndc`. Computed ABSOLUTELY from the baseline (not composed
// per-tick) so it is a pure function of fov → exactly reversible, and reduces
// to `baselineQuat` at fovAfter === baselineFov (the B.3 unwind contract).
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
