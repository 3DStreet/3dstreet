# Fly mode (helicopter) — remaining issues handoff

Playtest feedback from Kieran, 2026-08-30, on branch
`claude/helicopter-flying-mechanics-k6938x`. Context: that session already
shipped three tweaks (uncommitted in the working tree at time of writing):
wind-wash gain cut to ~1/3, the speed FOV kick removed entirely, and the
commanded pitch cap split from roll (`MAX_PITCH_TILT` 1.0 rad ≈ 57° vs
`MAX_ROLL_TILT` 0.55 rad ≈ 31°) in `heli-flight-model.js`. The issues below
survived that pass.

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

## 2. Google 3D Tiles don't stop descent

Symptom: helicopter descends straight through tile terrain/buildings.
`attachTilesColliders` IS wired for fly mode (`play-mode-helicopter.js`
~line 830, inside the fly-mode bootstrap's `physics.activate().then`), so
this is a "wired but not working" bug, not a missing feature. Suspects to
check in-browser with a tileset scene:

- Seeding cadence/budget: trimeshes build through a queue (3 tiles per
  120 ms pass, `MAX_TOTAL_TRIANGLES` 2M cap in `tiles-colliders.js`) —
  over-budget tiles are skipped with a console warning and fast flight may
  outrun the queue.
- LOD tracking: colliders mirror the renderer's `visibleTiles` selection via
  `tile-visibility-change`. If the event listener attaches after the initial
  selection settled, the already-visible tiles may never get bodies (only
  subsequent swaps would).
- Transform: trimeshes are baked from `matrixWorld` at attach time; if
  `street-geo` repositions the tileset root afterward the physics mesh is
  stale.
- Note the car reportedly works with tiles colliders (same module) — diff
  the two bootstraps' ordering first.

Debug: `[play-colliders]` console logs, and count `world.colliders` after
seeding settles.

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

## 4. Replace DIY mesh with a real GLB

`helicopter-mesh.js` (procedural basic-geometry) should be swapped for a
downloaded GLB. Requirements: license compatible with CC BY-NC 4.0 asset
policy, nose facing -Z (rig convention), separate rotor node(s) so
`play-mode-helicopter` can keep spinning them (`rotorSpeed`, and the
rotor-tilt feedback `rotorTiltX/Z` at ~line 505 — can be dropped if the GLB
doesn't split the hub). Distribution: via 3dstreet-assets-dist + a
`catalog.json` entry, like other vehicles; the `[fly-controls]` source
entity and the spawned play twin both need it. Keep the procedural mesh as
fallback or delete it — decide with Kieran.

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

## 6. Left stick forward ≠ enough forward speed

"It just flies up when I accelerate and push forward." Mechanics: RT is
collective (climb), left-stick-up is pitch. At full collective + full
forward pitch (~57° after this session's change) vertical thrust is still
~1.2g, so holding RT while pitched forward climbs. The deeper pitch cap
helped top speed but not the instinct — players hold RT as "gas".

Candidate fixes (pick after a feel test):

- Collective auto-trim vs pitch: scale the effective climb command down as
  commanded pitch increases (full stick forward + full RT ≈ level fast
  flight; climb only when stick is centered). This matches the GTA feel and
  is a small change in `computeHeliForces`/`stepHeliState`.
- Or raise `MAX_PITCH_TILT` further (1.15 rad ≈ 66° makes full-collective
  vertical component < 1g → pitching forward hard actually descends).
- Or add forward-speed-dependent lift loss. (Probably overkill.)

Also verify the analog path end-to-end: keyboard arrows give full ±1 pitch,
but check the pad's `pitchAxis` isn't scaled down anywhere between
`pollGamepad` and `readInputAxes`.

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
