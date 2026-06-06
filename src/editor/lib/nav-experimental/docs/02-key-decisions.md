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

Decision IDs are `KD-NN`. They talk in terms of the *range within which a
threshold delivers* its goal; the canonical numbers live only in
`03-configurable-thresholds.md` (referenced as `TH-NN`). Each decision
notes the pre-existing code/spec identifier(s) it was tracked under.

---

## A. Foundations

### KD-01 — Coexist behind a URL flag, don't replace the old controls
*(overall-plan decision 1)*

The new control system activates only under `?nav=experimental`; with the
flag off, the stock `THREE.EditorControls` are untouched. The alternative
— replacing the old controls outright on the `navigation` branch — was
rejected because the flag is cheap insurance and, more importantly,
enables **side-by-side feel comparisons** of old vs new in one session.
Consequence: the new controls must mirror the `EditorControls` public API
(`focus`, `resetZoom`, `newSceneCameraZoom`, `setCamera`,
`setAspectRatio`, `change` events, ortho fallback) so `viewport.js` and
the ActionBar can drive either interchangeably.

### KD-02 — Two tilt regimes split on a single threshold T; the scene-aware "diorama" model was retired
*(TASK-010; supersedes the original proposal's three-rule model)*

The original proposal chose the rotation pivot from a **three-way rule**
(orbit the screen-centre point / orbit the scene as a diorama / orbit the
camera) selected from tilt **and** whether the camera was inside or
outside the scene's footprint, with a blend band and distance feathering.
Feel-testing and the mid-project review with Kieran converged on: *too
clever*. Users don't model their scene as a bounded diorama they orbit;
they model it as "rotate around the thing I'm pointing at" (looking down)
or "look around from where I'm standing" (near eye level).

The shipped model has **two regimes** selected on **tilt alone**, split
at threshold **T** (`TH-03`, working range 15–35°):

- **Map mode** (tilt > T): looking down at the scene as on a map.
- **Street mode** (tilt ≤ T): at/near eye level, looking along the scene.
  Looking up is always Street mode.

The entire "finite scene boundary" concept — the inside/outside test, the
scene-centre pivot, the blend band, the distance feather, and the
"you're inside/outside the scene" indicator — was **removed**. This is
the single largest simplification in the project and the reason the
`SceneBounds` cylinder now survives only to frame Plan View.

### KD-05 — One threshold T governs all four tilt-conditional behaviours, and is runtime-tunable
*(TASK-010 D2)*

T is not four separate cutoffs. The **same** value gates: the LB
truck/dolly-vs-pedestal sub-mode, the wheel cursor-anchored-vs-dolly cut,
the rotation regime (Map/Street), and the letterbox indicator. Unifying
them means there is one number to reason about and tune. T is surfaced on
an A-Frame component schema (`TH-03` is one of only four runtime-live
knobs) because Diarmid needed to retune it during feel-testing without a
rebuild. Accepted consequence of unification: lowering T also lowers the
wheel-zoom cursor-anchor cut, widening the "cursor over empty sky anchors
oddly" band — accepted as a tuning tradeoff.

### KD-07 — Keep the hand-rolled orbit math; do not adopt a camera-control library
*(TASK-016)*

Evaluated `THREE.OrbitControls`, `MapControls`, and `camera-controls`
against the revised model. Decision: **keep hand-rolled**, but *not*
because a library can't do it. OrbitControls/MapControls genuinely can't
express KD-03's decoupled orbit (their `lookAt(target)` invariant *is*
the rejected snap-to-centre). `camera-controls` **can** (its
`setFocalOffset` holds an off-centre pivot through the orbit). The
decision rests on **scope and integration cost**: only ~150 of the
~3,800-line subsystem is "orbit math" a library competes with; the swoop,
AGL probing, hit-anchored truck/pedestal, WASD, tweens, indicators, and
the `EditorControls` adapter all stay hand-rolled regardless — and they
write the camera directly every tick, which would fight a library's
internal `update()` (a two-master problem). Re-open this only if
**mobile/touch camera-editing** becomes a goal (`camera-controls` ships
multi-touch) or if the model ever drops KD-03 for a locked-on turntable.

