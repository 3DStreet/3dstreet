// Single source-of-truth knobs for the experimental nav-controls system.
// The canonical values and their working ranges live in
// docs/03-configurable-thresholds.md (TH-NN).
//
// This module MUST stay THREE-free at module scope (KD-31): it is imported by the pure
// navMath layer, whose unit tests run without a THREE global. A top-level
// `new THREE.Vector3(...)` here throws `ReferenceError: THREE is not defined` at
// import in those tests. Keep any THREE-typed shared constant (e.g. a frozen
// direction vector) as a per-module const in the THREE-using modules instead.

// Tilt clamps (degrees from horizontal), TH-01 / TH-02. Positive = looking
// down, negative = looking up. MIN = -89 so the user can pitch up to look at
// buildings; MAX = +89 mirrors the floor on the down side and keeps `lookAt`
// numerically stable just shy of the spherical singularity.
export const MIN_TILT_DEGREES = -89;
export const MAX_TILT_DEGREES = 89;

// The single tilt threshold T (degrees below horizontal), TH-03, that
// governs ALL four tilt-conditional behaviours — the LB truck/dolly-vs-
// pedestal sub-mode, the wheel cursor-anchored-vs-dolly cut, the rotation
// regime (Map orbit above T vs rotate-in-place below T), and the
// letterbox mode indicator (KD-02/KD-05). This is the *default* for T; the
// live value is held on the controls instance (`_tiltThreshold`) and is
// overridable at runtime via the `nav-experimental-tuning` A-Frame component.
// Cut is on absolute angle from horizontal — looking up by any amount is
// below T. Stays runtime-tunable via `nav-experimental-tuning` so end-user
// testing can re-tune it.
export const TILT_THRESHOLD_DEFAULT_DEGREES = 25;

// Letterbox-indicator hysteresis dead-band δ (TH-73), in degrees,
// applied ONLY during a committed-motion-runner tween. While a tween runs, the
// indicator flips Street→Map only above T+δ and Map→Street only below T−δ, so a
// tween that settles right on the boundary (or runs along it) can't strobe the
// indicator. It flips promptly for a substantial crossing near T. Scoped to
// runner tweens: live drags, the wheel swoop, and every settle resolve at exact
// T (no dead-band), because the regime CONTROL is always exact-T and the
// indicator must not desync from it outside a tween. Build-time constant (NOT
// runtime-tunable — the runtime surface is fixed at five knobs). Too small ⇒ a
// boundary-run tween still flickers; too large ⇒ a genuine near-T crossing is
// delayed within the band. Working range 1–4°.
export const LB_TWEEN_HYSTERESIS_DEGREES = 2;

// Solid-geometry prevention & recovery (KD-16/17/18/19). All metres / degrees.
// Tunable.
//
// Collision / clamps.
//   EYE_MARGIN_METRES (TH-46) — shared eye-height clearance above any solid
//     floor, used by the descent clamp, WASD follow / step-up, the orbit
//     clamp, and the fall/pop targets. == the AGL street floor (TH-23, 1.5 m).
export const EYE_MARGIN_METRES = 1.5;
// Rate limit (TH-41) for the not-grounded (flying) vertical ease
// toward the flying cruise-height target (KD-19) `max(H, collisionFloorDest + eye)`. Applied per
// WASD tick as `maxStep = rate * dtSeconds`, easing BOTH the ≤ eye-margin lift
// onto a roof AND the settle back to cruise altitude H over ~0.3-0.4 s, so the
// vertical move composes with continuous per-frame WASD rather than snapping.
// ~4 m/s ≈ 1.5 m in ~0.4 s. Tunable from feel.
export const WASD_VERTICAL_LIFT_RATE_MPS = 4;
// WASD forward-ray classifier (KD-18).
//   BLOCK_SLOPE_MIN_DEGREES (TH-47) — a forward-ray hit at/above this slope reads
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
//   WASD_FACING_MIN (TH-44) — min dot(travelDir, -wallNormalH) for a forward
//     hit to count as a *facing* block (tangent guard). A grazing skim has
//     its normal ~perpendicular to travel (dot ≈ 0) and must not block.
export const WASD_FACING_MIN = 0.35;
//   WASD_FACING_HYSTERESIS — once blocked, the facing-dot threshold drops by
//     this much so minor wobble while skimming a façade doesn't stutter
//     block↔pass (replaces the old height-delta hysteresis).
export const WASD_FACING_HYSTERESIS = 0.1;
// Enclosure probe (TH-49). Cast-down origin = camera.y + this margin.
//   Altitude assumption: no relevant solid overhead sits more than
//   this far above the camera.
export const ENCLOSURE_PROBE_UP_MARGIN_METRES = 500;
// Recovery tweens.
export const FALL_DURATION_MS = 600; // fall / swoop / gesture-end tween
export const POP_TO_ROOF_DURATION_MS = 400;
// Discoverability cue (TH-52/TH-53) — show/hide hysteresis (a 2 m dead-band) so the
// cue doesn't strobe at the boundary. Keyed off height above the collision
// floor below.
export const DISCOVERABILITY_CUE_SHOW_METRES = 8;
export const DISCOVERABILITY_CUE_HIDE_METRES = 6;

