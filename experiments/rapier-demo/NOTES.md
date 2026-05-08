# Physics Play Mode — Working Notes

## Approach

We are doing this in **two phases**:

1. **Phase 1 (current): Validate physics in isolation.** A standalone A-Frame
   + Rapier demo lives in this folder. No 3DStreet dependencies, no React,
   no inspector. The goal is to nail vehicle feel, collision behavior, and
   any other physics primitives we want (peds, NPC traffic, etc.) before
   integrating anything back into the main app.
2. **Phase 2 (next): Port to 3DStreet.** Once Phase 1 feels good and we
   know the exact set of components/parameters we want, we re-do the
   integration into 3DStreet cleanly — driven by a Play button in the
   editor toolbar that toggles the inspector off and tags real scene
   entities with physics bodies.

The previous attempt skipped Phase 1 and tried to integrate directly. It
failed in several layers at once (entity selection, body sync, character
controller collisions) and was hard to debug because failures could be in
any of: 3DStreet's entity tree, Rapier wrapper behavior, or vehicle
controls. Splitting into two phases lets us debug each in isolation.

## Phase 1 status

Demo runs at `experiments/rapier-demo/index.html`. Static-serve the dir
(`python3 -m http.server 8000`) — `file://` won't work because the Rapier
wrapper loads as an ES module.

### What works

- A-Frame + Rapier physics via the `aframe-rapier-physics` wrapper.
- Drive a Dynamic-body box-car with WASD.
- Real Rapier collisions against Fixed walls and Fixed parked cars.
- Bumping into Dynamic peds/bikes shoves them around.
- Steering inverts in reverse to match driving-game convention.
- Top-right tuning panel (live sliders): max speed, turn rate, linear
  damping, angular damping, camera height.

### Vehicle physics decisions (current)

- **Body type: Dynamic** (NOT KinematicVelocityBased). The wrapper
  drives kinematic bodies via `setNextKinematicTranslation(getWorldPosition(object))`
  each step, and Rapier's `KinematicCharacterController.computeColliderMovement`
  does not appear to detect static colliders correctly in that setup —
  movement was reported as fully unblocked even when colliders existed.
  Dynamic bodies use Rapier's normal contact solver, which works.
- **Rotation locks:** `body.setEnabledRotations(false, true, false, true)`
  applied imperatively after `body-loaded`. The wrapper schema only
  exposes `linearDamping`/`angularDamping` — lock flags must be set on
  the underlying Rapier body. Locking X/Z rotation prevents tipping.
- **Snappy feel:** `setLinvel`/`setAngvel` directly each tick (no inertia
  ramp), plus high damping (`linearDamping: 3.0`, `angularDamping: 10.0`)
  so the car stops within ~⅓s on key release.
- **Top-down hardcoded camera.** `lookAt` on a parent rig didn't
  propagate to a child A-Frame `camera` entity (suspected camera
  component re-asserting matrix). Direct `position.set` + fixed
  `rotation.set(-π/2, 0, 0)` works.

### Verified via DevTools console

```js
document.querySelectorAll('[rapier-shape]').forEach(e => {
  const s = e.components['rapier-shape'];
  console.log(e.getAttribute('material')?.color, 'collider:', !!s?.collider, 'body:', !!e.components['rapier-body']?.body);
});
```

All entities show `collider: true, body: true` — `fit: true` works on
A-Frame primitive geometry (boxes, planes, cylinders).

### Updates after first round of feel tuning

- **Speed-locked steering.** Yaw rate now scales with planar speed; the
  car can't pivot at a standstill. Sign of velocity-along-heading flips
  the steering when reversing.
- **Coast on accelerator release.** `setLinvel` is only called when the
  player is actively pressing forward/back; otherwise `linearDamping`
  decelerates naturally, which preserves the ability to steer while
  coasting (and feels much closer to a real car).

## Failed attempt at a raycast-wheel vehicle (deleted)

We spent a long session trying to build a "proper" raycast-wheel
vehicle on top of Rapier's `DynamicRayCastVehicleController` via the
`aframe-rapier-physics` wrapper. The car always hit a hard terminal
velocity (~0.15 m/s for any reasonable engine force, scaling linearly
with engine), and we never diagnosed the opposing force. We tried:

