# 5 — Open Issues

Open items as of the snapshot SHA (`5f43d38d`). Four groups:
**standing items** (documentation/code-hygiene), **review &
confirmation gates** (work/decisions required before merging upstream),
**known rough edges** (shipped behaviour that doesn't feel right yet), and
**deferred work** (intentionally not built — may be wanted later), plus a
few **known constraints**. IDs are `OI-NN`.

---

## Standing items

### OI-1 — Code identifiers not yet reconciled to the KD / TH namespace

The code comments throughout `nav-experimental/` are annotated with the
**identifiers used during development**, which these docs do **not**
reuse. Three kinds, all of which should eventually be migrated to
reference the stable `KD-NN` / `TH-NN` IDs (or removed):

- **`TASK-NNN` references.** Pervasive in the comments (and in commit
  messages). They point at development tasks that have no meaning to a
  reader of this repo. The intended end state is that a comment cites the
  relevant **`KD`** (decision) or **`TH`** (threshold) instead of a
  `TASK-NNN`.
- **Per-task letter tags** — `D2`, `D-LT-3`, `DEC-A`/`DEC-B`,
  `H3`/`H4`/`H6`, `LT-1`, `N3`, `B7`, `A3`/`A4`, `CR-D5`, `D-A`/`D-B`,
  `WE-N`, etc. These were per-task review/decision labels;
  `03-configurable-thresholds.md` records the ones attached to thresholds
  alongside each `TH-NN` as a bridge, but the comments themselves still
  carry the bare tags.
- **Dangling path references** — a few comments and file headers point at
  documents that live outside this repo (paths under `claude/…`). A
  reader following them will 404; they should be repointed at this
  `docs/` folder or removed.

Doing this reconciliation (or deciding the scope of it) is **out of scope
for this documentation task** and is the standing open item. The
`03-configurable-thresholds.md` cross-reference column is the migration
aid: it maps each current code tag to its `TH-NN`.

### OI-2 — Only four knobs are runtime-configurable, despite many "tunable" comments

Numerous `constants.js` comments say "tunable" / "tune at feel-test."
That means *re-tune in code and rebuild* for all but four values. Only
the knobs wired through `navTuningComponent.js` are live without a
rebuild (`TH-03`, `TH-05`, `TH-07`, `TH-16` — see
`03-configurable-thresholds.md`, "Runtime-config surface"). The comment
wording reads as a larger live surface than exists; worth a clarifying
pass.

### OI-3 — A double-click arrives at the normal FOV, not the swoop's landing FOV

A swoop landing eases the FOV open to a wider "sense of arrival" value
(`TH-29`). A **double-click teleport**, by contrast, resets FOV to the
plain normal default (`TH-71`) — it does **not** reach the wider landing
FOV. This is an intentional, current scope boundary (the "sense of
arrival" is a swoop affordance and was not extended to the teleport), not
a bug — but a reader expecting a street-level double-click to match a
swoop landing's framing will see a narrower FOV. Flagged in case the
inconsistency is later judged worth closing. (Related: the landing-FOV
behaviour itself is under question — see OI-9.)

---

## Review / confirmation gates (work required before upstream merge)

### OI-4 — Engineering-quality pass before merge — RESOLVED (decomposition + readability sweep landed)

Both concerns this item originally raised have landed:

- **Decomposition** — the ~4,900-line monolith was split into ~13
  orchestrated modules (a thin orchestrator over per-gesture controllers,
  two camera-write mechanisms, a per-tick situation sensor, and stateful
  services); `ExperimentalControls.js` is now ~1,070 lines. See **KD-32**
  for the decision and why an orchestrated-classes shape was chosen over an
  ECS-native one.
- **Readability / consolidation** — a dedicated pass reconciled the code
  comments to the maintained `KD` / `TH` / `OI` namespace (this was the work
  `OI-1` tracked), stripped dev-process leakage and dead code, and
  disambiguated the confusable floor-probe method names.

What remains a genuine upstream gate is the **maintainer's own review** —
the "buildings are solid" nod (`OI-5`) and the placeholder UI affordances
(`OI-6`/`OI-7`) — not the internal-quality work this item described.

### OI-5 — "Buildings are solid" / rooftop landing needs the maintainer's final nod

KD-16 reverses an earlier rule so that a swoop lands *on* a building roof
rather than at street level inside its footprint. The maintainer has been
shown it and is **tentatively onboard**, but it is not finally confirmed,
and it is **structurally load-bearing**: "buildings are solid" also drives
WASD wall-blocking and enclosure, so a rejection unpicks more than rooftop
landings. Confirm before upstream.

### OI-6 — Letterbox mode indicator is a placeholder pending review

The full-width-black-bars Street-mode indicator (KD-30) is an explicit
placeholder. Lower-effort fallbacks are on hand (cursor-shape change,
accent-colour canvas border, a small mode badge) if it doesn't survive
review.

### OI-7 — Transient recovery cue is a new UI element with no precedent

The flash-on-transition recovery cue is a new kind of UI element in this
editor. The intent is to **ship it for review/testing** and settle then,
rather than pre-cut it. Provisional.

### OI-8 — Accessibility debt across the toolbar widgets

Both the compass and the context view button defer aria roles, focus
handling, and keyboard operability; reduced-motion for the swoop/tweens
and keyboard-only navigation are likewise unaddressed. Neither widget owns
the a11y work — it needs a real owner. Not a prototype blocker; a
dedicated pass is warranted if a11y becomes a requirement.

---

## Known rough edges (shipped, but the feel isn't right yet)

### OI-9 — The swoop Phase 2 → Phase 3 transition / landing FOV doesn't deliver the intended feel

The "sense of arrival" — easing the FOV open toward the wide landing value
as the swoop reaches street level (KD-12, `TH-29`/`TH-32`) — **doesn't
achieve what we wanted in practice.** A user will often want to **end up
at street level already at the widest FOV**, and right now that resting
position is hard to reach without nudging the wheel in a little (which
starts narrowing the FOV again). The wider-FOV-on-landing approach, as it
stands, doesn't really work.

Candidate fix (TBC): give the Phase 2 → 3 boundary a small **dead-band of
~2–3 wheel ticks that do nothing** before the Phase-3 FOV zoom begins, so
the camera settles at the wide landing FOV and you have to deliberately
push past the dead-band to start zooming in. Open question whether that
needs a **visual indicator** at the boundary. This may revise or replace
KD-12's height-driven FOV ramp; needs design + feel-test. (Distinct from
OI-14, which is the *zoom-out* hand-off at the same boundary.)

### OI-10 — The context view button (drone / street view / daylight) doesn't feel right yet

The single state-tracking button (KD-21) works mechanically but the **UX
doesn't feel right yet**, and it isn't clear how to improve it — icon
legibility, the icon-as-destination convention, the three-way state
changes, and discoverability are all candidates. This probably needs input
from **Kieran or his 2D-UI expert** rather than another internal
iteration. Carry it into the upstream review conversation alongside OI-6 /
OI-7 (the other UI affordances awaiting his eye).

---

## Deferred features (intentionally not built)

### OI-11 — FPS / pointer-lock mode
Pointer-lock entry/exit on Ctrl-hold, WASD nav, subtle FOV/overlay cues —
**not built**. Not a key navigation mechanic (close work is Street view +
double-click).

### OI-12 — Touch / mobile gestures
Out of scope for the prototype. The editor is desktop today; mobile uses
viewer-mode. If **mobile/touch camera-editing** becomes a goal it would
also re-open the orbit-library decision (KD-07), since `camera-controls`
ships multi-touch.

### OI-13 — Re-introduce cursor anchoring inside the swoop's Phase 2
Deliberately removed (KD-08). If feel-test shows the "land next to the
cursor target" loss is significant, the cleanest re-introduction is "latch
the anchor + cursor NDC at Phase-2 entry, trajectory determined at entry,
no per-tick re-raycast." Recorded for the backlog, not a v1 option.

### OI-14 — Phase 3 ↔ Phase 2 FOV/pedestal blending (zoom-out hand-off)
The current design hands off hard at FOV = baseline (zoom-out widens FOV,
*then* the camera starts to pedestal up). If that discontinuity reads as a
jolt, blend the last stretch of FOV restoration with a little pedestal.
Deferred. (Distinct from OI-9, which is the *zoom-in* arrival feel.)

### OI-15 — Velocity-decomposed wall-sliding (diagonal-into-wall)
Moving *parallel* to a wall is already free. Pushing *diagonally into* a
wall currently hard-stops the whole step; decomposing it to keep the
tangential component (true slide-along) is a later refinement.

### OI-16 — Orientation-to-slope swoop landing
Dropped per testing (landing stays horizontal). The landing math keeps the
hit normal available so orient-to-slope can be added later without a
rewrite (KD-20), but it is not implemented.

### OI-17 — Bare-earth terrain via an elevation API
The visible surface suffices; an external elevation service / geoid-height
fallback is a possible future addition, not built.

### OI-18 — High-quality street-view on photogrammetry tiles
Low-value per testing (tile resolution is poor); the system only ensures
it's not *broken* at street level on tiles, not that it's *nice*.

### OI-19 — Single-click teleport in Street mode
An open question (how it would coexist with object selection). Deferred.

### OI-20 — Discoverability caption / hover text ("double-click to navigate here")
Not built. The hover-highlight raycast fix (KD-27) is the only
discoverability change shipped for double-click.

### OI-21 — Smoothing / inertia layer
Damped/eased rotate & dolly is not implemented. If feel-test asks for it,
add a small velocity/lerp layer on the existing tick animator rather than
adopting a library (KD-07). Prospective.

### OI-22 — Escape-to-cancel an in-flight context-button / teleport transition
The context button and Space go inert during their own animation (no
queue). An "emergency brake" (Escape to cancel mid-flight) is a possible
later add, not built.

### OI-23 — Cardinal-snap hysteresis on the double-click heading
A pre-click heading near a 45° boundary can flip the snapped result by 90°
(`02-key-decisions.md` worked examples). Whether to add sticky snap near
the boundary is a feel-test call; pure snap shipped.

### OI-24 — Distance-scaled tween duration for very large elevation drops
A double-click from 200 m to street level uses the same fixed tween
duration (`TH-50`) as a short hop. That one duration is currently *shared*
by the recovery fall/swoop, the gesture-end recovery, the double-click
teleport, and the drone rise — so it cannot be tuned per-behaviour, and
scaling the teleport's duration with travel distance isn't possible
without splitting the constant first. Both (distance-scaling, and
separating the shared `TH-50`) are feel-test refinements, not built.

### OI-25 — Footprint-size filtering of tall-thin tile scatter
On fused photogrammetry tiles, a tall-thin baked object (lamppost, tree
trunk) exceeds the WASD block-height and will **block**, because footprint
filtering ("ignore < 2 m × 2 m") is hard on a mesh with no object
boundaries. Accepted minor limitation; a footprint filter is a possible
future refinement, not a guarantee.

---

## Known constraints (not bugs, worth stating)

### OI-26 — Orthographic camera unsupported
`ExperimentalControls` disables itself under an orthographic camera and
logs once, re-enabling when a perspective camera is restored. (The
controls' whole model is perspective-based.)

### OI-27 — Production webpack performance budget over on the base bundle
`npm run dist` reports a webpack performance-budget overage that
**pre-exists** on the base navigation bundle — it is not a build break
introduced by this work, and the dev build is clean. Worth knowing before
reading a `dist` "errors" line as a regression.

### OI-28 — Drone-view target height is discontinuous over a building edge
Because the drone height combines a neighbourhood "ground level" with the
roof directly below, two drone presses at adjacent spots near a tower base
can reach different altitudes (street vs roof). Accepted as a tuning
nicety — the hysteresis governs the *icon*, not the target — not a
correctness bug.

### OI-29 — Non-catalog glTF buildings are not solid
Solidity is catalog-gated (KD-34): only a building whose `mixin` resolves
to a `STREET.catalog` entry with `category:'buildings'` reads as solid. A
user-imported glTF or any non-catalog building model classifies as
`'scatter'`, so the camera passes through it — no collision floor, no
wall-block, no enclosure. Accepted boundary for the managed-street
prototype (the scenes that need solidity are catalog-built), not a bug.
