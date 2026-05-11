# 001 — Phase 3 Plan: Full Swoop

*Working draft 2026-05-11. Will iterate.*

Phase 3 of the navigation prototype work (see `001-overall-plan.md`). Connects Phase 1's cursor-anchored dolly with Phase 2's low-tilt mode into a single continuous wheel-zoom gesture: the 3-phase "swoop" described in `claude/reference/3D Street Navigation Proposal.md` §"3-phase Swoop zoom".

Promotes the skeleton at `001-phase-3-skeleton.md` to a working plan now that Phase 2 has shipped and feel-tested (2026-05-11). The skeleton is left in place as historical record of what was held open at the time.

**Implementation landed 2026-05-11 and went through one feel-test pass.** Updates from that pass — entry elevation raised 10m→20m, Phase 2 step bumped 0.10→0.20, floor-snap 0.1→1.0, active hand-off model adopted at zoom-out boundaries (replacing the round-down model for that direction), and toolbar-indicator emit added to Phase 2 ticks — are folded into the relevant sections below. See `9da791ea` for the code change.

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

| Phase | Range                              | Behaviour                                                                  |
|-------|------------------------------------|-----------------------------------------------------------------------------|
| 1     | `y > yCeil` (20m)                  | Existing tilt-conditional zoom (`001-tilt-conditional-zoom.md`) — cursor-anchored at tilt > 30°, plain camera-Z dolly at tilt ≤ 30°. Unchanged. |
| 2     | `yFloor < y ≤ yCeil` (1.5m–20m)    | Pedestal down + tilt toward horizontal. No cursor anchoring. "Swoop transition." |
| 3     | `y ≤ yFloor` (1.5m)                | FOV-only zoom around the camera position. No translation.                   |

`yCeil` = `SWOOP_PHASE2_ENTRY_ELEVATION_METRES`; `yFloor` = `SWOOP_PHASE2_EXIT_ELEVATION_METRES`. Current values shown in parens. `yCeil` was 10m through the first feel-test round and raised to 20m on 2026-05-11 when the swoop felt too sudden.

