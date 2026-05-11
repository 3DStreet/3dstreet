# 003 — Cursor-anchor fallback: adversarial review

*Working draft 2026-05-11. Will iterate.*

Adversarial review of `claude/specs/001-cursor-anchor-fallback.md`. The plan is a ~3-line change in `src/editor/lib/nav-experimental/cursorAnchor.js:138-149`; the math claim is sound but a couple of consumer-side interactions and numeric particulars deserve calling out before the feel-test pass.

Findings ordered by significance.

## Significant

- **The core math claim holds — verified.** For a perspective camera the world-space ray through a fixed NDC point `N` depends only on the camera's orientation (rotation matrix) and the projection matrix, not on the camera's position. Both `setFromCamera(N, cam)` calls return a ray with `origin = cam.position` and `direction = (unproject(N, depth=1) − cam.position).normalize()`, where the unprojection at `C1 = C0 + d·δ` shifts by the same `d·δ` (since unprojection is `position + rotation·…`), so the new direction is `(unproject(N, depth=1, C0) + d·δ − C0 − d·δ).normalize() = d`. Result: translating the camera along the cursor ray leaves the screen projection of any point on that ray fixed. Spec's central claim is correct.

- **`this._raycaster.ray` is safe to reuse after `intersectObject`.** Three.js' `Raycaster.intersectObject` reads `ray.origin`/`ray.direction` but does not mutate them — the only mutating call in `worldPointAt` is `setFromCamera` at `cursorAnchor.js:104`. The plan's reuse at Step 3 is equivalent to `camera.position + cursorDir * 30m`. Confirmed.

- **LB-pan path interaction is more than the plan admits.** Spec dismisses this as "in practice the LB-pan gesture rarely starts on a sky-miss cursor." That's true for *normal* use, but the consumer at `ExperimentalControls.js` latches `anchorPlane` to `anchor.y` for the *duration* of the drag. If the new Step 3 fires at gesture start with the cursor near the top of the viewport — entirely plausible at street level looking horizontally — `anchor.y` is no longer near 0; it's roughly `camera.y + cursorRayDir.y · 30m`, which for a 30°-up cursor ray at 1.6 m camera height is ~17 m. The drag then projects subsequent cursor positions onto a horizontal plane at y ≈ 17 m, and "drag right" translates the camera in *that* plane, not the ground plane. Feel-effect: the user clicks-drags expecting to slide the ground, and instead the camera glides along an elevated plane — visually similar at first, but the speed and parallax are wrong. Old fallback had the same problem (anchor at y ≈ `camera.y + camForward.y · 30m`), so this is not a regression — but it's not "in the same direction" as the plan suggests; it's a different elevated-plane anchor. Worth either acknowledging the parity-not-fix nature, or scoping a sibling change that clamps the LB-pan anchor to the ground plane on sky-miss (different fallback for the two consumers).
//** Accept "parity-not-fix" framing. Will add a sentence in the spec acknowledging the LB-pan elevated-plane behaviour is unchanged from old (both old and new put the anchor at a non-zero y on sky-miss; only the *horizontal* component of the anchor differs). Sibling change to clamp LB-pan's fallback to y=0 is logged as a follow-up if feel-test surfaces it, but not implemented in this scope.

- **"Zoom went up" risk, quantified.** Plan flags this; user explicitly accepts. Numbers: camera at street level y=1.6, cursor at NDC (−0.9, +0.9), FOV 60°, aspect 1.6. Pixel-to-ray direction at NDC.y=+0.9 with halfV ≈ 30° gives ray.y ≈ sin(0.9·30°) ≈ sin(27°) ≈ 0.45 (after accounting for ray-space tan, true value is ~0.43). A single tick at `ZOOM_PER_WHEEL_TICK = 0.10` against a 30 m anchor moves the camera by `0.10 · (anchor − cam) = 0.10 · 30 · d`, so Δy per tick ≈ 0.10·30·0.43 ≈ **1.3 m upward per tick**. With the budget hard-cap at 10 ticks/frame and trackpad bursts that fill a budget in one gesture, a short flick can lift the camera ~10–15 m above street level before stopping. That isn't "I escaped the scene" — still well inside any realistic scene's vertical extent — but it is "I wheel-zoomed and ended up at first-floor-window height for no obvious reason". User should expect this in the feel test; it's worse with more upward-pointing cursors.
//** Accept. Will pin the ~1.3 m/tick number in the spec as the feel-test expectation, so the tester has a reference for "acceptable" vs "out of scale".

- **Step-2-to-Step-3 cliff is improved but not removed.** At ground hit = 1999 m the wheel tick moves the camera by `0.10 · 1999 ≈ 200 m` along the cursor ray. At ground hit = 2001 m, Step 3 fires and the camera moves `0.10 · 30 = 3 m` along the same ray. That's a **~66× step-size discontinuity** for a sub-metre cursor change. Plan correctly notes the *direction* is now continuous (same ray); but the *magnitude* still cliffs. Less perceptually nasty than the old "anchor flipped sides" cliff, but if the user pans the cursor across the horizon while wheeling, they'll feel zoom snap from "huge" to "tiny" at the boundary. Pinning expectations: better than before, not fixed.
//** Acknowledged. Out of scope for this fix; flag in the spec as a known residual.

## Worth pinning before coding

