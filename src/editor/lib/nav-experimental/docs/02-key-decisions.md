# 2 — Key Decisions

This document records the decisions that shaped the experimental
navigation system: where a reasonable alternative existed **and** the
choice affects user-visible behaviour or maintainability. Implementation
details no reasonable person would have done differently are out of scope
(they live in the code).

**Conventions used throughout these docs.** *Tilt* is measured from
horizontal: 0° = looking along the ground, +90° = straight down,
negative = looking up. *AGL* = height above the solid surface directly
below the camera (a per-column downward raycast), as distinct from
absolute `camera.y`. See `04-glossary.md` for the full vocabulary.

Decisions are identified `KD-NN`. They talk in terms of the *range
within which a threshold delivers* its goal; the canonical numbers live
only in `03-configurable-thresholds.md` (referenced as `TH-NN`).

---

## A. Foundations

### KD-01 — Coexist behind a URL flag (now defaulting to the new system)

The new control system and the legacy `THREE.EditorControls` coexist,
selected by a URL flag and mutually exclusive at construction. The
alternative — deleting the old controls outright — was rejected because
keeping both is cheap insurance and enables **side-by-side feel
comparisons** of old vs new in one session. The **default has since
flipped**: on this branch the experimental controls are active by default,
and **`?nav=classic`** is the opt-out that restores the legacy controls
(the flag was originally opt-*in* via `?nav=experimental`). Consequence:
the new controls must mirror the `EditorControls` public API (`focus`,
`resetZoom`, `newSceneCameraZoom`, `setCamera`, `setAspectRatio`, `change`
events, ortho fallback) so `viewport.js` and the ActionBar can drive
either interchangeably.

### KD-02 — Two tilt regimes split on a single threshold T

Rotation, the LB sub-mode, and the wheel cut are selected on **tilt
alone**, split at threshold **T** (`TH-03`):

- **Map mode** (tilt > T): looking down at the scene as on a map.
- **Street mode** (tilt ≤ T): at/near eye level, looking along the scene.
  Looking up is always Street mode.

The rejected alternative was a multi-rule, scene-aware pivot scheme that
also asked whether the camera was inside or outside the scene's footprint
and treated a bounded scene as a "diorama" you orbit about its centre,
with a blend band between rules. Feel-testing found it too clever: users
model rotation as "spin around the thing I'm pointing at" (looking down)
or "look around from where I stand" (eye level), not "orbit my scene as a
museum diorama." The entire finite-scene-boundary concept — the
inside/outside test, the scene-centre pivot, the blend band, and the
"you're inside/outside the scene" indicator it would have driven — was
**removed**. This is the largest simplification in the system; the
`SceneBounds` cylinder now survives only to frame Plan View.

### KD-05 — One threshold T governs all four tilt-conditional behaviours, and is runtime-tunable

T is not four separate cutoffs. The **same** value gates: the LB
truck/dolly-vs-pedestal sub-mode, the wheel cursor-anchored-vs-dolly cut,
the rotation regime (Map/Street), and the letterbox indicator. Unifying
them means there is one number to reason about and tune. T is surfaced on
an A-Frame component schema (`TH-03` is one of only four runtime-live
knobs) so it can be retuned during feel-testing without a rebuild.
Accepted consequence of unification: lowering T also lowers the
wheel-zoom cursor-anchor cut, slightly widening the band in which "cursor
over empty sky anchors oddly."

### KD-07 — Keep the hand-rolled orbit math; do not adopt a camera-control library

