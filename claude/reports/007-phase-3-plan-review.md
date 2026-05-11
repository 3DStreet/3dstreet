# 007 — Phase 3 plan adversarial review

*Working draft 2026-05-11. Will iterate.*

Review of `claude/specs/001-phase-3-plan.md`. Focus: internal consistency after the cursor-anchoring cut, the math claims (reversibility, linear-in-y tilt, round-down drift), and the dispatch wiring against the locked decisions in `claude/decisions.md` and `claude/specs/001-tilt-conditional-zoom.md`. The Phase 2-via-pedestal model itself is a clean simplification — the math under it checks out — but the wiring described in §"Architecture additions" contradicts the §"Mechanics" gate, and a couple of Risks-section claims read wrong against a numerical trace.

Findings ordered by significance.

## H1 — Dispatch order contradicts the Phase 2 elevation gate (Mechanics says "unconditional on tilt"; Architecture says "tilt-checked first")

- The §"Mechanics" table at `claude/specs/001-phase-3-plan.md:38` plus the load-bearing sentence at `claude/specs/001-phase-3-plan.md:46` say: **"Phase 2's elevation gate is unconditional on tilt. Once `y ≤ 10m`, wheel input drives the swoop regardless of current tilt."**
- The §"Architecture additions" `_applyWheelTick` sketch at `claude/specs/001-phase-3-plan.md:184-195` does the opposite. The tilt check fires first; only the `tilt > 30°` branch reaches `decideSwoopPhase`:

  ```js
  if (cameraTiltDegrees(camera) <= TRUCK_PEDESTAL_CUTOFF_DEGREES) {
    return this._applyLowTiltWheelTick(sign);
  }
  const phase = decideSwoopPhase(camera.position.y);
  ```

  With this dispatch, at y=5m tilt=10° the low-tilt branch fires. Phase 2 never runs at low tilt — the gate is fully conditional on tilt > 30°.
- **This is not just a documentation slip; it breaks the swoop in steady state.** Phase 2's tilt lerp is `θ(y) = θ_stored × (y - 1.5) / 8.5`. With `θ_stored = 60°`, tilt drops below the 30° cut when `(y - 1.5) / 8.5 < 0.5`, i.e. at `y ≈ 5.75m`. So a continuous Phase 2 zoom-in:
  - Ticks 1..N: tilt > 30°, Phase 2 fires, camera pedestals down and tilts toward horizontal.
  - At y ≈ 5.75m: tilt crosses 30°. Next tick: dispatch routes to the low-tilt branch instead of Phase 2.
  - Low-tilt branch is the 3m-along-camera-forward dolly per `001-tilt-conditional-zoom.md`. The remaining descent from y=5.75 to y=1.5 never happens via Phase 2; the swoop aborts mid-flight.
- And on zoom-out from mid-swoop, the same flip: once tilt < 30° the camera is locked into the camera-forward dolly with no way back into Phase 2 unless the user manually re-tilts past 30°.
- The fix is to dispatch on elevation first, then on tilt only inside the `phase === 'phase1'` branch:

  ```js
  const phase = decideSwoopPhase(camera.position.y);
  if (phase === 'phase2') return this._applyPhase2WheelTick(sign);
  if (phase === 'phase3') return this._applyPhase3WheelTick(sign);
  // phase1: tilt-conditional split lives here
  if (cameraTiltDegrees(camera) <= TRUCK_PEDESTAL_CUTOFF_DEGREES) {
    return this._applyLowTiltWheelTick(sign);
  }
  return this._applyPhase1WheelTick(sign);
  ```
- Worth saying explicitly: the §Mechanics framing is the right design. Phase 2 below y=10m must run regardless of tilt — that *is* the swoop. The Architecture sketch as written silently reintroduces a Phase-2-only-at-high-tilt rule that the plan elsewhere disclaims.
//** Accepted. Real bug. Flipping the dispatch in §"Architecture additions" to the elevation-first form proposed here.

## H2 — `_storedTilt` initial value produces unwanted swoop trajectory on common entry paths

