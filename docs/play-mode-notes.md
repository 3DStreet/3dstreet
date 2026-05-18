# Play Mode — Working Notes

A scratchpad for the play-mode driving feature. Not user-facing docs.
Captures intent and open questions so the next slice has context.

## Traffic animation v1 (`street-traffic`)

Opt-in per managed-street. Set `playable: true` on a `managed-street`
and pressing Play animates entities along each of its lanes.

- **Knob:** `managed-street.playable` (boolean, default false). Existing
  scenes are unaffected until the user flips it.
- **Play gate:** the Play button is enabled when EITHER a
  `[drive-controls]` entity exists OR any `[managed-street]` has
  `playable: true`. See `useHasPlayable` in `PrimaryToolbar.jsx`.
- **Determinism:** every entity's position is a pure function of
  `scene-timer.elapsedTime`, the entity's lane slot index, the
  segment length, and the segment direction. Two viewers of the same
  scene at the same scene-time see identical traffic. No per-entity
  state, no RNG, no rAF accumulator coupling.
- **scene-timer wiring:** `play-mode.start()` resets the timer to 0
  and fires `timer-start`; `play-mode.stop()` fires `timer-pause`.
  The timer is the canonical clock for any subscriber that wants
  deterministic time.
- **Per-segment-type defaults** (in `street-traffic.js`):
  - drive-lane: 11.2 m/s (25 mph), `sedan-rig`, ~2 per 60m
  - bus-lane: 9.0 m/s, `bus`, ~1 per 60m
  - bike-lane: 6.0 m/s, `cyclist1`, ~3 per 60m
  - sidewalk: 1.4 m/s (real walking, not jogging), `char1`, ~6 per 60m
  - parking-lane: excluded (parked cars are static)
  - divider/grass/rail/building: no traffic
- **No pass-through within a lane** by construction: every entity in
  a given lane has identical speed, so relative velocity is zero.
  Cross-lane variation gives the visual richness.
- **Direction:** `direction: outbound` → -Z motion (mesh rotated
  180°); `inbound` → +Z (default rotation). `none` (sidewalks) →
  half the entities each way.
- **Loop:** `z(t) = ((startZ + dir*speed*t) wrap [-L/2, L/2])`. Loop
  period per lane = `length / speed`. Different lanes have different
  periods, hiding the repetition.

### What v1 is NOT

- ~~**Visual-only.**~~ Resolved: when drive-mode is also active
  (a `[drive-controls]` entity exists), traffic creates a
  kinematic-position-based Rapier body per animated entity, sized
  from a per-segment-type cuboid table (no GLB bounding-box scan
  needed). The body is updated every tick via
  `setNextKinematicTranslation/Rotation` so the dynamic player
  chassis collides with traffic correctly. Without drive-mode,
  Rapier WASM is never loaded — traffic stays visual-only.
- **drive-mode's static-collider seeder skips** entities tagged
  with `data-play-mode-traffic` (they get kinematic instead) and
  entities whose `object3D.visible === false` (the static pre-
  existing entities traffic hid). That eliminates the "player
  collides with invisible boxes where static cars used to be"
  problem.
- **No intersection coordination.** Each managed-street loops
  independently. Entities disappear into intersection regions and
  reappear at the other end of their own segment. Multi-street
  coordination is out of scope.
- **No within-lane speed variation, no overtaking, no spawning
  variation.** Pure loop, evenly spaced. The ±15% jitter discussed
  in the design conversation would reintroduce pass-through and is
  deferred.
- **No car-following / IDM / lane-change.** Real traffic-sim is a
  separate project.

### Open questions for v1.5+