Evaluated `THREE.OrbitControls`, `MapControls`, and `camera-controls`
against this model. Decision: **keep hand-rolled**, but *not* because a
library can't do it. OrbitControls/MapControls genuinely can't express
KD-03's decoupled orbit (their `lookAt(target)` invariant *is* the
rejected snap-to-centre). `camera-controls` **can** (its `setFocalOffset`
holds an off-centre pivot through the orbit). The decision rests on
**scope and integration cost**: only a small slice (~150 lines) of the
subsystem is "orbit math" a library competes with; the swoop, AGL
probing, hit-anchored truck/pedestal, WASD, tweens, indicators, and the
`EditorControls` adapter all stay hand-rolled regardless — and they write
the camera directly every tick, which would fight a library's internal
`update()` (a two-master problem). Re-open only if **mobile/touch
camera-editing** becomes a goal (`camera-controls` ships multi-touch) or
if the model ever drops KD-03 for a locked-on turntable.

---

## B. Rotation

### KD-03 — Map-mode rotation is a decoupled free-look orbit, not a locked-on turntable

When you Shift+LB in Map mode, the camera orbits the latched cursor world
point, but your **framing of that point is preserved** — it keeps its
place in your view; the camera does **not** snap to stare straight at it.
The rejected alternative (a turntable that snaps the pivot to screen
centre on first move) felt wrong. Mechanically this is realised by
composing yaw+pitch into a **single** rotation `R` applied to *both* the
camera's position-offset-from-pivot and its view direction, so the
pivot's position in the camera frame is invariant at any tilt. The
obvious-but-wrong approach — applying spherical pitch to the two vectors
independently — drifts the pivot across the screen, which is why the
single-`R` formulation is used.

### KD-04 — Hard switch at T, no blend band

The regime (and the LB sub-mode) switches cleanly at T with no
interpolation. The regime is read at the instant each gesture (or
sub-gesture) begins and **latched for its duration** — so a drag that
starts in Map mode keeps orbiting the cursor pivot even if you tilt below
T mid-drag. Accepted consequence (worth watching in feel-test): a Street
drag that tilts down past T keeps rotating in place until you release. The
concrete trigger to reconsider a blend: if releasing a Map rotate and
re-engaging just below T produces a pivot-location jump that feels wrong.

### KD-06 — Shift is live mid-drag

Whether an LB drag is a truck or a rotate is **not** latched at
mouse-down. Pressing/releasing Shift mid-drag switches the gesture
truck↔rotate without releasing the button; each switch re-grabs its own
anchor/pivot afresh and resets the pointer-delta baseline (so the first
move after a switch applies no accumulated jump). One continuous drag can
therefore compose truck → rotate → truck. This live-Shift behaviour is
also *why* a single drag can wander the camera into a building (the
recovery in KD-17 handles that), and why collision prevention can't rely
on the gesture type being fixed.

### KD-29 — Map-orbit underground guard caps the input tilt, reversibly

Because the orbit is decoupled (KD-03), the tilt clamp limits where you
*look*, not where the camera *sits* — so a Map orbit around a low pivot
can swing the camera below ground. The guard constrains the **resulting
camera height** (≥ floor + eye margin) by numerically tightening the
*input* tilt bound, so over-dragging past the floor never accumulates and
reversing the drag retraces exactly. The rejected alternative — shoving
the camera up when it breached the floor — was non-reversible and added
motion the user didn't ask for, which is the lesson behind KD-17.

---

## C. The swoop (wheel zoom)

### KD-08 — Wheel zoom is a 3-phase swoop gated on AGL; the transition phase has no cursor anchoring

A single continuous wheel gesture carries the camera from birds-eye to
street level through three phases selected by **height above ground**
(AGL, not absolute `camera.y`):

- **Phase 1** (AGL above `TH-22`): cursor-anchored dolly (tilt-conditional
  per KD-05); the world point under the cursor stays under the cursor.
- **Phase 2** (`TH-23` < AGL ≤ `TH-22`): pedestal-down + tilt-toward-
  horizontal. **No cursor anchoring.**
- **Phase 3** (AGL ≤ `TH-23`): FOV-only zoom; the camera doesn't move.

