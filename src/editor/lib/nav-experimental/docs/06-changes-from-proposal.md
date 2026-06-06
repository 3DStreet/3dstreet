# 6 — Changes from the Original Proposal

*The system began life as a written design proposal (the
"3D Street Navigation Proposal," April 2026) — a Google-Maps-inspired
control scheme the maintainer reviewed before implementation. This doc is
for a reviewer who knows that proposal: it shows what the implemented
system kept, changed, and dropped. The proposal itself is an external
design document, not part of this repo; the relevant content is summarised
inline below so this doc stands on its own.*

The proposal's **goals are intact**: Google-Maps-like control, free tilt
below 30° down to street level, a smooth birds-eye↔street transition, and
double-click navigation. What changed is *how*, and a lot got simpler. The
substantive deltas, then the deferrals.

---

## The big one: the scene-aware rotation model was thrown out

**Proposal:** the centre of rotation for Shift+LB was chosen by a
**three-rule, scene-aware** scheme — orbit the screen-centre point (high
tilt); orbit the **scene as a diorama** about its centre (low tilt,
bounded scene, camera outside the bounds cylinder); or orbit the camera
itself (low tilt, unbounded or camera inside). Plus a **weighted blend**
between rules in the 20–30° band and a distance feather near the bounds
edge. It leaned on a "finite scene boundary" concept the editor would
compute and maintain.

**Implemented:** **two regimes on one tilt threshold T**, nothing else.
Map mode (tilt > T) orbits the point under the cursor; Street mode
(tilt ≤ T) rotates in place about the camera. **No diorama mode, no
inside/outside-the-scene test, no scene-centre pivot, no blend band, no
distance feather.** The entire finite-scene-boundary concept — and the
"you're inside/outside the scene" indicator it would have driven — was
**removed**.

*Why:* feel-testing converged on "too clever." Users model rotation as
"spin around what I'm pointing at" or "look around from where I stand,"
not "orbit my scene as a museum diorama." Live-recompute pivot designs
were tried and rejected (one juddered near the bounds edge); a latched,
decoupled orbit is what shipped. The `SceneBounds` cylinder survives
**only** to frame Plan View. (Details: `02-key-decisions.md` KD-02,
KD-03.)

This is the single largest divergence and the reason much of the
proposal's "Key Novel Mechanics" section no longer maps onto the code.

---

## The tilt threshold: 30° → T (25°), unified and runtime-tunable

**Proposal:** a "30° threshold" governs the truck/dolly→truck/pedestal
cut, with the rotation blend around it.

**Implemented:** a single threshold **T** (`TH-03` = 25°) governs **four**
behaviours at once — the LB sub-mode, the wheel cursor-anchor cut, the
rotation regime, and the letterbox indicator — with **no blend** (KD-04,
KD-05). T is **live-tunable at runtime** via an A-Frame component, one of
only four such knobs.

---

## The swoop: cursor anchoring dropped from the transition; gated on AGL

