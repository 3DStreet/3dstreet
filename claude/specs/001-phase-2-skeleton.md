# 001 — Phase 2 Skeleton: Low-Tilt + Bounds-Based Rotation Center

*Working draft 2026-05-08. Will iterate.*

**Skeleton only.** This is deliberately not a full plan — Phase 2 is the "high-information phase" of the overall plan, and detailed mechanics should be re-derived after Phase 1 feel-testing produces concrete notes. Purpose of this document: lock in the *dependency map* onto Phase 0/1 modules, surface things Phase 1 should accommodate, and keep a running list of decisions to be resolved at Phase 2 planning time (after Phase 1 feel-test).

## Scope reminder (from overall plan)

- Remove the 30° tilt clamp (manual tilt path).
- 30° hard-cut between truck/dolly and truck/pedestal, latched at gesture start, with visual indicator (toolbar aspect-ratio shift, per resolved decision in `001-overall-plan.md`).
- Cylindrical bounds derivation, cached, invalidated on entity changes.
- Three-rule rotation center, latched at gesture start: camera view (>30°) / diorama center (outside cylinder, ≤30°) / camera position (inside cylinder or unbounded, ≤30°).
- 20–30° smooth blend between rotation centers.

## Dependencies on earlier phases

### From Phase 0
- `SceneBounds` (cylindrical bounds + cache + invalidation) — Phase 2 is the **first consumer**. Pre-Phase-2 spike should verify the cache invalidation hooks fire on the entity events Phase 2 actually needs (entity add, remove, position/rotation/scale change for street/managed-street/intersection).
- `GestureLatch` — Phase 2 latches the rotation-center choice and the truck-mode choice at gesture start. Verify the latch infrastructure can hold a *composite* state (mode + center + center-blend-weight), not just a single value.
- `ModifierState` — unchanged from Phase 1 use.

### From Phase 1
- `ExperimentalControls._onMouseDown/Move/Up` — Phase 2 modifies the dispatch table to include the 30° hard-cut. Phase 1's pan/tilt path becomes the >30° branch; new ≤30° branch added.
- The screen-center raycast hit code from Phase 1's Shift+LB pan/tilt is reused as the >30° rotation center; the rule-2 and rule-3 paths are new.
- `TickAnimator` — used for the visual-indicator toolbar transition (smooth aspect-ratio shift, not a snap).

### Things Phase 1 should accommodate (review before Phase 1 internals freeze)

These are the "scaffolding pass" findings the user asked for — items where Phase 2's needs may want to influence Phase 1 architecture so we don't have to retrofit.

1. **Gesture-latch composite state.** Phase 1 latches one thing per gesture (the rotation center). Phase 2 latches three (mode, center, center-blend-weight). If `GestureLatch` is built around single-value latching, generalize to a key/value bag now to avoid an awkward second pass.
2. **Mode-dispatch hook in mouse-handler.** Phase 1's `_onMouseDown` dispatches on modifier keys only. Phase 2 adds a tilt-angle dispatch on top. Easier if Phase 1's dispatch is already structured as a "decide mode" function returning a mode token, with the handler consuming the token — versus inline `if (shift) ... else ...`.
3. **Tilt-clamp scope.** Phase 2 removes the 30° clamp on the manual tilt path. Phase 1's tilt clamp should live in a single named constant + single enforcement site, not sprinkled. (Phase 1 plan calls for a "single source-of-truth constant" — verify implementation honors this.)
4. **Visual-indicator hook.** Phase 2 mutates toolbar styling on mode change. Phase 1 doesn't need to wire this, but should confirm the mode-change moment is observable (event emission or state in `useStore`) so Phase 2's UI code can subscribe without reaching into controls internals.
5. **`SceneBounds` cache warmup.** Phase 1 doesn't consume bounds, but if Phase 1 does scene-wide raycasts in hot paths (cursor anchor at 60Hz), confirm the bounds-cache invalidation isn't piggy-backed on every raycast — would mean Phase 2 thrashes the cache during gestures.

## Open decisions deferred to Phase 2 planning

These are deliberately not resolved now. Phase 1 feel-test notes will inform several.

- **Visual indicator design.** Toolbar aspect-ratio shift is the primary candidate (resolved in overall plan). Concrete implementation — animated transition vs snap, restoration on mode-flip-back, behavior with toolbars hidden — defer to Phase 2 planning.
- **Bounds-blend math.** 20–30° blend between rotation centers. Linear interpolation? Eased? Spatial blending near the cylinder boundary is also called out in the proposal — does that compound with the angular blend, or are they independent? Worth a paper sketch before coding.
- **Cylinder boundary feathering.** Proposal mentions a "weighted blend… in the zone around the edge of the scene bounds." How wide is the zone? Hardcoded meters or a fraction of the cylinder radius?
- **Latched-state staleness.** If a gesture is held for 10s and the user pans the camera *inside* the bounds during that time, the rotation center stays at the latched diorama-center. That's the design. Verify the resulting feel is acceptable, not surprising.
- **Mid-gesture mode flips at the 30° boundary.** Already deferred per overall plan; revisit only if it feels worse than mode-flipping during Phase 2 feel-test.
- **Phase 0 placeholder LB-pan removal.** Already removed in Phase 1; Phase 2 inherits the Phase 1 LB+drag truck/dolly as the >30° behavior.

## Risks (preliminary — expect additions)

- **Bounds derivation cost.** Union AABB over all street/managed-street/intersection entities, plus invalidation on entity change. For a 50-entity scene this is cheap; for a 5000-entity scene it might not be. Spike with a pathological scene before committing.
- **Latch staleness vs feel.** See open decisions above.
- **Visual-indicator distraction.** Toolbar aspect-ratio shift is intentionally hard to miss, which means it might also be intentionally distracting. Plan a feel-test exit criterion: does it feel like a useful signal or like flashing lights?
- **Three-rule rotation center logic correctness.** Three rules + two blends = six cases. Worth a truth table in the Phase 2 plan, not just prose.

## What this document is NOT

- Not a full task breakdown.
- Not a smoke test checklist.
- Not a final spec for the visual indicator.

Promote to `001-phase-2-plan.md` when Phase 1 feel-testing is done and notes exist to draw from.