- Plan: `this._storedTilt = cameraTiltDegrees(camera)` at construction (`claude/specs/001-phase-3-plan.md:89`); latched on downward wheel-driven crossings of y=10m only; **not** latched on non-wheel crossings (`claude/specs/001-phase-3-plan.md:102`).
- **Trace (a): saved scene starts at y=0.5m, tilt=0°.** Construction latches `_storedTilt = 0°`. User wheels out. The reversibility math `y_next = 1.5 + (y - 1.5) / (1 - α)` requires y > 1.5; at y=0.5, `y - 1.5 = -1.0` and the formula pushes the camera *further down* on a zoom-out tick (to y = 1.5 - 1.0/0.9 = 0.39m). This is a separate edge case the plan doesn't address — Phase 2's reciprocal does not behave correctly for `y < 1.5`. Once the camera does climb to y=1.5 (by whatever means), the tilt lerp reads `θ_stored = 0°`, so the camera ascends through y=10m still horizontal. Plan flags this in Risks (`claude/specs/001-phase-3-plan.md:305`); the y < 1.5 reciprocal-blowup is unflagged.
- **Trace (b): post-Plan-View start at y=200, tilt=90°.** User wheels in. The first tick is Phase 1; cursor-anchored dolly preserves tilt = 90°. Many ticks later y crosses 10m. The plan claims the latch fires *on the downward crossing*. Reading §"Phase 1 — cursor-anchored dolly (unchanged)" at `claude/specs/001-phase-3-plan.md:54`: "split the tick into 'the portion that lands at exactly y=10m' and 'the residual zoomed in Phase 2'. On crossing, latch the stored tilt before evaluating Phase 2 (see §'Stored-tilt latch')." Concretely the latch reads `cameraTiltDegrees(camera)` *after* the Phase 1 portion has translated the camera to y=10m. Since Phase 1 cursor-anchored dolly is tilt-preserving, the latched value is the tilt at the *start* of that crossing tick — equivalent to "tilt at the moment of crossing". This matches the plan's claim. The PV1 smoke test at `claude/specs/001-phase-3-plan.md:372` correctly exercises this.
- But under the round-down simplification adopted (§"Tick energy") the Phase 1 tick is not actually split. The plan says: "apply the tick fully in its starting phase, clamping at the boundary if the result would overshoot" (`claude/specs/001-phase-3-plan.md:111`). So the Phase 1 tick translates fully *past* y=10m, then clamps to y=10m, then the *next* tick's `decideSwoopPhase` returns 'phase2'. The latch needs to happen on that clamping, not on the next tick. The text at `claude/specs/001-phase-3-plan.md:197` ("on zoom-in, if the post-tick `camera.position.y` would drop below 10m, clamp to y=10m and latch `_storedTilt`") gets this right, but the §"Stored-tilt latch" rule at `claude/specs/001-phase-3-plan.md:92` ("on a downward crossing of `y = 10m` driven by wheel input, latch ... *before* applying any Phase 2 logic to the residual tick") is written for the split-tick model and is now stale. Worth tightening the wording to match the round-down model the plan actually adopts.
//** Accepted both halves. Tightening §"Stored-tilt latch" to the round-down wording. Also adding an explicit §Risks entry for the y < 1.5 reciprocal blowup, with the clamp policy ("zoom-out from y < 1.5 first pedestals up to 1.5 then begins the lerp").

## H3 — `_applyWheelTick` dispatch trips the low-tilt branch mid-Phase-2 swoop even after the H1 fix, unless Phase 2 entry-tilt is floored

