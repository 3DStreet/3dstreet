# Fresh-context prompt: build a known-good arcade vehicle demo

## Use this prompt verbatim in a new conversation

---

I'm building a physics-driven arcade vehicle for the 3DStreet web app
(A-Frame + three.js urban planning tool). I want to drive a car with
WASD around a flat scene and bump into static obstacles. This will
later be ported into the main app, but for now it lives in
`experiments/` as a standalone HTML demo.

**Current state:**

- `experiments/rapier-demo/index.html` works well and feels good. It
  uses a single Dynamic rigid body for the whole car (no per-wheel
  physics) with `setLinvel`/`setAngvel` directly. Speed-locked
  steering. This is the baseline. **DO NOT TOUCH IT.**
- The previous attempt at a "proper" raycast-wheel vehicle using
  Rapier's `DynamicRayCastVehicleController` failed. We tried real
  scale (480 kg chassis) and the Rapier-rust-example tiny scale (12 kg
  chassis), through the `aframe-rapier-physics` wrapper. In both
  cases the car would creep at ~0.15 m/s no matter what engine force
  we set, terminal velocity scaled linearly with engine force, and
  many hours of tuning suspension stiffness/damping/friction did not
  fix it. We never figured out what was eating the energy. That code
  has been deleted.

**What I need from you:**

Build a NEW standalone demo at `experiments/rapier-vehicle/` that is
a proven raycast-wheel vehicle. **Do not derive tuning from Rapier
docs or first principles.** Find a working JavaScript implementation
of a Rapier raycast vehicle online and port it as literally as
possible — same scale, same numbers, same update loop. Then adapt
the rendering layer to A-Frame.

Specifically:

1. **Search first, code second.** Find at least one working
   implementation. Good candidates to look for:
   - The Rapier.js testbed examples directory
     (https://github.com/dimforge/rapier.js — check `testbed3d/`
     and `examples3d/`, including any Rust source the JS testbed
     might mirror)
   - Any JS/TS project on GitHub or CodeSandbox that uses
     `world.createVehicleController` AND drives the car interactively
   - Any blog post / tutorial walking through a working setup
   - The Rust `examples3d/vehicle_controller3.rs` in dimforge/rapier
     PLUS the testbed harness that wires inputs to it (the
     `vehicle_controller3.rs` file alone doesn't include input/engine
     wiring — it's set by `testbed.set_vehicle_controller()` which
     does the actual driving logic). Find that wiring.

   If after a serious search you can't find a working JS reference,
   STOP and tell me. Don't guess at the tuning again.

2. **Port literally.** Once you find the reference, mirror the
   chassis dimensions, density/mass, suspension rest length, wheel
   radius, all `setWheel*` tuning calls, max engine force, max brake
   force, max steering angle, AND the per-frame update order — all
   of it byte-for-byte. The whole point is to start from something
   that drives correctly so we have a known-good baseline to deviate
   from.

3. **Use the same wrapper if possible.** The demo should use
   `https://cdn.jsdelivr.net/gh/Elettrotecnica/aframe-rapier-physics@43f389f46e4a10a40a03792654039923a69b3e3b/aframe-rapier.js`
   so that what we build can later be ported into 3DStreet (which
   uses this wrapper). However, if the wrapper is the obstacle —
   e.g., it doesn't expose a hook we need or it interferes with the
   vehicle controller — go around it: import Rapier directly via
   ES modules and roll a minimal A-Frame integration. Document the
   choice in a comment at the top of the file.

4. **Match `rapier-demo`'s scaffolding.** Same flat ground, same
   perimeter walls, same parked-car obstacles, same top-down camera,
   same WASD. Yellow forward-direction indicator on the chassis so
   I can verify which way it thinks "forward" is. Tuning panel of
   sliders for the values that actually move the needle on feel.

5. **Verify before declaring done.** Confirm the car: (a) drives
   forward at a believable speed (>5 m/s in a few seconds of
   accelerator-held); (b) front wheels visibly turn when steering;
   (c) chassis actually rotates (yaws) when steered, not just
   strafes; (d) collides solidly with walls and parked cars. If any
   of these are wrong, fix them — don't ship a broken-feeling
   raycast vehicle and tell me to tune sliders to fix it.

**Important context from the failed previous attempt** (so you don't
repeat the same dead ends):

- The wrapper's `rapier-shape` calls both `setDensity(options.density)`
  and `setMass(options.mass)` on the ColliderDesc. `setMass(1)` (the
  schema default) silently overrides any density. To use density-
  derived mass, you must explicitly pass `mass: 0`. To set explicit
  mass, set `mass: <value>`.
- The wrapper's `createCollider` only fires when an `object3dset`
  event of type `'mesh'` lands on the entity itself — child entities
  with geometry don't trigger it. So the chassis box geometry must
  live directly on the rapier-body entity, not as a child.
- `friction_slip < ~5` makes wheel-ground lateral grip too low and
  steered front wheels just slide ("strafe" feeling) instead of
  redirecting the chassis. Default 10.5 is fine.
- Rapier vehicle controller's `wheelForwardImpulse(i)` reports the
  exact impulse applied to the chassis at that wheel. Use it to
  verify engine force is actually reaching the wheels.
- The previous attempt got `wheelForwardImpulse` matching expected
  engine_force × dt exactly, but the chassis still terminaled at
  ~0.15 m/s under 2000 N engine on a 480 kg chassis. We never
  diagnosed the opposing force. **If you hit the same plateau,
  switch to direct Rapier integration (skip the wrapper for the
  player chassis) before spending more time tuning.**

Show me the demo running. Don't touch `rapier-demo/` or anything
outside `experiments/`.

---

## Notes for me (Kieran) before pasting this prompt

- Save this file. The next session won't have this context unless you
  paste the prompt above.
- The prompt is long but the length matters — every paragraph blocks
  a specific previous failure mode. Don't trim.
- If the next agent says "I can't find a working reference," that's a
  real signal — it means the wrapper or our setup is the problem and
  the answer is to abandon the wrapper for the vehicle, not to keep
  tuning.
