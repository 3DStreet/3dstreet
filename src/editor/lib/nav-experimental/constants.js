// Single source-of-truth knobs for the experimental nav-controls system.
// See claude/specs/001-phase-1-plan.md.

// Tilt clamps (degrees from horizontal). Positive = looking down,
// negative = looking up. Phase 2 lowered MIN to -89 so the user can pitch
// up to look at buildings; MAX = +89 mirrors the floor on the down side
// and keeps `lookAt` numerically stable just shy of the spherical
// singularity.
export const MIN_TILT_DEGREES = -89;
export const MAX_TILT_DEGREES = 89;

// Phase 2: 30° hard-cut between truck/dolly (>30° down) and truck/pedestal
// (everything else). Cut is on absolute angle from horizontal — looking
// up by any amount is pedestal mode.
export const TRUCK_PEDESTAL_CUTOFF_DEGREES = 30;

// Phase 2: angular blend zone (in degrees below horizontal) for the
// rotation-center lerp between Rule 1 (screen-center hit) and Rule 2/3.
export const ROTATION_BLEND_LOW_DEGREES = 20;
export const ROTATION_BLEND_HIGH_DEGREES = 30;

// Phase 2: Rule 2 (diorama-center) rotation-center y-coordinate. Eye
// height rather than ground (y=0) so a Shift+LB tilt-up gesture at street
// level orbits around a point above the ground and the camera doesn't
// arc underground. Assumes flat ground at y=0; non-pedestrian scene
// scales (drone/satellite) would need a scene-aware override.
export const ROTATION_CENTER_EYE_HEIGHT_METRES = 1.5;

// Phase 2: scene-edge feathering width in metres. Smoothstep from Rule
// 3 (inside the scene AABB, rotate-in-place) to Rule 2 (outside,
// diorama center) over a feather zone extending outward from the AABB
// boundary by this many metres. Constant in absolute units (rather
// than a fraction of scene size) because the user-perceived "I am
// outside the scene" distance is human-scale, not scene-scale —
// dropping it to ~0.5m on a 5m-wide street feels jumpy, scaling it up
// to 10m on a city scene feels mushy. 5m is the initial pick; tune
// from feel.
export const SCENE_FEATHER_METRES = 5;

// Wheel zoom: each "wheel-tick of budget" moves the camera by this fraction
// of the current camera-to-anchor distance. Sign is applied by the caller.
export const ZOOM_PER_WHEEL_TICK = 0.1;

// deltaY-to-tick conversion. Mice send ~100 per detent; trackpads send
// ~1-4 per event. We accumulate raw deltaY (deltaMode-aware) into a budget
// drained at WHEEL_BUDGET_PER_TICK_UNITS per wheel tick.
export const WHEEL_BUDGET_PER_TICK_UNITS = 100;
// Cap how much budget a single A-Frame tick can consume. Higher = more
// wheel responsiveness; lower = smoother but less reactive.
export const WHEEL_MAX_TICKS_PER_FRAME = 10;
// Hard cap on accumulated wheel budget. Without this, a trackpad burst
// or inertial scroll piles up budget that keeps draining for hundreds of
// ms after the user stops, feeling like queued/blocking inputs. Cap to
// one frame's drain capacity so the camera always reaches its target
// within the next frame.
export const WHEEL_MAX_BUDGET =
  WHEEL_MAX_TICKS_PER_FRAME * WHEEL_BUDGET_PER_TICK_UNITS;

// LB pan gesture: cap on how far the camera can translate per mousemove
// event, in metres. Guards against absurd anchor solutions (numerically
// degenerate ground-plane intersections at low tilt).
export const LB_PAN_MAX_STEP_METRES = 5000;