---

## B. Rotation

### KD-03 — Map-mode rotation is a decoupled free-look orbit, not a locked-on turntable
*(TASK-010 D1)*

When you Shift+LB in Map mode, the camera orbits the latched cursor world
point, but your **framing of that point is preserved** — it keeps its
place in your view; the camera does **not** snap to stare straight at it.
The rejected alternative (a turntable that snaps the pivot to screen
centre on first move) was tried, reported, and removed. Mechanically this
is realised by composing yaw+pitch into a **single** rotation `R` applied
to *both* the camera's position-offset-from-pivot and its view direction,
so the pivot's position in the camera frame is invariant at any tilt. An
earlier version applied spherical pitch to the two vectors independently,
which drifted the pivot across the screen (reports/010-testing #1) and
was the bug that forced the single-`R` formulation.

### KD-04 — Hard switch at T, no blend band
*(TASK-010 D3)*

The regime (and the LB sub-mode) switches cleanly at T with no
interpolation. The proposal's 20–30° weighted blend was dropped with the
diorama model. The regime is read at the instant each gesture (or
sub-gesture) begins and **latched for its duration** — so a drag that
starts in Map mode keeps orbiting the cursor pivot even if you tilt below
T mid-drag. Accepted consequence (worth watching in feel-test): a Street
drag that tilts down past T keeps rotating in place until you release. A
concrete re-add-the-blend trigger is recorded rather than an open
"revisit later": if releasing a Map rotate and re-engaging just below T
produces a pivot-location jump that feels wrong.

### KD-06 — Shift is live mid-drag
*(TASK-010 B6)*

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
*(TASK-010 D4; subsumes TASK-020)*

Because the orbit is decoupled (KD-03), the tilt clamp limits where you
*look*, not where the camera *sits* — so a Map orbit around a low pivot
can swing the camera below ground. The guard constrains the **resulting
camera height** (≥ floor + eye margin) by numerically tightening the
*input* tilt bound, so over-dragging past the floor never accumulates and
reversing the drag retraces exactly. This replaced an earlier "y-shove"
that pushed the camera up — a non-reversible correction that taught the
project the "don't add unrequested motion" lesson (KD-17).

---

## C. The swoop (wheel zoom)

### KD-08 — Wheel zoom is a 3-phase swoop gated on AGL; Phase-2 cursor anchoring was dropped
*(001-phase-3-plan; AGL from TASK-013)*

A single continuous wheel gesture carries the camera from birds-eye to
street level through three phases selected by **height above ground**
(AGL, not absolute `camera.y` — TASK-013):

- **Phase 1** (AGL above `TH-22`): cursor-anchored dolly (tilt-conditional
  per KD-05); the world point under the cursor stays under the cursor.
- **Phase 2** (`TH-23` < AGL ≤ `TH-22`): pedestal-down + tilt-toward-
  horizontal. **No cursor anchoring.**
- **Phase 3** (AGL ≤ `TH-23`): FOV-only zoom; the camera doesn't move.

The proposal called for cursor anchoring to continue *through* Phase 2.
It was **deliberately removed**: as tilt flattens through the descent the
cursor ray flattens too, the anchored solver fails near the horizon, and
it flickers between anchored and pure-pedestal per tick. Since Phase 1
already did the horizontal positioning, in-swoop anchoring buys little.
Tradeoff accepted: you land directly below your Phase-2 entry position
and LB-truck/WASD to fine-tune. Phase dispatch is on **elevation first,
then tilt** — the reverse order silently routes Phase-2 ticks into the
low-tilt dolly the moment the tilt lerp drops below T, aborting the
swoop.

### KD-09 — Continuous wheel accumulator, not an integer budget
*(TASK-014a)*

Wheel events normalise to a signed fractional "nominal tick" count
(`TH-10`) accumulated into one float. The high/FOV regimes apply the
whole pending accumulator per frame as one continuous step (no
quantisation, no multi-frame lag); the swoop drains whole ticks under its
per-frame cap (`TH-25`), carrying the remainder. This gives cross-device
parity (one mouse detent ≈ one tick; a trackpad delta ≈ a fraction) by
construction, and makes the dolly and FOV steps tunable independently
(`TH-08` vs `TH-09`) where they were previously one constant.

### KD-10 — Ctrl+wheel bypasses the swoop (fixed-tilt dolly); Mac pinch maps onto it
*(001-phase-3-plan §Ctrl+wheel)*

Holding Ctrl while wheeling gives a plain camera-Z dolly at the current
tilt and elevation, bypassing the swoop entirely — the proposal's
mitigation for "you can no longer do a close zoom at fixed tilt." A Mac
trackpad pinch arrives as Ctrl+wheel, so pinch = fixed-tilt zoom and
two-finger scroll = full swoop, with no Mac-specific code. Tradeoff: on
Windows the Ctrl key now has meaning in the canvas (browser-zoom muscle
memory differs), accepted.

### KD-11 — Swoop reversibility via a transient zoom-undo memory
*(TASK-022)*

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

### KD-12 — Landing FOV "sense of arrival" is a pure function of height
*(TASK-027 Part A)*

As the swoop lands, the FOV eases open toward the landing FOV (`TH-29`,
capped below the fisheye-distortion limit `TH-31`) so the world "opens
up." It is computed as a **pure function of height**, not latched on the
floor crossing — so the descent and an immediate-undo ascent retrace
exactly with no anchor and no jump if the ascent starts mid-band. The
widening is **back-loaded** toward the floor via an exponent (`TH-33`):
a height-linear ramp did almost all its widening at the top of the
descent and none at the bottom (live-test #2: "odd at the start, nothing
at the end"), reading as anything but an arrival.

### KD-13 — Street-level FOV zoom re-aims toward the cursor, faded by distance
*(TASK-027 Part B)*

In Phase 3, narrowing the FOV toward the cursor target also gently
re-aims the camera so the target stays put, computed **absolutely** from
a captured baseline (so it is a pure function of FOV → exactly
reversible). The re-aim magnitude **fades to zero** between `TH-34` and
`TH-35` of target distance, so a far façade→sky crossing is continuous
rather than a hard switch to the no-re-aim fallback.

### KD-14 — Swoop-vs-dolly breakout only fires when looking up at a wall or sky
*(TASK-027 Part C)*

Inside the Phase-2 band, a zoom-in tick normally continues the swoop. It
"breaks out" into a plain dolly **only** when you are craning *up* at
something you can't land on and clearly want to approach — a solid
near-vertical wall/façade, or open sky/horizon. Looking down or level
always swoops (a façade or sky the cursor merely grazes on the way down
must not abort the descent — live-test #2); looking up at scatter
(car/tree/sign) always swoops (live-test #1). The broke-out dolly is a
**bounded excursion** that zoom-out unwinds before resuming the ascent.

### KD-15 — The per-tick lateral lurch cap scales with height
*(TASK-014d / TASK-027 Part F)*

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
*(TASK-024 D1 — the "B4 reversal", pending Kieran's final nod)*

The visible solid surface (ground/road/terrain + buildings, with thin
scatter — signs, people, vehicles, plants — ignored) is found by a
**per-column downward raycast**. Two distinct "floor" notions come off
the same probe:

- **Collision floor** — the nearest solid surface *including building
  roofs*. Landing, the descent clamp, and enclosure all use this. You
  stop on top of whatever solid thing is under you.
- **Travel height** — height above the *ground beneath* buildings, used
  for WASD fly-speed scaling only, so you don't crawl when a roof passes
  under you.

This **reverses** TASK-013's earlier rule (Kieran review item B4) that
made the probe see *through* 3DStreet buildings so a swoop landed at
street level inside the footprint. Live testing found rooftop landing
feels more natural than landing inside a building. The reversal is scoped
to the *collision floor only* (B4's speed-scaling rationale survives as
travel height). It is **structurally load-bearing** — "buildings are
solid" also drives WASD wall-blocking and enclosure — so it needs
Kieran's confirmation before upstream; he is tentatively onboard.

### KD-17 — Automatic motion may only block/prevent; all recovery is user-invoked
*(TASK-024 governing principle)*

The hard rule: **automatic behaviour never adds unrequested camera
motion.** Prevention *blocks* during a gesture (you can't drive through a
floor; the orbit clamp caps the swing). The single bounded exception is
**gesture-end correction**: a drag that *finishes* inside a building eases
back to the most-recent legit pose it passed through — acceptable because
it's the tail of the gesture you just made, not a disconnected spring. Any
other "fix" (scene loaded inside a building, a teleport, a streamed-in
tile) is **user-invoked** — nothing moves until you press the recovery
control. A "legit" pose requires **both** not-enclosed **and** above the
collision floor by the eye margin (neither alone). This principle is the
direct lesson of the retired y-shove (KD-29).

### KD-18 — WASD prevention is a 4-way classifier keyed on surface geometry, not entity category
*(TASK-024 D2)*

A horizontal WASD step compares the collision floor under the camera now
vs at the destination column and classifies the surface ahead into one
of four outcomes — **block** (steep ≥`TH-47` **and** tall ≥`TH-48`:
wall/façade/cliff), **step-up** (steep but short: kerb/ledge → rise to
its top), **follow** (walkable <`TH-47`, up *and* down: road/ramp), or
**hover** (steep+tall down-step: roof edge → hold height, don't plunge).
Keying on **geometry, not entity category** is essential: photogrammetry
tiles fuse ground and buildings into one mesh with no category label, so
a category rule would have no input on exactly the geo scenes it targets.
Blocking keys off the **destination column** being solid (not the swept
footprint touching something), so an opening wider than the camera — a
doorway, arch, tunnel mouth — is threadable. (Live-test OH-1 correction:
walls *always* block — an earlier "don't block while enclosed" carve-out
let you walk through walls under an overhang; escape-from-inside is
user-invoked recovery, not driving through the wall.)

### KD-19 — Grounded vs flying: walking hugs the surface, flying holds an absolute cruise height
*(TASK-024a)*

WASD vertical behaviour depends on a **grounded** flag. *Grounded*
(walking): the camera hugs the surface directly, preserving AGL, not
rate-limited (terrain follow is immediate). *Not grounded* (flying): the
camera eases toward an absolute cruise height `H` (clamped up to clear any
roof by the eye margin), rate-limited (`TH-41`) so the move composes with
continuous WASD. Crucially, **terrain rising under you never grounds
you** — grounded becomes true only on a deliberate descent reaching the
surface. The earlier 3-way toggle and its options 1/2 were retired at
live A/B test (they jumped the camera by the full building height when
crossing onto a footprint); option 3 (absolute-height-hold) is the sole
flying behaviour because the forward ray blocks approach to anything
taller than flight height, so the clamp only ever lifts by ≤ the eye
margin.

### KD-20 — Floors are a per-column raycast, never a flat plane (slope-safe)
*(TASK-024 D4)*

Every floor query raycasts the actual surface per column — never a flat
scene-wide `y = groundY` plane, never an assumed +Y normal. 3DStreet
streets are flat slabs today, but sloped streets are a likely future
(the maintainer is in hilly San Francisco), so the design must not
*preclude* them even though it need not *accommodate* them now. The
steepness-based WASD rule (KD-18) and the AGL probes are inherently
slope-agnostic as a result; the swoop landing stays horizontal for now
but keeps the hit normal available so orient-to-slope can be added later
without a rewrite.

---

## E. Presets & affordances

### KD-21 — Context view button: one state-tracking button + Space share a single resolver; icon = destination
*(TASK-025)*

A single always-visible button (in `?nav=experimental`) offers the one
sensible "change my framing" move for where the camera is, resolved by a
**fixed precedence ladder**: **enclosed → daylight** (pop to clear air) ›
**elevated → street view** (swoop down) › **at street level → drone
view** (rise). The button and the Space key read the **same resolver**,
so they can never disagree. The icon shows the **destination** state
(where the button takes you), matching the compass tooltip convention.
During the button's own animation both triggers are inert (no queue — the
compass's one-deep queue existed only for its double-click rhythm, which
this button lacks). "Elevated vs at street level" uses a hysteresis band
(`TH-67`/`TH-68`) so the icon doesn't flicker at the boundary; branch 2
is **always a swoop** (never a bare vertical fall).

### KD-22 — Drone view is a vertical rise at a fixed gradient, not a swoop-inverse
*(TASK-025 D-A/D-E)*

Drone view rises **straight up** from your spot to an elevated tilted
"survey from above," tilting along the swoop's default overview gradient
(`TH-28`) so it *reads* like a swoop without needing a cursor. A tempting
reframing — "drone = exact reverse swoop" — was tried and **rejected**:
the swoop is not an invertible motion (its retrace is transient and
self-clearing per KD-11, and its free-overhead segment is cursor-dollying
— neither reproducible by a button press). The honest invariant is that
drone and street-view are two canonical moves **about the same ground
column**: because the rise is *vertical*, the swoop-back lands at the same
(x, z). So the drone⇄street toggle round-trips in **position** (not in
arbitrary prior gaze — gaze is the canonical preset each way). Height is
absolute above ground level (`TH-69`), with a roof-clearance rule
(`TH-70`) coupled to the hysteresis so a rooftop arrival reliably reads
"elevated." It rises *through* an overhang to clear air above (TASK-024
permits passing through solid mid-motion; it forbids only *ending*
inside), so drone view has no grey-out case.

### KD-26 — Plan View is folded into a compass button, not a separate view; body-click is two-stage
*(TASK-011 / TASK-026; supersedes the proposal's separate Plan View)*

There is no separate "Plan View." It is a particular camera angle of the
birds-eye view, surfaced as a **compass button** (à la Google Maps).
Clicking the compass body is a two-stage dispatcher decided from the live
pose: if not top-down → animate to top-down **preserving heading** (yaw
kept, so only tilt and altitude change — hardcoding screen-up to world +Z
forced a disorienting 180° spin); if already top-down but not north-up →
align to north; if both → no-op. Rotation **arrows** turn the heading
±90° (`TH-59`). In the Map regime the arrows orbit the **screen-centre
ground point** (a map-style turn keeping the centred feature centred);
near-horizontal they spin in place (TASK-026 — this replaced a call to a
never-implemented helper that threw on every non-top-down click). Plan
View is **zoom-out-only** (never drops below the current altitude — it
should never zoom *in*). The existing App-menu / toolbar / keyboard Plan
View entries fire the same intercept.

### KD-28 — Nadir is handled with a roll-safe pitch axis
*(TASK-023)*

At exact straight-down (nadir) the horizontal heading — and hence the
`view × up` pitch axis — is undefined, which previously left tilt dead at
top-down and risked a roll-snap. The rotation step falls back to the
camera's own screen-right axis (`camRight`), which stays well-defined and
horizontal at nadir and equals `view × up` off-nadir, so tilting *out* of
exact nadir is continuous and roll-free. Rotations are applied via
quaternion premultiply rather than re-deriving from `lookAt`.

---

## F. Double-click navigation (Phase 4)

### KD-23 — Four categories, cardinal-heading snap, never-raise; clearance delegated to TASK-024
*(TASK-012)*

A double-click animates (~`TH-54`-scale eased tween) the camera to a
predictable "good view" of what was clicked, classified into four
categories: **A** lane/street surface, **B** building, **C** generic
object, **D** empty/no-hit (no-op). Two load-bearing simplifications:

- **Cardinal-heading snap.** The resulting heading snaps to the nearest
  of N/E/S/W to the pre-click heading (≤45° rotation). This removes any
  dependence on objects defining a "front" (works for trees and lanes
  too) and bounds the rotation.
- **Never-raise.** A double-click may lower the camera or keep its height
  but **never raises it** — compared on **absolute world height** (what
  the user perceives as "how high am I"), not AGL.

This spec computes only the **desired pose** (look target, heading,
attitude, nominal standoff, target height). Resolving that onto a clear,
non-buried camera position — rest an eye margin above the surface, pull a
blocked standoff back along the heading, hand off to recovery if no clear
pose exists at/below the never-raise height — is the **shared TASK-024
machinery**, invoked identically for every category (not re-implemented
per category). The ~1 s tween is a **committed motion**: only its
endpoint is collision-validated; the path is not per-frame clamped, so a
teleport can descend through an intervening roof to a clear lane below.

### KD-24 — Category B aims at the building centre; height encodes air-vs-street
*(TASK-012, spec delta — supersedes the earlier hit-point aim)*

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
*(TASK-012 DC2/DC4/DC7)*

A double-click never engages Map or Street mode explicitly — it sets the
camera pose, and whether you end up in Street mode (letterbox on) falls
out of the resulting tilt vs T. The mode indicator re-evaluates on **tween
completion** (the landed pose is programmatic, so it won't update on its
own) and does **not** toggle mid-flight (a tween sweeping through T would
otherwise flicker the letterbox — unlike a manual drag, which toggles
live). The teleport **resets FOV** to the height-appropriate default
(discarding any focal-zoom FOV) and **clears TASK-022's transient
zoom-undo memory** (a double-click is a non-wheel move), so a subsequent
wheel-out uses the default overview, not a ghost of a pre-teleport
descent.

### KD-27 — Hover highlight is computed from the same raycast a click consumes
*(TASK-012)*

The hover highlight previously diverged from what a click selects (hover a
car in a lane → the *lane* highlights, but clicking selects the car). The
fix computes the hover target from the same raycast the click uses, so
hovering previews the click result — making the A/C classification
boundary (cursor over the car vs the asphalt beside it) visible and
anticipatable. Applied in both flag-on and legacy flag-off flows **only
if** an audit confirms the two paths haven't diverged for a legitimate
reason; otherwise experimental-only.

---

## G. Mode indicator

### KD-30 — Street mode is signalled by a letterbox (full-width black toolbar strips)
*(overall-plan decision 6; retained through TASK-010 D6)*

The 30°→T mode cut needs a hard-to-miss signal that stays out of the
mouse path. The chosen indicator restyles the floating top/bottom
toolbars into full-width black strips when Street mode is active; the
resulting aspect-ratio change is the cue. It fires whenever tilt crosses T
— including silently during a Phase-2 swoop tilt lerp (not just on LB
events). It is a deliberate placeholder to evaluate with Kieran; lighter
fallbacks (cursor-shape change, accent-colour canvas border, a mode badge)
are on hand if it doesn't survive review. Map mode shows no world-anchored
rotation ring in Street mode because the pivot is the camera itself
(KD-03 only puts a ring on a world pivot).

---

## Worked examples

Concrete scenarios annotated with the phase / pivot / control outcome.
Threshold T at its shipped value (`TH-03` = 25°). "AGL" = height above
the collision floor below.

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
**drone view**. The camera rises straight up (KD-22) to ~`TH-69` above
ground at the ~`TH-28` (~60°) gradient, heading preserved, normal FOV.
Now elevated → the button flips to **street view**; pressing it swoops
back down to the **same (x, z)** at street eye height (position
round-trips; the rise was vertical). If instead you were *enclosed*
(solid overhead), the ladder's first rung wins → **daylight** (pop up),
regardless of how low you are.