// Minimum orbit radius (TH-04). A very-close cursor pivot (only
// reachable while staying in Map mode via Ctrl+wheel swoop-bypass) makes
// the orbit twitchy; clamp the pivot out to at least this distance.
export const MIN_ORBIT_RADIUS_METRES = 2;

// Map-mode rotation-pivot bounds radius (TH-05). The bounds
// is a circle on the ground (y=0) CENTRED ON THE SCREEN-CENTRE GROUND
// POINT (where the view ray meets y=0 — also the fallback rotation
// centre):
//   • cursor's ground hit within this radius of the screen-centre point
//     → orbit the cursor's point.
//   • cursor over sky, or its hit beyond this radius → orbit the
//     screen-centre ground point itself.
// Both pivots are on the ground, so rotation visibly pivots a ground
// feature. Replaces the earlier MAX_ORBIT_RADIUS inward cap (which
// drifted on tilt) and corrects two wrong bounds centres tried along the way
// (camera nadir, camera position). The live value is held on the controls
// (`_mapPivotBoundsRadius`) and is overridable at runtime via the
// `nav-experimental-tuning` component.
export const MAP_PIVOT_BOUNDS_RADIUS_METRES = 500;

// Street-level-mode-OFF parity tuning (TH-74): far-acceptance budget for a
// CLICKED Map-mode rotation pivot. With the street regime off, Map rotation runs at
// EVERY tilt, and orbiting a far pivot from a low camera swings it violently
// (and can throw it under the ground mesh). A cursor hit becomes the pivot
// only if its distance from the camera is within
//   GAIN × (camera → screen-centre-ground-point distance, with the tilt
//           FLOORED at the threshold T)
// i.e. GAIN × cameraHeight / sin(max(tilt, T)). A farther click REJECTS to
// the centre pivot (same as a sky click) — it is never pulled in along the
// cursor ray; that inward pull-in is the drift the old MAX_ORBIT_RADIUS cap
// was removed for, and it re-tested as "whack" here. Near top-down the budget
// is GAIN × camera height, so any visible
// click passes; at shallow tilt it converges to GAIN × height / sin(T) —
// close to the camera — instead of following the centre point to the
// horizon. Applied ONLY with street-level mode off — with it on, tilt > T
// bounds the geometry by construction (parity rule). Overridable via the
// tuning component (mapPivotFarAcceptGain).
export const MAP_PIVOT_FAR_ACCEPT_GAIN = 2; // dimensionless; tunable

// Rotation-centre ring indicator's apparent on-screen size (TH-06) —
// the ring's radius as a fraction of the viewport's half-height.
// The billboard mesh world radius is set to
// `fraction × distance × tan(fov/2)` each frame, so the on-screen size
// is constant regardless of camera distance AND field of view. (An
// earlier `distance × fraction` form ignored fov, so the ring grew on
// screen whenever the fov was reduced — e.g. after a street-level FOV
// zoom.) Feel-tunable. ~0.035
// reproduces the previously-tuned size near a 60° fov.
export const RING_SCREEN_FRACTION = 0.035;

