# 4 — Glossary

Precise meanings of the terms of art used across these docs and the
code. This is the backstop for disambiguation — other docs may also
explain a term inline where it aids flow. Terms that have *actually
caused* spec/code confusion are flagged **⚠ disambiguate**.

## Camera-movement terminology

Seeded from the original proposal's terminology table. These name *what
moves*; they are standard cinematography terms.

| Term | Axis / plane | What moves | Notes |
|---|---|---|---|
| **Pedestal** (ped) | Vertical (Y translate) | Whole camera rises/lowers | Direction unchanged |
| **Dolly** (track) | Forward/back (along view) | Camera moves toward/away | Also "dolly in / dolly out" |
| **Truck** (crab) | Lateral (X translate) | Camera slides left/right | Direction unchanged |
| **Pan** | Yaw (rotate about Y) | Camera rotates left/right | Camera stays put |
| **Tilt** | Pitch (rotate about X) | Camera pivots up/down | Camera stays put — **but see the tilt-as-angle meaning below ⚠** |
| **Roll** | Rotate about the lens axis | Camera rotates about its view direction | Camera stays put; this system actively *prevents* roll |
| **Zoom** | Optical (focal length / FOV) | Lens magnifies — camera still | Not a true camera move |

In this system the controls are usually *combinations*: "truck/dolly" =
LB drag in Map mode (horizontal-plane translation); "truck/pedestal" = LB
drag in Street mode (horizontal + vertical translation); "pan/tilt" =
Shift+LB rotation.

## Angles & heights

**Tilt (as an angle).** ⚠ *Distinct from the "tilt" camera-move above.*
Throughout these docs and the code, **tilt = the angle of the view below
horizontal**: **0° = horizontal, +90° = straight down, negative = looking
up**. Measured as `asin(−forward.y)`. Note this is measured **from
horizontal, not from vertical** — the original proposal's "30° threshold"
meant 30° *below horizontal* (a gentle downward gaze), and the shipped
threshold T is the same convention. Do not read "tilt" as "degrees from
straight-down."

**T — the tilt threshold.** The single angle (`TH-03`, a modest look-down)
that splits Map mode (tilt > T) from Street mode (tilt ≤ T). Governs the
LB sub-mode, the wheel cut, the rotation regime, and the letterbox.
Exactly-T is Street mode. Looking up (negative tilt) is always Street
mode.

**AGL — Above Ground Level.** ⚠ *Distinct from `camera.y`.* The camera's
height **above the solid surface directly below it**, found by a
per-column downward raycast: `AGL = camera.y − groundY`. Used by the
swoop phase boundaries, WASD speed, the elevation hysteresis, and the
recovery cue. On a flat scene with ground at y=0, AGL equals `camera.y`.

