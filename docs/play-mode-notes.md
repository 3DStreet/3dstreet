# Play Mode — Working Notes

A scratchpad for the play-mode driving feature. Not user-facing docs.
Captures intent and open questions so the next slice has context.

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
- **Partial colliders on scene content.** Ground plane + any entity
  with a `vehicles*` or `cyclists*` mixin gets a static cuboid sized
  to its bounding box (shrunk 80%). Buildings, street segments,
  street furniture, and props are still pass-through. Likely next
  step: extend the category allowlist or move to a generic
  `play-collidable` opt-in component.
- **Race on Stop before Rapier finishes loading.** `enableDriveMode`
  registers `model-loaded` listeners inside `physics.activate().then`.
  If the user clicks Stop before WASM resolves, `driveCleanup`
  already ran and the listeners get attached after cleanup with no
  one to remove them. Low-impact (`addStaticCuboid` no-ops on a freed
  world) but worth fixing — capture cleanup state on `this` and
  re-check inside the `.then`.
- **Wheel suspension/friction sliders** (suspensionStiffness,
  frictionSlip, sideFrictionStiffness) are in `drive-controls`'s
  schema but not yet plumbed through to `play-mode-vehicle` —
  `play-mode-vehicle` reads them once at `buildVehicle` from its own
  defaults, ignoring the drive-controls values.
- **Camera mode isn't persisted.** `C` cycles top-down → chase → fpv
  but the choice resets to top-down on the next Play. Could surface
  as a `PlayModeControls` field tied to `drive-controls` schema.
- **PlayModeControls polls via rAF** waiting for the player car.
  Should be replaced with a `vehicle-built` event emitted at the end
  of `play-mode-vehicle.buildVehicle`.
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
  fix without first proving they're the cause.
- **Chassis frame ≠ entity frame.** `drive-controls.vehicleSize` is in
  ENTITY frame (x=width, y=height, z=length, A-Frame -Z forward);
  `play-mode-vehicle.chassisSize` is in CHASSIS frame (x=length,
  y=height, z=width, chassis -X forward). `viewer-mode.enableDriveMode`
  swaps X↔Z and the chassis is spawned with a -π/2 yaw offset to bring
  the two frames into the same world orientation. Don't try to
  unify them — the chassis-frame convention comes from the upstream
  Rapier demo wheel layout and changing it breaks the literal port.