- **Plan changes are a 3-line code edit plus a doc-comment refresh — but the doc-comment at `cursorAnchor.js:13-14` says "fixed 30 m forward along the camera's view direction".** Spec mentions updating "lines 7-17"; the actual stale lines are 13-14. Minor — flag so it's not missed.
//** Fix at code time. Doc-comment text update is the same; only the line reference was off.

- **Spec drift check: `001-phase-1-plan.md:44` describes a different fallback for the Shift+LB rotation-centre raycast** ("ground-plane (y=0) intersection at screen center; if that's behind the camera, fall back to a fixed point 10m forward on the ground plane"). Different code path (not `cursorAnchor.worldPointAt`), different constant (10 m vs 30 m), different fallback semantics ("on the ground plane" — y=0 enforced). Plan correctly leaves it alone, but it's worth a sentence in the spec confirming we considered and rejected unifying — otherwise a future maintainer may treat the two as analogous when they aren't.
//** Add one line to the spec's "No other files touched" section confirming the Shift+LB rotation-centre raycast at `001-phase-1-plan.md:44` is a separate code path and not touched.

- **Test coverage gap: "Step 2 still wins" regression assertion.** Plan says "existing test should already cover" — and it does (`cursorAnchor.test.js:58-69`, the `'ground'`-source case). But that test uses a camera looking *straight down*, which is the trivial case. Worth adding (or asserting in the new sky-miss test) a *non-trivial* "ray hits ground in range → Step 2 wins" case: camera at y=10 looking 45° down, cursor at viewport centre. Without this, the new Step 3 could accidentally also fire when Step 2 should have won, and the existing top-down test wouldn't catch it.
//** Add to test plan: oblique-camera (e.g. y=10 looking 45° down) "Step 2 wins" test with non-trivial cursor positions. Closes the regression-detection gap.

- **The new sky-miss tests will need a non-top-down camera.** The existing fallback test (`cursorAnchor.test.js:71-91`) uses a camera looking *straight up* with `up = (0,0,-1)` — that's a degenerate setup. For the cursor-ray-direction assertion to be meaningful (cursor in top-left vs top-right giving different anchors), the test needs a camera with a sensible orientation. Worth specifying this in the test plan so the implementer doesn't copy-paste the straight-up camera and produce tests that pass trivially.
//** Specify in the spec's test plan: sky-miss tests use a camera at street level (y≈1.6) looking horizontally, with cursor at distinct NDC positions to verify the ray-direction-driven anchor.

- **`source: 'fallback'` consumer audit.** Quick check of the codebase shows `source` is read only in `cursorAnchor.test.js` (assertions). `_applyWheelTick` at `ExperimentalControls.js:776` consumes only `{x, y, z}`. LB-pan path similarly opaque. No consumer treats `'fallback'` as "centre-anchored zoom". Safe to keep the source label.
//** Confirmed. No action.

## Alternatives not on the plan

- **Why not extend `MAX_GROUND_DIST`?** Spec picks "fix Step 3" and leaves `MAX_GROUND_DIST = 2000m` alone. An alternative would be to remove or 10× the cap. Argument for: Step 2 then covers the cursor-near-horizon case directly, the synthetic-30m hack disappears for typical use, and the "anchor at sky height changes LB-pan plane" issue goes away. Argument against: at 20 km ground hits, the wheel step size becomes `0.10 · 20000 = 2 km/tick`, which is wild — and the cliff still exists at whatever the new cap is. The plan's choice (fix the fallback shape, leave the cap) is the smaller, more defensible move. But it's worth noting that *both* changes would compose cleanly; the plan doesn't preclude extending Step 2 later.

- **Clamping the cursor ray to the lower hemisphere** (mentioned as a possible follow-up) would address the "zoom went up" risk at the cost of breaking zoom-out symmetry: zoom-in/zoom-out along the same cursor ray is what makes the gesture reversible. User has explicitly chosen the pure form for this reason. The plan is right to defer this to a contingent follow-up.

## Things the plan got right

- The math is correct and the diagnosis ("Step 3 projects to screen centre, hence centre-anchored feel") matches the consumer code at `ExperimentalControls.js:785-789`.
- Reusing `this._raycaster.ray` rather than re-deriving the cursor ray is the right call — same NDC, same camera, no chance of drift.
- Scope discipline: doc-comment update + 3-line code change + one spec line + three tests. No gold-plating.
- Honest about residual risks: the "zoom went up" surprise is acknowledged, the `MAX_GROUND_DIST` cliff is flagged as out-of-scope rather than swept under the rug.
- The mirror-image assertion ("top-left vs top-right cursor → mirror-image fallback points") is a tight test idea — exactly the property the old fallback violated.

## Suggested actions before coding

1. **Add a non-trivial "Step 2 wins" regression test** (camera at oblique angle, cursor at viewport centre, expect `source === 'ground'`). Small but closes the gap the plan acknowledges.
2. **Fix the line-range citation** in the spec ("doc-comment lines 7-17" → 13-14, or just "the fallback-chain section of the doc-comment").
3. **Add one sentence to the spec on the LB-pan interaction** — specifically that the new fallback gives LB-pan a non-ground anchor plane on sky-miss gesture starts, which is parity-with-old-behaviour rather than a fix, and that a sibling change to clamp LB-pan's fallback to y=0 may want to land alongside if feel-test surfaces it.
4. **Document the "~1.3 m/tick upward at typical sky-miss" number** somewhere in the spec or as a code comment, so the feel-tester knows what magnitude to expect before declaring it acceptable.

Beyond those four nits, the plan is sound and the change is worth shipping as scoped.
