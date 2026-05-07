# 001 — Overall Plan: Navigation Prototype Phasing

*Working draft 2026-05-07. Will iterate.*

Plan for prototyping the navigation overhaul described in `/claude/reference/3D Street Navigation Proposal.md`. Goal: learn fastest about the riskiest mechanics through UX testing of working prototypes, not ship to production.

## Re-shaping the phasing

The earlier "swoop first" instinct is right in spirit — go after the riskiest novelty — but the swoop isn't the right atom. The swoop is three composed behaviors (cursor-anchored Phase 1 dolly, Phase 2 transition, Phase 3 focal zoom) and the most novel/risky bit is just Phase 1 + cursor anchoring. Phases 2 and 3 layer on top.

Also, "bounds-based rotation center" only matters when you can tilt below 30°, which means the 30° hard-cut and the bounds logic are conjoined — you can't really evaluate one without the other. So they want to ship together.

## Phases

### Phase 0 — Control-plane foundation

*No UX-testable artifact.*

The five prototypes share a lot of plumbing: event handlers, modifier-key state machine, gesture-latching, the camera-state update loop, and a feature flag to toggle the new system on/off without removing the old one. Building this once, deliberately, avoids each phase rebuilding it. Sized in days, not weeks.

Outputs:
- A `nav-experimental` component (or similar) that owns the camera and reads input
- A setting to enable it (so old and new systems can coexist)
- Latching infrastructure (mode and rotation-center latched at gesture start)
- Bounds computation + cache + invalidation hooks

### Phase 1 — Birds-eye view, top-down to gentle tilt only

*First UX-testable slice. Strong-signal first cut at the new control scheme.*

- LB+drag = truck/dolly in world horizontal plane
- Shift+LB+drag = pan/tilt with simple "rotate about screen-center hit point" (no bounds logic yet — tilt clamped at ≥30°)
- Wheel = exponential cursor-anchored dolly (Phase 1 of swoop only — no Phase 2 transition yet)
- WASD = camera-yaw-projected horizontal motion
- Plan-view button with animated transition

This is enough to answer the biggest single question: does the new control scheme feel right alongside Google Maps? It also sanity-checks cursor anchoring before we layer the swoop transition on top.

### Phase 2 — Low-tilt + bounds-based rotation center

*Unblocks tilting below 30° and forces the bounds logic into existence.*

- Remove the 30° tilt clamp
- 30° hard-cut between truck/dolly and truck/pedestal, latched at gesture start, with a visual indicator
- Cylindrical bounds derivation, cached
- Three-rule rotation center (camera view / diorama center / camera position), latched at gesture start, with the smooth blend in the 20°–30° band

This is where the bounds-based design either feels good or doesn't. High-information phase.

### Phase 3 — Full swoop

*Connects Phases 1 and 2.*

- Phase 2 transition (pedestal + tilt + cursor anchoring continues)
- Phase 3 focal zoom (FOV-only, no anchoring)
- "Stored tilt at Phase 2 entry" with most-recent-crossing-wins rule
- No-hit fallback for cursor anchoring

By now there's a working Phase 1 dolly and a working low-tilt mode, so the swoop just connects them.

### Phase 4 — Double-click navigation

- Cardinal-direction snap for resulting heading
- Elevation rules (never raise; behavior across building / lane / object cases)
- Lane UV-point handling
- Hover-highlight raycast fix folds in here naturally (precondition for the double-click feel test, even if we're not shipping it standalone)

### Phase 5 — FPS mode

Self-contained, slot in last as agreed.

- Pointer lock entry/exit (Ctrl-hold + click to engage; release to exit)
- WASD navigation
- Visual indicators for mode (subtle FOV nudge, fade of 2D overlays)

## What's worth pinning down before Phase 1

These affect the foundation work, so resolving them early avoids rework.

1. **Replace vs coexist.** Working assumption: a feature-flagged new control system that fully takes over when on, and the old system runs unchanged when off. The alternative — incrementally mutating the existing controls — sounds tempting but means every prototype is fighting the existing semantics. Confirm.
//!! Confirm.  On this branch we could even completely break the old controls and that would probably be OK.  But for safety let's use a feature flag.  Can be build timr, or a URL parameter id that's just as easy.
2. **What's the existing nav component?** Worth a quick look at how the current camera controls are wired — stock A-Frame controls, three.js OrbitControls, custom? That tells us how much we're displacing in Phase 0 and where the toggle inserts cleanly.
//!! Agree sensible foundational analysis.  Propose this is done as part of planning phase 0.
3. **Scenes for evaluation.** Three representative scenes is probably right:
   - A Streetmix import (small, narrow, bounded)
   - A geo-located scene with Google Tiles (unbounded)
   - A large diorama with multi-storey buildings (bounded but with vertical extent)

   Worth picking specific ones now so feel-tests stay comparable across phases.
//!! Initially planning to start with just what we get from "Create a basic street".  I think we can learn a lot there, before extending to other scenes.  Key thing this doesn't cover is the unbounded scene, but the behaviour of the unbounded scene is just the behavour we get when in the middle of a bounded scene, so not actually any limitation in getting a sense of hos this feels.
4. **Who tests, and how often.** Self? Self + Kieran? A few Discord users? Per-phase walk-through, or a checkpoint at each merge? "Feel" feedback only, or any rough numeric capture (e.g. "rate 1–5 vs current")?
//!! Me first.  Once I think it's OK, I will share with Kieran (and we will definitely try a wider range of scenes at that point - he'll have ideas about what matters & is most interesting)
5. **Branch strategy.** Long-lived feature branch with squash-merges per phase, vs. main behind a flag. The flag-on-main approach makes it easy for Kieran or others to try the prototype without checking out a branch — probably the right call given the testing audience, but it constrains how broken intermediate states can be.
//!! Just work on my "navigation" branch for now.  Integration with upstream mein is something we'll plan for later.  If you want to work on a sub-branch for each phase and merge back into "navigation" that should work well.
6. **Visual indicator for the 30° hard-cut.** Cursor change? On-screen badge? Subtle camera FOV nudge? Worth deciding *before* Phase 2 lands so we're not retrofitting; even a placeholder we can iterate on.
//!! Don't know if this is going to work, but thinking about restyling the two toolbars that hover centrally top & bottom into full-width black strips, so we end up with a slightly different aspect ratio (wider screen).  No idea if this will work, but should be a pretty clear indication something has changed.  Would like to see how this feels.

## Open / deferred to prototype-time evaluation

Carrying forward from the review's `//**` notes — these are not blockers, but worth keeping visible so we don't forget to look at them while testing:

- Mid-gesture mode flips at the 30° boundary (latched at gesture start; reconsider only if it feels worse than mode-flipping)
- Spatial blending of rotation centers near the bounds boundary (does it hunt/spiral?)
- Phase 2 trackpad blast-through (might need rate-limiting or minimum animation duration)
- Whether cursor-anchored Phase 2 lands at a sensible distance from the cursor target
- Double-click elevation asymmetry (same gesture, different end-states by altitude)
- Sensible defaults for absolute thresholds (10m Phase-2 entry, 1.5m eye level) — tune for human-scale streets first, generalize later
