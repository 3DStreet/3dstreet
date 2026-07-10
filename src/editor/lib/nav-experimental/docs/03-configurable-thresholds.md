# 3 — Configurable Thresholds

**This document is the single source of truth for every canonical
numeric value in the experimental navigation system.** The other docs
reference threshold *IDs and working ranges* (e.g. "T" / `TH-03`); they
never restate the number. If a value here disagrees with a number quoted
elsewhere in these docs, this document wins — and the other doc has a
bug.

Every value was verified against
`src/editor/lib/nav-experimental/constants.js` at the snapshot SHA
(`5f43d38d`). Where a value lives elsewhere (one does — `TH-72`), the
location is named.

## How to read this table

- **ID** — the nav-docs threshold ID (`TH-NN`). Stable across these docs.
- **Constant** — the exact `constants.js` export (the name you grep for).
- **Value** — the current shipped value at the snapshot SHA.
- **Runtime?** — **yes** means it is live-tunable without a rebuild via
  the `nav-experimental-tuning` A-Frame component (see "Runtime-config
  surface" below). Everything else is a build-time constant: change it in
  `constants.js` and rebuild.
- **In-code tag(s)** — the identifiers currently used for this value in
  the **code comments** (`TASK-NNN` references and per-task letter codes
  like `D2`, `D-LT-3`, `H4`, `LT-1`, `DEC-B`, …). These are inconsistent
  and per-task; migrating the comments to the `TH-NN` / `KD-NN` namespace
  is an explicit Open Issue (`05-open-issues.md`, `OI-1`). Recorded here
  as the migration bridge — so a grep that turns up `D2` or `TASK-010`
  maps to its `TH-NN`. A "—" means no distinct tag.
- **Working range** — the band within which the value delivers its
  intended behaviour, with the failure mode at each end. "Feel" means the
  bound is a subjective comfort limit settled by feel-testing, not a hard
  numeric constraint.

---

## Runtime-config surface (authoritative)

Exactly **five** knobs are live-tunable at runtime. This list is
enumerated from what is actually wired in `navTuningComponent.js` →
the matching setter on the controls instance — **not** inferred from
`constants.js` comments (several other constants are commented
"tunable", meaning "re-tune in code and rebuild", *not* runtime-live).

Set them from the A-Frame inspector, or the console:

```js
sceneEl.setAttribute('nav-experimental-tuning', 'tiltThresholdDegrees', 30);
```

| Schema property | Setter | Threshold | Clamp applied by the setter |
|---|---|---|---|
| `tiltThresholdDegrees` | `setTiltThreshold` | `TH-03` (T) | clamped to **5–45°** |
| `mapPivotBoundsRadiusMetres` | `setMapPivotBoundsRadius` | `TH-05` | clamped to **1–100 000 m** |
| `rotationSpeedRadPerPx` | `setRotationSpeed` | `TH-07` | must be **> 0** |
| `wheelZoomLateralCapLowerBoundMetres` | `setWheelZoomLateralCap` | `TH-16` | must be **> 0** |
| `mapPivotFarAcceptGain` | `setMapPivotFarAcceptGain` | `TH-74` | clamp **0.05–100** |

Each setter ignores non-finite / out-of-range input. The component's
schema defaults are imported from the constants, so the component and
`constants.js` cannot drift.

Two **boolean enable-gates** — `streetLevelEnabled` (`?streetview=on`) and
`wasdEnabled` (`?wasd=on`) — are also wired on the `nav-experimental-tuning`
component. They are **gates, not tuning knobs**: each turns a whole
behaviour on or off rather than adjusting a numeric value, so they are not
counted among the five runtime-live threshold knobs above.

---

## Tilt & mode

| ID | Constant | Value | Controls | Runtime? | In-code tag(s) | Working range |
|---|---|---|---|---|---|---|
| `TH-01` | `MIN_TILT_DEGREES` | −89° | Lower clamp on look pitch (looking up). −89 (not −90) keeps `lookAt` numerically stable just shy of the up-singularity. | no | — | −85…−89.9. Past −90 = gimbal/`lookAt` blow-up. |
| `TH-02` | `MAX_TILT_DEGREES` | +89° | Upper clamp on look pitch (looking down). Mirrors `TH-01`. | no | — | +85…+89.9. |
| `TH-03` | `TILT_THRESHOLD_DEFAULT_DEGREES` | 25° | **T — the single tilt threshold governing all four tilt-conditional behaviours**: the LB truck/dolly-vs-pedestal sub-mode, the wheel cursor-anchored-vs-dolly cut, the rotation regime (Map vs Street), and the letterbox indicator. Cut is on absolute angle below horizontal. | **yes** | `T`, `D2` (TASK-010) | 15–35°. Too low ⇒ Street mode unreachable / cursor-anchor-over-sky band widens; too high ⇒ you can't look down without dropping to Map. |
| `TH-73` | `LB_TWEEN_HYSTERESIS_DEGREES` | 2° | **δ — letterbox-indicator hysteresis dead-band**, applied ONLY during a committed-motion-runner tween. While a tween runs the indicator flips Street→Map only above `T+δ` and Map→Street only below `T−δ`, so a tween that settles on / runs along `T` can't strobe the indicator; a substantial crossing near `T` still flips promptly. Live drags, the wheel swoop, and every settle resolve at **exact `T`** (no dead-band) — the regime *control* is always exact-`T` and the indicator must not desync from it outside a tween. | no | — (TASK-037) | 1–4°. Too small ⇒ a boundary-run tween still flickers; too large ⇒ a genuine near-`T` crossing is delayed within the band. |

## Rotation (Shift+LB)

| ID | Constant | Value | Controls | Runtime? | In-code tag(s) | Working range |
|---|---|---|---|---|---|---|
| `TH-04` | `MIN_ORBIT_RADIUS_METRES` | 2 m | Minimum Map-orbit pivot distance. A very-close pivot (reachable only via Ctrl+wheel swoop-bypass) makes the orbit twitchy; the pivot is pushed out to this radius. | no | `D5` (TASK-010) | 1–5 m. |
| `TH-05` | `MAP_PIVOT_BOUNDS_RADIUS_METRES` | 500 m | Map-mode rotation-pivot bounds radius, measured on the ground from the screen-centre ground point. Cursor hit inside → orbit the cursor point; outside (or sky) → orbit the screen-centre point. | **yes** | `D-LT-3`, `#6` (TASK-010) | 100–2000 m. Too small ⇒ most off-centre clicks fall back to the screen-centre pivot; too large ⇒ a far hit gives a huge lever arm (orbit degrades toward rotate-in-place). |
| `TH-06` | `RING_SCREEN_FRACTION` | 0.035 | Rotation-centre ring indicator radius, as a fraction of viewport half-height. Sized `fraction × distance × tan(fov/2)` per frame so on-screen size is constant across distance **and** FOV. | no | `D3` (TASK-010) | 0.02–0.06 (feel). |
| `TH-07` | `ROTATION_SPEED_RAD_PER_PX` | 0.0035 rad/px | Shift+LB rotation gain. Matches the legacy `EditorControls` feel. | **yes** | — (TASK-010 `#6`) | 0.002–0.006 (feel). |
| `TH-74` | `MAP_PIVOT_FAR_ACCEPT_GAIN` | 2 | Gain on the acceptance radius for a far Map-orbit pivot when street mode is off (KD-02): a cursor hit beyond `TH-05` is still accepted as the orbit pivot out to `TH-05 × this gain` before falling back to the screen-centre ground point, so an off-centre far click still orbits its target rather than snapping to centre. The genuine **5th runtime-live knob** — setter `setMapPivotFarAcceptGain`, wired in `navTuningComponent`. | **yes** | — | 1–5 (feel). Too low ⇒ far clicks fall back to screen-centre readily; too high ⇒ a very distant hit gives a huge lever arm (orbit degrades toward rotate-in-place). |

## Wheel input plumbing (continuous step model)

| ID | Constant | Value | Controls | Runtime? | In-code tag(s) | Working range |
|---|---|---|---|---|---|---|
| `TH-08` | `ZOOM_PER_WHEEL_TICK` | 0.05 | High-regime **dolly** step: fraction of camera→anchor distance per nominal tick. (Decoupled from FOV per `TH-09`.) | no | `B7` (TASK-014a) | 0.03–0.1 (feel). |
| `TH-09` | `FOV_PER_WHEEL_TICK` | 0.05 | Street-level **FOV** step: fraction the FOV shrinks/grows per nominal tick. | no | `B7` (TASK-014a) | 0.03–0.1 (feel). |
| `TH-10` | `WHEEL_UNITS_PER_NOMINAL_TICK` | 100 | `deltaY` px per one nominal tick. One mouse detent ≈ 100 ≈ 1.0 tick; preserves cross-device (mouse/trackpad) parity by construction. | no | — | device-calibration; ~100 for standard mice. |
| `TH-11` | `LINE_HEIGHT_PX` | 16 | Assumed px per line for line-mode (`deltaMode === 1`) wheel events. Known approximation; browsers vary. | no | — | 12–20. |
| `TH-12` | `WHEEL_MAX_TICKS_PER_EVENT` | 10 | Per-event magnitude clamp (nominal ticks). Stops a single pathological event (page-mode, some trackpads emit `deltaY` in the thousands) applying an unbounded one-frame factor. | no | — | 5–20. |
| `TH-13` | `WHEEL_ACCUM_EPS_TICKS` | 0.05 | Accumulator residual epsilon. Below this magnitude the accumulator is dropped so it can't accrue forever. | no | — | small (~0.05). |
| `TH-14` | `WHEEL_MAX_ACCUM_TICKS` | 12 | Hard bound on the wheel accumulator (~4 frames of swoop glide). Rides the tail of a normal gesture; kills a sustained-fast-scroll runaway pile-up. | no | `A4` (TASK-014a) | 8–16. |
| `TH-15` | `WHEEL_ANCHOR_DENOM_EPS_METRES` | 0.5 m | Degenerate-anchor guard: when the dolly anchor is within this height of the camera, the analytic phase1→2 boundary solve would divide by ~0; falls back to a per-tick post-step clamp. ~one camera radius. | no | `A3` (TASK-014a) | ~0.5. |

## Wheel lateral cap & ground reach

| ID | Constant | Value | Controls | Runtime? | In-code tag(s) | Working range |
|---|---|---|---|---|---|---|
| `TH-16` | `WHEEL_ZOOM_LATERAL_CAP_LOWER_BOUND_METRES` | 2 m | Lower bound of the per-tick horizontal-lurch cap. The live cap is `max(lowerBound, TH-17 × AGL)`; this bound governs near the ground and on the no-AGL Ctrl+wheel / out-of-bounds path. | **yes** | `LT-1` (TASK-014d) | 1–2 (feel). |
| `TH-17` | `WHEEL_ZOOM_LATERAL_CAP_AGL_COEFF` | 0.1 | Height coefficient of the lateral cap: cap scales at 0.1 × AGL above the lower bound, so the lurch is bounded proportionally to height. | no | TASK-027 Part F | 0.05–0.2. |
| `TH-18` | `WHEEL_GROUND_REACH_CEILING_METRES` | 1 000 000 m | Far-ground reach ceiling for the wheel-zoom path only. Keeps legitimate high-altitude straight-down ground hits while a degenerate grazing-ray near-`Float.MAX` hit still falls to the level-forward fallback. | no | TASK-014d | fixed (1e6). |
| `TH-19` | `LB_PAN_MAX_STEP_METRES` | 5000 m | Per-mousemove translation cap for the LB pan/truck gesture. Guards against degenerate ground-plane intersection solutions at low tilt. | no | — | large guard value. |
| `TH-20` | `MAX_GROUND_DIST` | 2000 m | Default cap on `worldPointAt`'s ground-plane intersection distance (LB-pan and orbit-pivot callers). Rejects grazing rays that would anchor far out of scope. | no | — | scene-scale dependent. |
| `TH-21` | `FALLBACK_FORWARD_DIST` | 30 m | Fixed forward distance for the level-forward synthetic anchor when both mesh raycast and ground-plane intersection miss (open sky). Also the low-tilt synthetic-anchor depth. | no | — | 10–50 (feel). |

## Swoop — phase boundaries & step (Phase 2/3; AGL)

These are measured **above ground (AGL)** = `camera.y − groundY`, where
`groundY` is the collision floor directly below the camera, not absolute
`camera.y`. On a flat scene at y=0 they coincide.

| ID | Constant | Value | Controls | Runtime? | In-code tag(s) | Working range |
|---|---|---|---|---|---|---|
| `TH-22` | `SWOOP_PHASE2_ENTRY_ELEVATION_METRES` | 20 m AGL | Phase-1→2 boundary ("yCeil"): below this the wheel drives the swoop transition. | no | — | 10–30. Too low ⇒ descent begins too suddenly near the ground; too high ⇒ swoop engages while still birds-eye. |
| `TH-23` | `SWOOP_PHASE2_EXIT_ELEVATION_METRES` | 1.5 m AGL | Phase-2→3 boundary ("yFloor") = street eye level. Equals `TH-46`. | no | — | ≈ human eye height (1.4–1.8). |
| `TH-24` | `SWOOP_PHASE2_STEP` | 0.15 | Phase-2 per-tick pedestal step: fraction of `(y − yFloor)` consumed per zoom-in tick. Exponential approach to the floor. | no | `B7` | 0.1–0.25 (feel). |
| `TH-25` | `SWOOP_PHASE2_MAX_TICKS_PER_FRAME` | 3 | Phase-2 per-frame drain cap (vs 10 elsewhere). Latched at frame start so a boundary-crossing frame can't unlock the higher cap. Makes a trackpad burst read as a deliberate ~350 ms transition. | no | `H4` | 2–5. |
| `TH-26` | `SWOOP_PHASE2_FLOOR_SNAP_METRES` | 1.0 m | Phase-2 floor snap (zoom-in) and zoom-out kick-start distance. Eliminates the asymptotic stall near the floor. | no | `H6` | 0.5–1.5. |
| `TH-27` | `SWOOP_PHASE3_FOV_FLOOR_DEGREES` | 15° | Phase-3 FOV floor: further zoom-in ticks at the floor are no-ops. | no | — | 10–20 (telephoto limit). |
| `TH-76` | `SWOOP_PHASE3_STICKY_TOLERANCE_METRES` | 0.01 m | Sticky-street-level tolerance (1 cm) on the Phase-2→3 entry test: once at/within this of the floor, the swoop stays latched in Phase 3 rather than re-entering Phase 2 on tiny AGL jitter, so a camera resting exactly at street level can't chatter across the boundary. | no | — | 0.005–0.02. Too small ⇒ floor jitter re-triggers Phase 2; too large ⇒ Phase 3 latches while still perceptibly above the floor. |

## Swoop — FOV "sense of arrival" & overview

| ID | Constant | Value | Controls | Runtime? | In-code tag(s) | Working range |
|---|---|---|---|---|---|---|
| `TH-28` | `DEFAULT_OVERVIEW_TILT_DEGREES` | 60° | Swoop-OUT overview attitude (degrees below horizontal) when there is no valid zoom-undo memory. Also the **drone-view** rise gradient. A strong look-down that is not fully top-down (top-down is the compass's job). | no | `OQ1` (TASK-022) | 45–75 (feel). |
| `TH-29` | `SWOOP_LANDING_FOV_DEGREES` | 75° | Landing FOV the descent eases open to as the swoop reaches street level ("the world opens up"). Height-driven, not latched. | no | TASK-027 Part A (delivers 014b) | 65–85 (capped below `TH-31`). |
| `TH-30` | `DEFAULT_MAP_FOV_DEGREES` | 60° | Swoop-OUT FOV target when the zoom-undo memory is cleared (the FOV analogue of `TH-28`). | no | TASK-027 Part A | 50–70. |
| `TH-31` | `FOV_DISTORTION_LIMIT_DEGREES` | 85° | Beyond here perspective reads as fisheye; the wheel's wide end is capped below it. | no | TASK-027 Part A | 80–90. |
| `TH-32` | `PHASE3_FOV_WIDE_CAP_DEGREES` | 75° | Street-level zoom's wide end = `min(TH-29, TH-31)`. **Derived constant** — re-tuning either input stays coherent. | no | TASK-027 Part A | derived. |
| `TH-33` | `SWOOP_FOV_RAMP_EXPONENT` | 3 | Concentrates the FOV "opening up" near the floor: `FOV = narrow + (wide−narrow)·(1−heightFrac)^exponent`. Exponent 1 = linear (does its widening at the top); 3 back-loads it into the final stretch. | no | TASK-027 Part A; live-test #2 | 2–4 (feel). |

## Cursor-locked street-level FOV re-aim

| ID | Constant | Value | Controls | Runtime? | In-code tag(s) | Working range |
|---|---|---|---|---|---|---|
| `TH-34` | `REAIM_FADE_NEAR_METRES` | 300 m | Cursor-target distance below which the FOV-zoom camera re-aim is full strength (weight 1). | no | `M4` / `WE-D2` (TASK-027 B) | < `TH-35`. |
| `TH-35` | `REAIM_FADE_FAR_METRES` | 800 m | Distance above which the re-aim fades to zero, so a far façade→sky crossing is continuous rather than a hard switch. | no | TASK-027 Part B | > `TH-34`, well below `TH-18`. |
| `TH-36` | `PHASE3_REAIM_NDC_EPS` | 1e-4 | Cursor-moved threshold (NDC units) above which the re-aim baseline pose is re-captured (a new aim). | no | TASK-027 Part B | tiny. |

## WASD motion (speed & collision)

| ID | Constant | Value | Controls | Runtime? | In-code tag(s) | Working range |
|---|---|---|---|---|---|---|
| `TH-37` | `WASD_SPEED_HEIGHT_FACTOR` | 1.0 m/s per m AGL | Horizontal speed scales linearly with AGL: `speed = clamp(AGL × factor, MIN, MAX)`. | no | TASK-013 | 0.5–2. |
| `TH-38` | `WASD_MIN_SPEED` | 10 m/s | Speed floor at/below 10 m AGL. ≈ urban driving pace at street level. | no | — | 5–15 (feel). |
| `TH-39` | `WASD_MAX_SPEED` | 500 m/s | Speed ceiling at high altitude. | no | — | scene-scale. |
| `TH-40` | `WASD_RAMP_UP_MS` | 200 ms | Time to ramp from rest to target speed while a key is held. Release snaps velocity to zero (no decel ramp). | no | — | 100–400 (feel). |
| `TH-41` | `WASD_VERTICAL_LIFT_RATE_MPS` | 4 m/s | Rate-limit for the not-grounded (flying) vertical ease toward `max(H, floorDest+eye)` (~1.5 m in ~0.4 s). Eases the lift onto a roof and the settle back to cruise. | no | `DEC-B` (TASK-024a) | 3–6 (feel). |
| `TH-42` | `WASD_CAMERA_RADIUS_METRES` | 0.5 m | Forward-ray look-ahead pad so a wall is seen one camera-radius before contact. **Not** a corner-damping radius. | no | TASK-024 | 0.3–1.0. |
| `TH-43` | `WASD_STEP_HYSTERESIS_METRES` | 0.3 m | (Legacy) block↔pass dead-band on the height threshold. Superseded as the primary stutter guard by the facing hysteresis `TH-45`. | no | TASK-024 | 0.2–0.5. |
| `TH-44` | `WASD_FACING_MIN` | 0.35 | Min `dot(travelDir, −wallNormalH)` for a forward hit to count as a *facing* block. A grazing skim (dot ≈ 0) must not block. | no | `N3` (TASK-024) | 0.2–0.5. |
| `TH-45` | `WASD_FACING_HYSTERESIS` | 0.1 | Once blocked, the facing-dot threshold drops by this much so wobble while skimming a façade doesn't stutter block↔pass. | no | TASK-024 | 0.05–0.2. |

## Solid-geometry collision & recovery

| ID | Constant | Value | Controls | Runtime? | In-code tag(s) | Working range |
|---|---|---|---|---|---|---|
| `TH-46` | `EYE_MARGIN_METRES` | 1.5 m | Shared eye-height clearance above any solid floor — used by the descent clamp, WASD follow/step-up, the orbit clamp, and the fall/pop targets. Equals the street AGL floor and `TH-23`. | no | — | ≈ eye height. |
| `TH-47` | `BLOCK_SLOPE_MIN_DEGREES` | 45° | A forward-ray hit at/above this slope reads as a near-vertical wall/façade/cliff (WASD up-step block; down-step hover when also tall). | no | `D1` (TASK-024) | 35–55. Too low ⇒ ramps block; too high ⇒ you walk into steep faces. |
| `TH-48` | `BLOCK_HEIGHT_MIN_METRES` | 1.5 m | Floor delta at/above which an up-step blocks (vs steps up) and a down-step can hover. **Independent** of `TH-46` (they merely share a 1.5 m start). | no | TASK-024 | 1.0–2.0. |
| `TH-49` | `ENCLOSURE_PROBE_UP_MARGIN_METRES` | 500 m | Enclosure cast-down origin offset above the camera; assumes no relevant solid overhead sits higher than this. | no | `D10e` (TASK-024) | scene-scale. |
| `TH-50` | `FALL_DURATION_MS` | 600 ms | Tween duration shared by the recovery fall/swoop, the gesture-end recovery, the **double-click teleport**, and the **drone-view rise**. | no | TASK-024 | 400–800 (feel; one knob currently spans all of these — see OI-24). |
| `TH-51` | `POP_TO_ROOF_DURATION_MS` | 400 ms | Pop-to-roof / pop-to-daylight tween duration. | no | TASK-024 | 300–600 (feel). |
| `TH-52` | `DISCOVERABILITY_CUE_SHOW_METRES` | 8 m | Show the recovery/discoverability cue above this height over the collision floor. (This is the *flash* trigger, the button being the persistent affordance.) | no | `D7` (TASK-024) | 5–12; must exceed `TH-53`. |
| `TH-53` | `DISCOVERABILITY_CUE_HIDE_METRES` | 6 m | Hide the cue below this height (2 m dead-band vs `TH-52` to stop strobing). | no | TASK-024 | < `TH-52`. |
| `TH-75` | `CUE_FLASH_MS` | 3000 ms | Recovery-cue flash window (KD-35): once shown, the cue kind auto-clears after this long *even while the stranding condition still holds*, so it flashes once per stranding episode instead of nagging. **Lives in `useRecoveryCue.js`, not `constants.js`.** Sibling of `TH-52`/`TH-53`. | no | — | 2000–5000. Too short ⇒ the flash is missed; too long ⇒ it reads as sticky/naggy. |
| `TH-77` | `TRAVEL_HEIGHT_PATCH_HALF_SPAN_METRES` | 2 m | Half-span of the travel-height sampling patch (KD-16): the ground-beneath-buildings estimate for WASD fly-speed scaling casts multiple downward rays across a `2 × half-span` square below the camera and takes the lowest hit, so a single roof under the camera centre doesn't fool the speed scaling. **Lives in `collisionProbe.js`.** | no | — | 1–4. Too small ⇒ a centred roof still skews the estimate; too large ⇒ the patch samples unrelated distant ground. |
| `TH-72` | `ENCLOSURE_FALLBACK_INTERVAL_MS` | 250 ms | **Lives in `situationSensor.js`, not `constants.js`** (moved there with the per-tick sensor during the decomposition — KD-32). Idle-gated enclosure re-probe cadence: while stationary with no scene-dirty signal, re-evaluate at most this often so a streaming source we didn't wire (e.g. Google 3D Tiles) is still picked up. ~4 raycasts/sec idle worst-case. | no | `CR-D5` | 200–500. |

## Plan View

| ID | Constant | Value | Controls | Runtime? | In-code tag(s) | Working range |
|---|---|---|---|---|---|---|
| `TH-54` | `PLAN_VIEW_DURATION_MS` | 1000 ms | Plan-view (and shared compass) tween duration. | no | — | 600–1500 (feel). |

## Compass

| ID | Constant | Value | Controls | Runtime? | In-code tag(s) | Working range |
|---|---|---|---|---|---|---|
| `TH-55` | `NORTH_AXIS` | `{1,0,0}` (+X) | World-north axis. 3DStreet currently treats +X as north (per Kieran; likely inherited from Google 3D Tiles). The needle render and the align/rotate targets all read this, so re-pointing north later is a one-line change. | no | — | a unit axis. |
| `TH-56` | `NORTH_BEARING_FROM_MINUS_Z` | 90° | Bearing of `NORTH_AXIS` clockwise from world −Z. Derived from `TH-55` so the needle formula and the align target stay in sync. | no | — | derived from `TH-55`. |
| `TH-57` | `COMPASS_TOPDOWN_TOLERANCE_DEGREES` | 2° | "Top-down" = within this many degrees of straight-down (+90 tilt) for the compass body-click dispatcher. | no | — | 1–5. |
| `TH-58` | `COMPASS_NORTH_TOLERANCE_DEGREES` | 2° | "North-up" = needle within this many degrees of screen-top. | no | — | 1–5. |
| `TH-59` | `COMPASS_ROTATE_STEP_DEGREES` | 90° | Rotation-arrow step (one cardinal turn per arrow click). | no | — | 90 (cardinal). |

## Double-click navigation (Phase 4)

| ID | Constant | Value | Controls | Runtime? | In-code tag(s) | Working range |
|---|---|---|---|---|---|---|
| `TH-60` | `DOUBLECLICK_LANE_STANDOFF_METRES` | 5 m | Category A (lane): stand off this far back along the cardinal heading at eye height. ≫ eye height keeps the down-look below T (Street mode) by construction. | no | TASK-012 | 3–10 (feel). |
| `TH-61` | `DOUBLECLICK_OBJECT_STANDOFF_RADII` | 3 | Category C (generic object): stand off this many bounding-sphere radii from the object centre. | no | TASK-012 | 2–5 (feel). |
| `TH-62` | `DOUBLECLICK_BUILDING_STANDOFF_DIAG` | 1.5 | Category B (building): stand off this multiple of the footprint diagonal back along the heading. | no | TASK-012 | 1–3 (feel). |
| `TH-63` | `DOUBLECLICK_BUILDING_VIEW_HEIGHT_FRAC` | 0.33 | Category B: target camera height = this fraction of building height (so from high above you come *down* to see it, not stay on the roof). | no | TASK-012 | 0.25–0.5 (feel). |
| `TH-64` | `DOUBLECLICK_MAX_FRAMING_PITCH_DEGREES` | 70° | Category B framing-pitch cap: if framing the hit-point would tilt more than this, move the aim point toward camera height so the camera never cranes near-vertically at a tower top. | no | `WE-8` (TASK-012) | 60–80. |
| `TH-65` | `DOUBLECLICK_STANDOFF_PULLBACK_STEP_METRES` | 1 m | B/C clearance search step: pull the standoff inward (toward the look target) in increments of this. | no | TASK-012 | 0.5–2. |
| `TH-66` | `DOUBLECLICK_STANDOFF_PULLBACK_MAX_METRES` | 40 m | B/C clearance search ceiling: give up (no-op) past this much inward pull. | no | TASK-012 | 20–60. |

## Context view button / drone view

| ID | Constant | Value | Controls | Runtime? | In-code tag(s) | Working range |
|---|---|---|---|---|---|---|
| `TH-67` | `DRONE_ELEVATED_ENTRY_METRES` | 1.8 m | Elevated↔street-level hysteresis **entry**: at/below this AGL → "at street level". Sits just above resting eye-height so standing normally reads as street level. | no | `D-B` (TASK-025) | 1.6–2.2; must stay below `TH-68`. |
| `TH-68` | `DRONE_ELEVATED_EXIT_METRES` | 2.5 m | Elevated↔street-level hysteresis **exit**: above this AGL → "elevated". The tight 1.8↔2.5 dead-band still clears eye-height bob. | no | `D-B` (TASK-025) | 2.2–3.5; must exceed `TH-67`. |
| `TH-69` | `DEFAULT_DRONE_HEIGHT` | 40 m | Drone-view target altitude above ground level for a street-level press (an elevated "survey from above"). | no | TASK-025 | 25–60 (feel). |
| `TH-70` | `ROOF_CLEARANCE` | 20 m | When atop a building taller than `TH-69`, end this far above the roof. **Coupled** to the hysteresis: must be ≥ `TH-68` + margin so a rooftop drone arrival lands unambiguously "elevated" and the button flips to street view. | no | `D-B`, `M-2` (TASK-025) | ≥ `TH-68` + margin. |
| `TH-71` | `DEFAULT_FOV_DEGREES` | 50° | Default/normal FOV the drone rise (and the double-click teleport) reset to. A literal — THREE's `PerspectiveCamera` default = the inspector camera's resting FOV. **Not** 60 (the `|| 60` frustum-fit fallback is a defensive default, not the resting FOV). | no | `D-A` (TASK-025) | 45–55. |

---

## Notes on coupled / derived values

- `TH-23` = `TH-46` = `TH-48` numerically (all 1.5 m today) but are
  **three independent constants** — they share a starting value, not a
  definition. Re-tuning one must not silently move the others.
- `TH-32` is computed from `TH-29` and `TH-31` (`min`), so the
  street-level wide-FOV cap stays coherent if either input is retuned.
- `TH-56` is derived from `TH-55`.
- `TH-70` ≥ `TH-68` + margin is a **load-bearing coupling**: break it and
  the drone⇄street toggle stops flipping the button.
- `TH-17`/`TH-16` together define the live lateral cap
  `max(TH-16, TH-17 × AGL)`.