// Wheel zoom — high-regime DOLLY step (TH-08). Each nominal
// tick moves the camera by this fraction of the current camera-to-anchor
// distance. Sign is applied by the caller. DOLLY KNOB ONLY — it no longer
// feeds the street-level FOV factor (that is FOV_PER_WHEEL_TICK below), so
// the two regimes tune independently.
export const ZOOM_PER_WHEEL_TICK = 0.05;

// Zoom-OUT escape floor (TH-80): minimum EFFECTIVE camera→anchor distance,
// in metres, used to size a zoom-out dolly step. The dolly step is
// multiplicative in the camera→anchor distance (ZOOM_PER_WHEEL_TICK × dist
// per tick), so with the camera parked millimetres from its anchor a
// zoom-out tick moves ~nothing and the wheel reads as dead. Reachable via
// focus (F / double-click) on an entity with no measurable geometry — the
// empty-bbox fallback flies the camera to 0.25 m from the entity origin
// (e.g. a geojson data layer at 0 0 0, #1865). Legacy EditorControls had the
// same escape valve as `minSpeedFactor = 8` (step = max(8, dist) × 0.1 ≥
// 0.8 m/detent); 16 m × ZOOM_PER_WHEEL_TICK reproduces that 0.8 m/tick
// minimum. Applied on zoom-OUT only — zoom-in stays asymptotic (never
// overshoots through the anchor), which deliberately trades exact in/out
// reversibility inside this radius for never getting stuck.
export const WHEEL_ZOOM_OUT_MIN_ANCHOR_DIST_METRES = 16;

// Wheel zoom — street-level FOV step (TH-09). Fraction by which
// the field of view shrinks (zoom-in) / grows (zoom-out) per nominal tick.
// Split out from ZOOM_PER_WHEEL_TICK so FOV tunes independently of the dolly.
export const FOV_PER_WHEEL_TICK = 0.05;

// Continuous step model (KD-09). Incoming wheel events are
// normalised to a signed, fractional "nominal tick" count and accumulated
// into a single float accumulator (_wheelAccum). The high & FOV regimes
// apply the WHOLE pending accumulator per frame as one continuous step
// (no quantisation, no multi-frame lag); the swoop consumes whole ticks
// under its per-frame rate-cap, carrying any sub-tick remainder.
//
// One mouse detent (deltaY ≈ 100) ≈ 1.0 nominal tick; a trackpad
// deltaY ≈ 3 event ≈ 0.03 of a tick — same deltaY→motion ratio as before,
// so cross-device parity is preserved by construction.
export const WHEEL_UNITS_PER_NOMINAL_TICK = 100;
// Line-mode (deltaMode === 1) approximate pixels per line. Known
// approximation (browsers vary); matches the previous inline value.
export const LINE_HEIGHT_PX = 16;
// Per-EVENT magnitude clamp, in nominal ticks. Some OS/trackpads emit a
// single deltaY in the thousands; page-mode (deltaMode === 2) multiplies by
// ~viewport height. Without this the continuous step would apply an
// unbounded factor in one frame. Matches the old per-frame ceiling.
export const WHEEL_MAX_TICKS_PER_EVENT = 10;
// Accumulator residual / loop-termination epsilon, in nominal ticks. Below
// this magnitude the accumulator is dropped so it doesn't accumulate
// forever (mirrors the old `unit * 0.05` residual drop).
export const WHEEL_ACCUM_EPS_TICKS = 0.05;
// Hard bound on the accumulator (TH-14). High/FOV drain the whole
// accumulator each frame so they can't pile up, but the swoop drains only
// SWOOP_PHASE2_MAX_TICKS_PER_FRAME ticks/frame — a sustained fast scroll
// could otherwise build a runaway tail. 12 ticks ≈ four frames of swoop
// glide: rides the tail for normal gestures, kills the pathological pile-up.
export const WHEEL_MAX_ACCUM_TICKS = 12;
// Degenerate-anchor-denominator guard (TH-15), in metres. When the
// dolly anchor is within this height of the camera (|cam.y − hit.y| ≤ this,
// reachable in the low-tilt branch as tilt→0 since the forward anchor
// approaches the camera's own height), the analytic phase1→phase2 boundary
// solve would divide by ~0; fall back to the per-tick post-step y-clamp.
// ~one camera radius.
export const WHEEL_ANCHOR_DENOM_EPS_METRES = 0.5;