Cursor anchoring is deliberately *not* carried through Phase 2: as tilt
flattens through the descent the cursor ray flattens too, the anchored
solver fails near the horizon, and it flickers between anchored and
pure-pedestal per tick. Since Phase 1 already does the horizontal
positioning, in-swoop anchoring buys little. Tradeoff accepted: you land
directly below your Phase-2 entry position and LB-truck/WASD to fine-tune.
Phase dispatch is on **elevation first, then tilt** — the reverse order
silently routes Phase-2 ticks into the low-tilt dolly the moment the tilt
lerp drops below T, aborting the swoop.

### KD-09 — Continuous wheel accumulator, not an integer budget

Wheel events normalise to a signed fractional "nominal tick" count
(`TH-10`) accumulated into one float. The high/FOV regimes apply the
whole pending accumulator per frame as one continuous step (no
quantisation, no multi-frame lag); the swoop drains whole ticks under its
per-frame cap (`TH-25`), carrying the remainder. This gives cross-device
parity (one mouse detent ≈ one tick; a trackpad delta ≈ a fraction) by
construction, and lets the dolly and FOV steps be tuned independently
(`TH-08` vs `TH-09`).

### KD-10 — Ctrl+wheel bypasses the swoop (fixed-tilt dolly); Mac pinch maps onto it

Holding Ctrl while wheeling gives a plain camera-Z dolly at the current
tilt and elevation, bypassing the swoop — so you can still do a close zoom
at a fixed tilt. A Mac trackpad pinch arrives as Ctrl+wheel, so pinch =
fixed-tilt zoom and two-finger scroll = full swoop, with no Mac-specific
code. Tradeoff: on Windows the Ctrl key now has meaning in the canvas
(browser-zoom muscle memory differs), accepted.

### KD-11 — Swoop reversibility via a transient zoom-undo memory

So that "zoom in then out returns to the same camera angle," the controls
keep a small transient memory `{valid, tilt, fov}`. The entry attitude is
captured when a wheel zoom-in crosses the Phase-1→2 boundary downward;
zoom-out then **retraces** to it. The memory is **cleared by any actual
non-wheel camera move** (LB drag, WASD, compass, Plan View, double-click)
— so once you've manually moved, a later swoop-out eases to the **default
overview** attitude (`TH-28`) instead of replaying a stale entry. The
descent and the immediate-undo ascent evaluate the *same* height→tilt
curve, so the retrace can't drift at the band boundaries. This "transient
and self-clearing, no persistent history" property is deliberate — it is
also why drone view could **not** be defined as a literal swoop-inverse
(see KD-22).

### KD-12 — Landing FOV "sense of arrival" is a pure function of AGL

As the swoop lands, the FOV eases open toward the landing FOV (`TH-29`,
capped below the fisheye-distortion limit `TH-31`) so the world "opens
up." It is computed as a **pure function of AGL** (the same height-above-
ground that drives the swoop phases), not latched on the floor crossing —
so the descent and an immediate-undo ascent retrace exactly with no anchor
and no jump if the ascent starts mid-band. The widening is **back-loaded**
toward the floor via an exponent (`TH-33`): an AGL-linear ramp does almost
all its widening at the top of the descent and none at the bottom, reading
as anything but an arrival; the exponent concentrates it into the final
stretch.

### KD-13 — Street-level FOV zoom re-aims toward the cursor, faded by distance

In Phase 3, narrowing the FOV toward the cursor target also gently
re-aims the camera so the target stays put, computed **absolutely** from
a captured baseline (so it is a pure function of FOV → exactly
reversible). The re-aim magnitude **fades to zero** between `TH-34` and
`TH-35` of target distance, so a far façade→sky crossing is continuous
rather than a hard switch to the no-re-aim fallback.

### KD-14 — Swoop-vs-dolly breakout only fires when looking up at a wall or sky

Inside the Phase-2 band, a zoom-in tick normally continues the swoop. It
"breaks out" into a plain dolly **only** when you are craning *up* at
something you can't land on and clearly want to approach — a solid
near-vertical wall/façade, or open sky/horizon. Looking down or level
always swoops (a façade or sky the cursor merely grazes on the way down
must not abort the descent); looking up at scatter (car/tree/sign) always
swoops (scatter must never break the swoop). The broke-out dolly is a
**bounded excursion** that zoom-out unwinds before resuming the ascent.