- Even with the H1 fix (elevation-first dispatch), there's a related interaction worth flagging. The plan asserts at `claude/specs/001-phase-3-plan.md:100`: "the swoop only runs at tilt > 30°, so the latched value is always > 30°. Floor at 30° is unnecessary."
- This contradicts the locked tilt-conditional decision (`claude/decisions.md` 2026-05-11) plus the dispatch in `src/editor/lib/nav-experimental/ExperimentalControls.js:780`. Under tilt-conditional, plain camera-Z dolly *also* runs at tilt ≤ 30° at high altitude. So at y=15m, tilt=20°, wheel-in dollies down-and-forward (per `001-tilt-conditional-zoom.md:26`, ≈ `sin(20°) × 3m ≈ 1m/tick` downward). Over many ticks `camera.position.y` crosses 10m. At that moment current tilt is 20° (preserved by the dolly).
- Per the round-down rule, the crossing tick clamps at y=10m and latches `_storedTilt = 20°`. Phase 2 then lerps tilt from 20° → 0° over the descent.
- This is off-spec relative to the proposal (`claude/reference/3D Street Navigation Proposal.md` §"3-phase Swoop zoom"), which assumes Phase 2 entry from a map-mode tilt. Whether it's a real problem is a feel-test call — landing horizontal from a 20° start is not absurd. But the plan's "always > 30°" claim is wrong, and either the latch needs a floor or the spec needs to acknowledge the low-tilt entry path explicitly. Recommend: document the low-tilt entry case as a known minor-quirk and feel-test before adding a floor; if a floor is added, `_storedTilt = max(latch, 30°)` is the one-line change.
//** Accepted. Going with accept-and-document — the floor is a hack and the natural behaviour (lerp 20° → 0° as you dive) is plausibly fine. Rewriting the "always > 30°" sentence in §"Stored-tilt latch" to acknowledge the low-tilt entry path; flagging in Risks for feel-test.

## H4 — Per-phase drain cap is ambiguous across the boundary; written sketch produces an asymmetric speed-up on zoom-out crossings

- Plan at `claude/specs/001-phase-3-plan.md:182`: "`_drainWheel` checks `decideSwoopPhase(camera.position.y)` before each unit-tick iteration; cap the iteration count by `SWOOP_PHASE2_MAX_TICKS_PER_FRAME` when in Phase 2, else by `WHEEL_MAX_TICKS_PER_FRAME`."
- Two plausible readings:
  - (a) `cap = phase === 'phase2' ? 3 : 10`, recomputed each iteration. Total ticks/frame may exceed the smaller cap when transitioning: e.g. start at y=11, 4 ticks land you at y=10, next 3 ticks are Phase 2 capped at 3; total 7 ticks (within both caps).
  - (b) `cap = 3` if *any* iteration so far has been Phase 2, otherwise `10`. Total bounded by 10 in Phase 1, drops to 3 if Phase 2 starts.
  - (c) Independent counters per phase: 10 Phase-1 ticks + 3 Phase-2 ticks = 13 ticks across the boundary in one frame.
- The natural single-counter implementation (a) produces an asymmetry: on zoom-out crossing y=10m upward, a Phase 2 tick at y=9.99 fires under cap=3, then the *next* iteration at y=10.something has `decideSwoopPhase` returning 'phase1' and cap jumps to 10. If `ticksThisFrame = 3` already, no Phase 1 ticks fire this frame (3 < 10 so the loop continues — actually it continues, since `ticksThisFrame < cap` is the gate). So zoom-out crossing the boundary instantly unlocks 7 more ticks of Phase 1 in the same frame: visible "speed-up" right at the moment of crossing. The pedestal-up was slow; the next instant is fast.
- The reverse direction (zoom-in crossing into Phase 2) is the symmetric case but feels different because Phase 1 is at altitude (the perceptible-motion-per-tick is much smaller fraction of viewport): 10 ticks/frame Phase 1, then 3/frame Phase 2 — the speed-up-to-slow-down direction is more forgivable.
- Recommend: lock the per-frame total to `min(cap_for_starting_phase, cap_for_ending_phase)` for any frame that crosses a boundary, or just lock the cap at the *start* of the frame's drain pass and keep it for the whole frame. Add a sentence to §"Trackpad blast-through mitigation" disambiguating.
//** Accepted. Going with "lock the cap at the start of the frame's drain pass for the whole frame" — simplest and avoids the asymmetric speed-up. Adding the disambiguating sentence to §"Trackpad blast-through mitigation".

## H5 — Round-trip drift claim ("~2 ticks short") understates the worst case

