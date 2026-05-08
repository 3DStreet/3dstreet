# 001 — Phase 3 Skeleton: Full Swoop

*Working draft 2026-05-08. Will iterate.*

**Skeleton only.** Phase 3 connects Phase 1's cursor-anchored dolly with Phase 2's low-tilt mode. The mechanics have to be re-specified after both Phase 1 and Phase 2 feel-tests, because the swoop's "feel" depends on the feel of its endpoints. Purpose of this document: dependency map and a list of decisions held open.

## Scope reminder (from overall plan)

- Phase 2 transition (pedestal + tilt + cursor anchoring continues, between ~10m and 1.5m elevation).
- Phase 3 focal zoom (FOV-only, no anchoring) at street level.
- "Stored tilt at Phase 2 entry" with most-recent-crossing-wins rule.
- No-hit fallback for cursor anchoring (already in Phase 1).
- Reversibility — zoom out retraces.

## Dependencies on earlier phases

### From Phase 0
- No new direct dependencies beyond what Phase 1 and 2 already consume.

### From Phase 1
- `cursorAnchor.js` — Phase 3 reuses the cursor-anchor helper for the Phase-2-transition portion of the swoop. The no-hit fallback chain is identical.
- `tickAnimator.js` — Phase 3's transitions are continuous, not discrete tween animations, so `TickAnimator` may not be the right abstraction. May need a "rate-limited continuous integrator" instead. Decide at Phase 3 plan time.
- Phase 1's wheel handler is replaced. Phase 1's straight cursor-anchored dolly becomes the Phase-1-of-swoop branch; the Phase-2 and Phase-3 branches are new.
- The Mac pinch (Ctrl+wheel) modifier semantics from Phase 1 (currently identical to plain wheel) become meaningful in Phase 3 — Ctrl+wheel could be the "fixed-tilt zoom" escape hatch (per the proposal's "what is lost" discussion).

### From Phase 2
- Tilt is no longer clamped at 30°, so the swoop's tilt-flattening behavior between 10m and 1.5m has somewhere to land.
- `SceneBounds` — relevant for the "10m above what?" question (10m above ground, or above scene bounds?).
- Stored-tilt state needs a home. Likely on `ExperimentalControls` instance state, written on downward Phase-1→2 crossing, read on upward Phase-2→1 crossing.

### Things Phase 1/2 should accommodate

1. **Wheel-handler structure.** Phase 1's wheel handler is one branch (cursor-anchored dolly). Phase 3 turns it into a three-branch state machine. If Phase 1's handler is a single function, Phase 3 needs to refactor; if it's already structured around a "decide phase" function, Phase 3 just adds branches. Lean toward the latter even in Phase 1.
2. **Camera-state observability.** Phase 3 needs to know "current elevation" and "current tilt" cheaply on every wheel tick. Confirm these are read from `THREE.Camera` directly without per-tick recomputation.
3. **Cursor-anchor re-raycast on a continuous gesture.** Phase 1 re-raycasts per wheel tick. Phase 3's transition is continuous — does the anchor update per integration step (60Hz) or per wheel tick? Phase 3 design call; Phase 1 just needs to expose `cursorAnchor.worldPointAt()` cheaply enough to be called either way.

## Open decisions deferred to Phase 3 planning

- **10m and 1.5m thresholds.** Marked "tune for human-scale streets first" in overall plan. Will need feel-tuning, not just a guess.
- **What "10m above" measures.** Above ground plane (y=0)? Above scene bounds top? Above nearest mesh below the camera? The first is simplest; the others may feel better for elevated dioramas.
- **Pinch (Ctrl+wheel) semantics.** Phase 1 makes Ctrl+wheel identical to plain wheel. Phase 3 candidates: (a) Ctrl+wheel = fixed-tilt zoom (no swoop), per the proposal's "what is lost" mitigation; (b) Ctrl+wheel = trackpad-pinch alias for plain wheel, no semantic difference. Decide at Phase 3 plan time.
- **Phase 2 transition interpolation.** Pedestal + tilt + cursor-anchor-tracking simultaneously. The math has to keep the cursor anchor under the cursor *while* tilting *while* pedestal-ing. Worth a paper-math derivation in the Phase 3 plan, not just a hand-wave.
- **Trackpad blast-through.** Already flagged in overall plan. Phase 3 needs a concrete mitigation (rate-limit, minimum animation duration, or wheel-event coalescing).
- **No-hit fallback during Phase 2 transition.** Phase 1's no-hit fallback gives a forward 30m point. During a swoop, that fallback might cause weird trajectories. Define behavior.
- **Reversibility math.** "Zoom in then out returns to same camera angle" — easy to assert, harder to guarantee without explicit state preservation. Decide whether the swoop is a stateful machine (records its breadcrumbs) or a stateless function of elevation+stored-tilt.

## Risks (preliminary)

- **Anchor drift during continuous transition.** Per-tick raycasting works for discrete wheel ticks; for continuous integration the math has to hold across small steps too. Most likely failure mode.
- **Most-recent-crossing-wins state can be confusing.** If the user crosses 10m four times during exploration, what tilt does Phase 2→1 zoom-out restore? The most recent. Verify in feel-test that this matches user expectation, not just the spec.
- **Phase 3 focal-zoom feel.** FOV-only zoom at street level may feel sluggish or fish-eyed at extremes. Plan to tune FOV bounds.

## What this document is NOT

- Not a math derivation of the Phase 2 transition.
- Not a final spec for Ctrl+wheel semantics.
- Not a smoke test checklist.

Promote to `001-phase-3-plan.md` when Phase 2 has shipped and feel-tested.
