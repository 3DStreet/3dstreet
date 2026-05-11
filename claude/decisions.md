# Decisions log

Consolidated record of UX and design decisions made on the navigation prototype, with date, one-line decision, brief rationale, and pointer to the relevant doc. Newest first. Implementation tunables (constants, file structure, etc.) live in the plan files — this log is for decisions that shaped the user-visible behaviour and would otherwise be hard to reconstruct.

## 2026-05-11 — Wheel-zoom is cursor-anchored at tilt > 30° only

At tilt > 30° (map mode): cursor-anchored exponential dolly (Phase 1 spec, unchanged). At tilt ≤ 30° (FPS mode): plain camera-Z dolly along the view direction, no cursor anchoring.

**Rationale:** Google Maps' cursor-anchored zoom is a map-view feature; at low tilt we're not in map mode and the comparison doesn't apply. The 30° cut is already the boundary between Phase 2's two LB+drag modes, so wheel-zoom semantics aligning is consistent with the rest of the UX. Sidesteps the "cursor over sky → screen-centre-feeling zoom" inconsistency at low tilt (a corner-of-the-viewport feel-test finding).

**Trade-off:** at low tilt you can't cursor-anchor wheel-zoom toward a specific ground feature. WASD-W remains the horizontal-forward affordance; wheel-zoom adds camera-Z dolly which follows tilt as well.

See: `claude/specs/001-tilt-conditional-zoom.md`. Replaces an earlier proposal (`claude/specs/001-cursor-anchor-fallback.md`, superseded) which would have papered over the fallback shape.

## 2026-05-10 — Rotation centre is fully latched at Shift+LB gesture start

The Shift+LB rotation centre is computed once at gesture start (using the camera's tilt, screen-centre raycast, and AABB feather) and held for the duration of the drag. Next gesture re-evaluates.

**Rationale:** the user originally objected to latching because "a rotate starting outside the scene shouldn't turn into a rapid sideways transition through the scene". Two live-recompute variants were attempted to honour that objection: (1) blend the rotation centres per frame → juddered near the AABB edge (orbit math feeds camera position back into the centre, creating a feedback loop); (2) blend the rotation *results* (three independent candidates' (pos, dir) pairs blended) → felt "absolutely terrible" at feel-test. Reverted to the latched design as the least-bad option.

**Trade-off:** a long Shift+LB rotation from outside a small scene arcs the camera through the scene at the latched orbit radius. User releases Shift+LB and re-engages to reset the centre — accepted.

See: `claude/specs/001-phase-2-plan.md` (Open Design Call #3 trail). Live-recompute code preserved on branch `navigation-phase2-nolatch`.

## 2026-05-09 — Scene-boundary inside/outside test uses AABB rectangle, not cylinder

Phase 2's rotation-centre rule (Rule 2 outside scene / Rule 3 inside) tests against the scene's axis-aligned bounding box, not the SceneBounds cylinder.

**Rationale:** the cylinder (`max(width, depth) / 2` as radius) gives wrong "inside" semantics for long-thin scenes — a camera 10m off the side of a 100m × 5m street is "inside" by cylinder reckoning but feels obviously outside. The AABB is the actual horizontal footprint. The cylinder is still computed and exposed for Plan View framing (which needs a single radius).

See: `claude/specs/001-phase-2-plan.md` Open Design Call #3.

## 2026-05-09 — `MIN_TILT_DEGREES = -89°` (looking-up allowed)

The camera tilt clamp lets the user pitch up to almost-straight-up (originally Phase 1 floored tilt at +30° below horizontal — "no looking up"). Paired with the eye-height rotation centre for Rule 2 (1.5m, not 0m) so the camera doesn't arc underground when the user tilts up at street level.

**Rationale:** street-level viewing of buildings requires looking up. Eye-height rotation centre + lowered clamp together make this work without underground artefacts.

See: `claude/specs/001-phase-2-plan.md` inline-discussion item #7.

## 2026-05-07 — 30° hard-cut between LB+drag truck/dolly and truck/pedestal

LB+drag at tilt > 30° = truck/dolly in the world horizontal plane. LB+drag at tilt ≤ 30° = truck/pedestal (world-horizontal + world-vertical motion). Sub-mode latched at gesture start; no smooth blend across the boundary.

**Rationale:** truck/dolly and truck/pedestal can't be linearly blended without producing "drift up and forward" feel. Hard cut is the cleanest answer; the visual indicator (toolbar restyle) tells the user which mode they're in. Wheel-zoom adopting the same 30° cut (2026-05-11 above) extends this consistently.

See: `claude/specs/001-phase-2-plan.md` §"Mechanics" + Open Design Call (no number — it's the load-bearing UX question in Risks).

## 2026-05-07 — Visual indicator for low-tilt mode: toolbar restyle to full-width black strips

When tilt ≤ 30° (truck/pedestal mode active), the floating toolbars (top + bottom) restyle to full-width black strips. Aspect-ratio change of the visible viewport is the signal that "you're in low-tilt mode".

**Rationale:** strong, hard-to-miss signal that stays out of the user's mouse path. Alternative was cursor-shape change or a small mode badge — both reserved as fallbacks if toolbar restyle proves distracting.

See: `claude/specs/001-overall-plan.md` decision 6.

## 2026-05-07 — Feature flag is URL parameter, not build-time

The new nav controls are gated by `?nav=experimental` in the URL. Old and new systems coexist; switching between them is in-session.

**Rationale:** fast to toggle for side-by-side feel comparisons. The `navigation` branch could break the old controls outright but the flag is cheap insurance.

See: `claude/specs/001-overall-plan.md` decision 1.

## 2026-05-07 — Phasing: control-plane foundation, then low-stakes UX first

Phase 0 = shared plumbing (event handlers, latching, feature flag). Phase 1 = bird's-eye nav (LB-truck, Shift+LB rotate, wheel zoom, WASD, Plan View). Phase 2 = low-tilt + bounds-based rotation centre. Phase 3 = full swoop. Phase 4 = double-click nav. Phase 5 = FPS mode.

**Rationale:** earlier instinct was "swoop first" because it's the riskiest novelty, but the swoop is three composed behaviours (Phase 1 dolly + Phase 2 transition + Phase 3 focal zoom). The most novel/risky bit is just Phase 1 + cursor anchoring; the other two layer on top. Phase 2's bounds-based rotation centre is conjoined with the 30° hard-cut so they ship together.

See: `claude/specs/001-overall-plan.md`.

---

## Format note

Each entry: date heading + one-line decision (as the heading itself or first paragraph) + brief rationale + trade-off if any + pointer to the relevant doc. Keep entries to a paragraph or two each — this file is an index, not a full design record. If a decision turns out to be wrong and gets reversed, the new decision goes at the top and the old one stays in place with a "Superseded by [date]" tag rather than being deleted.