`y` is `camera.position.y` directly — i.e. metres above world origin, not "metres above ground" (see §"Open decisions" #1 for rationale).

**Phase 2's elevation gate is unconditional on tilt.** Once `y ≤ yCeil`, wheel input drives the swoop regardless of current tilt. The 30° tilt-conditional rule from `001-tilt-conditional-zoom.md` lives inside Phase 1 only; Phase 2 is pure pedestal+tilt with no anchoring, so it has no per-tick raycast and no failure modes.

**Design history note: cursor anchoring was deliberately removed from Phase 2 (2026-05-11 conversation).** The proposal called for cursor anchoring to continue through Phase 2 ("the descent track aims to keep the anchor point under the cursor"). That design re-introduced the failure-mode class fixed by `001-tilt-conditional-zoom.md`: as tilt descends through the swoop, the cursor-pixel ray flattens, the anchored solver fails (`d_y ≥ 0` near the horizon), and pure-pedestal fallback fires per tick — same flicker the tilt-conditional split eliminated at low tilt. Since the user is already nearly above their target by Phase 2 entry (Phase 1's anchored dolly handled the horizontal positioning), the marginal value of in-swoop anchoring is small. Trade-off accepted: the user lands directly below their Phase 2 entry xz position, and LB-trucks or WASDs to fine-tune.

### Phase 1 — cursor-anchored dolly (unchanged)

Exactly as today. Each tick translates the camera along the camera→anchor ray by `ZOOM_PER_WHEEL_TICK` (10%) of the current distance. Tilt-preserving by construction. The no-hit fallback chain in `cursorAnchor.worldPointAt()` is unchanged.

**Phase-boundary handling on a Phase-1 zoom-in tick:** if the tick would push `camera.position.y` below `yCeil`, the tick is applied fully in Phase 1 (overshoot), then the camera is clamped to `yCeil` and `_storedTilt` is latched (see §"Stored-tilt latch"). The next tick dispatches naturally to Phase 2.

### Phase 2 — swoop transition (`yFloor` < y ≤ `yCeil`)

Pure pedestal + tilt. No cursor anchoring; no raycast; no solver. Per unit zoom-in tick:

1. **Target elevation:** `y_next = y - α × (y - yFloor)`, with `α = SWOOP_PHASE2_STEP` (currently `0.20`) per unit tick. Exponential approach to `yFloor`.
2. **Target tilt:** `θ_next = θ_stored × (y_next - yFloor) / (yCeil - yFloor)`. Linear ramp from `θ_stored` at y=`yCeil` to `0°` at y=`yFloor`.
3. **Update camera:** `camera.position.y = y_next`; tilt set to `θ_next`; `(x, z)`, yaw, and FOV unchanged.

Zoom-out tick: `y_next = yFloor + (y - yFloor) / (1 - α)`. Multiplicative reciprocal of the zoom-in step. Tilt follows the same linear-in-y formula, which means it rises from current → θ_stored as the camera ascends.

**Yaw and (x, z) are held fixed across a Phase 2 tick.** The camera elevators down/up at its current xz position; the user can LB-truck or WASD horizontally before, during, or after the swoop independently.

**Phase-boundary handling at zoom-out crossings: active hand-off, not round-down.** A naive "clamp at boundary, let next tick re-dispatch" model deadlocks because `decideSwoopPhase` is inclusive at the lower-phase side of each boundary (y=`yCeil` → 'phase2'; y=`yFloor` → 'phase3'). The next tick fires the same boundary and loops. Both Phase 3 → Phase 2 and Phase 2 → Phase 1 zoom-out hand-offs invoke the destination phase's helper recursively with the same `sign` on the *same tick*. The wheel click visibly continues past the boundary rather than stalling. Per `claude/reports/007-phase-3-plan-review.md` (post-implementation feel-test, 2026-05-11).

**Phase 2 → Phase 3 zoom-in:** `y_next ≤ yFloor` → clamp to `yFloor`, tilt to 0°, latch `_phase3FovBaseline = camera.fov`. Next tick dispatches naturally to Phase 3 (no recursive hand-off needed — Phase 3's helper expects to be entered on the *following* tick, not in the boundary tick).

**Phase 2 → Phase 1 zoom-out:** `y_next ≥ yCeil` → clamp to `yCeil`, tilt to `_storedTilt`, then recursively invoke Phase 1's helper (or the low-tilt branch if `_storedTilt ≤ 30°`) for the same sign.

**Phase 2 zoom-out kick-start at the floor.** The multiplicative reciprocal `yFloor + (y - yFloor)/(1 - α)` is zero from `y = yFloor` exactly, so without a kick-start zoom-out from street level produces no motion. Policy: if `sign > 0` and `y ≤ yFloor + SWOOP_PHASE2_FLOOR_SNAP_METRES`, bump `y` to `yFloor + snap` *before* applying the formula. The same `snap` constant is used for the zoom-in floor-snap, so the kick-start mirrors the zoom-in snap distance — boundary symmetry.

**Phase 2 tilt emits `nav-experimental:modechange`.** The toolbar's full-width-black-bars visual indicator (per `decisions.md` 2026-05-07) is driven by this event. Phase 2's tilt lerp crosses 30° silently from the LB-mode comparator's perspective; calling `_maybeEmitLbModeChange()` after every Phase 2 tilt write keeps the toolbar in lock-step with the swoop. Phase 1 and Phase 3 are tilt-preserving, so no equivalent emit needed.

### Phase 3 — focal zoom (y = 1.5m, tilt = 0°)

Camera is at street level, horizontal. Wheel input becomes FOV-only.

**FOV state:** at Phase 3 entry (downward crossing of `yFloor`), latch `_phase3FovBaseline = camera.fov`. Per zoom-in tick: `fov ÷= 1 + ZOOM_PER_WHEEL_TICK` (= ÷1.1). Per zoom-out tick: `fov ×= 1 + ZOOM_PER_WHEEL_TICK` (= ×1.1).

**FOV floor:** `SWOOP_PHASE3_FOV_FLOOR_DEGREES = 15`. Further zoom-in ticks at the floor have no effect.

**Phase 3 → Phase 2 transition (zoom-out): active hand-off.** When the user is at FOV baseline and zooms out, the tick is handed off to Phase 2's helper (recursive call, same sign). The check fires at the top of `_applyPhase3WheelTick`: if `sign > 0 && fov ≥ baseline`, clear `_phase3FovBaseline` and invoke `_applyPhase2WheelTick(sign)`. Without the hand-off, the next tick re-dispatches to Phase 3 (since `y = yFloor` exactly), re-latches baseline, and loops without progressing — same dispatch deadlock fixed at the Phase 2 → Phase 1 boundary. Per `claude/reports/007-phase-3-plan-review.md` post-implementation feel-test (2026-05-11).

**Lazy baseline latch.** If Phase 3 is entered without `_phase3FovBaseline` set (e.g. saved scene starts at `y < yFloor`), latch from the current FOV on first tick. Idiomatic safety net rather than a real edge case in feel-test.

**Camera position and tilt are locked** in Phase 3. Only FOV changes. (The user can still drive position via WASD/LB+drag and tilt via Shift+LB independently of the wheel.)

### Stored-tilt latch

Instance state on `ExperimentalControls`:

```js
this._storedTilt = cameraTiltDegrees(this._camera);  // initialised on construction
```

**Write rule:** when a Phase-1 zoom-in tick would push `camera.position.y` below `yCeil`, the tick is applied fully (overshoot), the camera is clamped to `yCeil`, and `this._storedTilt = cameraTiltDegrees(this._camera)` is latched in the same step. Phase 1 ticks are tilt-preserving, so the latched value equals the camera's tilt at the moment of crossing. Most-recent-crossing-wins.

**Read rule:** Phase 2's target-tilt computation reads `this._storedTilt`.

**Why initialised at construction:** the user can start the session with the camera already at `y < yCeil` (e.g. a saved scene at street level) and start zooming. Phase 2's tilt-lerp needs a defined `θ_stored` from the first tick. Camera's current tilt at construction is a reasonable default.

**Manual camera changes (not via wheel) do not update `_storedTilt`.** Specifically: Shift+LB, LB+drag, WASD, Plan View, focus animations — none of these write to `_storedTilt`. Rationale: `_storedTilt` is the "what tilt was the user using before they dove" memory. Manual re-tilting at any elevation is a separate gesture; the stored value should reflect the user's *most recent intent to descend*, not their current orientation.

**Edge case — low-tilt Phase 1 → Phase 2 entry.** Under tilt-conditional zoom (`001-tilt-conditional-zoom.md`), a Phase 1 wheel input at tilt ≤ 30° dollies the camera along its view direction. With non-zero tilt, the dolly has a downward y component (~sin(tilt) × 3m per tick); enough ticks carry y across `yCeil` at low tilt. The crossing tick latches `_storedTilt` = current tilt (could be e.g. 20°). Phase 2 then lerps tilt from 20° → 0° as y descends to `yFloor`. This is off-spec relative to the proposal (which assumes Phase 2 entry from a map-mode tilt) but plausibly fine in practice — landing horizontal from a 20° start is a reasonable elevator descent. Flagged in Risks for feel-test; if it feels wrong, the one-line fix is to floor the latch at `max(latch, 30°)`. See `claude/reports/007-phase-3-plan-review.md` H3.

**Edge case:** what if the camera crosses `yCeil` by some non-wheel mechanism (Plan View tween, focus, WASD descent)? Skeleton flagged this. Recommendation: **don't latch on non-wheel crossings**. The user's tilt at, say, the moment a Plan View tween ends is the new orientation regardless; storing it as `_storedTilt` for a future swoop doesn't add information. The next downward wheel crossing latches whatever the current tilt is, which is correct. Documenting the convention here.

### Tick energy and phase splitting

Each unit zoom-in tick has "energy" equal to one `ZOOM_PER_WHEEL_TICK` step in its native phase. At phase boundaries, the model differs by direction (asymmetric because the dispatch deadlock at zoom-out forced active hand-off, while zoom-in works fine with round-down).

**Zoom-in crossings (Phase 1 → Phase 2, Phase 2 → Phase 3): round-down.** The tick is applied fully in its starting phase; if the result would overshoot, the camera is clamped to the boundary and `_storedTilt` (or `_phase3FovBaseline`) latched. The next tick dispatches naturally to the destination phase. Lost energy is bounded by one tick's worth, but **one tick's worth is not necessarily small** in Phase 1: a Phase 1 tick is 10% of camera→anchor distance, not 10% of any fixed quantity. With the cursor near a building 5m away, a single tick can be 0.5m; with the cursor on the ground 50m away, a single tick is 5m. A Phase 1 → Phase 2 crossing tick can therefore lose several metres of in-band Phase-1 energy in the worst case. See `claude/reports/007-phase-3-plan-review.md` H5.

**Zoom-out crossings (Phase 3 → Phase 2, Phase 2 → Phase 1): active hand-off.** The naive "clamp at boundary, let next tick re-dispatch" model deadlocks because `decideSwoopPhase` is inclusive at the lower-phase side of each boundary value. At y=`yCeil` exactly, dispatch is still 'phase2'; at y=`yFloor` exactly, dispatch is still 'phase3'. The next tick fires the same boundary and loops. Fix: the boundary handler invokes the destination phase's helper recursively with the same `sign` on the *same tick*. Net effect: the wheel click visibly continues past the boundary. One tick's energy may be spent in two phases — strictly more than 1 tick of total energy across the boundary, but the asymmetry is small and the alternative (no motion) is unacceptable.

**Round-trip drift.** A full Phase 1 → Phase 2 → Phase 3 → Phase 2 → Phase 1 cycle crosses two zoom-in boundaries (round-down loss) and two zoom-out boundaries (active hand-off gain). The net direction of drift depends on the relative magnitudes; in practice, drift is in the small-metres range for camera y. Acceptable for the prototype. The smoke test at row R4 measures this directly.

### Reversibility

The proposal asserts: "Mouse wheel up/down controls are consistent, so if you zoom in & then out, or zoom out & then in, you end up with the same camera angle."

**Phase 1:** reversible by construction. A zoom-in tick by factor `(1 - α)` and a zoom-out tick by factor `1 / (1 - α)` are exact inverses on the (camera, anchor) line, assuming the anchor doesn't change. If the cursor moved between the two ticks, the anchors differ and reversibility holds only "approximately" — same as today.

**Phase 2:** trivially reversible inside the band. `(x, z)` are untouched. `y` and `θ` are deterministic functions of each other via `θ(y) = θ_stored × (y - yFloor) / (yCeil - yFloor)`. The zoom-in tick `y_next = y - α(y - yFloor)` and its inverse `y_next = yFloor + (y - yFloor)/(1 - α)` retrace exactly. No anchor state, no per-tick raycast. Boundary asymmetries (round-down zoom-in, active hand-off zoom-out, kick-start from the floor) introduce small drift — see §"Tick energy" and smoke-test row R4.

**Phase 3:** trivially reversible. `fov ÷ 1.1` and `fov × 1.1` are inverses.

**Cross-phase reversibility:** Phase 1 → Phase 2 → Phase 3 round-trip is approximately reversible. Per-phase ticks are exactly reversible; boundary handling is asymmetric (zoom-in round-down loses energy, zoom-out active hand-off spends energy in two phases on the boundary tick). The net drift is small-metres in y for typical gestures. See §"Tick energy" for the full discussion and smoke-test row R4 for measurement.

### Trackpad blast-through mitigation

Skeleton flagged this. Current state: `WHEEL_MAX_TICKS_PER_FRAME = 10` and `WHEEL_MAX_BUDGET = 1000` together mean a trackpad burst can drive 10 ticks per frame, i.e. ~6 frames to traverse Phase 2 from y=10 to y=1.5 with 10% steps (~64 ticks). ~100ms minimum. Feels rushed for a "swoop" gesture that should feel smooth.

**Recommendation:** lower per-frame drain cap *inside Phase 2 only* to `SWOOP_PHASE2_MAX_TICKS_PER_FRAME = 3`. Phase 1 and Phase 3 retain the existing 10/frame. Result: Phase 2 traversal is bounded below at ~64/3 ≈ 21 frames ≈ 350ms, which reads as a deliberate transition rather than a teleport.

Implementation: at the *start* of each frame's `_drainWheel` pass, evaluate `decideSwoopPhase(camera.position.y)` once, set the cap for the frame, and hold it for the full pass — do not re-evaluate per iteration. This avoids the boundary-crossing asymmetry where (e.g.) a Phase 2 → Phase 1 zoom-out crossing mid-pass would suddenly raise the cap from 3 to 10 and unlock 7 additional Phase-1 ticks in the same frame, producing a visible speed-up the moment the user crosses `yCeil`. See `claude/reports/007-phase-3-plan-review.md` H4. Net effect: a frame that crosses the boundary runs at the *starting* phase's cap; the new phase's cap kicks in next frame.

**Why not lower the global cap:** Phase 1 at altitude wants snappy response — 100ms to dolly through a wheel burst feels good. Slowing Phase 1 to match Phase 2 trades that off needlessly.

**Alternative considered:** queue-based minimum-duration animation (start the swoop as a tween, ignore wheel input until it completes). Rejected — breaks the "wheel goes brrrr and the camera follows" feel that Phase 1 is built on. The per-phase cap preserves continuous-wheel feel without enabling teleport.

## Architecture additions

### `constants.js` — new entries

```js
// Phase 3 swoop boundaries (camera.position.y in metres).
// 2026-05-11 feel-test: ENTRY raised 10 → 20.
export const SWOOP_PHASE2_ENTRY_ELEVATION_METRES = 20;
export const SWOOP_PHASE2_EXIT_ELEVATION_METRES = 1.5;

// Phase 2 per-tick pedestal step. 2026-05-11 feel-test: 0.10 → 0.20.
export const SWOOP_PHASE2_STEP = 0.20;

// Phase 2 per-frame drain cap (latched at start of each drain pass per H4).
export const SWOOP_PHASE2_MAX_TICKS_PER_FRAME = 3;

// Phase 2 floor-snap distance. Used both as zoom-in snap (H6) and zoom-out
// kick-start. 2026-05-11 feel-test: 0.1 → 1.0.
export const SWOOP_PHASE2_FLOOR_SNAP_METRES = 1.0;

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

// Pure: next elevation under Phase 2 zoom in (sign<0) or zoom out
// (sign>0). Default alpha = SWOOP_PHASE2_STEP.
export function phase2NextElevation(y, sign, alpha) { ... }
```

All three are pure functions of their inputs; trivially unit-testable. No solver helper — Phase 2 has no cursor anchoring.

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

**`_applyPhase1WheelTick(sign)`:** the *current* high-tilt branch of `_applyWheelTick`, extracted unchanged. Also handles the Phase 1 → Phase 2 boundary: on zoom-in, if the post-tick `camera.position.y` would drop below `yCeil`, clamp to `yCeil` and latch `_storedTilt = cameraTiltDegrees(camera)` (before the clamp's tilt-changing side effects, though Phase 1 ticks don't change tilt).

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

### 1. What the elevation thresholds measure — `camera.position.y` (Recommended)

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

**Why:** the per-tick re-raycast model re-introduces the failure-mode class fixed by `001-tilt-conditional-zoom.md`. As tilt descends through the swoop, the cursor-pixel ray flattens and the anchored solver fails near the horizon, flickering between anchored and pure-pedestal per tick. Avoiding that flicker requires either latching the anchor at entry (which breaks the "anchor follows cursor" intent of the original proposal) or pre-checking the cursor's NDC band at entry to decide anchored vs pure-pedestal upfront. Both add complexity for marginal value: by the time Phase 2 begins (at `yCeil`), Phase 1's anchored dolly has already done the horizontal positioning, so the additional in-swoop horizontal-correction the anchoring would provide is small.

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

- **Phase 2 asymptotic approach to `yFloor`.** Resolved by the floor-snap (currently `SWOOP_PHASE2_FLOOR_SNAP_METRES = 1.0m`): when zoom-in lands within snap distance of `yFloor`, snap to `yFloor` exactly and hand off to Phase 3. 2026-05-11 feel-test bumped this from 0.1m to 1.0m — at 0.1m the asymptotic tail visibly stalled before snap fired.
- **`_storedTilt` initial value is wrong for "user starts at street level".** If the user loads a scene with the camera at y=0.5m, tilt=0°, and the first wheel input is zoom-out, Phase 2's tilt-lerp reads `_storedTilt = 0°`, which means the camera arrives at `yCeil` still horizontal. They'd then have to Shift+LB to look down. Mitigation: accept the edge case; the user can Shift+LB before zooming out. Document the convention.
- **Phase 2 zoom-out formula blows up for `y ≤ yFloor`.** The reciprocal `yFloor + (y - yFloor)/(1 - α)` is zero or negative at and below the floor. Mitigation: kick-start in `_applyPhase2WheelTick` — if `sign > 0 && y ≤ yFloor + SWOOP_PHASE2_FLOOR_SNAP_METRES`, bump y to `yFloor + snap` before applying the formula. Same `snap` constant is used for the zoom-in floor-snap, so the kick-start mirrors the snap distance and the boundary is symmetric. Without the kick-start, zoom-out from street level produces no motion (the bug found at the 2026-05-11 feel-test).
- **Low-tilt Phase 2 entry path latches `_storedTilt < 30°`.** Per §"Stored-tilt latch" edge-case note: under tilt-conditional zoom, the Phase 1 low-tilt dolly can carry the camera across `yCeil` while tilt is < 30°. The resulting Phase 2 lerp from (e.g.) 20° → 0° is plausibly fine but off-spec. Feel-test will tell. See `claude/reports/007-phase-3-plan-review.md` H3.
- **Phase 3 → Phase 2 transition feels wrong.** Zoom-out from a deep FOV (say 20°) widens FOV to baseline, then suddenly the camera starts pedestalling up. That's a discontinuity in the wheel's *effect* (FOV change → position change). Mitigation: try blending FOV and pedestal in a narrow band (e.g. last 10% of FOV restoration also pedestals slightly). Defer to feel-test; out of scope for v1.
- **Trackpad blast-through still possible despite the cap.** 3 ticks/frame at 60Hz over 64 ticks = ~350ms, but a 30Hz framerate (heavy scene) gives ~700ms. Both feel OK. Below 30Hz the swoop starts to feel laggy — but that's a general performance issue, not a Phase 3 one.
- **Manual camera moves during a wheel burst.** The user could LB-drag mid-swoop. The wheel-budget drainer keeps running; the camera position changes from both sources. Phase 2 only writes `y` and `tilt`, so the user's `(x, z)` adjustments are preserved as long as the LB-drag and wheel ticks don't fight over `y` (they don't — LB-drag at low tilt is pedestal which *does* write `y`, so during a Phase 2 swoop with LB-pedestal active the two will fight). Acceptable for the prototype; feel-test surfaces severity.
- **Plan View → swoop interaction.** After a Plan View tween, the camera is at high y and looking straight down (tilt = 90°). The first wheel-in tick latches `_storedTilt = 90°` on the `yCeil` crossing, and Phase 2 starts unwinding 90° → 0° over the descent. Should feel reasonable but is the most extreme tilt case. Worth a smoke-test entry.

## Smoke test checklist

URL: **http://localhost:3333/?nav=experimental**, against the default basic-street scene.

### Phase 1 (unchanged) — regression coverage

- [ ] **P1.1** Wheel-in at high altitude over a building — cursor stays on building; same feel as Phase 2-shipped state.
- [ ] **P1.2** Wheel-out at high altitude — camera retreats; cursor anchor holds.
- [ ] **P1.3** Trackpad two-finger scroll at altitude — smooth, no stutter.
- [ ] **P1.4** Low-tilt branch (tilt ≤ 30°) — plain camera-Z dolly, no swoop.

### Phase 1 → Phase 2 boundary (downward)

- [ ] **B1.1** Start at y ≈ 30m, tilt ≈ 60°, cursor over a road; wheel-in continuously — at `yCeil` (20m) the camera begins to tilt toward horizontal and descend toward `yFloor` (1.5m). No jolt at the crossing.
- [ ] **B1.2** Repeat with cursor over a building's mid-storey — same smooth crossing.
- [ ] **B1.3** Wheel-in single tick that crosses the boundary — camera doesn't overshoot or jump; clamped to `yCeil` on first tick, continues in Phase 2 on next.
- [ ] **B1.4** `_storedTilt` correctness — across the crossing, log the latched value; should equal the camera tilt at the moment of crossing.

### Phase 2 — swoop transition

- [ ] **S2.1** Continuous wheel-in from `yCeil` → `yFloor` — camera descends and tilts to horizontal over a perceptible duration. Camera (x, z) and yaw unchanged across the swoop.
- [ ] **S2.2** Wheel-out from mid-swoop (e.g. y=10m) — camera ascends, tilts back toward `_storedTilt`. At `yCeil` transitions to Phase 1 (cursor-anchored or low-tilt branch depending on `_storedTilt`) seamlessly via the active hand-off.
- [ ] **S2.3** Cursor position is irrelevant to Phase 2 trajectory — repeat S2.1 with cursor over a building, over sky, off-screen; trajectory identical.
- [ ] **S2.4** Toolbar visual indicator (black bars top/bottom) appears as the swoop's tilt drops through 30° and disappears on zoom-out when tilt rises back above 30°. Should not require an LB-click to re-evaluate.
- [ ] **S2.5** Zoom-out from street level (y = `yFloor` exactly) — camera ascends. The first tick kick-starts y to `yFloor + snap`; subsequent ticks accelerate normally. No "wheels nothing happens" stall.

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

- [ ] **R1** Zoom-in from y=30m to street level (full swoop into Phase 3), then zoom-out — final camera state within ~1° tilt and ~0.5m horizontal of starting state, assuming cursor was stationary.
- [ ] **R2** Repeated in/out cycles — no cumulative drift.
- [ ] **R3** Most-recent-crossing-wins — at y=25m, Shift+LB to a new tilt, then swoop down: zooming back out returns to the *new* tilt (not the original).
- [ ] **R4** Boundary drift — zoom in from y=25m with cursor over a nearby building (cam→anchor distance ~5–10m, so Phase 1 ticks are large) deep into Phase 3, then zoom back out. Log final y. Per `claude/reports/007-phase-3-plan-review.md` H5 plus the active-hand-off model (§"Tick energy"), drift can be in the small-metres range. Smoke-test confirms the magnitude.

### Ctrl+wheel

- [ ] **C1** Ctrl+wheel at high tilt (any altitude) — plain camera-Z dolly; no swoop, no tilt change.
- [ ] **C2** Ctrl+wheel at low tilt — same as plain wheel at low tilt (no change in behaviour).
- [ ] **C3** Mac trackpad pinch — arrives as Ctrl+wheel; gives fixed-tilt zoom.
- [ ] **C4** Mac trackpad two-finger scroll — plain wheel; full swoop.

### Trackpad blast-through

- [ ] **T1** Fast trackpad burst from y=30m to street — swoop is visible, not teleported. Per-frame drain cap (3 ticks/frame in Phase 2) is the limit.
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