- Real-world scale (2×1.2×4 m, 480 kg chassis) and Rapier-rust-example
  scale (1.2 m chassis, ~12 kg).
- Explicit `mass:` on the chassis collider (the wrapper's `setMass(1)`
  default overrides density unless you set `mass: 0`).
- Putting the chassis geometry directly on the rapier-body entity (the
  wrapper's `object3dset` listener doesn't fire for child meshes).
- Suspension stiffness from 100 to 5000, damping from 10 to 800.
- Friction slip from 1 to 50, side friction stiffness from 1 to 2.5.
- Linear damping 0, chassis collider friction 0.
- Per-tick diagnostics confirmed `wheelForwardImpulse(i)` matched
  `engine_force × dt` exactly — engine torque was reaching the
  chassis at the right magnitude — yet the chassis still wouldn't
  accelerate past the plateau.

The next attempt should not start from Rapier docs again. See
`../NEXT_PROMPT.md` — it instructs the next agent to find a
verifiably-working JS implementation of a Rapier raycast vehicle and
port it byte-for-byte before adapting anything.

## Phase 2 plan (when a working vehicle is locked in)

Same as before — see "Phase 2 plan" above. The integration should be
a thin tagging layer over whichever vehicle setup ends up working
(Dynamic-body baseline OR raycast vehicle, whichever feels right and
performs in the real 3DStreet scene).

## Open questions / next steps for Phase 1

- **NPC traffic.** Add a `npc-vehicle` component that drives Dynamic-body
  cars along a path — does linvel-based path-follow feel okay against
  the player car? Or do we need waypoint+slerp?
- **Pedestrians.** Constant forward drift via `setLinvel`. Should they
  steer around obstacles (some lookahead raycast) or just stop on
  contact?
- **Better camera.** Top-down works but a third-person follow camera
  with momentum is way better for shareability. Need to figure out why
  parent-rig + lookAt didn't propagate, or just drive the camera entity
  directly.
- **Mobile / touch.** Out of scope for Phase 1, note for later.

## Phase 2 plan (when Phase 1 is locked in)

The integration should be **a thin tagging layer over the proven physics
setup from this demo**, not a re-derivation:

1. Add the Rapier CDN script + `rapier-physics` system to `index.html`.
2. New A-Frame component `physics-auto-body` that maps mixin `category`
   → body type (vehicles → Dynamic with rotation locks, peds → Dynamic
   with rotation locks, fixtures/buildings → Fixed). Reuses the
   tuned-from-demo body params.
3. New `vehicle-controls` component — direct port from the demo, no
   character controller.
4. Play button in `PrimaryToolbar`: on click, set `isInspectorEnabled`
   to false (the F5/`5` shortcut path — known good) AND set
   `viewer-mode="preset:play"`. On Stop (the bottom-left toolbar's
   "Edit" button, relabeled "Stop" while play-mode is active), reverse
   both.
5. `viewer-mode`'s play preset: snapshot every catalog-instantiated
   entity's transform (filter `<a-mixin>` definitions and anything
   inside `<a-assets>`), tag each with `physics-auto-body`, pick a
   vehicle (selected entity if it's a vehicle, else first vehicle in
   scene), attach `vehicle-controls` + follow camera. On disable,
   reverse: detach controls, remove auto-bodies, restore transforms.
   Snapshot is in-memory only — must NOT touch the save pipeline.
6. **Editor shortcut bypass while in play mode.** When the scene has
   `.play-mode` class, `shouldCaptureKeyEvent` in
   `src/editor/lib/shortcuts.js` returns false so editor WASD shortcuts
   don't fight vehicle-controls.

The previous attempt at this is in git history (branch
`physics-play-mode`, commits before this NOTES.md was added) — refer
back if needed but expect the Phase 1 tuning to differ.

## Why we backed out the previous integration

The earlier code tried to do all of the above at once and never got past
"Play button doesn't enter play mode" because the inspector was still
holding the camera. After fixing that, the next layer (entity tagging
inside `enablePlayMode`) hit a new bug (`taggable count = 0`). Diagnosing
each new layer required reloading the editor with cloud scenes; cycle
time was minutes per attempt. The Phase 1 demo cycles in seconds.
