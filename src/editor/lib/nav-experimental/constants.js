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

// TASK-024 — solid-geometry prevention & recovery. All metres / degrees.
// Starting values from the SPEC; tunable.
//
// Collision / clamps.
//   EYE_MARGIN_METRES — shared eye-height clearance above any solid floor,
//     used by the descent clamp, WASD follow / step-up, the orbit clamp,
//     and the fall/pop targets. == the TASK-013 AGL street floor (1.5 m).
export const EYE_MARGIN_METRES = 1.5;
// TASK-024a (D3): default not-grounded follow option. 1 = collision-follow
// (shipped behaviour-1); 2 = travel-follow; 3 = absolute. The live value is
// held on the controls (`_followOption`) and overridable at runtime via the
// `nav-experimental-tuning` component (`followOption`).
export const FOLLOW_OPTION_DEFAULT = 1;
// WASD forward-ray classifier (D1).
//   BLOCK_SLOPE_MIN_DEGREES — a forward-ray hit at/above this slope reads
//     as a near-vertical wall / façade / cliff (up-step block; down-step
//     hover when also tall).
export const BLOCK_SLOPE_MIN_DEGREES = 45;
//   BLOCK_HEIGHT_MIN_METRES — floor delta at/above which an up-step blocks
//     (vs steps up) and a down-step can hover. INDEPENDENT of
//     EYE_MARGIN_METRES (they merely share a 1.5 m starting value).
export const BLOCK_HEIGHT_MIN_METRES = 1.5;
//   WASD_CAMERA_RADIUS_METRES — forward-ray look-ahead pad so the wall is
//     seen one camera-radius before contact. NOT a corner-damping radius.
export const WASD_CAMERA_RADIUS_METRES = 0.5;
//   WASD_STEP_HYSTERESIS_METRES — block↔pass dead-band on the height
//     threshold only, so a façade tangent doesn't stutter.
export const WASD_STEP_HYSTERESIS_METRES = 0.3;
//   WASD_FACING_MIN — min dot(travelDir, -wallNormalH) for a forward hit
//     to count as a *facing* block (N3 tangent guard). A grazing skim has
//     its normal ~perpendicular to travel (dot ≈ 0) and must not block.
export const WASD_FACING_MIN = 0.35;
//   WASD_FACING_HYSTERESIS — once blocked, the facing-dot threshold drops by
//     this much so minor wobble while skimming a façade doesn't stutter
//     block↔pass (replaces the old height-delta hysteresis).
export const WASD_FACING_HYSTERESIS = 0.1;
// Enclosure probe (3a). Cast-down origin = camera.y + this margin.
//   Altitude assumption (D10e): no relevant solid overhead sits more than
//   this far above the camera.
export const ENCLOSURE_PROBE_UP_MARGIN_METRES = 500;
// Recovery tweens.
export const FALL_DURATION_MS = 600; // fall / swoop / gesture-end tween
export const POP_TO_ROOF_DURATION_MS = 400;
// Discoverability cue (D7) — show/hide hysteresis (a 2 m dead-band) so the
// cue doesn't strobe at the boundary. Keyed off height above the collision
// floor below.
export const DISCOVERABILITY_CUE_SHOW_METRES = 8;
export const DISCOVERABILITY_CUE_HIDE_METRES = 6;

// TASK-010 (D5): minimum orbit radius. A very-close cursor pivot (only
// reachable while staying in Map mode via Ctrl+wheel swoop-bypass) makes
// the orbit twitchy; clamp the pivot out to at least this distance.
export const MIN_ORBIT_RADIUS_METRES = 2;