// cursorAnchor.worldPointAt fallback chain (Phase 1):
//   Step 2 caps the ground-plane intersection distance at this many metres
//     to reject grazing rays that would anchor far out of scene scope.
//   Step 3 returns a fixed point this many metres along the camera's
//     forward direction when both scene-mesh raycast and ground-plane
//     intersection miss.
// Also used as the synthetic-anchor depth for the tilt-conditional
// wheel-zoom's low-tilt branch (per `001-tilt-conditional-zoom.md`):
// `pos + cameraForward * FALLBACK_FORWARD_DIST` is the "hit" point fed
// into the existing orbit-step math, giving a 3m-per-tick forward dolly
// (ZOOM_PER_WHEEL_TICK × FALLBACK_FORWARD_DIST).
export const MAX_GROUND_DIST = 2000;
export const FALLBACK_FORWARD_DIST = 30;

// Shift+LB rotation speed (radians per pixel). Matches the Phase-0
// EditorControls feel.
export const ROTATION_SPEED_RAD_PER_PX = 0.0035;

// WASD horizontal motion: speed = clamp(camera height * factor, MIN, MAX).
// At y ≥ MIN_SPEED metres: speed = altitude (linear scaling).
// At y < MIN_SPEED metres: speed = MIN_SPEED (constant floor).
// MIN raised from 5 to 10 on 2026-05-11 per user feel-test request:
// at street level (~1.6m) the previous 5m/s was too slow; 10m/s ≈ urban
// driving pace gets you across a block in a reasonable time. High
// altitudes unchanged (the linear scaling above y=10 still gives the
// same speeds).
export const WASD_SPEED_HEIGHT_FACTOR = 1.0; // m/s per metre of altitude
export const WASD_MIN_SPEED = 10; // m/s
export const WASD_MAX_SPEED = 500; // m/s
// Acceleration ramp-up: time (ms) to reach the target speed from rest
// while a key is held. Release of all keys snaps velocity to zero
// instantly (no deceleration ramp). Tune from feel.
export const WASD_RAMP_UP_MS = 200;

// Plan View transition.
export const PLAN_VIEW_DURATION_MS = 1000;

// Phase 3 "swoop" wheel-zoom boundaries (camera.position.y in metres).
// See claude/specs/001-phase-3-plan.md. Absolute-y for now; production
// needs to be ground-relative (AGL) — backlog item 2026-05-11.
// Entry raised from 10 → 20 on 2026-05-11 feel-test: triggering only
// below 10m felt too sudden — the user wants the descent to begin
// well before street level.
export const SWOOP_PHASE2_ENTRY_ELEVATION_METRES = 20;
export const SWOOP_PHASE2_EXIT_ELEVATION_METRES = 1.5;

// Phase 2 per-tick pedestal step: fraction of (current y - exit elevation)
// consumed per unit zoom-in tick. Matches ZOOM_PER_WHEEL_TICK in shape;
// kept as a separate constant so Phase 2 feel can be tuned independently
// of Phase 1's anchored dolly step.
// Bumped 0.10 → 0.20 on 2026-05-11 feel-test — descent felt too slow.
export const SWOOP_PHASE2_STEP = 0.2;

// Phase 2 per-frame drain cap (overrides WHEEL_MAX_TICKS_PER_FRAME inside
// the swoop transition only). Slows trackpad bursts so the transition
// reads as deliberate rather than instantaneous. Per H4 of the
// adversarial review, the cap is latched at the start of each frame's
// drain pass — see ExperimentalControls._drainWheel.
export const SWOOP_PHASE2_MAX_TICKS_PER_FRAME = 3;

// Phase 2 floor-snap: when zoom-in lands within this distance of
// SWOOP_PHASE2_EXIT_ELEVATION_METRES, snap to it. Eliminates the
// asymptotic stall near street level (H6 of the review). Also used as
// the zoom-out kick-start distance — see `_applyPhase2WheelTick`.
// Bumped 0.1 → 1.0 on 2026-05-11 feel-test — at 0.1 the asymptotic
// tail visibly stalled before snap fired.
export const SWOOP_PHASE2_FLOOR_SNAP_METRES = 1.0;

// Phase 3 FOV floor (degrees). Further zoom-in ticks at the floor are
// no-ops.
export const SWOOP_PHASE3_FOV_FLOOR_DEGREES = 15;
