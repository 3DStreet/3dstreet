// Single source-of-truth knobs for the experimental nav-controls system.
// See claude/specs/001-phase-1-plan.md.

// Minimum tilt from horizontal, in degrees, enforced by Shift+LB tilt drag.
// Phase 2 will lower or remove this floor; until then it lives here as a
// single named export so the change is one edit.
export const MIN_TILT_DEGREES = 30;

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

// Shift+LB rotation speed (radians per pixel). Matches the Phase-0
// EditorControls feel.
export const ROTATION_SPEED_RAD_PER_PX = 0.0035;

// WASD horizontal motion: speed = clamp(camera height * factor, MIN, MAX).
export const WASD_SPEED_HEIGHT_FACTOR = 1.0; // m/s per metre of altitude
export const WASD_MIN_SPEED = 5; // m/s
export const WASD_MAX_SPEED = 500; // m/s
// Acceleration ramp-up: time (ms) to reach the target speed from rest
// while a key is held. Release of all keys snaps velocity to zero
// instantly (no deceleration ramp). Tune from feel.
export const WASD_RAMP_UP_MS = 200;

// Plan View transition.
export const PLAN_VIEW_DURATION_MS = 1000;
