# Fly mode (helicopter) — remaining issues handoff

Playtest feedback from Kieran, 2026-08-30, on branch
`claude/helicopter-flying-mechanics-k6938x`. Context: that session already
shipped three tweaks (uncommitted in the working tree at time of writing):
wind-wash gain cut to ~1/3, the speed FOV kick removed entirely, and the
commanded pitch cap split from roll (`MAX_PITCH_TILT` 1.0 rad ≈ 57° vs
`MAX_ROLL_TILT` 0.55 rad ≈ 31°) in `heli-flight-model.js`. The issues below
survived that pass.

**Update 2026-09-05 (kids' playtest pass):** vertical control reworked to a
velocity command — held W/S sets a climb/descent rate, release settles to a
gentle sink near hover; the old latching collective lever (release W →
climb forever, the throttle-oscillation complaint) is gone.
`MAX_PITCH_TILT` cut to 0.42 rad ≈ 24° with bank-compensated thrust +
`K_CYCLIC_DRIVE` and lower `HORIZ_DRAG` so full stick cruises ~115 km/h at
a sane attitude (supersedes section 6's proposals). Tiles penetration
(section 2) root-caused and fixed: triangle-budget leak, LOD-swap collider
gap, and no CCD — see the revised section 2. Sections 1, 3, 5, 7 and the
GLB swap (4) remain open.

Code map: flight math `src/aframe-components/play/heli-flight-model.js`
(pure, tests in `test/core/heli-flight-model.test.js`); rig/camera/audio
driver `play-mode-helicopter.js`; procedural audio `heli-sound.js`; gamepad
mapping `play-mode.js` `pollGamepad` (heli branch ~line 349); colliders
`scene-colliders.js` + `tiles-colliders.js`; physics stepping
`play-mode-vehicle.js` (`play-mode-physics` system, ~line 284).

## 1. Wind sound is still awful

Even after cutting the gain (cap 0.3 → 0.1, slope 0.008 → 0.0025 per m/s in
`heliSoundParams`), the wind layer reads as harsh noise. The problem is
probably timbre, not just level: it's raw white noise through a single
1200 Hz highpass (`heli-sound.js` layer 3). Options, roughly in order of
effort:

- Kill the layer entirely and let chop + turbine carry speed feel (chop
  filter frequency could rise slightly with airspeed instead).
- Reshape it: bandpass (~400–900 Hz, low Q) instead of highpass, and/or a
  second gentle lowpass so it's a "whoosh" not a "hiss"; modulate the filter
  frequency, not just gain, with speed.
- Replace the whole synth with a small looped sample set (would abandon the
  "fully procedural, no downloads" design premise — decide deliberately).

`heliSoundParams` is pure and unit-tested (`test/core/heli-sound.test.js`),
so retune there first.

## 2. Google 3D Tiles don't stop descent — FIXED 2026-09-05

Basic tiles collision worked; what remained was intermittent penetration
"at speed and/or far from the spawn point". Three concrete causes found in
`tiles-colliders.js` / `play-mode-helicopter.js`, all fixed (with unit
tests in `test/core/tiles-colliders.test.js`):

- Triangle-budget leak: `totalTriangles` was only ever incremented — tiles
  freed on LOD/frustum changes never returned their triangles, so a long
  flight exhausted the 2M budget and seeding silently stopped ("falls
  through the ground far from spawn"). Budget is now returned on free.
- LOD-swap collider gap: a tile leaving the selection freed its trimesh
  immediately, while its replacements waited on the 120 ms build queue —
  a collider-free window under a fast-moving player. Outgoing tiles are
  now retired and their bodies freed only once the build queue is empty.
- No CCD on the heli chassis: powered dives pass 30 m/s (0.5 m per 60 Hz
  sub-step), enough to tunnel through the paper-thin tile trimeshes.
  `setCcdEnabled(true)` on the chassis body.

Still worth a look if reports continue: stale `matrixWorld` if
`street-geo` repositions the tileset root mid-session, and per-tile
`MAX_TILE_VERTICES` skips (console-warned).

## 3. Helicopter doesn't collide with scene objects

Symptom: flies through catalog obstacles/buildings. As with tiles, the
wiring exists: `seedSegmentColliders` + `seedObstacleColliders` are called
in the fly bootstrap (~line 840), and the chassis is a plain dynamic cuboid
(`COLLIDER_HALF`, `buildHelicopter` ~line 347) with collision events on.
Suspects:

- `seedObstacleColliders` scope: it sizes cuboids from world bboxes
  (batching-aware via `_batchLocalBbox` — see the batching gotcha in
  CLAUDE.md). Check which selectors it seeds; large buildings vs small
  obstacles may differ, and the 80% bbox shrink makes near-misses generous.
- Altitude: obstacles are seeded once at play start from ground-level
  entities; verify seeding actually ran in the fly session (same
  `[play-colliders] seeded` log) rather than assuming.
- Verify against the car in the SAME scene: if the car collides and the
  heli doesn't, look at chassis collider size vs mesh (the visual is much
  larger than the collider disc note at line ~64).

## 4. Replace DIY mesh with a real GLB — PARTLY ADDRESSED 2026-09-04

Kieran's second-round feedback: "too blocky, not even low poly", and
the aircraft should represent a specific type — the Eurocopter MH-65
Dolphin (USCG SAR helicopter; reference model
https://sketchfab.com/3d-models/mh-65-dolphin-7e35835b0f434755993232e615d4f768).
`helicopter-mesh.js` was rebuilt as an MH-65-class silhouette at real
scale (~12 m fuselage, 4-blade ~12 m rotor, fenestron tail fan in a
swept fin, tricycle wheeled gear, SAR orange with white boom band and
dark radome) using spheres / cones / tori instead of boxes. Still
procedural — a real GLB remains the end state, with the same
requirements as before: license compatible with CC BY-NC 4.0 (check the
Sketchfab model's license before using it), nose facing -Z, separate
main-rotor and fan nodes so `play-mode-helicopter` can keep spinning
them via `rotorSpeed` / `rotorTiltX/Z`, distributed via
3dstreet-assets-dist + a `catalog.json` entry.

Knock-on changes from the size jump (all in `play-mode-helicopter.js`):
`COLLIDER_HALF` is now the real hull, offset aft by `COLLIDER_OFFSET_Z`;
mass/inertia are pinned to the OLD reference box via
`setMassProperties` (`HANDLING_*`) so the mass-scaled flight-model
torques keep the same feel — swapping in a GLB must keep that; chase
cam leash 24 m / 8 m; FPV seat 3 m ahead of the origin; the layer
panel's invisible click box is 2.2 x 3.6 x 12 m. `heli-sound` blade-pass
now assumes 4 blades.

## 5. Right stick isn't intuitive — expected steering

Current mapping (`play-mode.js` ~349): right stick = chase-cam orbit/zoom
(carried over from drive mode), yaw is on LB/RB bumpers. Kieran expects the
right stick to STEER (yaw). Proposed remap to the twin-stick shooter / GTA
convention:

- Right stick X → yaw pedals (`yawAxis`), replacing LB/RB (keep bumpers as
  secondary).
- Camera orbit moves to... nothing? Chase cam already auto-follows; mouse
  drag still orbits. Or keep right-stick-Y for zoom only.
- FPV free-look currently owns the right stick in FPV mode — keep that, or
  yaw-on-stick applies there too (probably fine: FPV look could move to
  d-pad or just yaw the aircraft).

Talk through with Kieran before implementing (design-approach-first
preference), but the core ask is clear: right stick X must turn the nose.

## 6. Left stick forward ≠ enough forward speed — RETUNED AGAIN 2026-09-04

Resolved by the vertical-control rework rather than any of the proposals
below: W/RT now commands a climb RATE (not thrust), so holding it while
pitched forward climbs at a bounded ~9 m/s instead of compounding, and
releasing it levels off. Forward speed comes from bank-compensated thrust
plus a cyclic drive force at a modest 24° commanded pitch (~115 km/h at
full stick, reaching 20 m/s in ~4.5 s). If "holding RT as gas" still reads
wrong in a feel test, the auto-trim-vs-pitch idea (scale climb command
down with commanded pitch) remains the right next lever.

Second round: "max forward speed is still kinda slow" at ~33 m/s.
Retuned for the MH-65-class airframe in `heli-flight-model.js`:
`HORIZ_DRAG` 0.22 → 0.145, `K_CYCLIC_DRIVE` 3.0 → 3.6 (roll gets half
of it via `ROLL_DRIVE_FRAC` so a sideways slide no longer outruns
forward cruise), `VERT_DRAG` 0.08 → 0.06. Full stick now cruises ~55 m/s
(~200 km/h; the real aircraft does ~75 m/s) and reaches 20 m/s in ~3 s
at the same 24° visual pitch. If that still reads slow, the next levers
are `HORIZ_DRAG` down to ~0.12 (~65 m/s) or nudging `MAX_PITCH_TILT`.
Vertical rates were then raised to match ("like a snail compared to
forward"): `MAX_CLIMB_RATE` 9 → 20 m/s, `MAX_DESCENT_RATE` 9 → 22 m/s,
both reachable in ~2 s at the default `liftPower` 2.2.

Still worth verifying on real hardware: the pad's `pitchAxis` isn't scaled
down anywhere between `pollGamepad` and `readInputAxes`.

## 7. Frame jumps at speed (heli AND cars)

Symptom: ~1 m single-frame position jump forward/back, magnitude scales
with speed. Near-certain cause: fixed-timestep accumulator with NO render
interpolation. `play-mode-physics.tick` (`play-mode-vehicle.js` ~line 296)
steps `world.step()` 0–4 times per rAF at a fixed 1/60 timestep and the
sync snaps `el.object3D` to the body pose after stepping. On a display
whose rAF isn't 60 Hz (120 Hz / ProMotion) frames alternate 0 and 1
sub-steps; at 30 m/s one 1/60 step is 0.5 m, two accumulated steps 1 m —
exactly the reported jump, and it explains why cars show it too.

Standard fix: keep the fixed step, store each body's previous pose, and
render `lerp/slerp(prev, curr, physAcc / timestep)`. Touches only the sync
path in the `play-mode-physics` system, benefits car + heli + kinematic
traffic twins at once. Watch out: `scene-timer.advanceSimulation` is driven
per sub-step — interpolation must be render-only, never feed back into
simulation or replay determinism.

## Suggested order

7 (jumpiness — biggest cross-cutting feel win), 6 + 5 together (one
control-feel pass, needs a design chat first), 2 + 3 together (one
collision debugging session in a real scene), 1 (audio taste pass), 4
(asset work, independent of everything else).