### KD-15 — The per-tick lateral lurch cap scales with height

A shallow-tilt wheel-zoom tick can translate the camera tens of metres
sideways (the "lurch"). The horizontal component of one tick is capped to
`max(TH-16, TH-17 × AGL)` — proportional to height, with `TH-16` as the
floor near the ground and on the no-AGL paths. The cap scales the whole
step vector, preserving the H:V ratio so the move stays on the
camera→target ray (target stays under the cursor, reversibility exact). A
straight-down step has ~0 horizontal component, so the cap never throttles
descent.

---

## D. Solid geometry, collision & recovery

### KD-16 — Buildings are solid; you land on roofs; collision floor vs travel height

The visible solid surface (ground/road/terrain + buildings, with thin
scatter — signs, people, vehicles, plants — ignored) is found by a
**per-column downward raycast**. Two distinct "floor" notions come off
the same probe:

- **Collision floor** — the nearest solid surface *including building
  roofs*. Landing, the descent clamp, and enclosure all use this. You
  stop on top of whatever solid thing is under you.
- **Travel height** — height above the *ground beneath* buildings, used
  for WASD fly-speed scaling only, so you don't crawl when a roof passes
  under you. The ground beneath is approximated by **multiple downward
  raycasts across a 2 m × 2 m square** below the camera, taking the lowest
  hit — so a single roof under the camera centre doesn't fool the speed
  scaling.

A swoop therefore lands **on a building roof**, not at street level inside
the footprint — rooftop landing tested as more natural than landing
inside a building (clipping, confusion). This is a deliberate reversal of
an earlier rule (the probe used to see *through* 3DStreet buildings so a
landing measured "height to the land, not the building"); the reversal is
scoped to the *collision floor only*, so fly-speed scaling still uses the
travel height and doesn't crawl over roofs. "Buildings are solid" is
**structurally load-bearing** — it also drives WASD wall-blocking and
enclosure — so it needs the maintainer's confirmation before upstream
(see `05-open-issues.md`).

### KD-17 — Automatic motion may only block/prevent; all recovery is user-invoked

The hard rule: **automatic behaviour never adds unrequested camera
motion.** Prevention *blocks* during a gesture: you can't pedestal or
descend through a floor, and a Map-orbit's downward swing is
**pitch-clamped** to keep the camera above the floor beneath its pivot
(KD-29 — a reversible cap on the gesture's input range, not a correction
of the output pose). But because that clamp references only the *pivot's*
floor, an arc can still swing the camera into a *different* mass; that
residual is handled by the single bounded exception — **gesture-end
correction**: a drag that *finishes* inside a building eases back to the
most-recent legit pose it passed through, acceptable because it's the tail
of the gesture you just made, not a disconnected spring. Any other "fix"
(scene loaded inside a building, a teleport, a streamed-in tile) is
**user-invoked** — nothing moves until you press the recovery control. A "legit" pose requires **both** not-enclosed **and** above the
collision floor by the eye margin (neither alone). This principle is the
direct lesson behind KD-29 (the rejected camera-shove).

### KD-18 — WASD prevention is a 4-way classifier keyed on surface geometry, not entity category