// LB pan gesture: cap on how far the camera can translate per mousemove
// event, in metres. Guards against absurd anchor solutions (numerically
// degenerate ground-plane intersections at low tilt).
export const LB_PAN_MAX_STEP_METRES = 5000;

// cursorAnchor.worldPointAt fallback chain:
//   Step 2 caps the ground-plane intersection distance at this many metres
//     to reject grazing rays that would anchor far out of scene scope.
//   Step 3 returns a fixed point this many metres along the camera's
//     forward direction when both scene-mesh raycast and ground-plane
//     intersection miss.
// Also used as the synthetic-anchor depth for the tilt-conditional
// wheel-zoom's low-tilt branch:
// `pos + cameraForward * FALLBACK_FORWARD_DIST` is the "hit" point fed
// into the existing orbit-step math, giving a 3m-per-tick forward dolly
// (ZOOM_PER_WHEEL_TICK × FALLBACK_FORWARD_DIST).
export const MAX_GROUND_DIST = 2000;
export const FALLBACK_FORWARD_DIST = 30;

// Cap on the HORIZONTAL component of one wheel-zoom dolly tick, in metres
// (TH-16 lower bound, TH-17 coefficient; KD-15). Bounds the shallow-tilt lurch
// (~50 m/tick at 200 m / 22°) without throttling straight-down descent
// (horizontal ≈ 0 there, so the cap never fires). Absolute metres/tick (NOT a
// % of the step) so it does not silently track ZOOM_PER_WHEEL_TICK. PER TICK,
// not per frame: the continuous drain merges every tick accumulated since the
// last frame into one step, so the applying step scales its cap budget by the
// tick count (floored at one tick) — otherwise the max zoom rate would be
// cap × fps, i.e. proportional to frame rate (glacial on low-fps scenes).
// Separate knob from the orbit-pivot bounds (different origin: camera nadir vs
// screen-centre ground point). Live-tunable via nav-experimental-tuning.
//
// The cap scales with height (KD-15): `lateralCap(yAgl) = max(LOWER_BOUND,
// COEFF × yAgl)` (see navMath.lateralCap). The lower bound keeps it usable
// near the ground (and on the Ctrl+wheel / out-of-bounds path that has no AGL
// — it falls back to the lower bound). The lower bound is the live-tunable
// knob (`wheelZoomLateralCapLowerBoundMetres`); the coefficient is a constant
// re-tuned here.
export const WHEEL_ZOOM_LATERAL_CAP_LOWER_BOUND_METRES = 2; // 1–2; feel
export const WHEEL_ZOOM_LATERAL_CAP_AGL_COEFF = 0.1;

// Per-caller far-ground reach ceiling for the wheel-zoom path (TH-18).
// Far above any real scene (1000 km) but well short of float overflow, so
// legitimate high-altitude ground (a straight-down hit thousands of m
// below) is kept while a degenerate grazing-ray Float.MAX-class hit still
// falls to the level-forward fallback. LB-pan and the orbit-pivot caller
// keep the default MAX_GROUND_DIST (2000 m) — see worldPointAt's
// maxGroundDist opt.
export const WHEEL_GROUND_REACH_CEILING_METRES = 1e6;

// Shift+LB rotation speed (radians per pixel), TH-07. Matches the legacy
// EditorControls feel.
export const ROTATION_SPEED_RAD_PER_PX = 0.0035;

