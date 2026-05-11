# Backlog

Internal backlog for the navigation prototype: ideas, follow-ups, and improvements that aren't decided design choices (those go in `decisions.md`) and aren't blocking the current phase. Items are notes-to-self, not commitments. Each entry: date raised, brief description, phase-target if known.

Newest first.

## 2026-05-11 — Phase 3 swoop elevation thresholds must be AGL for production

**Phase target:** before production (pre-merge to main; possibly Phase 6).

Phase 3 prototype measures the 10m and 1.5m swoop boundaries against `camera.position.y` (i.e. metres above world origin). Known-broken for scenes whose ground level is meaningfully above or below y=0 — at ground-level = 5m, the "1.5m street-level floor" lands underground. Acceptable for prototype testing against the basic-street default scene (ground at y=0); not acceptable for production where Streetmix imports, geo-located scenes, and elevated dioramas exist.

Production fix: switch to AGL ("above ground level") via a per-tick raycast straight down from camera. The raycast is cheap (one ray per tick) and `cursorAnchor` already does per-tick raycasts. Fall back to absolute-y if the downward raycast misses (open sky / outside scene).

What is unknown: how prevalent non-y=0 ground scenes are in real 3DStreet usage. Worth scanning the published scene corpus before deciding whether AGL is critical-path or a nice-to-have.

See `claude/specs/001-phase-3-plan.md` §"Open decisions" #1.

**Source:** user, 2026-05-11, Phase 3 plan review.

## 2026-05-11 — "Smoothly recenter the diorama" control

**Phase target:** Phase 4 (double-click) — possibly overlapping with that work.

After the Shift+LB rotation snap fix, a long off-aim rotation can leave the user with the diorama in their peripheral vision (which is the correct museum behaviour). Sometimes the user wants a quick way to "recentre" — smoothly tween the camera back to looking at the diorama centre, similar to the existing `focus()` / double-click animation.

Worth considering as part of Phase 4 (double-click navigation): the design might naturally cover this. Double-click on the diorama → camera tweens to face it. Or a dedicated key/button if the affordance needs to be more discoverable.

**Source:** user, 2026-05-11, post-rotation-fix feel-test.

## 2026-05-11 — Evaluate replacing custom orbit math with an existing library

**Phase target:** before production (Phase 6 / pre-merge to main).

`ExperimentalControls` rolls its own orbit-and-rotation math (`_shiftRotate`, `_latchRotationCenter`, spherical math, tilt clamps, virtual-offset rotate-in-place trick, etc.) rather than delegating to a library that already implements this — e.g. `THREE.OrbitControls` (`update()` runs per render frame; handles `target` updates naturally) or A-Frame's own camera control components. Rolling our own was probably the wrong call: it cost us implementation effort, and it costs us *again* every time we want a small behavioural change (most recent: the snap-fix is non-trivial because per-tick orientation tracking has to be added by hand, where a library that runs `update()` per frame would handle it for free).

Before productising, evaluate:
- `THREE.OrbitControls` — can we configure it to give the Phase 1/2 behaviours we want? (Tilt-conditional wheel zoom, the 30° hard-cut at LB+drag, Plan View tween, etc.)
- Other libraries (e.g. `camera-controls`).
- Hybrid: library for the orbit/rotate path, custom for the Phase 2 sub-modes.

If the answer is "library covers most cases, custom covers the rest", the migration is worth doing. If our custom design is too divergent (e.g. the 30° hard-cut between truck/dolly and truck/pedestal isn't a standard orbit-controls feature), maybe not — but at least document the gap.

**Source:** user, 2026-05-11, during snap-fix design discussion.

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