A horizontal WASD step compares the collision floor under the camera now
vs at the destination column and classifies the surface ahead into one
of four outcomes — **block** (steep ≥`TH-47` **and** tall ≥`TH-48`:
wall/façade/cliff), **step-up** (steep but short: kerb/ledge → rise to
its top), **follow** (walkable <`TH-47`, up *and* down: road/ramp), or
**hover** (steep+tall down-step: roof edge → hold height, don't plunge).
Keying on **geometry, not entity category** is essential: photogrammetry
tiles fuse ground and buildings into one mesh with no category label, so
a category rule would have no input on exactly the geo scenes that need
it. Blocking keys off the **destination column** being solid (not the
swept footprint touching something), so an opening wider than the camera
— a doorway, arch, tunnel mouth — is threadable. Walls *always* block
(an earlier "don't block while enclosed" carve-out let you walk through
walls under an overhang); escape-from-inside is user-invoked recovery, not
driving through the wall.

### KD-19 — Grounded vs flying: walking hugs the surface, flying holds an absolute cruise height

WASD vertical behaviour depends on a **grounded** flag. *Grounded*
(walking): the camera hugs the surface directly, preserving AGL, not
rate-limited (terrain follow is immediate). *Not grounded* (flying): the
camera eases toward an absolute cruise height `H` (clamped up to clear any
roof by the eye margin), rate-limited (`TH-41`) so the move composes with
continuous WASD. Crucially, **terrain rising under you never grounds
you** — grounded becomes true only on a deliberate descent reaching the
surface. The rejected alternatives (preserve-AGL while flying, or a
manual ground/fly toggle) jumped the camera by the full building height
when crossing onto a footprint; absolute-height-hold is the sole flying
behaviour because the forward ray blocks approach to anything taller than
flight height, so the clamp only ever lifts by ≤ the eye margin.

### KD-20 — Floors are a per-column raycast, never a flat plane (slope-safe)

Every floor query raycasts the actual surface per column — never a flat
scene-wide `y = groundY` plane, never an assumed +Y normal. 3DStreet
streets are flat slabs today, but sloped streets are a likely future (the
maintainer is in hilly San Francisco), so the design must not *preclude*
them even though it need not *accommodate* them now. The steepness-based
WASD rule (KD-18) and the AGL probes are inherently slope-agnostic as a
result; the swoop landing stays horizontal for now but keeps the hit
normal available so orient-to-slope can be added later without a rewrite.

---

## E. Presets & affordances

### KD-21 — Context view button: one state-tracking button + Space share a single resolver; icon = destination

A single always-visible button (present whenever the experimental controls
are active — i.e. by default unless `?nav=classic`) offers the one
sensible "change my framing" move for where the camera is, resolved by a
**fixed precedence ladder**: **enclosed → daylight** (pop to clear air) ›
**elevated → street view** (swoop down) › **at street level → drone
view** (rise). The button and the Space key read the **same resolver**,
so they can never disagree. The icon shows the **destination** state
(where the button takes you), matching the compass tooltip convention.
During the button's own animation both triggers are inert (rejected the
alternative of a one-deep queue — that complexity is only worth it for a
control with an advertised double-click rhythm, which this button lacks).
"Elevated vs at street level" uses a hysteresis band (`TH-67`/`TH-68`) so
the icon doesn't flicker at the boundary; "street view" is **always a
swoop** (never a bare vertical fall).

### KD-22 — Drone view is an ascending reverse-swoop at a fixed ~60° gradient

Drone view is an **ascending reverse-swoop**: the camera pulls
**up-and-back** along its current horizontal heading to a canonical
height, ending at the swoop's default overview tilt (`TH-28`, ~60° below
horizontal) **looking at the "feet" point** — the surface directly below
where you started. The back-offset distance is closed-form from the
gradient (`d = (H − feetY) / tan(60°)`), so it *reads* like a swoop run
in reverse, without needing a cursor to steer it.

It is **not** defined as an exact swoop-inverse — that was considered and
**rejected**, because the swoop is not a literally invertible motion (its
retrace is transient and self-clearing per KD-11, and its free-overhead
segment is cursor-dollying — neither reproducible by a button press).
Instead drone view is a self-contained closed-form reverse-swoop to a
*fixed* gradient. What makes the **drone⇄street toggle** round-trip is the
shared **feet point F**: drone's centre-ray looks at F, and pressing again
swoops street-view back down to F, returning you to where you rose from.
The toggle round-trips in **position** (not in arbitrary prior gaze — gaze
is the canonical preset each way; yaw is preserved throughout).