// WASD horizontal motion (TH-37..TH-40; KD-19): speed = clamp(AGL * factor,
// MIN, MAX), where AGL = height above the ground directly below the camera.
// At AGL ≥ MIN_SPEED metres: speed = AGL (linear scaling).
// At AGL < MIN_SPEED metres: speed = MIN_SPEED (constant floor).
// The floor is ~urban driving pace at street level (~1.6 m AGL): fast enough
// to cross a block in reasonable time. High altitudes use the linear scaling.
export const WASD_SPEED_HEIGHT_FACTOR = 1.0; // m/s per metre of AGL height
export const WASD_MIN_SPEED = 10; // m/s
export const WASD_MAX_SPEED = 500; // m/s
// Acceleration ramp-up: time (ms) to reach the target speed from rest
// while a key is held. Release of all keys snaps velocity to zero
// instantly (no deceleration ramp). Tune from feel.
export const WASD_RAMP_UP_MS = 200;

// Plan View transition.
export const PLAN_VIEW_DURATION_MS = 1000;
// Fallback Plan-View lift height (metres, TH-78): when the scene has no bounds
// to frame, Plan View rises to at least this altitude (it never drops below the
// current camera height — Plan View only ever zooms out).
export const COMPASS_UNBOUNDED_PLAN_VIEW_HEIGHT_METRES = 200;

// Swoop wheel-zoom phase boundaries (TH-22/TH-23; KD-08), in metres **above
// ground (AGL)** = camera.y − groundY, where groundY is the collision-floor
// surface directly below the camera. See docs/02-key-decisions.md.
export const SWOOP_PHASE2_ENTRY_ELEVATION_METRES = 20;
export const SWOOP_PHASE2_EXIT_ELEVATION_METRES = 1.5;

// Sticky tolerance (metres AGL), TH-76, added to the Phase-2→3 entry test so a
// reverse swoop that settles right on the exit elevation still latches to
// Phase 3. 1 cm — imperceptible for swoop entry.
export const SWOOP_PHASE3_STICKY_TOLERANCE_METRES = 0.01;

// Default swoop-out overview attitude (degrees below horizontal), TH-28. The
// target the swoop-out tilts toward when there is no valid transient
// zoom-undo memory (any non-wheel descent, or after the memory was cleared).
// 60° is a strong looking-down overview that is not fully top-down; fully
// top-down is delegated to the compass / Plan View (KD-26), not the wheel.
// Tunable from feel.
export const DEFAULT_OVERVIEW_TILT_DEGREES = 60;

// Phase 2 per-tick pedestal step (TH-24): fraction of (current y - exit
// elevation) consumed per whole zoom-in tick. Kept as a separate constant so
// Phase 2 feel can be tuned independently of Phase 1's anchored dolly step.
// Re-tune with the other two step knobs at feel-test.
export const SWOOP_PHASE2_STEP = 0.15;

// Phase 2 per-frame drain cap (TH-25), overriding WHEEL_MAX_TICKS_PER_EVENT
// inside the swoop transition only. Slows trackpad bursts so the transition
// reads as deliberate rather than instantaneous. The cap is latched at the
// start of each frame's drain pass — see ExperimentalControls._drainWheel.
export const SWOOP_PHASE2_MAX_TICKS_PER_FRAME = 3;

// Phase 2 floor-snap (TH-26): when zoom-in lands within this distance of
// SWOOP_PHASE2_EXIT_ELEVATION_METRES, snap to it. Eliminates the asymptotic
// stall near street level. Also used as the zoom-out kick-start distance —
// see `_applyPhase2WheelTick`.
export const SWOOP_PHASE2_FLOOR_SNAP_METRES = 1.0;

// Phase 3 FOV floor (degrees). Further zoom-in ticks at the floor are
// no-ops.
export const SWOOP_PHASE3_FOV_FLOOR_DEGREES = 15;