**Absolute height / `camera.y`.** The camera's world Y coordinate,
independent of any surface below. The double-click **never-raise** promise
is compared on *absolute* height (what a user perceives as "how high am
I"), specifically *not* AGL — comparing AGL across columns with different
ground heights could let a valley→hilltop move rise while passing an "AGL"
check.

**Collision floor.** ⚠ The nearest **solid** surface directly below
(ground/road/terrain **plus building roofs**), with thin scatter (signs,
people, vehicles, plants) ignored. This is what landing, the descent
clamp, and enclosure use — *you stop on top of whatever solid thing is
under you.* Contrast **travel height**.

**Travel height.** The height above the **ground beneath buildings**,
used **only** for WASD fly-speed scaling, so you
don't crawl when a roof passes 2 m under you. On fused photogrammetry
tiles (no ground/building separation) it's approximated by the lowest
solid hit over a small patch below the camera. Distinct from the
collision floor: collision wants roofs, speed wants the land beneath.

**Eye margin.** The standard eye-height clearance (`TH-46`) the
camera keeps above any solid floor — used by the descent clamp, WASD
follow/step-up, the orbit underground guard, and the fall/pop targets.
Numerically equals the street swoop floor and the WASD block-height today,
but they are independent constants.

## Camera states (the context-button vocabulary)

These describe *where the camera is*, and drive the context view button /
Space resolver. They can overlap; a fixed precedence ladder
(enclosed → elevated → at street level) resolves which action is offered.

**Enclosed / underground.** ⚠ **Solid geometry directly overhead**,
between the camera and the sky — covering "under terrain," "inside a
building," and "under an overpass/deck." *Being legitimately under an
overpass at street level is enclosed but reachable* — it is **not** the
same as being **buried** (no eye-clearance) inside a mass. Enclosure wins
the resolver ladder (getting out of solid comes first).

**Elevated.** Not enclosed, and **high above the surface below** — AGL
above the elevated-exit threshold (`TH-68`). The context button offers
*street view* (swoop down). Detection is **look-at-aware**: when nothing
is directly below (elevated over a finite scene's edge) it measures height
above the look-at hit, so "high above the scene looking down" reads
elevated.

**At street level.** ⚠ *Distinct from "Street mode."* A **camera state**:
low **and** just above a solid surface — AGL at/below the entry threshold
(`TH-67`), not enclosed. The context button offers *drone view* (rise).
Contrast **Street mode**, which is a *tilt regime* (tilt ≤ T) that drives
the letterbox. They usually coincide but are different predicates: you can
be in Street mode (looking level) while elevated (high up).

**Grounded vs flying.** ⚠ The WASD vertical state.
- **Grounded** — "walking on the surface": the camera hugs the surface
  directly, preserving AGL, not rate-limited. Becomes true only on a
  *deliberate descent* reaching the surface — **terrain rising under you
  never grounds you**.
- **Flying** (not grounded) — the camera holds an **absolute cruise
  height `H`** (clamped up to clear any roof by the eye margin),
  rate-limited so the move eases. `H` is captured at each un-ground edge.

## Rotation & pivots

**Latching.** Choosing a value **at gesture start and holding it for the
gesture's duration**, to avoid mid-gesture jumps. The **rotation regime**
(Map/Street) and the **rotation pivot** are latched at the start of each
Shift+LB sub-gesture; the swoop's **entry tilt** is latched at the
Phase-1→2 crossing. Because Shift is live mid-drag (KD-06), each
truck↔rotate switch re-latches a fresh pivot/anchor.

**Decoupled / free-look orbit.** ⚠ The Map-mode Shift+LB behaviour
(KD-03): the camera circles the latched pivot while the view rotates by
the same deltas, so the grabbed point **keeps its position in your view**
(stays where it was on screen) — it does **not** snap to screen centre,
and it does **not** track the moving cursor pixel-for-pixel. Contrast the
rejected **locked-on turntable** (snaps the pivot to centre and stares at
it).

**Rotate in place.** The Street-mode Shift+LB behaviour: the pivot is the
camera's own position, so it's a first-person look-around with no
translation.

**Rotation centre / pivot.** The world point a Shift+LB rotate orbits. In
Map mode it's the cursor's world hit-point (bounded to a circle of radius
`TH-05` around the screen-centre ground point; beyond that, or over sky,
it falls back to the screen-centre ground point). In Street mode it's the
camera itself.

**Screen-centre ground point.** Where the camera's centre view ray meets
the ground (y=0) — the fallback rotation pivot and the compass-arrow orbit
pivot in Map mode. Note this *pivot* uses the flat y=0 plane; *collision*
floors, by contrast, are always a per-column raycast of the real surface
(KD-20) — different subsystems, not a contradiction.

**Nadir.** Looking exactly straight down (tilt +90°). A singularity for
heading/pitch math; handled specially so you can tilt *out* of it without
a roll-snap (KD-28).

**Cylindrical bounds vs AABB.** ⚠ Two ways the scene extent was computed.
The **AABB** (axis-aligned bounding box) was used for the old inside/
outside-the-scene test; the **cylinder** (a vertical cylinder around the
AABB's XZ centre) avoided the "long narrow street" pathology. The
inside/outside test is **gone** (KD-02); the cylinder survives only to
frame **Plan View**.

**Diorama / diorama mode.** ⚠ **A removed concept — historical.** The
original proposal's idea of treating a bounded scene as an object you
orbit around its centre ("museum diorama"), used when the camera was
outside the scene's bounds at low tilt. The whole finite-scene-boundary /
diorama model was **retired** (KD-02); the term survives only
in historical specs and code comments. If you see "diorama" in a current
context, it's stale.

## The swoop

**Swoop.** The 3-phase continuous wheel-zoom transition from birds-eye to
street level (and back), gated on AGL. Named for the gliding descent.

**Swoop phases 1 / 2 / 3.** ⚠ *"Phase" in some code comments also refers
to development milestones — unrelated to these.* The swoop's three
regimes:
- **Phase 1** (AGL > `TH-22`): cursor-anchored dolly (Map) / plain dolly
  (Street). The world point under the cursor stays put.
- **Phase 2** (`TH-23` < AGL ≤ `TH-22`): the "swoop transition" —
  pedestal down + tilt toward horizontal, no cursor anchoring, FOV easing
  open.
- **Phase 3** (AGL ≤ `TH-23`): FOV-only zoom; camera holds still.

**Cursor-anchored zoom.** Wheel zoom that dollies the camera along the
ray through the cursor's world hit-point, so that point stays under the
cursor as you zoom (matching Google Maps). Phase-1 and Street-level
re-aim (KD-13) use it; Phase 2 deliberately does **not**.

**Zoom-undo memory.** The transient `{valid, tilt, fov}` state (KD-11)
that lets a swoop-out retrace to the tilt you dove from. Cleared by any
non-wheel camera move; when cleared, the swoop-out eases to the **default
overview** attitude (`TH-28`) instead.

**Sense of arrival / landing FOV.** The FOV easing open toward the wide
landing value (`TH-29`) as the swoop reaches street level, back-loaded
toward the floor so it reads as "the world opening up" on arrival (KD-12).

**Breakout dolly.** A bounded excursion where a Phase-2 zoom-in tick
"breaks out" of the swoop into a plain dolly because you're craning up at
a wall or sky (KD-14); zoom-out unwinds it before resuming the ascent.

## Presets & affordances

**Plan View.** Top-down, north-up framing. ⚠ **Not a separate view** in
the shipped system — it is folded into the **compass** button (KD-26).
Animated, heading-preserving, zoom-out-only.

**Drone view.** A canonical elevated, partially-tilted "survey from above"
preset (the swoop's default overview gradient, `TH-28`), reached by an
**ascending reverse-swoop** — the camera pulls up-and-back along its
heading, ending tilted down at the feet point it rose from. The third
framing alongside plan view and street view. Not a literal swoop-inverse;
a closed-form reverse-swoop to a fixed gradient (KD-22).

**Street view (the preset).** ⚠ *The context-button action, distinct from
"Street mode" the tilt regime.* The "come down to the surface" action —
always a swoop to the surface below.

**Daylight (pop to daylight).** The recovery action when **enclosed**:
pop straight up to the nearest clear surface, out into the open.

**Letterbox / mode indicator.** The full-width black toolbar strips shown
when in **Street mode** (tilt ≤ T) — the visual signal that the control
scheme has switched regime (KD-30). The aspect-ratio change is the cue.
Resolved by the camera-write funnel on every camera write (TASK-037): exact
T for real-time writes and settles, a tween-scoped hysteresis dead-band
during committed-motion tweens (see below).

**Hysteresis dead-band (δ, `TH-73`).** A small margin around a threshold
inside which the state is held rather than flipped, so a value hovering on
the boundary can't strobe. Used for the letterbox indicator *during a
committed-motion-runner tween* (flip only past `T±δ`); the same idea drives
the elevated↔street-level context state (`TH-67`/`TH-68`) and the recovery
cue (`TH-52`/`TH-53`). The letterbox dead-band is tween-scoped only — the
control regime a user drives is always exact-T.

**Recovery cue.** A transient on-screen prompt that flashes when you
become stranded-high or enclosed, drawing the eye to the context button
(which is the persistent affordance). Keyed off height above the collision
floor (`TH-52`/`TH-53` hysteresis).

**Context view button.** The single always-visible toolbar button whose
icon and action track the camera state (daylight / street view / drone
view), sharing one resolver with the Space key. **Icon = destination**
(where it takes you), not where you are.

## Input plumbing

**Nominal tick.** The device-normalised unit of wheel input (`TH-10`):
one mouse detent ≈ 1.0 tick, a trackpad delta ≈ a fraction, so behaviour
is consistent across devices. Accumulated as a float (KD-09).

**Live Shift.** Shift read continuously *during* an LB drag (not latched
at mouse-down), so truck↔rotate can switch mid-drag (KD-06).

**Committed motion.** A tween (double-click teleport, drone rise, swoop
recovery) whose **endpoint** is collision-validated but whose **path** is
not per-frame clamped — so it can pass *through* solid geometry to reach a
clear destination, but never *ends* inside solid.

**Scatter.** Thin scene objects ignored entirely by the collision/floor
probes: traffic control, signs, plants, fixtures, people, bicycles,
vehicles. (As a double-click target, scatter is Category C — a "generic
object" you frame — but it is never *floor*.)