Target height is absolute above ground level (`TH-69`), with a
roof-clearance rule (`TH-70`) coupled to the hysteresis so a rooftop
arrival reliably reads "elevated." The rise passes *through* an overhang
to clear air above (a committed motion may pass through solid mid-flight;
it forbids only *ending* inside), so drone view has no grey-out case.

### KD-26 — Plan View is folded into a compass button, not a separate view; body-click is two-stage

There is no separate "Plan View." It is a particular camera angle of the
birds-eye view, surfaced as a **compass button** (à la Google Maps).
Clicking the compass body is a two-stage dispatcher decided from the live
pose: if not top-down → animate to top-down **preserving heading** (yaw
kept, so only tilt and altitude change — hardcoding screen-up to north
forced a disorienting 180° spin when you were orbited facing south); if
already top-down but not north-up → align to north; if both → no-op.
Rotation **arrows** turn the heading ±90° (`TH-59`). In the Map regime the
arrows orbit the **screen-centre ground point** (a map-style turn keeping
the centred feature centred); near-horizontal they spin in place. Plan
View is **zoom-out-only** (never drops below the current altitude — it
should never zoom *in*). The existing App-menu / toolbar / keyboard Plan
View entries fire the same intercept.

### KD-28 — Nadir is handled with a roll-safe pitch axis

At exact straight-down (nadir) the horizontal heading — and hence the
`view × up` pitch axis — is undefined, which would otherwise leave tilt
dead at top-down and risk a roll-snap. The rotation step falls back to the
camera's own screen-right axis, which stays well-defined and horizontal at
nadir and equals `view × up` off-nadir, so tilting *out* of exact nadir is
continuous and roll-free. Rotations are applied via quaternion premultiply
rather than re-deriving from `lookAt`.

---

## F. Double-click navigation

### KD-23 — Four categories, cardinal-heading snap, never-raise; clearance delegated to the shared collision machinery

A double-click animates (an eased tween of duration `TH-50`, ~0.6 s) the
camera to a predictable "good view" of what was clicked, classified into
four
categories: **A** lane/street surface, **B** building, **C** generic
object, **D** empty/no-hit (no-op). Two load-bearing simplifications:

- **Cardinal-heading snap.** The resulting heading snaps to the nearest
  of N/E/S/W to the pre-click heading (≤45° rotation). This removes any
  dependence on objects defining a "front" (works for trees and lanes
  too) and bounds the rotation.
- **Never-raise (AGL-relative, per-column).** A double-click may lower the
  camera or keep its height but **never raises it above the local ground** —
  capped on **height above the collision floor beneath it** (AGL,
  per-column), not absolute world height. Per-column AGL is what lets a
  valley→hilltop double-click move *up the hill* to view the target (rising
  in absolute terms relative to the valley floor it left, but never higher
  above the *hilltop* ground than it was above the *valley* ground) — an
  absolute-height cap would wrongly forbid that legitimate hill navigation.
  The cap is a **clamp-down** (`min(desired, current)`), so it constrains
  height without ever *rejecting* a target.

This logic computes only the **desired pose** (look target, heading,
attitude, nominal standoff, target height). Resolving that onto a clear,
non-buried camera position — AGL-clamp the height (above), keep it above the
surface (not buried), and pull a standoff that lands **inside solid**
**inward toward the look target** until clear — reuses the **shared
collision machinery** (KD-16/KD-17), invoked identically for every category.
A double-click **always moves**: the cap constrains *where* it lands, never
*whether* (no silent no-op, no recovery hand-off). And the resolved pose is
**never bounded to the finite scene** — a standoff that lands over **void**
beyond the scene edge is accepted at framing distance (no floor to cap
against, no burial risk), exactly as WASD/fly is free to move out over the
void rather than snapping back inside (KD-02/KD-19); it is *not* dragged in
to the nearest ground. Only an *inside-solid* standoff pulls inward. The
~0.6 s tween is a **committed motion**: only its endpoint is
collision-validated; the path is not per-frame clamped, so a teleport can
descend through an intervening roof to a clear lane below.