- Simulation-time / physics-time coupling. **Done:** scene-timer
  gained a passive `simulationTime` field separate from the
  wall-clock `elapsedTime` (camera-path and other legacy features
  keep using elapsedTime; play-mode features use simulationTime).
  Ownership rules:
    - `play-mode-physics` advances simulationTime by exactly one
      `timestep` per completed `world.step()`. The 4-sub-step cap
      in the accumulator means slow CPUs drop wall-time rather than
      letting physics fall further behind — simulationTime lags
      wall-time and we get true slow-motion.
    - `play-mode` system tick advances simulationTime by rAF
      deltaMs only when physics is NOT active (traffic-only play
      without a driveable). Otherwise it leaves simulationTime
      alone so physics is the sole writer.
  Effect: at any given simulationTime, every machine that kept up
  has executed the same number of sub-steps from the same initial
  state. Recording/replay is now feasible — record input at each
  physics sub-step, replay by injecting at the same indices.
  (Input is still captured at rAF rate, so true cross-machine
  determinism for interactive play still needs the input log work.)
- Coprime-period stagger or seeded jitter to break the visible loop
  on long sessions.
- Crosswalk events (pedestrian crosses perpendicular to street at
  intersection) as a much higher-signal animation than parallel
  sidewalk walkers.
- Physics-time = scene-time coupling. Right now scene-timer is
  wall-clock-driven (resumes via `performance.now()` offset). When
  determinism for recordings becomes a requirement, the timer
  should advance only on completed physics sub-steps.

## Pause / sim-time HUD (toolbar)

The play-mode top toolbar (`scenegraph/Toolbar.jsx`) reuses the
editor's `PrimaryToolbar.module.scss` styling so Stop looks like the
editor's Play. To the left of Stop sits a clickable SIM readout that
doubles as the pause toggle.

- **Clock**: shows `scene-timer.simulationTime`. Wall-time is anchored
  locally in React at the moment `isPlaying` flips true — reading
  `scene-timer.elapsedTime` is unsafe because if its `timerActive`
  flag was already set, the reset to 0 in `play-mode.start()` gets
  clobbered and elapsed reverts to time-since-page-load.
- **Desync warning**: sim turns yellow when `wall - sim > 100ms`.
  Slow CPUs naturally produce this because `play-mode-physics` caps
  at 4 sub-steps per rAF frame, so wall pulls ahead of sim. The
  "Stall 2s" button in `PlayModeControls` busy-waits the main thread
  to force the case on demand.
- **Pause toggle**: clicking the SIM readout calls
  `play-mode.togglePause()`. Pause sets `this.isPaused`, mirrors
  `isPlayPaused` into zustand, and the tick guards in `play-mode`
  and `play-mode-physics` early-return — physics stops stepping, the
  passive `simulationTime` stops advancing, and traffic (which is a
  pure function of `simulationTime`) freezes alongside. The toolbar
  shifts its wall anchor forward by the pause duration on resume so
  the displayed drift doesn't include time spent paused.

## Architecture: play mode is decoupled from any single feature

"Play" is a generic lifecycle, not a synonym for drive mode.

- `play-mode` A-Frame system (`src/aframe-components/play-mode.js`)
  owns one boolean (`isPlaying`, mirrored into the zustand store as
  `useStore.getState().isPlaying`) and two scene events:
  `play-mode-start` and `play-mode-stop`. Methods: `start()`, `stop()`.
- Buttons hit the system directly. They have no knowledge of which
  features will respond:
  - Play button: `setIsInspectorEnabled(false)` then
    `scene.systems['play-mode'].start()`.
  - Stop button: `setIsInspectorEnabled(true)` — opening the inspector
    in `store.js` also calls `play-mode.stop()` as a belt-and-suspenders
    guard against state drift if the inspector is opened by any other
    path.
- Features subscribe to scene events and do their own setup/teardown:
  - **`drive-mode` component** (lives in `play-mode-vehicle.js`,
    attached to `<a-scene drive-mode>` in `index.html`). On
    `play-mode-start`: if a `[drive-controls]` entity exists, spawn
    the `play-mode-player-car`, lazy-load Rapier, seed colliders. On
    `play-mode-stop`: tear it all down.
  - **Future traffic animation** will be a sibling scene component
    (e.g. `street-traffic`) that listens for the same events
    and animates lane occupants. It will not import or depend on
    drive-mode or Rapier.