- §"Reversibility" at `claude/specs/001-phase-3-plan.md:125`: "a full down-and-back-up traversal may end up ~2 ticks short of the start in each crossed boundary. Acceptable for the prototype; document and feel-test."
- Numerical trace, Phase 2 boundary only (start y=12, zoom in past Phase 2):
  - Phase 1 tick that crosses y=10m: with cursor over ground at y=0 and camera at y=12 tilt=60°, the camera→hit distance has a vertical component ~12m. A 10% step → Δy ≈ -1.2m. Clamped at y=10m → "lost" 0.2m. Acceptable.
  - But the *worst* case is when the Phase 1 step is large (cursor-anchored at near anchor, e.g. camera near a tall building): if step would carry y from 10.5 → 5.0, clamp at 10m loses 5m of Phase-1-equivalent energy. Round-down loss is **bounded only by the tick size**, and the tick size is 10% of camera→anchor distance, not 10% of anything bounded.
- Plan §"Tick energy" (`claude/specs/001-phase-3-plan.md:111`) waves at this with "Since unit ticks are 10% steps, a single tick is unlikely to cross a phase boundary by more than a fraction of the next phase's range." That's true *on average* but not in the corner case where the camera is close to scene geometry — exactly the case in which the user is most likely to be making fine wheel adjustments at the boundary.
- Practical impact: a single boundary tick can lose up to ~1 "in-band tick" of energy each side. Round-trip cost across two boundaries (Phase 1↔Phase 2 and Phase 2↔Phase 3) is in the small-metres range for y, not the ~0.2m the plan implies. Worth a smoke-test entry: "R2-extended — zoom from y=12 deep into Phase 3 with cursor on a building, zoom back to y=12: log final y."
//** Accepted. Tightening the §"Tick energy" wording and adding the smoke-test entry. The drift remains acceptable for the prototype, but the plan should be honest about magnitude.

## H6 — Phase 2 risk note about "tilt accelerating at end" is the opposite of what the math does

- Risks at `claude/specs/001-phase-3-plan.md:304`: "Phase 2 reads as 'jerky' with linear-in-y tilt + exponential-in-y descent. The two curves don't align 'naturally' — pedestal slows asymptotically near y=1.5m while tilt continues to change linearly. Could feel like the tilt accelerates at the end."
- Trace from (y=10, θ_stored=60°), α=0.1, ten ticks:

  | tick | y     | θ°     | Δy    | Δθ°   |
  |------|-------|--------|-------|-------|
  | 0    | 10.00 | 60.000 | —     | —     |
  | 1    |  9.15 | 53.999 | 0.850 | 6.001 |
  | 2    |  8.39 | 48.600 | 0.765 | 5.399 |
  | 3    |  7.70 | 43.741 | 0.689 | 4.860 |
  | 4    |  7.07 | 39.367 | 0.620 | 4.374 |
  | 5    |  6.51 | 35.430 | 0.558 | 3.937 |
  | 10   |  4.85 | 23.595 | 0.330 | 2.327 |

- Δθ per tick *decelerates* monotonically by exactly the factor 0.9 each tick (since Δy decreases by 0.9 and Δθ = (θ_stored/8.5) × Δy is a constant times Δy). Tilt does **not** accelerate at the end — pedestal and tilt slow together at the same multiplicative rate. The perceptual rate is uniform per tick.
- The actual feel risk is the opposite: because both rates slow together, the swoop has no "final settle" moment. The camera approaches y=1.5 asymptotically and the user has to keep wheeling. The Phase-2 → Phase-3 boundary lands when wheel ticks accumulate past the 1.5m clamp. If anything is jerky, it'll be the *clamp at boundary*, not the curve shape.
- Recommend rewriting the risk: replace with "Phase 2 has no terminal acceleration — the swoop slows asymptotically and the user must keep wheeling to reach y=1.5m. Mitigate (if needed) by snapping y to 1.5m when within e.g. 10cm." The "change to smoothstep" mitigation as written is solving a problem that the math doesn't produce.
//** Accepted. Embarrassing — I wrote the risk before doing the numerical trace. Rewriting per the recommendation.

## H7 — Stranded reasoning after the cursor-anchoring cut