### KD-24 — Category B aims at the building centre; height encodes air-vs-street

A building double-click looks at the building's **centre**, not the
clicked hit-point. The camera height (a fraction of building height from
above — `TH-63`; front-door height from the street via never-raise) is
what encodes the viewpoint, and aiming at a *fixed* centre lets the look
angle fall out of that height automatically: gentle from above,
steep-but-bounded from the street. Aiming at the moving hit-point instead
coupled the look to *where* you clicked, so an aerial click (landing on
the roof) craned up at the roof. The framing-pitch cap (`TH-64`) is the
**backstop** — if framing would crane past it, the aim point moves toward
camera height — not the primary mechanism.

### KD-25 — A double-click sets pose only; mode follows from the resulting tilt; FOV resets

A double-click never engages Map or Street mode explicitly — it sets the
camera pose, and whether you end up in Street mode (letterbox on) falls
out of the resulting tilt vs T. The mode indicator re-evaluates on **tween
completion** (the landed pose is programmatic, so it won't update on its
own) and does **not** toggle mid-flight (a tween sweeping through T would
otherwise flicker the letterbox — unlike a manual drag, which toggles
live). The teleport **resets FOV** to the normal default (`TH-71`,
discarding any focal-zoom FOV) and **clears the swoop's transient
zoom-undo memory** (a double-click is a non-wheel move), so a subsequent
wheel-out uses the default overview, not a ghost of a pre-teleport
descent. (Note the teleport arrives at the *normal* FOV, not the swoop's
wider landing FOV — see `05-open-issues.md`.)

### KD-27 — Hover highlight is computed from the same raycast a click consumes

The hover highlight previously diverged from what a click selects (hover a
car in a lane → the *lane* highlights, but clicking selects the car). The
fix computes the hover target from the same raycast the click uses, so
hovering previews the click result — making the A/C classification
boundary (cursor over the car vs the asphalt beside it) visible and
anticipatable. Applied in both the experimental and the legacy
(`?nav=classic`) flows **only if** an audit confirms the two paths haven't
diverged for a legitimate reason; otherwise experimental-only.

---

## G. Mode indicator

### KD-30 — Street mode is signalled by a letterbox (full-width black toolbar strips)

The mode cut at T needs a hard-to-miss signal that stays out of the mouse
path. The chosen indicator restyles the floating top/bottom toolbars into
full-width black strips when Street mode is active; the resulting
aspect-ratio change is the cue. It fires whenever tilt crosses T —
including silently during a Phase-2 swoop tilt lerp (not just on LB
events). It is a deliberate placeholder to evaluate with the maintainer;
lighter fallbacks (cursor-shape change, accent-colour canvas border, a
mode badge) are on hand if it doesn't survive review. Street mode shows no
world-anchored rotation ring because the pivot is the camera itself (KD-03
only puts a ring on a world pivot).

---

## Worked examples

Concrete scenarios annotated with the phase / pivot / control outcome.
T at its current value (`TH-03` = 25°). "AGL" = height above the collision
floor below.

### WE-1 — Camera at 200 m AGL, tilt 22°, cursor over a building

- **Mode:** tilt 22° < T (25°) → **Street mode** (letterbox on). *Note
  how close this is to the boundary — at tilt 28° the same pose would be
  Map mode.*
- **Swoop phase:** AGL 200 m ≫ `TH-22` → **Phase 1** (cursor-anchored
  dolly). But because tilt ≤ T, Phase 1's tilt-conditional branch makes
  the wheel a **plain camera-Z dolly**, not cursor-anchored.
- **Shift+LB rotate:** Street regime (tilt ≤ T) → **rotate in place**
  about the camera position; no world ring.
- **LB drag:** Street sub-mode → **truck/pedestal** (horizontal +
  vertical world translation).
- **WASD:** horizontal motion at ~200 m/s (speed scales with AGL, capped
  at `TH-39`).

