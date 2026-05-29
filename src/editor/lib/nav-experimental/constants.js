// Single source-of-truth knobs for the experimental nav-controls system.
// See claude/specs/001-phase-1-plan.md.

// Tilt clamps (degrees from horizontal). Positive = looking down,
// negative = looking up. Phase 2 lowered MIN to -89 so the user can pitch
// up to look at buildings; MAX = +89 mirrors the floor on the down side
// and keeps `lookAt` numerically stable just shy of the spherical
// singularity.
export const MIN_TILT_DEGREES = -89;
export const MAX_TILT_DEGREES = 89;

// TASK-010: the single tilt threshold T (degrees below horizontal) that
// governs ALL four tilt-conditional behaviours — the LB truck/dolly-vs-
// pedestal sub-mode, the wheel cursor-anchored-vs-dolly cut, the rotation
// regime (Map orbit above T vs rotate-in-place below T), and the
// letterbox mode indicator. This is the *default* for T; the live value
// is held on the controls instance (`_tiltThreshold`) and is overridable
// at runtime via the `nav-experimental-tuning` A-Frame component (D2).
// Cut is on absolute angle from horizontal — looking up by any amount is
// below T. Lowered from the old 30° to 18° per the mid-project review.
export const TILT_THRESHOLD_DEFAULT_DEGREES = 18;

// TASK-010 (D4): underground guard floor for the Map-mode orbit. A
// Map-orbit around a ground-level pivot can swing the camera below
// ground (the decoupled rotation clamps the *view*, not the *position*);
// `applyGroundFloor` keeps the camera at or above this absolute y.
// Absolute-y for now — AGL is TASK-013's job.
export const ROTATION_GROUND_FLOOR_METRES = 0.5;

// TASK-010 (D5): minimum orbit radius. A very-close cursor pivot (only
// reachable while staying in Map mode via Ctrl+wheel swoop-bypass) makes
// the orbit twitchy; clamp the pivot out to at least this distance.
export const MIN_ORBIT_RADIUS_METRES = 2;

// TASK-010: cap on the Map-mode orbit radius. `worldPointAt` returns a
// `'ground'` hit up to MAX_GROUND_DIST (2000m) for a slightly-down
// cursor ray, so a distant ground pivot would give a multi-kilometre
// lever arm and the orbit would feel like the whole world swinging.
// Clamp the pivot in along the view ray to this distance. Feel-tunable.
export const MAX_ORBIT_RADIUS_METRES = 100;

// TASK-010 (D3): rotation-centre ring indicator's apparent on-screen
// size, as a fraction of the camera→pivot distance. The billboard mesh
// is scaled by `distance × this` each frame so it holds a roughly
// constant size on screen as the camera orbits. Feel-tunable.
export const RING_SCREEN_FRACTION = 0.04;

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