Found three places where the plan still carries reasoning that no longer applies. None are showstoppers; flagging for cleanup.

- §"Stored-tilt latch" rationale at `claude/specs/001-phase-3-plan.md:98`: "Rationale: `_storedTilt` is the 'what tilt was the user using before they dove' memory. Manual re-tilting at any elevation is a separate gesture; the stored value should reflect the user's *most recent intent to descend*, not their current orientation." This reads fine post-cut, but the underlying premise — that the stored value represents an intent-to-descend coupled with an anchor — is now just "the tilt to restore to on zoom-out". The framing as a memory of pre-dive intent is more elaborate than the simplified mechanic warrants. Optional simplification.
- §"What this plan does NOT cover" at `claude/specs/001-phase-3-plan.md:405`: correctly captures the deferred re-introduction path ("latch anchor + cursor NDC at Phase 2 entry, no per-tick re-raycast"). Good — that section reads consistent with the cut.
- §Risks list: no leftover cursor-anchor risks. Good.
- §"Architecture — `ExperimentalControls.js`": no leftover mentions of `_scratchCamera` or `phase2SolveCameraPosition`. Good — the surgery removed those.
- §Goals at `claude/specs/001-phase-3-plan.md:12`: "Cursor anchoring is preserved through Phase 1 only; Phase 2 is pure pedestal+tilt." Reads consistent post-cut.

The one real stranded item is in the §"Mechanics" gate vs §"Architecture" dispatch (H1 above), which is more than a cleanup matter. The rest of the document is internally consistent post-cut.
//** Acknowledged. Leaving the §"Stored-tilt latch" rationale as-is — the "memory of pre-dive intent" framing is harmless even though it's slightly more elaborate than the simplified mechanic needs. Not worth rewriting.

## What the plan got right

- **Math for Phase 2 reversibility.** `y_next = y - α(y-1.5)` and `y_next = 1.5 + (y-1.5)/(1-α)` are exact inverses for `y > 1.5`; the 5-tick in/out trace returns to start to floating-point precision. Phase 3 FOV reversibility (`÷ 1.1` and `× 1.1`) is exact. Verified.
- **Tilt-lerp rate is uniform per tick.** As traced above, Δθ/Δy is constant. The lerp curve is the right shape; no need to smoothstep it.
- **Per-phase drain cap is the right tool.** The qualitative argument for slowing Phase 2 (not Phase 1) is sound. Only the boundary-handling detail (H4) needs nailing down.
- **Cursor-anchoring cut.** The decision to drop in-swoop anchoring is well-justified against the locked tilt-conditional rule. The deferred re-introduction path is captured correctly. Not proposing to revisit.
- **Open decisions #5–#7.** Reversibility-as-function-of-state, per-phase drain cap, no new abstraction — all sound, locked correctly.

## Recommended actions before sign-off

In priority order:

1. **Fix the dispatch order (H1).** Edit §"Architecture additions" `_applyWheelTick` sketch so elevation gates Phase 2/3 before the tilt-conditional split. Without this the swoop aborts at `y ≈ 5.75m` for a typical 60° entry.
2. **Tighten the latch wording (H2 second half) to match the round-down model.** The §"Stored-tilt latch" write rule talks about "residual ticks" that the §"Tick energy" round-down simplification eliminated.
3. **Disambiguate the per-frame cap behaviour at boundary crossings (H4).** One sentence on whether `ticksThisFrame` is shared or per-phase, plus a note on the zoom-out speed-up if shared.
4. **Add a smoke-test entry for the corner-case round-down drift (H5).** Cursor-near-building Phase 1→2 crossing logs final-y on round-trip.
5. **Rewrite the "tilt accelerates at end" risk (H6).** Replace with the asymptote-at-y=1.5 risk.
6. **Decide on the low-tilt Phase 2 entry case (H3).** Either accept-and-document, or add `_storedTilt = max(latch, 30°)` floor.

None of these block the plan structurally — the swoop design is sound, the math is mostly right, the simplifications are well-chosen. H1 is the only one that breaks the feature at the wiring level; the rest are spec-clarity and corner-case items.
