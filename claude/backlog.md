# Backlog

Internal backlog for the navigation prototype: ideas, follow-ups, and improvements that aren't decided design choices (those go in `decisions.md`) and aren't blocking the current phase. Items are notes-to-self, not commitments. Each entry: date raised, brief description, phase-target if known.

Newest first.

## 2026-05-11 — Visual cue for scene-bounds entry/exit

**Phase target:** TBD (Phase 3+ probably; not blocking Phase 2 UX learning).

When the camera crosses the scene-bounds boundary (the AABB used by the rotation-centre rule), the rule for the *next* Shift+LB rotate changes — outside the AABB you orbit the diorama (Rule 2), inside you rotate in place (Rule 3). With the latched rotation centre (per `decisions.md` 2026-05-10), this rule change only manifests between gestures, but the user has no way to tell ahead of time which behaviour they're about to get.

Need some visual indication of "you are inside / outside the scene-bounds" so the rule change is anticipatable. No specific design yet — candidates worth thinking about:

- Cursor change (similar to how Phase 2 considered cursor-shape as a fallback indicator).
- Subtle accent overlay on the canvas edge.
- Edge highlight on the scene-bounds rectangle when the camera is near it.
- An icon or status next to the existing toolbar indicator.
- Audio-visual cue at the moment of crossing.

**Related design consideration: feathering may no longer be needed.** The current `SCENE_FEATHER_METRES = 5m` smoothstep was originally there to soften the Rule 2 ↔ Rule 3 transition under live-recompute (when the rotation centre was recomputed per frame). Now that the rotation centre is fully latched at gesture start, feathering only affects gestures that *start* in the feather zone — and even then, only smooths the once-latched centre rather than a continuous transition. Re-evaluate whether feathering is still pulling its weight, or whether a hard boundary + visual cue is cleaner. The two might conflict: a soft 5m feather makes "you're at the edge" ambiguous in a way that a visual boundary indicator wants to be unambiguous.

**Source:** user, 2026-05-11 (mid-Phase-2 feel-test). "Not urgent to fix; not blocking our UX learning."