// Landing FOV / sense of arrival (TH-29..TH-33; KD-12).
//   SWOOP_LANDING_FOV_DEGREES — the FOV the descent eases open to as the swoop
//     lands at street level (height-driven, not latched). The world "opens up".
//   DEFAULT_MAP_FOV_DEGREES — the swoop-OUT FOV target when the transient
//     zoom-undo memory is cleared (mirrors DEFAULT_OVERVIEW_TILT_DEGREES for
//     FOV: memory valid → exact FOV undo, memory cleared → this default).
//   FOV_DISTORTION_LIMIT_DEGREES — beyond here the perspective reads as
//     fisheye; the wheel's wide end is capped below it.
//   PHASE3_FOV_WIDE_CAP_DEGREES — the street-level zoom's wide end. Expressed
//     as min(landing, distortion) so retuning either constant stays coherent.
//     Replaces the old per-entry latched `_phase3FovBaseline` (a constant now).
export const SWOOP_LANDING_FOV_DEGREES = 75;
export const DEFAULT_MAP_FOV_DEGREES = 60;
export const FOV_DISTORTION_LIMIT_DEGREES = 85;
export const PHASE3_FOV_WIDE_CAP_DEGREES = Math.min(
  SWOOP_LANDING_FOV_DEGREES,
  FOV_DISTORTION_LIMIT_DEGREES
);
// SWOOP_FOV_RAMP_EXPONENT — concentrates the FOV "opening up" near the FLOOR
// (the sense of arrival) instead of spreading it linearly across the band. The
// pedestal descent is exponential (fast at the top, asymptotically slow near
// the floor), so a height-LINEAR FOV ramp does ~all its widening at the top and
// almost none at the bottom (odd at the start, nothing at the end). FOV =
// narrow + (wide−narrow)·(1−heightFrac)^exponent: with exponent 3 the widening
// is back-loaded into the final stretch of the descent. Feel-tune.
export const SWOOP_FOV_RAMP_EXPONENT = 3;

// Cursor-locked street-level FOV zoom / camera re-aim (TH-34..TH-36; KD-13).
//   REAIM_FADE_{NEAR,FAR}_METRES — the cursor-target distance band over which
//     the re-aim magnitude fades to zero (1 below NEAR, 0 above FAR), so a far
//     façade → sky crossing is continuous rather than a hard switch to the
//     no-re-aim fallback. Fade completes well before
//     WHEEL_GROUND_REACH_CEILING_METRES.
//   PHASE3_REAIM_NDC_EPS — cursor-moved threshold (in NDC units) above which
//     the re-aim baseline pose is re-captured at the current pose (a new aim).
export const REAIM_FADE_NEAR_METRES = 300;
export const REAIM_FADE_FAR_METRES = 800;
export const PHASE3_REAIM_NDC_EPS = 1e-4;

// Compass (TH-55..TH-59; KD-26).

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

// Double-click navigation tuning (TH-60..TH-66; KD-23/KD-24). All first-pass
// tuning values (settled at feel-test). Standoff / view-height geometry feeds the desired
// pose in navMath.desiredDoubleClickPose; the pull-back knobs bound the B/C
// standoff-clearance search.
//   Lane (Category A): stand off ~5 m back along the cardinal heading at
//     EYE_MARGIN_METRES (1.5 m) eye height. ~5 m ≫ 1.5 m keeps the down-look
//     below the mode threshold T by construction (Street mode on a lane
//     click).
export const DOUBLECLICK_LANE_STANDOFF_METRES = 5;
//   Generic object (Category C): stand off this many bounding-sphere radii
//     from the object centre, aimed at the centre.
export const DOUBLECLICK_OBJECT_STANDOFF_RADII = 3;
//   Building (Category B): stand off this multiple of the footprint diagonal
//     back along the heading…
export const DOUBLECLICK_BUILDING_STANDOFF_DIAG = 1.5;
//   …at this fraction of the building's height (so from high above you come
//     DOWN to see the building rather than stay on its roof).
export const DOUBLECLICK_BUILDING_VIEW_HEIGHT_FRAC = 0.33;
//   Framing-pitch cap (Category B): if framing the exact hit-point would
//     tilt the look more than this, move the aim point TOWARD camera height
//     (down for a look-up, up for a look-down) so the camera never cranes
//     near-vertically at a tower top (TH-64; KD-24).
export const DOUBLECLICK_MAX_FRAMING_PITCH_DEGREES = 70;
//   B/C standoff clearance search: pull the standoff inward (toward the look
//     target) in STEP-metre increments, up to MAX metres, re-testing each
//     candidate; give up (no-op) past MAX.
export const DOUBLECLICK_STANDOFF_PULLBACK_STEP_METRES = 1;
export const DOUBLECLICK_STANDOFF_PULLBACK_MAX_METRES = 40;

