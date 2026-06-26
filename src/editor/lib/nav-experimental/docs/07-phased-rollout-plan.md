# 7 — Phased Rollout Plan

*Audience: Kieran + Diarmid. One page so we share the same picture of what
ships when, and why each stage is safe to release on its own. This is the
plan behind draft PR #14 ("Split Phase 1 / Phase 2").*

Tilt convention (per `02-key-decisions.md`): **0° = looking along the
ground, +90° = straight down.** "Map" = high tilt (looking down), "Street"
= low tilt (looking along the scene).

## The core principle (the seam)

Stage 1 ships as a **parity-plus upgrade** — it makes the controls users
already have feel better without changing what any of them *do*. Stage 2 is
where we deliberately *do* change the interaction model (a real
street-navigation mode); we defer it precisely *because* it's a behaviour
change, so Stage 1 isn't held hostage to it.

The key that makes a clean Stage 1 possible is keeping **LB drag
perpendicular (⊥) to the camera plane** (the legacy behaviour) rather than
panning the ground plane. ⊥-to-camera degrades gracefully with tilt — no
special cases — so a user who has dropped to street level can just drag up
to rise back out. The first attempt lost this (it panned the ground plane,
which lurches at low tilt and strands the user low); that is what made it a
regression instead of a clean split.

| Looking… | LB-drag up does… |
|---|---|
| Top-down | slides across the ground (same as today's map pan) |
| At the horizon | **pedestals straight up** (rise/fall) |
| In between | a smooth blend of the two |

**Implementation note:** this is **one continuous screen-space pan** —
translate the camera in its own right/up basis, like legacy
`THREE.EditorControls` pan — **not** a hard switch between two handlers at
threshold T. Do **not** reuse the existing tilt-gated `pan-pedestal`
handler; that is the Stage 2 moded behaviour. Stage 1 keeps a single
uniform LB behaviour at every tilt — the table above is how that one
behaviour *feels* across tilt, not three modes.

That single property is what lets a user who has dropped to street level
simply drag up to rise back out. It is the make-or-break behaviour for the
"Norman" test below.

## Acceptance test — "Norman and the Waymo"

**Norman** = "Normal Man", a non-technical first-time user. He doesn't know
what a pedestal or a truck is; he just wants to look at the cool car. The
job: get next to the self-driving Waymo, look around it, and get back out.

Beats (record this journey to compare builds):
1. New scene (basic street), top-down.
2. See the cars down the street.
3. Wheel-zoom in toward the Waymo.
4. Click / double-click to frame it.
5. Circle the car to see all sides.
6. Settle near street level.
7. Lift back up to a higher viewpoint.
8. (failure mode) end up under the ground — is there a way out?

Cross-cutting finding: **beat 5 (orbit the car) confused Norman in every
build**

## Stage 1 — Improve the existing camera. **SHIP FIRST.**

Goal: strict **parity-plus**. No new viewing *modes* — just better controls
at the viewpoints users already use. Nothing here removes or changes a
legacy behaviour.

**In:**
- **LB ⊥ camera plane** (pedestal when low) — the keystone. *(needs the
  one code change: project the drag onto the camera plane, not
  `_groundPlane`.)*
- **Compass**: rotate, click → top-down, click again → north. *(already in
  branch — TASK-011/023/025/026.)*
- **Cursor-anchored dolly zoom**. *(in.)*
- **Rotate around the screen-centre point**, found with the new collision
  raycast (mesh → ground) fired through the screen centre, with the ring
  indicator and the shallow-tilt pivot fix so a shallow view can't fling.
  Rotate-*about-cursor* is deferred to Stage 2 (it's the same gesture aimed
  at the pointer instead of the centre); Stage 1 keeps the legacy
  rotate-around-centre feel. *(pivot/anti-fling done — commit `0b67de49`.)*
- **Under-tiles recovery**: if a rotation dips the camera beneath the
  Google 3D tiles, it auto-lifts back above the surface — no getting
  trapped under the world.
- **Object / building double-click to frame.** *(preserved with street
  off.)*
- **Momentum pan** to match the existing momentum zoom; **zoom in/out
  velocity fix.** *(polish — to build.)*

**Out → Stage 2:** swoop transitions, focal zoom, WASD/arrow flight,
Space-to-ground, street eye-height teleport, letterbox indicator, the
drone/streetview icon.

**Why it's safe to ship alone:** LB⊥ restores the legacy feel; everything
else is purely additive UI/behaviour layered on top.

## Stage 2 — Full Street View. (defer until ready)

A real street-level navigation mode — this is the deliberate behaviour
change, which is exactly why it ships on its own once the feel is locked,
rather than blocking Stage 1.

**In:** **rotate about the cursor** (vs Stage 1's rotate-about-centre);
lane double-click → teleport to eye height; letterbox mode
indicator; rotate-in-place at low tilt; smooth **swoop + focal-zoom**
transitions between birds-eye and street; **WASD / arrow flight**;
**Space-to-ground**; **drone/streetview toggle**; the enclosure escape
hatch.

## Flags

- `?nav=classic` — kill switch to the legacy `THREE.EditorControls` (both
  stages off).
- `?streetview=on` — gates the Stage 2 street mode. **Open:** rename to
  `?swoop=on`?

## Open decisions for Diarmid

1. Agree **LB ⊥ camera plane** is the Stage 1 base?
2. Agree the Stage 1 / Stage 2 split — parity-plus now, street mode later?
