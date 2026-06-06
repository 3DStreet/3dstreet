# 5 — Open Issues

Open items as of the snapshot SHA (`5f43d38d`). Three sources:
**deferred work** (intentionally not built — may be wanted later),
**review/confirmation gates** (decisions awaiting Kieran or feel-test),
and **spec-vs-code discrepancies** surfaced while writing these docs.
IDs are `OI-NN`.

---

## Standing item

### OI-1 — Doc-ID namespace not reconciled with source-comment identifiers

These docs mint a new global namespace — `KD-NN` for decisions
(`02-key-decisions.md`) and `TH-NN` for thresholds
(`03-configurable-thresholds.md`). The code comments and feature specs
still use the **older, inconsistent, per-task** identifiers (`D2`,
`D-LT-3`, `DEC-A`/`DEC-B`, `H3`/`H4`/`H6`, `LT-1`, `B4`, `N3`, `R2-*`,
`CR-D*`, `WE-*`, …). `03-configurable-thresholds.md` records the old IDs
alongside each `TH-NN`, but **the source comments have not been rewritten
to the new namespace.** Reconciling them (or deciding not to) is
deliberately **out of scope** for this documentation task and remains
open.

---

## Spec-vs-code discrepancies (found while documenting)

Per the sourcing rule, where a spec and the code disagree these docs
describe the **code's** behaviour; the discrepancy is logged here. None
of these is a code *bug* — in each case a later task superseded an
earlier planning artefact that was never retro-edited.

### OI-2 — `001-phase-3-plan.md` documents pre-AGL, pre-TASK-022/027 swoop values

The Phase-3 plan (a historical planning artefact in the workspace) still
describes:
- swoop boundaries as **absolute `camera.position.y`**, with an explicit
  `//!!` note that production needs AGL. **Superseded:** TASK-013 made
  them AGL (`decideSwoopPhase` takes AGL). Docs describe AGL.
- `SWOOP_PHASE2_STEP = 0.20`. **Superseded:** now `0.15` (`TH-24`,
  TASK-014a Part B7).
- a latched `_phase3FovBaseline` for the street-level wide-FOV cap.
  **Superseded:** TASK-027 Part A replaced the latch with the derived
  constant `PHASE3_FOV_WIDE_CAP_DEGREES` (`TH-32`); the landing FOV is now
  a pure function of height (KD-12), not a floor-crossing latch.
- internal names `_decideZoomPhase` / `_applyWheelTick` /
  `TRUCK_PEDESTAL_CUTOFF_DEGREES`. The shipped code uses
  `decideSwoopPhase`, `_drainWheel`, and the live `_tiltThreshold`.

Treat `001-phase-3-plan.md` as a snapshot of the Phase-3 milestone, not
current behaviour.

### OI-3 — The double-click spec/plan lag the shipped code; FOV-arrival scope boundary

`TASK-012-phase4-double-click-spec.md` is written defensively around
TASK-014b being "unlanded," and hedges the street-level resting FOV. As
shipped: the landing FOV work *did* land (via TASK-027 Part A, `TH-29` =
75°), but the **double-click teleport resets FOV to the plain default**
`DEFAULT_FOV_DEGREES` (`TH-71` = 50°), **not** the 75° swoop-arrival FOV.
This is an intentional, recently-closed scope boundary (the 75° "sense of
arrival" is a swoop affordance and was *not* extended to the double-click
teleport). Flagged here because a reader comparing the spec's
"height-appropriate FOV" language to the code will see 50°, not 75°, on a
street-level double-click arrival.

### OI-4 — Only four knobs are runtime-configurable, despite many "tunable" comments

Numerous `constants.js` comments say "tunable" / "tune at feel-test."
That means *re-tune in code and rebuild* for all but four values. Only
the knobs wired through `navTuningComponent.js` are live without a
rebuild (`TH-03`, `TH-05`, `TH-07`, `TH-16` — see
`03-configurable-thresholds.md` "Runtime-config surface"). The comment
wording is misleading on its own; documented here so it isn't read as a
larger live surface than exists.

### OI-5 — `constants.js` / file headers reference workspace-only planning paths

Source comments point to `claude/specs/...`, `claude/reports/...`,
`claude/decisions.md`, `claude/backlog.md`, `claude/issues-for-
discussion.md`. Those live in the **planning workspace**, not the product
repo, so an upstream reader following them will 404. Harmless, but worth a
cleanup pass before upstream (or replacing them with pointers into this
`docs/` folder).

---

## Review / confirmation gates (prototype → upstream)

### OI-6 — B4 reversal ("buildings are solid", rooftop landing) needs Kieran's final nod

KD-16 deliberately reverses Kieran's review item B4 (which made the probe
see *through* 3DStreet buildings). He has been shown it and is
**tentatively onboard**, but it is not finally confirmed, and it is
**structurally load-bearing**: "buildings are solid" also drives WASD
wall-blocking and enclosure, so a rejection unpicks more than rooftop
landings. Must be confirmed before upstream.

### OI-7 — Letterbox mode indicator is a placeholder pending review

The full-width-black-bars Street-mode indicator (KD-30) is an explicit
placeholder to evaluate with Kieran. Lower-effort fallbacks are on hand
(cursor-shape change, accent-colour canvas border, a small mode badge) if
it doesn't survive review.

### OI-8 — Transient recovery cue is a new UI element with no 3DStreet precedent