// Context view button — street / daylight / drone (TH-67/TH-68; KD-21).
//
// Elevated↔street-level hysteresis band (metres above the collision floor
// directly below the camera). Below ENTRY → "at street level" (offers drone
// view); above EXIT → "elevated" (offers street view); between → hold the
// last state (anti-flicker). Two failure modes are weighed (KD-21): icon
// flicker at the boundary (wants a WIDE band) vs lag on a deliberate slow
// ascent (wants a NARROW/low band). The original 8/14 m band was far too high
// — standing on a 3 m kerb still read as "street level". "At street level"
// now means within ~human-height of a
// surface; anything more is elevated. Resting AGL is ~eye-height
// (EYE_MARGIN_METRES = 1.5 m), so ENTRY 1.8 sits just above resting eye-height
// (standing normally = street level) and EXIT 2.5 means >2.5 m of air under
// you = elevated. The tight 1.8↔2.5 dead band still clears eye-height bob.
export const DRONE_ELEVATED_ENTRY_METRES = 1.8; // tunable
export const DRONE_ELEVATED_EXIT_METRES = 2.5; // tunable

// Drone-view canonical rise (TH-69/TH-70; KD-22).
//   DEFAULT_DRONE_HEIGHT — target altitude above GROUND LEVEL (the travel
//     height, which looks past tall buildings to the ground between
//     them) for a street-level drone press. An elevated "survey from above"
//     vantage. TUNE AT FEEL-TEST.
export const DEFAULT_DRONE_HEIGHT = 40; // metres above ground level; tunable
//   ROOF_CLEARANCE — when atop a building taller than DEFAULT_DRONE_HEIGHT,
//     end this far above the ROOF you stand on (the collision floor directly
//     below). COUPLED to the hysteresis (KD-21/KD-22): must be
//     >= DRONE_ELEVATED_EXIT_METRES + dead-band margin so a drone arrival atop
//     a tall roof lands unambiguously "elevated" and the button flips to street
//     view. With EXIT now 2.5 m (lowered from the original 14), any
//     canonical drone height ≫ EXIT, so this trivially clears the bar.
export const ROOF_CLEARANCE = 20; // metres above roof; >= EXIT + margin; tunable

// Default/normal field of view (degrees) the drone rise resets to (TH-71). A
// LITERAL, not an attach-time `camera.fov` capture (which is unreliable on a
// re-attach mid-zoom). 50 is THREE's PerspectiveCamera default = the inspector
// camera's resting fov (it is constructed `new THREE.PerspectiveCamera()` with
// no fov arg — see cameras.js). NOT 60 (the `|| 60` frustum-fit fallback
// elsewhere is a defensive default, not the resting fov; using it would ship
// drone view ~20% wider than every other view, violating the "normal FOV"
// contract).
export const DEFAULT_FOV_DEGREES = 50;

// Camera far-plane, tracked to the camera's distance from the scene centre
// so a birds-eye view keeps distant geometry in frustum without over-
// extending near the ground: far = clamp(distance × factor, min, max).
// Render-frustum plumbing (not a nav-behaviour threshold), shared by the
// wheel-swoop and committed-motion tick loops.
export const CAMERA_FAR_PLANE_MIN_METRES = 20000;
export const CAMERA_FAR_PLANE_MAX_METRES = 100000000;
export const CAMERA_FAR_PLANE_DISTANCE_FACTOR = 10;