### WE-2 — Camera at 200 m AGL, tilt 55°, cursor over a building roof

- **Mode:** 55° > T → **Map mode** (no letterbox).
- **Swoop phase:** Phase 1, and tilt > T → **cursor-anchored** dolly. The
  roof point stays under the cursor as you wheel in; once AGL drops
  through `TH-22` the swoop transition takes over (pedestal + tilt toward
  horizontal), and the entry tilt (~55°) is latched for the zoom-undo
  retrace (KD-11).
- **Shift+LB rotate:** Map regime → orbit the **latched roof point**; it
  keeps its upper-left screen position (decoupled, KD-03), with a ring
  marker on it. Drag 90° of yaw → you end on the opposite side of the
  building, same height, still framing it.
- **LB drag:** Map sub-mode → **truck/dolly** in the horizontal plane.

### WE-3 — Continuous wheel-in from WE-2 down to the street

Phase 1 (cursor-anchored dolly, ~`TH-08` of distance/tick) → at AGL
`TH-22` the entry tilt latches and **Phase 2** begins: the camera
pedestals down its current (x, z), tilting from ~55° toward 0° as it
descends, the FOV easing open toward `TH-29` back-loaded near the floor
(KD-12). At AGL `TH-23` it snaps to the floor and enters **Phase 3**:
further wheel-in narrows FOV toward `TH-27`, gently re-aiming toward the
cursor target (KD-13). Wheel-out retraces: Phase 3 widens FOV to baseline,
then the ascent tilts back toward the latched ~55° entry (memory still
valid) and rises. If you'd LB-dragged anywhere in between, the memory is
cleared and the ascent eases to the default overview `TH-28` (~60°)
instead.

### WE-4 — Double-click a 4-storey building from 80 m up

Category **B**. Desired pose: look at the building **centre** (KD-24),
stand off ~`TH-62` × footprint diagonal along the cardinal-snapped
heading, target height ~`TH-63` of building height. Never-raise: you're
at 80 m, target is lower → you **descend** to it. If the resulting view
still tilts down > T → you **stay in Map mode** (no letterbox) — "see the
building from across the street, from up high-ish." FOV resets to the
default (`TH-71`); the zoom-undo memory clears. If the standoff column is
occupied by a neighbour, clearance pulls the standoff back along the
heading until clear (never lifting above 80 m).

### WE-5 — Double-click the *top* of a tall tower from street level

Category **B**. Never-raise keeps the camera at street level (won't
raise). The hit-point is dozens of metres up, but the camera does **not**
crane near-vertically: aiming at the building centre with the framing-
pitch cap (`TH-64`) as backstop gives a comfortable bounded look-up. Tilt
is negative (looking up) ≤ T → **Street mode** (letterbox on). You're at
the "front door"; wheel-out from here.

### WE-6 — WASD toward a wall, then through a doorway

Driving W at a building face: the destination column is steep (≥`TH-47`)
and tall (≥`TH-48`) and the wall faces travel (dot ≥ `TH-44`) → **block**;
you stop one camera-radius (`TH-42`) short. Steer a few degrees so the
destination column is the open doorway (wider than the camera) → the
column is clear even though the jambs are solid → you **thread** it. A
knee-high kerb (steep but < `TH-48`) → **step-up** onto its top. A gentle
ramp (< `TH-47`) → **follow** up or down.

### WE-7 — At street level, press the context button (Space)

Resolver ladder: not enclosed, not elevated (AGL ≤ `TH-67`) → branch 3 →
**drone view**. The camera reverse-swoops up-and-back (KD-22) to ~`TH-69`
above ground, ending at the ~`TH-28` (~60°) overview tilt looking at the
feet point F it rose from, heading preserved, normal FOV. Now elevated →
the button flips to **street view**; pressing it swoops back down to **F**
at street eye height (position round-trips about the feet point, not via a
vertical column). If instead you were *enclosed* (solid overhead), the
ladder's first rung wins → **daylight** (pop up), regardless of how low you
are.