The flash-on-transition recovery cue (TASK-024/025) is a new kind of UI
element. Decision was to **ship it for Kieran to test** and settle then,
rather than pre-cut it. Flagged provisional.

### OI-9 — Accessibility debt across the toolbar widgets

Both the compass (TASK-011) and the context view button (TASK-025) defer
aria roles, focus handling, and keyboard operability; reduced-motion for
the swoop/tweens and keyboard-only navigation are likewise unaddressed.
Neither widget owns the a11y work — it needs a real owner rather than each
deferring to the other. Not a prototype blocker; a dedicated pass is
warranted if a11y becomes a requirement.

---

## Deferred features (intentionally not built)

### OI-10 — FPS / pointer-lock mode (Phase 5)
Scoped as the last, self-contained phase (pointer-lock entry/exit on
Ctrl-hold, WASD nav, subtle FOV/overlay cues) and **not built**. Not a key
navigation mechanic — close work is Street view + double-click.

### OI-11 — Touch / mobile gestures
Out of scope for the whole prototype. The editor is desktop today; mobile
uses viewer-mode. If **mobile/touch camera-editing** becomes a goal it
would also re-open the orbit-library decision (KD-07 / OI-19), since
`camera-controls` ships multi-touch.

### OI-12 — Re-introduce cursor anchoring inside the swoop's Phase 2
Deliberately removed (KD-08). If feel-test shows the "land next to the
cursor target" loss is significant, the cleanest re-introduction is "latch
the anchor + cursor NDC at Phase-2 entry, trajectory determined at entry,
no per-tick re-raycast." Recorded for the backlog, not a v1 option.

### OI-13 — Phase 3 ↔ Phase 2 FOV/pedestal blending
The current design hands off hard at FOV = baseline (zoom-out widens FOV,
*then* the camera starts to pedestal up). If that discontinuity in the
wheel's effect reads as a jolt at feel-test, blend the last stretch of FOV
restoration with a little pedestal. Deferred.

### OI-14 — Velocity-decomposed wall-sliding (diagonal-into-wall)
Moving *parallel* to a wall is already free (the radius/hysteresis only
suppress false blocks while skimming). Pushing *diagonally into* a wall
currently hard-stops the whole step; decomposing it to keep the tangential
component (true slide-along) is a later refinement.

### OI-15 — Orientation-to-slope swoop landing
Dropped per testing (landing stays horizontal). The landing math keeps the
hit normal available so orient-to-slope can be added later without a
rewrite (KD-20), but it is not implemented.

### OI-16 — Bare-earth terrain via an elevation API
The visible surface suffices; an external elevation service / geoid-height
fallback is a possible future addition, not built.

### OI-17 — High-quality street-view on Google 3D Tiles
Low-value per testing (tile resolution is poor); the system only ensures
it's not *broken* at street level on tiles, not that it's *nice*.

### OI-18 — Single-click teleport in Street mode
An open question from the review (how it would coexist with object
selection). Deferred.

### OI-19 — Discoverability caption / hover text ("double-click to navigate here")
Floated in the proposal; not built. The hover-highlight raycast fix
(KD-27) is the only discoverability change shipped for double-click.

### OI-20 — Smoothing / inertia layer
Damped/eased rotate & dolly (the nicest thing `camera-controls` has that
this system lacks) is not implemented. If feel-test asks for it, add a
small velocity/lerp layer on the existing `tickAnimator` rather than
adopting a library (KD-07). Prospective.

### OI-21 — Escape-to-cancel an in-flight context-button / teleport transition
The context button and Space go inert during their own animation (no
queue). An "emergency brake" (Escape to cancel a transition mid-flight) is
noted as a possible later add, not built.

### OI-22 — Cardinal-snap hysteresis on the double-click heading
A pre-click heading near a 45° boundary can flip the snapped result by 90°
(`02-key-decisions.md` worked examples). Whether to add sticky snap near
the boundary is a feel-test call; pure snap shipped.

### OI-23 — Distance-scaled tween duration for very large elevation drops
A double-click from 200 m to 1.5 m uses the same ~1 s tween as a short
hop. Scaling the duration with distance is a feel-test refinement, not
built.

### OI-24 — Footprint-size filtering of tall-thin tile scatter
On fused photogrammetry tiles, a tall-thin baked object (lamppost, tree
trunk) exceeds the WASD block-height and will **block**, because footprint
filtering ("ignore < 2 m × 2 m") is hard on a mesh with no object
boundaries. Accepted minor limitation; a footprint filter is a possible
PLAN refinement, not a guarantee.

---

## Known constraints (not bugs, worth stating)

### OI-25 — Orthographic camera unsupported
`ExperimentalControls` disables itself under an orthographic camera and
logs once, re-enabling when a perspective camera is restored. (The
controls' whole model is perspective-based.)

### OI-26 — Production webpack performance budget over on base navigation
`npm run dist` reports a webpack performance-budget overage that
**pre-exists** on the base navigation bundle — it is not a build break
introduced by this work, and the dev build is clean. Worth knowing before
reading a `dist` "errors" line as a regression.

### OI-27 — Drone-view target height is discontinuous over a building edge
Because the drone height combines a neighbourhood "ground level" with the
roof directly below, two drone presses at adjacent spots near a tower base
can reach different altitudes (street vs roof). Accepted as a tuning
nicety — the hysteresis governs the *icon*, not the target — not a
correctness bug (TASK-025 WE-11).
