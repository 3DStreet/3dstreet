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
- A feature flag to enable it (URL parameter — fast to toggle without a rebuild; old and new systems coexist)
- Latching infrastructure (mode and rotation-center latched at gesture start)
- Bounds computation + cache + invalidation hooks
- Foundational analysis of the existing camera-controls wiring (stock A-Frame? three.js OrbitControls? custom?) — done as part of Phase 0 planning, before any code lands. Output is a short note documenting what's being displaced and where the toggle inserts cleanly.

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
- Bounds derivation (AABB-based for inside/outside test, cylinder-based for Plan View framing), cached
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

## Decisions (resolved before Phase 1)

1. **Replace vs coexist: coexist, behind a URL-parameter feature flag.** New control system fully takes over when on; old system unchanged when off. URL parameter rather than build-time flag, so it's cheap to toggle in-session. The `navigation` branch could in principle break the old controls outright, but the flag is cheap insurance and supports side-by-side feel comparisons.
2. **Existing nav component analysis: deferred to Phase 0 planning.** Done before any Phase 0 code lands. Output is a short note on what's being displaced and where the toggle inserts cleanly.
3. **Scenes for evaluation: start with the "Create a basic street" default scene.** A single bounded scene is enough to learn from initially. The "unbounded" case is behaviorally equivalent to "inside a bounded scene's cylinder," which the basic street already exercises. Wider scene set (Streetmix import, geo-located, large multi-storey diorama) brought in when sharing with Kieran — he'll have informed views on what matters most.
4. **Testing: self first, Kieran second.** Diarmid drives feel-tests through the early phases. Once the prototype is at a state worth sharing, Kieran joins and the scene set broadens. Discord-user testing is not in this round.
5. **Branch strategy: work on the `navigation` branch.** A sub-branch per phase, merged back into `navigation` at phase boundaries, keeps each phase reviewable and reversible. Integration with upstream `main` is a later-phase concern.
6. **Visual indicator for the 30° hard-cut: toolbar aspect-ratio shift.** Restyle the two centrally-floating toolbars (top + bottom) into full-width black strips when the new low-tilt mode is active. The resulting aspect-ratio change (wider effective viewport) is a strong, hard-to-miss signal that mode has changed, while staying out of the user's mouse path. Treat as a placeholder to evaluate in Phase 2 — may need iteration. Lower-effort fallbacks if this doesn't feel right: cursor-shape change, subtle accent-color overlay on canvas border, or a small mode badge.

## Open / deferred to prototype-time evaluation

Carrying forward from the review's `//**` notes — these are not blockers, but worth keeping visible so we don't forget to look at them while testing:

- Mid-gesture mode flips at the 30° boundary (latched at gesture start; reconsider only if it feels worse than mode-flipping)
- Spatial blending of rotation centers near the bounds boundary (does it hunt/spiral?)
- Phase 2 trackpad blast-through (might need rate-limiting or minimum animation duration)
- Whether cursor-anchored Phase 2 lands at a sensible distance from the cursor target
- Double-click elevation asymmetry (same gesture, different end-states by altitude)
- Sensible defaults for absolute thresholds (10m Phase-2 entry, 1.5m eye level) — tune for human-scale streets first, generalize later
- ~~**Acceleration-based WASD instead of instant velocity.**~~ Landed in Phase 1 (2026-05-09): velocity ramps from 0 to target over `WASD_RAMP_UP_MS` (200ms default) while keys are held; releasing all keys snaps velocity to zero (no decel ramp). Same site (`_drainWASD`) would extend to Phase 5 FPS mode unchanged.

## Phase 2 status — feel-tested and accepted (2026-05-11)

Phase 2 implementation is complete and the prototype is in a stable state. Key feel-test outcomes from the May 2026 session:

- **Latched rotation centre** (not live-recompute). Two live-recompute designs were tried and ruled out at feel-test (one juddered near the AABB edge; one felt "absolutely terrible"). Latched centre with the museum-diorama view-decoupling is the shipping design. See `claude/decisions.md` 2026-05-10 (rotation latching) and 2026-05-11 (museum feel via dual-spherical). Live-recompute code is preserved on branch `navigation-phase2-nolatch` for reference.
- **Scene-boundary inside/outside test uses the AABB rectangle**, not the cylinder. Cylinder still computed (Plan View framing needs a single radius). See `decisions.md` 2026-05-09.
- **Shift+LB rotation: museum-diorama feel.** Apply yaw/tilt deltas to both camera position-around-centre AND view direction independently; no `lookAt(centre)` snap. See `claude/specs/001-shiftrotate-decoupled-view.md`.
- **Wheel zoom: tilt-conditional.** Cursor-anchored at tilt > 30° (map mode); plain camera-Z dolly at tilt ≤ 30° (FPS mode). See `claude/specs/001-tilt-conditional-zoom.md`.
- **WASD ground-level speed: 2× faster** (MIN_SPEED 5 → 10 m/s). Per user feel-test request.

Superseded sub-plans (kept as historical record):
- `claude/specs/001-phase-2-rotation-blend.md` — superseded result-blend approach (lives only on branch `navigation-phase2-nolatch`, not `navigation`).
- `claude/specs/001-cursor-anchor-fallback.md` — superseded by the tilt-conditional approach.

Backlog (not blocking Phase 3): see `claude/backlog.md`. Items include "smooth recentre diorama" control (overlaps Phase 4), scene-bounds visual cue, and "evaluate replacing custom orbit math with library before production".

## Starting Phase 3

Phase 3 is the **3-phase swoop zoom**. Skeleton lives at `claude/specs/001-phase-3-skeleton.md` (designed to be filled in after Phase 1+2 feel-test, which has now happened). The skeleton's dependency map references Phase 1 and Phase 2 mechanics that have shipped — particularly the cursor-anchored wheel dolly (Phase 1) and the 30° tilt cut (Phase 2). The tilt-conditional wheel-zoom decision is directly relevant: the swoop applies to the >30° branch; the ≤30° branch stays as plain dolly across all phases.

**Reading order for the next session:**
1. `claude/CLAUDE.md` — folder conventions and the plan-and-code adversarial-review cycle.
2. `claude/decisions.md` — locked-in UX choices that constrain new designs.
3. `claude/backlog.md` — open items for context.
4. `claude/specs/001-overall-plan.md` (this file) — phasing.
5. `claude/specs/001-phase-2-plan.md` — current state of Phase 2 (the "current state" boxes at the top of each section).
6. `claude/specs/001-phase-3-skeleton.md` — Phase 3 starting point.
7. `src/editor/lib/nav-experimental/` — read fresh; the Phase 1+2 code is the substrate Phase 3 extends.