// TASK-010 (D-LT-3): Map-mode rotation-pivot bounds radius. The bounds
// is a circle on the ground (y=0) CENTRED ON THE SCREEN-CENTRE GROUND
// POINT (where the view ray meets y=0 — also the fallback rotation
// centre):
//   • cursor's ground hit within this radius of the screen-centre point
//     → orbit the cursor's point.
//   • cursor over sky, or its hit beyond this radius → orbit the
//     screen-centre ground point itself.
// Both pivots are on the ground, so rotation visibly pivots a ground
// feature. Replaces the earlier MAX_ORBIT_RADIUS inward cap (which
// drifted on tilt, reports/010-testing.md #7) and corrects two wrong
// bounds centres tried along the way (camera nadir, camera position). The
// live value is held on the controls (`_mapPivotBoundsRadius`) and is
// overridable at runtime via the `nav-experimental-tuning` component (#6).
export const MAP_PIVOT_BOUNDS_RADIUS_METRES = 500;

// TASK-010 (D3): rotation-centre ring indicator's apparent on-screen
// size — the ring's radius as a fraction of the viewport's half-height.
// The billboard mesh world radius is set to
// `fraction × distance × tan(fov/2)` each frame, so the on-screen size
// is constant regardless of camera distance AND field of view. (An
// earlier `distance × fraction` form ignored fov, so the ring grew on
// screen whenever the fov was reduced — e.g. after a street-level FOV
// zoom — reports/010-testing.md #2 second pass.) Feel-tunable. ~0.035
// reproduces the previously-tuned size near a 60° fov.
export const RING_SCREEN_FRACTION = 0.035;

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

// WASD horizontal motion: speed = clamp(AGL * factor, MIN, MAX), where
// AGL = height above the ground directly below the camera (TASK-013;
// formerly absolute camera.y).
// At AGL ≥ MIN_SPEED metres: speed = AGL (linear scaling).
// At AGL < MIN_SPEED metres: speed = MIN_SPEED (constant floor).
// MIN raised from 5 to 10 on 2026-05-11 per user feel-test request:
// at street level (~1.6m AGL) the previous 5m/s was too slow; 10m/s ≈
// urban driving pace gets you across a block in a reasonable time. High
// altitudes unchanged (the linear scaling above AGL=10 still gives the
// same speeds).
export const WASD_SPEED_HEIGHT_FACTOR = 1.0; // m/s per metre of AGL height
export const WASD_MIN_SPEED = 10; // m/s
export const WASD_MAX_SPEED = 500; // m/s
// Acceleration ramp-up: time (ms) to reach the target speed from rest
// while a key is held. Release of all keys snaps velocity to zero
// instantly (no deceleration ramp). Tune from feel.
export const WASD_RAMP_UP_MS = 200;

// Plan View transition.
export const PLAN_VIEW_DURATION_MS = 1000;

// Phase 3 "swoop" wheel-zoom boundaries, in metres **above ground (AGL)**
// = camera.y − groundY, where groundY is the height of the street-segment
// surface directly below the camera (TASK-013; formerly absolute
// camera.position.y). See claude/specs/001-phase-3-plan.md.
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

// TASK-011 compass.

// World-north axis. 3DStreet currently treats +X as north (per Kieran;
// likely inherited from Google 3D Tiles). The needle render AND the
// align-to-north / rotate targets all read this, so re-pointing north
// later (e.g. standardising to a true North-up convention) is a one-line
// change here — not a hunt-and-replace.
export const NORTH_AXIS = Object.freeze({ x: 1, y: 0, z: 0 }); // +X

// Bearing of NORTH_AXIS measured clockwise from world -Z, in degrees.
// Derived from NORTH_AXIS so the needle formula and the align target stay
// in sync. For +X this is 90 (= atan2(NORTH_AXIS.x, -NORTH_AXIS.z) in deg).
export const NORTH_BEARING_FROM_MINUS_Z = 90;

// Pose-test tolerances for the compass body click.
// "Top-down" = within this many degrees of straight-down (tilt = +90).
export const COMPASS_TOPDOWN_TOLERANCE_DEGREES = 2;
// "North-up" = needle within this many degrees of screen-top.
export const COMPASS_NORTH_TOLERANCE_DEGREES = 2;

// Rotation-arrow step.
export const COMPASS_ROTATE_STEP_DEGREES = 90;