- Cross-feature coupling (drive mode + traffic active simultaneously)
  is handled inside the feature components, not at the play-mode
  layer: traffic creates kinematic Rapier bodies *only when*
  `play-mode-physics` has an active world. Otherwise it just moves
  visuals.

## Where we are (commit `829c7014`, tip of `physics-play-mode`)

- A `Play` button on the primary toolbar enters drive mode; a centered
  `Stop` button exits. Play is disabled (with explanatory tooltip)
  until at least one `[drive-controls]` entity exists in the scene —
  `useHasDriveable` watches the scene via MutationObserver.
- The editor's default `viewer-mode` preset on `#cameraRig` was changed
  from `camera-path` to `locomotion` in `index.html`. Camera-path UI
  was already gone (PR #1566); this just makes the default consistent.
- Drive mode requires a **Driveable Vehicle** entity in the scene (from
  the AddLayerPanel). A Driveable Vehicle is an entity tagged with
  `drive-controls` (which auto-injects a yellow forward-direction cone)
  plus a placeholder red box, plus a child `Vehicle Mesh` entity that
  carries the `vehicle-mesh-slot` marker component and ships with
  `mixin: sedan-taxi-rig` pre-populated. The marker is a real component
  (not a `data-*` attr) because the json-utils serializer drops plain
  data-attrs on save/reload.
- On Play, a synthetic `#play-mode-player-car` is appended to the
  scene at the Driveable Vehicle's world pose. The Vehicle Mesh's
  mixin is cloned onto the player-car inside a `0 -90 0` rotation
  wrapper (catalog vehicle glTFs are authored forward = +Z, the
  chassis controller's forward is local -X). The editor entity is
  hidden during play and restored on Stop; the play chassis suppresses
  its red placeholder box when a custom mesh is being cloned in.
- Physics: direct Rapier (`@dimforge/rapier3d-compat`), code-split into
  its own webpack chunk and lazy-loaded on first activate(). Ported
  literally from `kfarr/aframe-rapier-examples` (Isaac Mason's
  `dynamic-raycast-vehicle-controller`).
- Scene content gets static colliders on Play: a flat ground plane,
  plus a static cuboid (80% of bounding box) for every entity whose
  mixin's `<a-mixin category>` starts with `vehicles` or `cyclists`.
  Re-applied on `model-loaded` so late-loading GLBs still get colliders.
- A top-right `PlayModeControls` panel (only mounted when the inspector
  is closed) exposes engine force, brake, steer angle. Changes write
  through to both the scene's `drive-controls` (canonical, persisted)
  and the running `play-mode-vehicle` (live). It rAF-polls until the
  player car's `vehicle` is built, then renders.
- Auto-fit wheels scale from `chassisSize` (which itself is derived
  from drive-controls' `vehicleSize`, with the X↔Z frame swap); explicit
  override fields exist for `wheelRadius` and `wheelWidth`.
- Camera modes: top-down (default), chase (smoothed lerp behind the
  car), fpv (driver-eye). Cycle in-play with the `C` key. Smoothing
  state resets when leaving chase so re-entering snaps cleanly.
  `updateCamera` converts world → camera-parent-local explicitly
  because the camera is a child of `cameraRig`.

## Direction (Kieran)

> _"this method of having this custom drivable vehicle is OK but it
> gets stale quickly if it's saved in a file; instead as a user i can
> be in a drive play mode and i can drive any vehicle in the scene,
> any vehicle should be playable; over time there would be better
> tuning"_

### Reframing

Today, "what you can drive" is a **scene authoring decision** (you add
the Driveable Vehicle entity, save the scene, anyone who loads that
scene drives that). The scene file becomes stale quickly: the choice
of vehicle is baked in.

Better model: **any vehicle in the scene is potentially drivable, and
which one you drive is a play-time decision** — not part of the saved
scene.

Implications:

- `drive-controls` per vehicle stops being the right shape. We don't
  want to mark up every parked car with `drive-controls`.
- "Driveable Vehicle" as an AddLayerPanel template should probably go
  away (or stay as a quick-add for an empty scene).
- Tuning has to live somewhere outside the vehicle entity — global
  defaults plus per-vehicle-type overrides perhaps.

### Possible mechanics

1. **Click-to-drive while in play mode.** User enters Play (no specific
   vehicle pre-tagged); a top-down view shows all vehicles; clicking
   any vehicle attaches the controller to it. Spacebar / Esc returns
   to spectator camera. Vehicle stays where it is on Stop.
2. **Cycle through vehicles with a key.** Tab / [ / ] cycles to the
   next vehicle in the scene.
3. **Spectator mode by default.** Play just enters a free-camera
   ride-along; clicking a vehicle takes control.

### Tuning storage

If any vehicle is drivable, tuning probably lives:

- **Per vehicle TYPE** (mixin id / category). E.g. `sedan-rig` defaults
  vs `box-truck-rig` defaults. Stored once globally, not per-instance.
- **Per scene override** for the cameraRig or scene root, for global
  values like gravity, camera height, default engine force.
- **Per individual entity** only when truly needed (a hand-tuned
  scripted vehicle); rare enough to justify the extra UI.

### Vehicle detection

How do we identify which entities are "vehicles"?

- Catalog category match: `vehicles-rigged`, `vehicles-transit`,
  `vehicles`. Robust because it's data, not heuristic.
- Look up the mixin id, check the registered `<a-mixin category=...>`.
- Fallback: any entity with a model whose bounding box is car-shaped.
  Probably overkill.

### Other "play modes"

The same architecture should generalize: a "Camera Path Object" for
camera-path mode, a "Player Avatar" for first-person walking, etc.
Each play mode introspects the scene for its required object type.

## Smaller open issues

- **Mesh scale ≠ vehicleSize.** A sedan-taxi-rig mesh comes in at
  real-car size (~4.5m); the default `vehicleSize` is 0.8 × 0.4 × 1.6,
  so the wheels look small under the mesh. The tuk-tuk mesh in the
  catalog is closer to the default `vehicleSize` and feels right
  without retuning. Eventual fix: auto-fit `vehicleSize` from the
  mesh's bounding box, or drop `vehicleSize` entirely once we move to
  per-mixin tuning.
- **Static colliders cover:** flat ground plane, raised sidewalk
  slabs (top at +0.15m, mountable curbs by virtue of the raycast
  vehicle controller's per-wheel suspension), and bounding-box
  cuboids for any entity whose mixin's category starts with
  `vehicles`, `cyclists`, `buildings`, `fixtures` (benches,
  shelters, food carts, light poles), or `dividers` (jersey
  barriers, bollards, planters, cones). Still pass-through:
  `plants` (tree canopy AABB would feel unfair — needs trunk-only
  collider) and `signs` (thin posts on most variants). Light-pole
  and cone tall+thin AABBs inside the included categories are an
  accepted minor cost — revisit when a user complains.
- **Wheel suspension/friction sliders** (suspensionStiffness,
  frictionSlip, sideFrictionStiffness) are in `drive-controls`'s
  schema but not yet plumbed through to `play-mode-vehicle` —
  `play-mode-vehicle` reads them once at `buildVehicle` from its own
  defaults, ignoring the drive-controls values.
- **Camera mode isn't persisted.** `C` cycles top-down → chase → fpv
  but the choice resets to top-down on the next Play. Could surface
  as a `PlayModeControls` field tied to `drive-controls` schema.
- **Hardcoded default mixin (`sedan-taxi-rig`)** in
  `createDriveableVehicle`. If catalog renames it, the AddLayerPanel
  template silently produces an empty mesh slot.
- **No undo for play-mode actions.** Driving doesn't go through the
  command/history system. Probably never should — but worth noting.

## Decisions made (don't redo without good reason)

- **Direct Rapier, not the wrapper.** A previous wrapper-mediated
  attempt produced an undiagnosable energy sink. Lesson: when the
  wrapper is the obstacle, go around. See
  https://github.com/kfarr/aframe-rapier-examples for the verified
  baseline.
- **Wheel/chassis tuning is a literal port of the Isaac Mason demo.**
  Don't tune from first principles — start from values known to feel
  right and deviate from there.
- **No re-introduction of camera-path mode UI.** PR #1566 removed it
  on purpose; play mode = drive, not the old auto-circle camera.
- **Don't re-enable cursor-teleport / look-controls / movement-controls
  on Edit.** Doing so was suspected of breaking first-click selection
  in the editor (controls intercepting clicks). `Toolbar.handleStop`
  calls `viewer-mode.disableAllModes()` and then just flips
  `setIsInspectorEnabled(true)` — nothing else. **NOTE: this did not
  actually fix the bug.** After a Play → Stop cycle, the first click
  on some scene objects still falls through and a second click is
  required to select. Root cause still unknown — leaving these
  controls disabled on Stop didn't help, so the culprit is somewhere
  else (stale raycaster state? lingering play-mode listener? the
  hidden Driveable Vehicle re-appearing under the cursor?). Worth
  investigating next; don't re-enable the controls as part of the
  fix without first proving they're the cause. **Resolved:** logs
  from `window.__DEBUG_PLAY_CLICK` showed the raycaster's `click`
  handler in `src/editor/lib/raycaster.js` was rejecting every
  post-Stop click because of a strict `onDownPosition.distanceTo(
  onUpPosition) === 0` check. Pre-Play, mouse-down/up positions
  happened to be exactly equal; post-Stop, layout shifts and
  control-settling perturb the container's bounding rect so the
  same physical click produces 0.005-0.12 normalized-coord drift
  and gets discarded as a drag. Loosened to `< 0.01` (≈10-20 px).
  The instrumentation behind the `__DEBUG_PLAY_CLICK` flag stays
  in place for the next time something weird happens here.
- **Perf budget bumped to 3.2 MiB** in `webpack.prod.config.js` to
  fit the play-mode JS (~52 KB net add to the core bundle on top
  of main). Lazy-loading play-mode itself is feasible but the
  win-per-effort is poor next to the structural wins listed in
  issue #1624 (GLTFExporter dynamic import, async catalog.json,
  editor code-split). Treat play-mode lazy-loading as part of
  that work, not this branch.
- **Chassis frame ≠ entity frame.** `drive-controls.vehicleSize` is in
  ENTITY frame (x=width, y=height, z=length, A-Frame -Z forward);
  `play-mode-vehicle.chassisSize` is in CHASSIS frame (x=length,
  y=height, z=width, chassis -X forward). `viewer-mode.enableDriveMode`
  swaps X↔Z and the chassis is spawned with a -π/2 yaw offset to bring
  the two frames into the same world orientation. Don't try to
  unify them — the chassis-frame convention comes from the upstream
  Rapier demo wheel layout and changing it breaks the literal port.

## PARKED: full chassis teardown on every Stop→Play (flicker)

Right now `play-mode.start` ends with `mode-manager.setMode('drive')`
and `play-mode.stop` calls `setMode('editor')`. Drive-mode's `enter`
hook spawns the chassis + activates Rapier + seeds segment colliders;
its `exit` hook tears all of that down. So a Stop→Play cycle does a
full rebuild — visible as a brief flicker / first-time-build look on
the chassis.

The right model (per discussion 2026-05-17): mode changes own
setup/teardown; Play/Stop within drive mode should just pause/resume
the simulation. Chassis stays alive across Stop→Play cycles. Only
explicit mode changes (drive → editor, future drive → locomotion)
trigger drive-mode `enter`/`exit`.

Open design questions to settle before fixing:
- When stopped (but still in drive mode), is the chassis visible?
  Frozen in place, hidden, or restored to spawn?
- Does the inspector treat the live chassis as a selectable entity
  while stopped, or stay hidden from the scene-graph?
- What invalidates drive-mode state — only removing the
  `[drive-controls]` entity, or any edit to it?

Don't tackle until the asset-system work lands.
