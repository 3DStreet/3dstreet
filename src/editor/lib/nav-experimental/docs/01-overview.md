# 1 — Overview

*Audience: a maintainer (Kieran or another upstream reviewer) forming a
mental model of the experimental navigation system ahead of testing and
reviewing it. This doc is deliberately light — the detail is in the
sibling docs.*

## What this is

A replacement for the 3DStreet editor camera controls, built to make
moving around a scene feel like **Google Maps + Street View as a single
integrated system**: free tilt all the way from top-down to street level,
a smooth continuous transition between birds-eye and street views, and
double-click-to-navigate — improvements over the stock controls and over
Google Maps itself (which won't tilt below ~30°).

It is still a **prototype**, but on this branch it is the editor's
**default** camera-control system. The legacy controls remain available as
an opt-out.

## Turning it on and off

On this branch the experimental controls are **active by default** — no
flag needed. To fall back to the stock `THREE.EditorControls`, append
**`?nav=classic`** to the editor URL (e.g.
`http://localhost:3333/?nav=classic`). The two systems coexist and are
mutually exclusive at construction time, which lets you A/B the feel in
one session by toggling that parameter. (`&navDebug=true` adds console
diagnostics.)

> **What actually ships in the default build — read this before testing.**
> The experimental controls being on does *not* mean everything below is
> live. Two **sub-flags gate the Stage-2 behaviour OFF by default** (see
> `07-phased-rollout-plan.md` for the staging rationale):
>
> - **`?streetview=on`** (default **off**) gates the whole street-level
>   regime — the swoop descent, the street-level FOV zoom, the context
>   button's *street view* action, lane double-click teleport, the
>   letterbox indicator, and rotate-in-place at low tilt.
> - **`?wasd=on`** (default **off**) gates WASD / arrow-key flight.
>
> So the **default** (`?nav` unset, no sub-flags) ships the *elevated*
> half: Map-mode LB/Shift+LB, cursor-anchored dolly zoom, the compass,
> drone view, and building/object double-click framing — **but not** the
> swoop-to-street, WASD, letterbox, or lane teleport. A maintainer testing
> the default build will not see the two-regime mechanics that docs 02–05
> describe until `?streetview=on` (and `?wasd=on`) are added. Everything
> below documents the full Stage-2 system; treat the swoop / Street-mode /
> WASD material as flag-gated.

The code lives entirely in `src/editor/lib/nav-experimental/`;
`ExperimentalControls` is `new`-ed in `viewport.js` unless `?nav=classic`
is present, and mirrors the `EditorControls` public API, so the rest of
the editor (the ActionBar zoom buttons, focus-on-object, scene load)
drives it without knowing which control scheme is active.

## The mental model: two regimes on one threshold

Everything keys off **tilt** — how far the camera looks down below
horizontal (0° = horizontal, +90° = straight down, negative = looking
up). A single threshold **T** — currently ~25°, live-tunable (`TH-03`) —
splits all behaviour into two regimes:

| | **Map mode** (tilt > T) | **Street mode** (tilt ≤ T) |
|---|---|---|
| Feel | Looking down at a map | At eye level, looking along the scene |
| **LB drag** | Truck/dolly in the horizontal plane | Truck/pedestal (horizontal + vertical) |
| **Shift+LB** | Orbit the point under the cursor (framing preserved) | Rotate in place (first-person look-around) |
| **Wheel** | Cursor-anchored dolly | Plain dolly along the view |
| Indicator | (none) | Letterbox: toolbars become full-width black strips |

The same live T governs *every* tilt-conditional decision — the four
primary (LB sub-mode, wheel cut, rotation regime, letterbox) plus the
context-button and compass-arrow reuses — one number to reason about.
**Shift is live during a drag**: you can switch truck↔rotate without
releasing the button.

This two-regime model is itself a major simplification: an earlier design
chose the rotation pivot from a multi-rule, scene-aware scheme (orbit the
scene "as a diorama" when outside its bounds, etc.). Feel-testing retired
all of that in favour of "rotate around what I'm pointing at" vs "look
around from where I stand." See `06-changes-from-proposal.md`.

## The four pillars

**1. Tilt-conditional manual controls** (LB / Shift+LB / WASD). The table
above. WASD always moves in the horizontal plane projected from the
camera's heading, at a speed that scales with height. Map-mode rotation
is a *decoupled free-look orbit* — the camera circles the grabbed point
while your framing of it is preserved; it does **not** snap to stare at
it. A circle marker shows the pivot.

**2. The "swoop"** — a single continuous wheel gesture from birds-eye to
street level, in three phases selected by **height above ground (AGL)**:

```
   high   │ Phase 1 — cursor-anchored dolly (Map) / plain dolly (Street)
          │           the world point under the cursor stays put
  ~20 m   ├───────────────────────────────────────────────────────────  (TH-22)
   AGL    │ Phase 2 — "swoop transition": pedestal down + tilt toward
          │           horizontal. The world opens up (FOV eases wide).
  ~1.5 m  ├───────────────────────────────────────────────────────────  (TH-23)
  street  │ Phase 3 — FOV-only zoom; the camera holds still
```

Zoom-out reverses it, returning to the tilt you dove from (a transient
memory) — or, if you've moved manually since, to a default ~60° overview.
Ctrl+wheel (and Mac trackpad pinch) bypasses the swoop for a fixed-tilt
zoom.

**3. Presets, surfaced as toolbar controls.**

- **Compass** (à la Google Maps): click the body to animate to top-down
  while keeping your heading; click again to align north. Arrows turn the
  heading ±90°. *There is no separate "Plan View" — it is folded into
  this button.*
- **Context view button** — a new always-visible toolbar button whose icon
  tracks the camera state and offers the one sensible move: **daylight**
  (pop out of solid geometry), **street view** (swoop down to the surface),
  or **drone view** (an ascending reverse-swoop up to an elevated angled
  survey). One button, three faces.
- **The Space-bar key** — a new keyboard shortcut that drives the *same*
  resolver as the context button, so it performs all three of those moves
  from the keyboard. (Both the button and Space are new in this system —
  neither existed in the original proposal.)

**4. Double-click navigation.** Double-click anything to animate to a
predictable good view of it. The heading **snaps to the nearest cardinal
(N/E/S/W)** of your current heading (so ≤45° rotation, no dependence on
objects having a "front"), and a double-click **never raises** the camera
— it descends or stays. Four cases: a **lane** point (drop to eye level
there), a **building** (frame it, from across the street or the front
door depending where you start), a **generic object** (frame it at its
size), or **empty space** (no-op). The hover highlight is fixed to
preview exactly what a click will select.

## The cross-cutting invariant: stay out of solid geometry

A late but foundational addition makes **buildings solid** and
keeps the camera out of solid geometry across *every* mode. The surface
under the camera is found by a **per-column downward raycast** (never a
flat ground plane — so terrain and future sloped streets work unchanged),
and the camera rests an eye-height above it. The governing principle:
**automatic behaviour only ever *blocks* motion — it never adds
unrequested camera movement.** If you nonetheless end up inside something
(a scene loads with the camera in a building, a tile streams in around
you), nothing moves on its own; you press the context button / Space to
recover. The one exception is a *drag that finishes* inside a building,
which eases back out as the tail of that gesture.

This invariant is the most likely thing to want the maintainer's review:
it reverses an earlier design rule so that a swoop lands *on a building
roof* rather than at street level inside its footprint — because rooftop
landings tested as more natural. See `02-key-decisions.md` KD-16.

## What's *not* here

FPS / pointer-lock mode and touch/mobile gestures were scoped out of the
prototype. The orbit math is hand-rolled (a library evaluation chose to
keep it — `02-key-decisions.md` KD-07). Several values are tuned for
human-scale streets with ground near y=0; the AGL work generalised the
swoop, but a few rough edges remain in `05-open-issues.md`.

## Where to go next

- **Reviewing the design choices** → `02-key-decisions.md` (with worked
  examples).
- **Tuning / the exact numbers and what's runtime-configurable** →
  `03-configurable-thresholds.md`.
- **Vocabulary** (tilt, AGL, grounded vs flying, diorama, latching,
  swoop phases…) → `04-glossary.md`.
- **Known gaps and spec-vs-code discrepancies** → `05-open-issues.md`.
- **How this diverges from the original proposal** →
  `06-changes-from-proposal.md`.
