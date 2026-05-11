# 001 — Phase 3 Plan: Full Swoop

*Working draft 2026-05-11. Will iterate.*

Phase 3 of the navigation prototype work (see `001-overall-plan.md`). Connects Phase 1's cursor-anchored dolly with Phase 2's low-tilt mode into a single continuous wheel-zoom gesture: the 3-phase "swoop" described in `claude/reference/3D Street Navigation Proposal.md` §"3-phase Swoop zoom".

Promotes the skeleton at `001-phase-3-skeleton.md` to a working plan now that Phase 2 has shipped and feel-tested (2026-05-11). The skeleton is left in place as historical record of what was held open at the time.

## Goals

1. Replace the current "single cursor-anchored dolly" wheel behaviour (at tilt > 30°) with a three-phase state machine driven by camera elevation.
2. Land a smooth, continuous transition from birds-eye to street level on a single wheel gesture. Cursor anchoring is preserved through Phase 1 only; Phase 2 is pure pedestal+tilt (see §"Mechanics" design history note and §"Open decisions" #3).
3. Validate reversibility: zoom in to street level, zoom back out, end at the same camera angle.
4. Resolve the open decisions held over from the skeleton — explicitly, with recommendations.
5. Keep the existing low-tilt branch (`tilt ≤ 30°`, plain camera-Z dolly per `001-tilt-conditional-zoom.md`) unchanged. The swoop applies to the high-tilt branch only.

## Non-goals

- No change to the low-tilt wheel branch.
- No change to LB+drag, Shift+LB+drag, WASD, or Plan View. Phase 3 is wheel-only.
- No double-click navigation (Phase 4).
- No FPS mode (Phase 5).
- No replacement of the wheel-budget accumulator. The existing drain model is reused; Phase 3 changes what each unit tick *does*, not how ticks are produced.

## What Phases 0–2 left us with

- `?nav=experimental` flag, `ExperimentalControls` owning the camera, `ModifierState`, `GestureLatch`, `SceneBounds`, `CursorAnchor`, `TickAnimator` — all in place.
- `_decideZoomPhase(event)` exists as a one-liner returning `'phase1'`. Phase 3 extends this into a real branch.
- `_applyWheelTick(sign)` is the per-unit-tick driver. Today it has two branches inside it — high-tilt (cursor-anchored) vs low-tilt (synthetic camera-forward anchor). Phase 3 splits the high-tilt branch into three further branches.
- `cursorAnchor.worldPointAt()` returns `{ x, y, z, source }`. Phase 3 reuses it unchanged.
- Wheel-budget accumulator drained at `WHEEL_MAX_TICKS_PER_FRAME = 10` per A-Frame tick. Phase 3 may lower the cap when in the transition band (see §"Trackpad blast-through mitigation").
- Stored-tilt state has no home yet — Phase 3 adds it as instance state on `ExperimentalControls`.

## Mechanics — exact spec

Phase is selected per unit tick from camera elevation `y = camera.position.y`:

| Phase | Range            | Behaviour                                                                  |
|-------|------------------|-----------------------------------------------------------------------------|
| 1     | `y > 10m`        | Existing tilt-conditional zoom (`001-tilt-conditional-zoom.md`) — cursor-anchored at tilt > 30°, plain camera-Z dolly at tilt ≤ 30°. Unchanged. |
| 2     | `1.5m < y ≤ 10m` | Pedestal down + tilt toward horizontal. No cursor anchoring. "Swoop transition." |
| 3     | `y ≤ 1.5m`       | FOV-only zoom around the camera position. No translation.                   |

`y` is `camera.position.y` directly — i.e. metres above world origin, not "metres above ground" (see §"Open decisions" #1 for rationale).

**Phase 2's elevation gate is unconditional on tilt.** Once `y ≤ 10m`, wheel input drives the swoop regardless of current tilt. The 30° tilt-conditional rule from `001-tilt-conditional-zoom.md` lives inside Phase 1 only; Phase 2 is pure pedestal+tilt with no anchoring, so it has no per-tick raycast and no failure modes.

**Design history note: cursor anchoring was deliberately removed from Phase 2 (2026-05-11 conversation).** The proposal called for cursor anchoring to continue through Phase 2 ("the descent track aims to keep the anchor point under the cursor"). That design re-introduced the failure-mode class fixed by `001-tilt-conditional-zoom.md`: as tilt descends through the swoop, the cursor-pixel ray flattens, the anchored solver fails (`d_y ≥ 0` near the horizon), and pure-pedestal fallback fires per tick — same flicker the tilt-conditional split eliminated at low tilt. Since the user is already nearly above their target by y=10m (Phase 1's anchored dolly handled the horizontal positioning), the marginal value of in-swoop anchoring is small. Trade-off accepted: the user lands directly below their Phase 2 entry xz position, and LB-trucks or WASDs to fine-tune.

### Phase 1 — cursor-anchored dolly (unchanged)

Exactly as today. Each tick translates the camera along the camera→anchor ray by `ZOOM_PER_WHEEL_TICK` (10%) of the current distance. Tilt-preserving by construction. The no-hit fallback chain in `cursorAnchor.worldPointAt()` is unchanged.

**Phase-boundary handling on a Phase-1 zoom-in tick:** if the tick would push `camera.position.y` below 10m, split the tick into "the portion that lands at exactly y=10m" and "the residual zoomed in Phase 2". On crossing, latch the stored tilt before evaluating Phase 2 (see §"Stored-tilt latch"). The simple implementation is to translate fully in Phase 1, then immediately invoke Phase 2's logic with the residual zoom-energy (parametrised in §"Tick energy and phase splitting").

### Phase 2 — swoop transition (1.5m < y ≤ 10m)

Pure pedestal + tilt. No cursor anchoring; no raycast; no solver. Per unit zoom-in tick:

1. **Target elevation:** `y_next = y - α × (y - 1.5)`, with `α = SWOOP_PHASE2_STEP = 0.10` per unit tick. Exponential approach to the 1.5m floor.
2. **Target tilt:** `θ_next = θ_stored × (y_next - 1.5) / 8.5`. Linear ramp from `θ_stored` at y=10 to `0°` at y=1.5.
3. **Update camera:** `camera.position.y = y_next`; tilt set to `θ_next`; `(x, z)`, yaw, and FOV unchanged.

Zoom-out tick: `y_next = 1.5 + (y - 1.5) / (1 - α)`. Same multiplicative reciprocal as Phase 1. Tilt follows the same linear-in-y formula, which means it rises from current → θ_stored as the camera ascends.

**Yaw and (x, z) are held fixed across a Phase 2 tick.** The camera elevators down/up at its current xz position; the user can LB-truck or WASD horizontally before, during, or after the swoop independently.

**Phase-boundary handling on a Phase-2 zoom-in tick that crosses y=1.5m:** clamp position to y=1.5m, tilt to 0°, hand residual tick energy to Phase 3.

**Phase-2 zoom-out tick crossing y=10m:** the inverse — clamp at y=10m, tilt at θ_stored, hand residual to Phase 1.

### Phase 3 — focal zoom (y = 1.5m, tilt = 0°)

Camera is at street level, horizontal. Wheel input becomes FOV-only.

**FOV state:** at Phase 3 entry (downward crossing of y=1.5m), latch `fov_baseline = camera.fov`. Per zoom-in tick: `fov ÷= 1 + ZOOM_PER_WHEEL_TICK` (= ÷1.1). Per zoom-out tick: `fov ×= 1 + ZOOM_PER_WHEEL_TICK` (= ×1.1).

**FOV floor:** `SWOOP_PHASE3_FOV_FLOOR_DEGREES = 15`. Further zoom-in ticks at the floor have no effect.

**Phase 3 → Phase 2 transition (zoom-out):** when `fov ≥ fov_baseline`, clamp `fov = fov_baseline`, latch `fov_baseline` as the camera's current FOV, and hand the residual zoom-out energy to Phase 2 (which begins to pedestal up from y=1.5m). Mirrors the upward-crossing logic of Phase 2 → Phase 1.

**Camera position and tilt are locked** in Phase 3. Only FOV changes. (The user can still drive position via WASD/LB+drag and tilt via Shift+LB independently of the wheel.)

### Stored-tilt latch

Instance state on `ExperimentalControls`:

```js
this._storedTilt = cameraTiltDegrees(this._camera);  // initialised on construction
```

**Write rule (round-down model):** when a Phase-1 zoom-in tick would push `camera.position.y` below 10m, the tick is applied fully (per §"Tick energy" round-down), the camera is clamped to y=10m, and `this._storedTilt = cameraTiltDegrees(this._camera)` is latched in the same step. Phase 1 ticks are tilt-preserving, so the latched value equals the camera's tilt at the moment of crossing. Most-recent-crossing-wins.

**Read rule:** Phase 2's target-tilt computation reads `this._storedTilt`.

**Why initialised at construction:** the user can start the session with the camera already at `y < 10m` (e.g. a saved scene at street level) and start zooming. Phase 2's tilt-lerp needs a defined `θ_stored` from the first tick. Camera's current tilt at construction is a reasonable default.

**Manual camera changes (not via wheel) do not update `_storedTilt`.** Specifically: Shift+LB, LB+drag, WASD, Plan View, focus animations — none of these write to `_storedTilt`. Rationale: `_storedTilt` is the "what tilt was the user using before they dove" memory. Manual re-tilting at any elevation is a separate gesture; the stored value should reflect the user's *most recent intent to descend*, not their current orientation.

**Edge case — low-tilt Phase 1 → Phase 2 entry.** Under tilt-conditional zoom (`001-tilt-conditional-zoom.md`), a Phase 1 wheel input at tilt ≤ 30° dollies the camera along its view direction. With non-zero tilt, the dolly has a downward y component (~sin(tilt) × 3m per tick); enough ticks carry y across 10m at low tilt. The crossing tick latches `_storedTilt` = current tilt (could be e.g. 20°). Phase 2 then lerps tilt from 20° → 0° as y descends to 1.5m. This is off-spec relative to the proposal (which assumes Phase 2 entry from a map-mode tilt) but plausibly fine in practice — landing horizontal from a 20° start is a reasonable elevator descent. Flagged in Risks for feel-test; if it feels wrong, the one-line fix is to floor the latch at `max(latch, 30°)`. See `claude/reports/007-phase-3-plan-review.md` H3.

**Edge case:** what if the camera crosses y=10m by some non-wheel mechanism (Plan View tween, focus, WASD descent)? Skeleton flagged this. Recommendation: **don't latch on non-wheel crossings**. The user's tilt at, say, the moment a Plan View tween ends is the new orientation regardless; storing it as `_storedTilt` for a future swoop doesn't add information. The next downward wheel crossing latches whatever the current tilt is, which is correct. Documenting the convention here.

### Tick energy and phase splitting

Each unit zoom-in tick has "energy" equal to one `ZOOM_PER_WHEEL_TICK` step in its native phase. When a tick crosses a phase boundary, the remaining energy is interpreted in the new phase:

- A Phase 1 tick that would push y from 12 → 9: split into "12 → 10 in Phase 1" and "remaining 1m of pedestal-equivalent in Phase 2". Concretely: in Phase 1 the proportional step was `(12 - 9) / 12 = 25%` of the cam→anchor distance. After translating to y=10, the residual proportion is `2/3 × 25% = 16.7%` of the *new* cam→anchor distance. Apply that as a Phase 2 step from y=10.
- Symmetrically for Phase 2 → Phase 3 and Phase 3 → Phase 2 crossings on zoom-out.

**Simplification (recommended):** round-down — apply the tick fully in its starting phase, clamping at the boundary if the result would overshoot. The "lost" energy on a clamped tick is bounded by one tick's worth, but **one tick's worth is not necessarily small** in Phase 1: a Phase 1 tick is 10% of camera→anchor distance, not 10% of any fixed quantity. With the cursor near a building 5m away, a single tick can be 0.5m; with the cursor on the ground 50m away, a single tick is 5m. So a Phase 1 → Phase 2 crossing tick can lose up to several metres of in-band Phase-1 energy in the worst case, not the ~0.2m suggested by averages. Round-trip cost across two crossings (1↔2 and 2↔3) can therefore be in the small-metres range for camera y. See `claude/reports/007-phase-3-plan-review.md` H5.

**Phase 3 plan adopts the round-down simplification anyway.** Acceptable for the prototype because (a) the drift is bounded and (b) implementing proper energy carry-over across phases requires re-parameterising each tick's "energy" between very different units (anchored-ray-distance for Phase 1, pedestal-fraction for Phase 2, FOV-fraction for Phase 3) — high complexity for a feel-test-detectable corner case. Revisit if feel-testing surfaces it.

### Reversibility

The proposal asserts: "Mouse wheel up/down controls are consistent, so if you zoom in & then out, or zoom out & then in, you end up with the same camera angle."

**Phase 1:** reversible by construction. A zoom-in tick by factor `(1 - α)` and a zoom-out tick by factor `1 / (1 - α)` are exact inverses on the (camera, anchor) line, assuming the anchor doesn't change. If the cursor moved between the two ticks, the anchors differ and reversibility holds only "approximately" — same as today.

**Phase 2:** trivially reversible. `(x, z)` are untouched. `y` and `θ` are deterministic functions of each other via `θ(y) = θ_stored × (y - 1.5) / 8.5`. The zoom-in tick `y_next = y - α(y - 1.5)` and its inverse `y_next = 1.5 + (y - 1.5)/(1 - α)` retrace exactly. No anchor state, no per-tick raycast — nothing data-dependent.

**Phase 3:** trivially reversible. `fov ÷ 1.1` and `fov × 1.1` are inverses.

**Cross-phase reversibility:** Phase 1 → Phase 2 → Phase 3 round-trip is reversible iff each per-phase tick is reversible and the boundary crossings are reversible. With the round-down simplification (§"Tick energy"), a boundary clamp on the way down loses up to 1 tick of energy; on the way up the same energy is lost. Net effect: a full down-and-back-up traversal may end up ~2 ticks short of the start in each crossed boundary. Acceptable for the prototype; document and feel-test.

### Trackpad blast-through mitigation

Skeleton flagged this. Current state: `WHEEL_MAX_TICKS_PER_FRAME = 10` and `WHEEL_MAX_BUDGET = 1000` together mean a trackpad burst can drive 10 ticks per frame, i.e. ~6 frames to traverse Phase 2 from y=10 to y=1.5 with 10% steps (~64 ticks). ~100ms minimum. Feels rushed for a "swoop" gesture that should feel smooth.

**Recommendation:** lower per-frame drain cap *inside Phase 2 only* to `SWOOP_PHASE2_MAX_TICKS_PER_FRAME = 3`. Phase 1 and Phase 3 retain the existing 10/frame. Result: Phase 2 traversal is bounded below at ~64/3 ≈ 21 frames ≈ 350ms, which reads as a deliberate transition rather than a teleport.

Implementation: at the *start* of each frame's `_drainWheel` pass, evaluate `decideSwoopPhase(camera.position.y)` once, set the cap for the frame, and hold it for the full pass — do not re-evaluate per iteration. This avoids the boundary-crossing asymmetry where (e.g.) a Phase 2 → Phase 1 zoom-out crossing mid-pass would suddenly raise the cap from 3 to 10 and unlock 7 additional Phase-1 ticks in the same frame, producing a visible speed-up the moment the user crosses y=10m. See `claude/reports/007-phase-3-plan-review.md` H4. Net effect: a frame that crosses the boundary runs at the *starting* phase's cap; the new phase's cap kicks in next frame.

**Why not lower the global cap:** Phase 1 at altitude wants snappy response — 100ms to dolly through a wheel burst feels good. Slowing Phase 1 to match Phase 2 trades that off needlessly.

**Alternative considered:** queue-based minimum-duration animation (start the swoop as a tween, ignore wheel input until it completes). Rejected — breaks the "wheel goes brrrr and the camera follows" feel that Phase 1 is built on. The per-phase cap preserves continuous-wheel feel without enabling teleport.

## Architecture additions

### `constants.js` — new entries

```js
// Phase 3 swoop boundaries (camera.position.y in metres).
export const SWOOP_PHASE2_ENTRY_ELEVATION_METRES = 10;
export const SWOOP_PHASE2_EXIT_ELEVATION_METRES = 1.5;

// Phase 2 per-tick pedestal step: fraction of (current y - exit elevation)
// consumed per unit zoom-in tick. Matches ZOOM_PER_WHEEL_TICK in shape.
export const SWOOP_PHASE2_STEP = 0.10;

// Phase 2 per-frame drain cap (overrides WHEEL_MAX_TICKS_PER_FRAME inside
// the swoop transition only). Slows trackpad bursts so the transition
// reads as deliberate rather than instantaneous.
export const SWOOP_PHASE2_MAX_TICKS_PER_FRAME = 3;

// Phase 3 FOV floor (degrees). Further zoom-in ticks at the floor are no-ops.
export const SWOOP_PHASE3_FOV_FLOOR_DEGREES = 15;
```

### `navMath.js` — new helpers

```js
// Pure: returns 'phase1' | 'phase2' | 'phase3' from elevation.
export function decideSwoopPhase(y) { ... }

// Pure: returns target tilt (degrees from horizontal) for a given
// elevation y, given the latched stored tilt at Phase 2 entry.
export function phase2TargetTilt(y, storedTiltDeg) { ... }
```

Both are pure functions of their inputs; trivially unit-testable. `phase2TargetTilt` is a 3-line lerp. No solver helper — Phase 2 has no cursor anchoring.

### `ExperimentalControls.js` — internal changes

**Instance state:**
- `this._storedTilt` — initialised from `cameraTiltDegrees(camera)` at construction.
- `this._phase3FovBaseline` — initialised null; latched on downward crossing of y=1.5m; cleared on upward crossing.

**`_decideZoomPhase`:** kept as-is but now consulted by `_drainWheel` for per-frame-cap selection (not by `_applyWheelTick`, which uses `decideSwoopPhase(camera.position.y)` directly since the phase is implicit from elevation, not from the event).

**`_drainWheel`:** check `decideSwoopPhase(camera.position.y)` before each unit-tick iteration; cap the iteration count by `SWOOP_PHASE2_MAX_TICKS_PER_FRAME` when in Phase 2, else by `WHEEL_MAX_TICKS_PER_FRAME`.

**`_applyWheelTick(sign)`:** dispatch on **elevation first**, then on tilt only inside the Phase 1 branch. This ordering is load-bearing — see `claude/reports/007-phase-3-plan-review.md` H1. The reverse order (tilt-first) silently routes Phase 2 ticks into the low-tilt camera-Z dolly the moment the swoop's lerp drops tilt below 30° (≈ y=5.75m for θ_stored=60°), aborting the swoop mid-flight.

```js
const phase = decideSwoopPhase(camera.position.y);
if (phase === 'phase2') return this._applyPhase2WheelTick(sign);
if (phase === 'phase3') return this._applyPhase3WheelTick(sign);
// phase1: the tilt-conditional split from 001-tilt-conditional-zoom.md
// lives here, scoped to the y > 10m elevation range only.
if (cameraTiltDegrees(camera) <= TRUCK_PEDESTAL_CUTOFF_DEGREES) {
  return this._applyLowTiltWheelTick(sign);
}
return this._applyPhase1WheelTick(sign);
```

**`_applyPhase1WheelTick(sign)`:** the *current* high-tilt branch of `_applyWheelTick`, extracted unchanged. Also handles the Phase 1 → Phase 2 boundary: on zoom-in, if the post-tick `camera.position.y` would drop below 10m, clamp to y=10m and latch `_storedTilt = cameraTiltDegrees(camera)` (before the clamp's tilt-changing side effects, though Phase 1 ticks don't change tilt).

**`_applyPhase2WheelTick(sign)`:** new. Computes `y_next` (per the reciprocal exponential), computes `θ_next` via `phase2TargetTilt`, sets `camera.position.y = y_next`, sets the camera's tilt to `θ_next` preserving yaw, leaves `(x, z)` and FOV untouched. Handles Phase 2 → Phase 3 boundary on zoom-in (clamp to y=1.5, tilt=0°, latch `_phase3FovBaseline = camera.fov`) and Phase 2 → Phase 1 boundary on zoom-out (clamp to y=10, leave `_storedTilt` unchanged).

**`_applyPhase3WheelTick(sign)`:** new. Multiplies `camera.fov` by the reciprocal factor, clamps to `[SWOOP_PHASE3_FOV_FLOOR_DEGREES, _phase3FovBaseline]`. On zoom-out, if `camera.fov` reaches `_phase3FovBaseline`, clear the baseline and the next zoom-out tick will begin Phase 2.

**`nav-experimental:swoopphase` event (optional):** emit on phase changes. No current consumer, but useful for the toolbar indicator if Phase 3 wants a different visual cue from the existing `decideLbMode` mode-change event. Skipped from v1 — fold into `nav-experimental:modechange`'s payload if needed.

### Ctrl+wheel — fixed-tilt zoom (Recommended)

Per the proposal's "what is lost" mitigation: holding Ctrl while wheeling bypasses the swoop and gives a plain camera-Z dolly at the current tilt and elevation.

Implementation: in `_onWheel`, if `event.ctrlKey` is set, route to the low-tilt branch's behaviour (synthetic camera-forward anchor, plain dolly) regardless of tilt. The user can hold Ctrl at high tilt to zoom toward the ground without descending into the swoop.

**Mac trackpad pinch caveat:** Mac trackpad pinch arrives as `Ctrl+wheel`. So on Mac, pinching = fixed-tilt zoom. Two-finger scroll = swoop. The proposal explicitly supports this mapping (§"Mac trackpad mapping: ... Ctrl+wheel ... maps naturally onto the 'fixed-tilt zoom' Ctrl-modifier behavior"). No special Mac code path needed.

**Trade-off:** on Windows, the Ctrl key is now meaningful in wheel context. Users who reflexively hold Ctrl (e.g. browser zoom muscle memory) will see different behaviour. Acceptable — Ctrl-scroll outside the editor canvas still does browser zoom.

This is the recommendation. See §"Open decisions" #2 for the alternative.

## Open decisions

The skeleton flagged seven held-open decisions. Phase 3 plan resolves them with recommendations; user pushback expected via `//!!`.

### 1. What "10m above" measures — `camera.position.y` (Recommended)

**Recommendation: `camera.position.y` directly.** Simplest, no raycast cost per tick, no scene-dependent surprise.

**Trade-off:** scenes with the ground plane not at y=0 (elevated dioramas, geo-located scenes far from origin) will see the 10m and 1.5m boundaries at non-intuitive absolute heights. For the prototype testing on the basic-street default scene (ground at y=0) this doesn't matter.
//!! OK for prototyping.  For production absolutely needs to be relative to ground level.  Record that in the backlog as an outstanding issue.
//** Agreed. Added backlog entry "Phase 3 swoop elevation thresholds must be AGL for production" pointing back to this section.

**Alternatives deferred:** "above ground" (AGL via per-tick raycast below camera) or "above scene bounds top" (via `SceneBounds`). For the basic-street default scene (ground at y=0) absolute-y works fine. For scenes with ground level meaningfully above or below y=0, the absolute-y thresholds are known-wrong (1.5m absolute lands in/below the ground); what is unknown is how prevalent such scenes are in real 3DStreet usage. AGL via per-tick raycast is the production fix when we know.
//!! Don't need feel-testing to know that when ground level is more than 1.5m above y=0, we won't have appropriate behaviour.  What is unknown is how important scenes with GL !== 0 are.
//** Reworded above — "if feel-testing reveals" was the wrong framing. The behaviour is known-broken for ground ≠ 0; the unknown is just prevalence.

### 2. Ctrl+wheel semantics — fixed-tilt zoom (Recommended)

**Recommendation:** Ctrl+wheel bypasses the swoop, giving plain camera-Z dolly at the current tilt. Matches the proposal's `what is lost` mitigation.

**Alternative:** Ctrl+wheel identical to plain wheel (no special semantic). Cleaner; loses the "I want to keep my current tilt while zooming" affordance.

The recommendation costs ~5 lines of code to gate at `_onWheel` and adds a useful affordance. Worth doing.
//!! OK.
//** Locked.

### 3. Phase 2 cursor anchoring — removed entirely

**Resolution (2026-05-11, post-//!!-pass):** Phase 2 has no cursor anchoring. Pedestal + tilt only. The proposal's "land next to the world point under the cursor" feature is dropped from the prototype.

**Why:** the per-tick re-raycast model re-introduces the failure-mode class fixed by `001-tilt-conditional-zoom.md`. As tilt descends through the swoop, the cursor-pixel ray flattens and the anchored solver fails near the horizon, flickering between anchored and pure-pedestal per tick. Avoiding that flicker requires either latching the anchor at entry (which breaks the "anchor follows cursor" intent of the original proposal) or pre-checking the cursor's NDC band at entry to decide anchored vs pure-pedestal upfront. Both add complexity for marginal value: by the time Phase 2 begins (y=10m), Phase 1's anchored dolly has already done the horizontal positioning, so the additional in-swoop horizontal-correction the anchoring would provide is small.

**Trade-off:** the user ends Phase 2 directly below their entry xz position. They LB-truck or WASD to fine-tune the horizontal landing. Acceptable; we'll learn from feel-test whether the loss is felt.

**If feel-test reveals the loss is significant**, the cleanest re-introduction is the "latch anchor + cursor NDC at Phase 2 entry, no per-tick re-raycast, swoop trajectory determined at entry" model. Recorded for the backlog rather than as a v1 option.

### 4. No-hit fallback during Phase 2 — n/a

**Resolution:** moot. With no cursor anchoring in Phase 2, there's no anchor to fall back from. Pure pedestal+tilt is the only mode.

### 5. Reversibility — stateless function of (elevation, stored-tilt) per phase

Documented above. No "breadcrumb" recording. State is `_storedTilt` (latched at Phase 1 → Phase 2 downward crossings) and `_phase3FovBaseline` (latched at Phase 2 → Phase 3 downward crossings). Everything else is a function of `camera.position`, `camera.quaternion`, `camera.fov`, and `_storedTilt`.

Reversibility holds to within 1 boundary-tick per crossing (round-down simplification). Acceptable for the prototype.
//!! OK
//** Locked.

### 6. Trackpad blast-through — per-phase drain cap

Phase 2 drains at `SWOOP_PHASE2_MAX_TICKS_PER_FRAME = 3` instead of the default 10. Phase 1 and Phase 3 unchanged at 10. Provides a guaranteed ~350ms transition minimum without slowing Phase 1 dolly response.
//!! OK
//** Locked.

### 7. `tickAnimator` vs continuous integrator — neither (Recommended)

Skeleton flagged: "Phase 3's transitions are continuous, not discrete tween animations, so `TickAnimator` may not be the right abstraction. May need a 'rate-limited continuous integrator' instead."

**Recommendation:** use neither. The existing wheel-budget drainer in `_drainWheel` is already a rate-limited integrator (drained at N ticks per A-Frame tick). Phase 3 reuses it. No new abstraction.

`TickAnimator` is still the right tool for one-shot tweens (Plan View, future Phase 4 navigation animations) — Phase 3 doesn't displace it.
//!! OK
//** Locked.

## Deliverables

1. **Constants** in `constants.js` (4 new entries).
2. **`navMath.js` helpers** `decideSwoopPhase`, `phase2TargetTilt`, with unit tests.
3. **`ExperimentalControls.js` internal changes:** new instance state, refactor of `_applyWheelTick` into the four phase-specific helpers, per-phase drain cap in `_drainWheel`, Ctrl+wheel gating in `_onWheel`.
4. **Manual smoke test checklist** below.
5. **Documentation:** update the file header in `ExperimentalControls.js` to reflect the Phase 3 mechanics. Update the wheel-handling block.

## Task breakdown

1. **`decideSwoopPhase` + `phase2TargetTilt`** in `navMath.js` with unit tests. ~30 min.
2. **Refactor `_applyWheelTick`** into the four phase helpers. No behaviour change yet — Phase 1 helper is the existing code, Phase 2/3 are stubs that throw. ~1 sitting.
3. **Implement Phase 2 helper.** Trivial now (pedestal+tilt only). ~30 min.
4. **Implement Phase 3 helper.** FOV-only is straightforward. ~30 min.
5. **Boundary handling and stored-tilt latch.** ~1 sitting. This is where tricky bugs hide.
6. **Per-phase drain cap.** ~30 min.
7. **Ctrl+wheel gating.** ~30 min.
8. **Smoke test pass + feel-tuning** (`SWOOP_PHASE2_STEP`, `SWOOP_PHASE2_MAX_TICKS_PER_FRAME`, FOV floor). ~1–2 sittings.

Total: ~3–5 sittings. The cursor-anchoring-removal saves the bulk of the original budget; what's left is mostly wiring + tuning.

## Risks

- **Phase 2 asymptotic approach to y=1.5m — no terminal settle.** Pedestal step is `α(y - 1.5)`, so Δy → 0 as y → 1.5. Tilt step `Δθ = (θ_stored/8.5) × Δy` slows by the same factor each tick. The swoop doesn't "land" at street level — the user has to keep wheeling and y approaches 1.5 asymptotically. (Earlier draft of this risk claimed tilt *accelerates* at the end; numerical trace at `claude/reports/007-phase-3-plan-review.md` H6 shows the opposite. Δθ decelerates by factor 0.9 per tick, same rate as Δy.) Mitigation: snap y to 1.5m when within ~10cm (one half-tick at the end of Phase 2), so the Phase 2 → Phase 3 crossing is crisp rather than asymptotic. Easy one-liner in `_applyPhase2WheelTick` boundary handling.
- **`_storedTilt` initial value is wrong for "user starts at street level".** If the user loads a scene with the camera at y=0.5m, tilt=0°, and the first wheel input is zoom-out, Phase 2's tilt-lerp reads `_storedTilt = 0°`, which means the camera arrives at y=10m still horizontal. They'd then have to Shift+LB to look down. Mitigation: accept the edge case; the user can Shift+LB before zooming out. Document the convention.
- **Phase 2 zoom-out formula blows up for y < 1.5m.** `y_next = 1.5 + (y - 1.5) / (1 - α)` with `y < 1.5` gives `(y - 1.5)` negative and `y_next < y` — i.e. zoom-out pushes the camera *further down*, the opposite of intended. The saved-scene-at-y=0.5 case (above) exercises this. Policy: in `_applyPhase2WheelTick` zoom-out, if `y < SWOOP_PHASE2_EXIT_ELEVATION_METRES`, clamp y to that value first, then begin the lerp from there. Equivalent to "snap up to street level on first zoom-out tick if below it." See `claude/reports/007-phase-3-plan-review.md` H2.
- **Low-tilt Phase 2 entry path latches `_storedTilt < 30°`.** Per §"Stored-tilt latch" edge-case note: under tilt-conditional zoom, the Phase 1 low-tilt dolly can carry the camera across y=10m while tilt is < 30°. The resulting Phase 2 lerp from (e.g.) 20° → 0° is plausibly fine but off-spec. Feel-test will tell. See `claude/reports/007-phase-3-plan-review.md` H3.
- **Phase 3 → Phase 2 transition feels wrong.** Zoom-out from a deep FOV (say 20°) widens FOV to baseline, then suddenly the camera starts pedestalling up. That's a discontinuity in the wheel's *effect* (FOV change → position change). Mitigation: try blending FOV and pedestal in a narrow band (e.g. last 10% of FOV restoration also pedestals slightly). Defer to feel-test; out of scope for v1.
- **Trackpad blast-through still possible despite the cap.** 3 ticks/frame at 60Hz over 64 ticks = ~350ms, but a 30Hz framerate (heavy scene) gives ~700ms. Both feel OK. Below 30Hz the swoop starts to feel laggy — but that's a general performance issue, not a Phase 3 one.
- **Manual camera moves during a wheel burst.** The user could LB-drag mid-swoop. The wheel-budget drainer keeps running; the camera position changes from both sources. Phase 2 only writes `y` and `tilt`, so the user's `(x, z)` adjustments are preserved as long as the LB-drag and wheel ticks don't fight over `y` (they don't — LB-drag at low tilt is pedestal which *does* write `y`, so during a Phase 2 swoop with LB-pedestal active the two will fight). Acceptable for the prototype; feel-test surfaces severity.
- **Plan View → swoop interaction.** After a Plan View tween, the camera is at high y and looking straight down (tilt = 90°). The first wheel-in tick latches `_storedTilt = 90°` on the y=10m crossing, and Phase 2 starts unwinding 90° → 0° over the descent. Should feel reasonable but is the most extreme tilt case. Worth a smoke-test entry.

## Smoke test checklist

URL: **http://localhost:3333/?nav=experimental**, against the default basic-street scene.

### Phase 1 (unchanged) — regression coverage

- [ ] **P1.1** Wheel-in at high altitude over a building — cursor stays on building; same feel as Phase 2-shipped state.
- [ ] **P1.2** Wheel-out at high altitude — camera retreats; cursor anchor holds.
- [ ] **P1.3** Trackpad two-finger scroll at altitude — smooth, no stutter.
- [ ] **P1.4** Low-tilt branch (tilt ≤ 30°) — plain camera-Z dolly, no swoop.

### Phase 1 → Phase 2 boundary (downward)

- [ ] **B1.1** Start at y ≈ 20m, tilt ≈ 60°, cursor over a road; wheel-in continuously — at y=10m the camera begins to tilt toward horizontal and descend toward 1.5m. No jolt at the crossing.
- [ ] **B1.2** Repeat with cursor over a building's mid-storey — same smooth crossing.
- [ ] **B1.3** Wheel-in single tick that crosses the boundary — camera doesn't overshoot or jump; clamped to y=10m on first tick, continues in Phase 2 on next.
- [ ] **B1.4** `_storedTilt` correctness — across the crossing, log the latched value; should equal the camera tilt at the moment of crossing.

### Phase 2 — swoop transition

- [ ] **S2.1** Continuous wheel-in from y=10m → y=1.5m — camera descends and tilts to horizontal over a perceptible duration (~300ms minimum on a mouse, ~500ms on a trackpad burst). Camera (x, z) and yaw unchanged across the swoop.
- [ ] **S2.2** Wheel-out from mid-swoop (e.g. y=5m) — camera ascends, tilts back toward `_storedTilt`. At y=10m, transitions to Phase 1 cursor-anchored dolly seamlessly.
- [ ] **S2.3** Cursor position is irrelevant to Phase 2 trajectory — repeat S2.1 with cursor over a building, over sky, off-screen; trajectory identical.

### Phase 2 → Phase 3 boundary (downward)

- [ ] **B2.1** Wheel-in continuously through y=1.5m — camera stops descending, tilt = 0°; further wheel-in becomes FOV zoom.
- [ ] **B2.2** No jolt at the crossing.
- [ ] **B2.3** `_phase3FovBaseline` latches correctly — verify by logging at the crossing.

### Phase 3 — focal zoom

- [ ] **P3.1** Wheel-in at street level — FOV narrows; camera doesn't move.
- [ ] **P3.2** FOV floor reached — further wheel-in is a no-op; no error.
- [ ] **P3.3** Wheel-out — FOV widens; camera doesn't move until baseline FOV reached.

### Phase 3 → Phase 2 boundary (upward)

- [ ] **B3.1** Wheel-out from Phase 3 — FOV returns to baseline, then camera begins to pedestal up. Tilt remains 0° at exactly y=1.5m and starts to ramp toward `_storedTilt`.
- [ ] **B3.2** No FOV "snap" at the boundary.

### Reversibility

- [ ] **R1** Zoom-in from y=20m to street level (full swoop into Phase 3), then zoom-out — final camera state within ~1° tilt and ~0.5m horizontal of starting state, assuming cursor was stationary.
- [ ] **R2** Repeated in/out cycles — no cumulative drift.
- [ ] **R3** Most-recent-crossing-wins — at y=15m, Shift+LB to a new tilt, then swoop down: zooming back out returns to the *new* tilt (not the original).
- [ ] **R4** Round-down boundary drift — zoom in from y=12 with cursor over a nearby building (cam→anchor distance ~5–10m, so Phase 1 ticks are large) deep into Phase 3, then zoom back out. Log final y. Per `claude/reports/007-phase-3-plan-review.md` H5 the drift can be in the small-metres range. Smoke-test confirms the worst-case magnitude.

### Ctrl+wheel

- [ ] **C1** Ctrl+wheel at high tilt (any altitude) — plain camera-Z dolly; no swoop, no tilt change.
- [ ] **C2** Ctrl+wheel at low tilt — same as plain wheel at low tilt (no change in behaviour).
- [ ] **C3** Mac trackpad pinch — arrives as Ctrl+wheel; gives fixed-tilt zoom.
- [ ] **C4** Mac trackpad two-finger scroll — plain wheel; full swoop.

### Trackpad blast-through

- [ ] **T1** Fast trackpad burst from y=20m to street — swoop takes ≥300ms; transition is visible, not teleported.
- [ ] **T2** Fast mouse-wheel spin — same; the per-phase cap engages.

### Plan View interaction

- [ ] **PV1** From Plan View (tilt=90°), wheel-in — first tick crosses 10m with `_storedTilt = 90°`, swoop unwinds 90° → 0° over Phase 2.
- [ ] **PV2** No NaNs or numerical issues at tilt=90° (the extreme case for the tilt lerp).

### Compatibility regressions

- [ ] **C1.** ActionBar zoom-in/out still work (separate code path).
- [ ] **C2.** Shift+LB rotation unaffected.
- [ ] **C3.** LB+drag truck/pedestal unaffected.
- [ ] **C4.** WASD unaffected.
- [ ] **C5.** Console hygiene — no errors or unexpected logs.

### Feel-test against Google Maps

- [ ] **F1.** Google Maps wheel from satellite to street-view transition vs our swoop. Which feels smoother? (Note: GMaps cursor-anchors through the transition; we don't. Note also where landing position diverges from cursor target.)
- [ ] **F2.** Pinch-to-zoom on Mac trackpad — comparable to Google Maps pinch (fixed-tilt zoom via Ctrl+wheel)?
- [ ] **F3.** "I wanted to look closer at that car" — does the lack of in-swoop anchoring feel like a missing affordance, or is post-landing LB-truck / WASD natural enough?

The F-row notes are the load-bearing output of Phase 3.

## Exit criteria

Phase 3 is done when:

- [ ] All mechanics implemented per the spec above.
- [ ] All Phase 1/2 tests still pass; new helpers in `navMath.js` have unit tests.
- [ ] Smoke test passes end-to-end against the basic-street default scene.
- [ ] At least one Google Maps comparison session documented (F-row notes).
- [ ] Open decisions #1–#7 confirmed or revised after feel-test.
- [ ] Sub-branch merged back to `navigation`.

## What this plan does NOT cover

- AGL ("metres above ground") elevation measurement — production fix; see backlog.
- **Cursor anchoring inside Phase 2** — explicitly removed from the v1 prototype (see §"Open decisions" #3). If feel-test reveals the landing-near-cursor-target feature is missed, re-introduce via the "latch anchor + cursor NDC at entry, swoop trajectory determined at entry, no per-tick re-raycast" model.
- Animated tween for the swoop independent of wheel input (e.g. a "swoop to street level" button). Possible Phase 4 follow-up.
- Geo-located scene behaviour beyond "Phase 3 boundaries are defined in world units." Streetmix-on-Google-3D-Tiles scenes may need scene-aware thresholds; out of scope here.
- Phase 3 → Phase 2 FOV/pedestal blending. The current design has a hard hand-off at FOV = baseline; if it reads as a jolt during feel-test, blend in a follow-up.
- Touch / mobile gestures (out of scope for the whole nav prototype until production phase).