**Proposal:** a 3-phase swoop where **cursor anchoring continues through
Phase 2** ("the descent track aims to keep the anchor point under the
cursor… you naturally land next to the world point you were aiming at").

**Implemented:** the 3-phase swoop ships, but **Phase 2 has no cursor
anchoring** — it is pure pedestal + tilt-toward-horizontal (KD-08). The
per-tick re-raycast that in-swoop anchoring needs re-introduces a flicker
failure mode as the cursor ray flattens near the horizon; since Phase 1
already does the horizontal positioning, the loss is small. You land
directly below your Phase-2 entry and LB-truck/WASD to fine-tune.

Other swoop deltas:
- **Boundaries are AGL, not absolute height.** The proposal's "10 m /
  1.5 m" were absolute; the implementation measures **height above the
  collision floor** via a downward raycast (`TH-22`, `TH-23`). On a flat
  scene with ground at y=0 they coincide.
- **Phase-3 "sense of arrival."** The proposal worried about a wide-FOV
  "goldfish-bowl." The implementation adds a deliberate **landing FOV**
  (`TH-29`) the descent eases open to, back-loaded toward the floor so the
  world "opens up" on arrival (KD-12), and re-aims the FOV zoom toward the
  cursor target (KD-13) — both absent from the proposal.
- **Reversibility via a transient memory.** The proposal asked that
  zoom-in-then-out return to the same angle. Implemented as a transient
  zoom-undo memory that clears on any non-wheel move, easing to a default
  overview once you've manually moved (KD-11).
- **Ctrl+wheel fixed-tilt zoom & Mac pinch** — implemented as the
  proposal's "what is lost" mitigation suggested (KD-10).

---

## Plan View folded into the compass — not a separate view

**Proposal:** Plan View "removed as a separate view… surfaced as a
top-level compass-style button," animating to an N-S-oriented top-down
view.

**Implemented:** matches the proposal's *intent* and refines the
behaviour: the compass body-click is a **two-stage** dispatcher — first
animate to top-down **preserving your current heading** (not forcing
N-up), and only a *second* click aligns to north (KD-26). Hardcoding
screen-up to north forced a disorienting 180° spin whenever you were
orbited facing south, so heading-preserve-then-align tested better.
Rotation **arrows** turn ±90°, orbiting the screen-centre ground point in
Map mode. Plan View is **zoom-out-only**.

---

## Double-click: building-centre aim, never-raise as absolute height, collision-aware

**Proposal:** "some initial ideas, refinement still needed" — never
increase elevation; cardinal-direction heading snap; lane clicks go to a
point on the lane; building clicks give a building-level view.

**Implemented:** keeps the four-category model (lane / building / generic
object / empty), the **cardinal-heading snap** (≤45° rotation, no
dependence on a defined "front"), and **never-raise** — refined as
compared on **absolute world height**, not AGL (KD-23). Two notable shifts
beyond the proposal:

- **Category B (building) aims at the building *centre*, not the clicked
  hit-point** (KD-24). The camera *height* encodes air-vs-street; aiming
  at a fixed centre lets the look angle fall out of that height (gentle
  from above, bounded look-up from the street), avoiding a near-vertical
  neck-snap when you click a tower top. This **supersedes** the proposal's
  implied "look at what you clicked."
- **Collision-aware landing.** The proposal predates the "buildings are
  solid" invariant; the implemented double-click delegates clearance to
  the shared collision machinery (rest above the surface, pull a blocked
  standoff back along the heading, never come to rest inside solid), and
  the teleport is a **committed motion** (endpoint validated, path not
  per-frame clamped). It also **resets FOV** and clears the swoop's
  zoom-undo memory on arrival (KD-25).

The **hover-highlight raycast fix** (preview matches what a click selects)
is implemented as the proposal asked.

---

## New since the proposal: stay out of solid geometry

This has **no counterpart in the proposal** — it emerged from later live
testing and is now foundational. Buildings became **solid**; the camera is
kept out of solid geometry across every mode via per-column raycast floors;
recovery (daylight / street / drone) is **user-invoked** under the
principle that automatic behaviour only ever *blocks* motion, never adds it
(KD-16, KD-17, KD-18, KD-19). Landing *on* a building roof rather than at
street level *inside* it overturns an earlier design rule and is the change
most needing the maintainer's sign-off (`05-open-issues.md` OI-5).

Several affordances came with it that the proposal didn't anticipate:
- the **context view button** — a brand-new always-visible toolbar control
  (one button, three faces: daylight / street view / drone view) that
  offers the one sensible "change my framing" move for where the camera is
  (KD-21);
- the **Space-bar key** — a brand-new keyboard shortcut that drives the
  *same* resolver as the button, so it does all three actions from the
  keyboard (KD-21);
- **drone view**, a new canonical preset (elevated, ~60°-tilted "survey
  from above") alongside plan view and street view (KD-22).

Neither the toolbar button nor the Space key existed in the proposal —
they are new, top-level pieces of the UX, not just internal mechanics.

---

## Naming

- The proposal's **"birds eye view"** is **dropped** as ambiguous; the two
  elevated framings are **"plan view"** (top-down) and **"drone view"**
  (angled survey).
- **"Street mode"** (a tilt regime) and **"at street level"** (a camera
  state — low and above a surface) are now kept distinct; the proposal
  used "street view" loosely for both. See `04-glossary.md`.

---

## Deferred or dropped relative to the proposal

| Proposal feature | Status |
|---|---|
| **FPS / pointer-lock mode** (Ctrl-hold pointer lock, WASD, FOV cue) | **Deferred** — not built (`05-open-issues.md` OI-11). |
| **Touch controls** | **Out of scope** for the prototype; desktop only (OI-12). |
| **Cursor anchoring through Phase 2 of the swoop** | **Dropped** from v1; re-introducible if missed (KD-08 / OI-13). |
| **Weighted blend of rotation centres (20–30° band)** | **Dropped** with the diorama model (KD-02, KD-04). |
| **Diorama mode / finite-scene-boundary orbit** | **Removed entirely** (KD-02). |
| **"Inside/outside the scene" indicator** | **Removed** — the concept it signalled is gone. |
| **Phase 2 "land next to the cursor target"** | **Dropped** — you land below your entry xz (KD-08). |
| **Discoverability hover-caption** ("double-click to navigate here") | **Not built**; hover-highlight fix is the only discoverability change (OI-20). |
| **Streetview-mode elevation restriction** | **Dropped** — the lowered threshold makes it unnecessary. |
| Screenshots in the proposal | **Not reproduced** — they illustrated the *old* double-click problems and the lost fixed-tilt close-zoom, both superseded; described in prose where relevant. |

---

## At-a-glance

| Area | Proposal | Implemented |
|---|---|---|
| Rotation pivot | 3 rules + blend + scene bounds | 2 regimes on tilt T, no blend |
| Tilt cut | 30°, governs LB mode | T = 25°, governs 4 behaviours, runtime-tunable |
| Map rotation | (implied lock-on) | decoupled free-look orbit (framing preserved) |
| Swoop Phase 2 | cursor-anchored | pure pedestal+tilt, no anchoring |
| Swoop gating | absolute height | AGL (per-column floor) |
| Landing FOV | avoid goldfish-bowl | deliberate "sense of arrival" ramp |
| Plan View | compass button → N-up | compass body-click: heading-preserve, then N-up |
| Double-click building | view its "front" / hit-point | aim building centre; height encodes air vs street |
| Never-raise | "don't increase elevation" | absolute-height clamp + collision clearance |
| Solid geometry | (not addressed) | buildings solid; stay-out + user-invoked recovery |
| Context view button | (not in proposal) | **new** — one button, 3 faces (daylight/street/drone) |
| Space-bar key | (not in proposal) | **new** — keyboard shortcut for the same 3 actions |
| Orbit math | (n/a) | hand-rolled (library evaluated, declined) |
| FPS / touch | proposed / asked | deferred / out of scope |
