# 004 — Tilt-conditional wheel zoom: adversarial review

*Working draft 2026-05-11. Will iterate.*

Adversarial review of `claude/specs/001-tilt-conditional-zoom.md`. The plan is a ~10-line branch in `_applyWheelTick`; the math reuses the existing orbit step against a synthesised anchor along `cameraForward`. Overall: **the plan is sound and worth shipping as scoped.** Findings below are mostly correctness-of-claims confirmations plus a few small things to pin before coding.

Findings ordered by significance.

## Significant

- **The "tilt-preserving by construction" claim holds — verified.** `_applyWheelTick` does `camera.position.copy(...).add(offset)` only — pure translation, no rotation. The low-tilt branch synthesises `H = camPos + fwd*30` (using `camera.getWorldDirection`) and runs the same orbit math `pos' = H + (pos − H)*factor`. For zoom-in (factor 0.9), `pos' = pos + fwd*3`; for zoom-out (factor 1/0.9), `pos' = pos − fwd*3.33`. Neither touches `camera.quaternion`, so `getWorldDirection` returns the same vector on the next tick — the branch decision is stable for the duration of `_drainWheel`. Tilt is preserved across the burst. (`src/editor/lib/nav-experimental/ExperimentalControls.js:770-796`).

- **Vertical-drift math is right; the plan undercounts the looking-up extreme.** Per-tick Δy ≈ `3 * (-fwd.y) = 3 * sin(-tilt)`:
  - tilt = 0°: Δy = 0
  - tilt = +30° (boundary, looking down): Δy = −1.5 m/tick (downward)
  - tilt = −30° (looking up 30°): Δy = +1.5 m/tick (upward)
  - tilt = −45°: Δy = +2.12 m/tick (plan's number, correct)
  - tilt = −60°: Δy = +2.60 m/tick
  - tilt = −89° (clamp): Δy ≈ +3.0 m/tick

  Plan quantifies up to −45°. The clamp lets the user pitch to −89°, where a 10-tick burst lifts the camera ~30 m — and at street level (1.6 m) that's roof-of-a-10-storey-building height in one trackpad flick. Plan's risk paragraph (`001-tilt-conditional-zoom.md:156`) caps the example at −45°/15–20 m; worth extending to the actual clamp for honesty. Not a correctness issue, just numeric framing.
//** Accept. Extend the risk paragraph to cover the clamp range.

- **The high-tilt sky-miss residual is genuinely small but non-zero.** Plan claims "at high tilt the cursor mostly points at ground/scene". Quick check with FOV=60° (halfV=30°): at tilt = +35° (just above the cut), the top edge of the viewport (NDC.y=+1) points at world-y direction `sin(35° − 30°) = sin(5°) ≈ +0.087` — above horizon. At tilt = +45° the top edge points at `sin(15°)`. So Step 3 can still fire at high tilt for cursors in the top fraction of the viewport between roughly 30° and 60° camera tilt. Within that band, Step 3 returns a camera-forward (= downward-into-scene) point and the wheel-zoom is no longer cursor-anchored. The plan's "rare and acceptable" framing is right in spirit — the bug the user reported was at low tilt — but "rare" is overstated for the 30–60° tilt band with cursor near top of viewport. If the user feel-tests at tilt = 35° with cursor at the top, they may see the same inconsistency the original report described. Worth flagging as a known residual rather than dismissing.
//** Accept. Add a known-residual note in the plan under "High-tilt sky-miss case unchanged".

- **`decideLbMode` boundary convention matches the plan — verified.** `navMath.js:43-45` is `tiltDeg > TRUCK_PEDESTAL_CUTOFF_DEGREES ? 'pan-truck' : 'pan-pedestal'`. Plan uses the same comparator (`tiltDeg > TRUCK_PEDESTAL_CUTOFF_DEGREES`) for wheel-zoom. At exactly 30°: `decideLbMode` returns `pan-pedestal` (low-tilt mode); wheel-zoom enters the low-tilt branch (forward dolly). Consistent. The plan's test-case description at `001-tilt-conditional-zoom.md:128` reads slightly awkwardly ("inclusive at 30°, matching decideLbMode") — at 30° the *low-tilt* branch fires, which is *exclusive* from the >30° set; "low-tilt branch is inclusive at 30°" would read more cleanly. Wording nit.
//** Fix the wording.

- **`FALLBACK_FORWARD_DIST` migration is safe — verified.** `cursorAnchor.js:177` re-exports it via `_internals`. The existing `test/editor/lib/nav-experimental/cursorAnchor.test.js` doesn't reference `FALLBACK_FORWARD_DIST` directly (grepped — only `_internals.MAX_GROUND_DIST`-style uses appear elsewhere, none for this constant). Moving the constant to `constants.js` and re-importing it back into `cursorAnchor.js` keeps `_internals.FALLBACK_FORWARD_DIST` resolvable. No risk.

## Worth pinning before coding

- **`cursorAnchor.js` doc-comment header needs an update too.** Lines 7-17 list the three-step fallback chain as if cursor-anchoring is *always* the wheel-zoom behaviour. Post-change, Step 3 only fires for wheel-zoom at high tilt (and still fires unconditionally for LB-pan, which is a separate consumer). One line in the header noting that the wheel-zoom consumer now branches on tilt before reaching this function avoids a future maintainer assuming all three steps apply to every wheel tick. Plan mentions updating `001-phase-1-plan.md` and `001-phase-2-plan.md` but not the in-code doc comment.
//** Add to plan's code-changes section.

- **The proposed `computeWheelTickHit` helper is a slightly awkward abstraction.** Plan offers it as the test seam (`001-tilt-conditional-zoom.md:121-122`). The honest signature would be `(camera, cursorAnchor, lastWheelClient, sign) → {hit, factor}` — but `cursorAnchor.worldPointAt` does a raycast against scene mesh, which is exactly the side-effecting thing you want to keep out of a pure helper. The cleaner factoring is either:
  - **Pure tilt-only helper:** `computeLowTiltHit(camera) → {x, y, z}` returning the synthetic forward-anchor point. Lift only the low-tilt branch into `navMath.js`. Caller does the tilt check and chooses between `computeLowTiltHit` and `cursorAnchor.worldPointAt`. Test the math without mocking the raycaster.
  - **Or skip the helper entirely** and write an integration-style test with a stub camera + stub `cursorAnchor` whose `worldPointAt` is spied. The branch is 10 lines; the math is a 3-line dot product.

  Either is cleaner than the proposed helper. Lean toward the first — it matches the existing pattern in `navMath.js` of small pure helpers (`cameraTiltDegrees`, `decideLbMode`).
//** Go with the first option: pure `computeLowTiltWheelHit(camera) → Vector3` in `navMath.js`. Matches the small-pure-helper pattern; tests it directly without raycaster mocks.

- **`_zoomActionBar` parity sanity check — confirmed orthogonal.** ActionBar buttons call `_zoomActionBar`, which uses `camera.position.distanceTo(this.center) * zoomSpeed` as the step (per plan). It already doesn't anchor on the cursor at any tilt. Plan's "stays unchanged" is correct. At low tilt clicking ActionBar still gives a centre-of-scene anchor — different feel from wheel zoom's new low-tilt camera-Z dolly, but that's pre-existing and not the user's reported bug. No action.

- **Wheel-zoom mid-Shift+LB-drag interaction is benign.** A wheel event during a Shift+LB drag does not block the rotation latch — but `_applyWheelTick` only translates the camera, doesn't touch the orientation, and the latch stored `screenHit` and `tiltBlend` as world-space points at gesture start. The next `_shiftRotate` step reads `camera.position` (which has now moved) and orbits around the latched `center`. Since `center` is a fixed world point, post-translation the camera-to-center vector is different — the camera will be at a different orbit radius than before the wheel event. That's the existing Phase 2 latched-centre semantics (orbit radius is implicitly re-derived per frame from `camera.position`); the wheel zoom just changes the radius mid-gesture. Probably feels fine; no design call needed.

- **Phase 3 swoop integration is consistent with the existing skeleton.** `claude/specs/001-phase-3-skeleton.md:23` says "Phase 1's straight cursor-anchored dolly becomes the Phase-1-of-swoop branch" — Phase 3 already plans a multi-branch wheel-handler keyed on elevation/tilt. The tilt-conditional split adds a `tilt ≤ 30°` branch that Phase 3 will need to keep (or supersede); composes cleanly. Risk #3 in the plan (`001-tilt-conditional-zoom.md:158`) flags this correctly. No additional concern.

- **Decisions-log entry matches the plan.** `claude/decisions.md` 2026-05-11 entry matches: ">30° = cursor-anchored, ≤30° = camera-Z dolly, no cursor anchoring." Pointer to `001-tilt-conditional-zoom.md` is correct. ✓

## Alternatives not on the plan

- **Altitude floor / underground clamp.** At positive tilt approaching 30°, repeated zoom-in ticks drift the camera downward (−1.5 m/tick at the boundary). Over a 10-tick burst that's −15 m — if the camera started at street level (y=1.6), it ends up ~13 m underground. The plan's Risk #1 mentions a y-clamp as a contingent mitigation. Worth pre-emptively noting: a min-y clamp (e.g. y ≥ 0.5) is a one-line change and would prevent any below-ground states without changing felt behaviour above ground. Even if not implemented in this commit, worth a sentence under "Mitigation paths".

- **Project to horizontal plane at low tilt.** Plan explicitly rejects this (would overlap with W). Agreed — but worth noting that the differentiation argument cuts both ways: W gives horizontal-only at all speeds; wheel-zoom gives camera-Z-with-pitch. If feel-test surfaces "wheel-zoom drift is annoying and W is more useful at low tilt", projecting onto the horizontal plane is the obvious next move. Reversible decision; logged for completeness.

## Things the plan got right

- The diagnosis is clean: bug only manifests at low tilt (sky-miss from low-tilt cursor near top of viewport), and the 30° cut already exists in the codebase. Sidestepping the bug at its source is the right move once you accept "cursor-anchored zoom is a map-mode feature".
- Reusing the existing orbit math against a synthesised anchor (rather than writing a new code path) keeps the change tiny and side-effect-free. `factor` math and tilt-preservation arguments both compose for free.
- Honest about residuals: high-tilt sky-miss case unchanged (acknowledged), vertical drift at -45° quantified, Phase 3 integration flagged.
- Scope discipline: doesn't touch `cursorAnchor.worldPointAt` Step 3, doesn't touch the LB-pan elevated-plane behaviour, doesn't touch `_zoomActionBar`. Each of those is a separate decision with its own trade-offs; bundling them would muddy the change.
- The constant migration is clean: `FALLBACK_FORWARD_DIST` is a number, not behaviour; moving it to `constants.js` is overdue housekeeping anyway.

## Suggested actions before coding

1. **Extend the vertical-drift quantification in Risk #1** to cover the clamp range (−89° → +3 m/tick → ~30 m per 10-tick burst). Set expectations for the feel-tester at the looking-up extreme.
2. **Add a sentence about the 30–60° tilt band sky-miss residual** under "High-tilt sky-miss case unchanged" — at 35° tilt with cursor near top of viewport, the original inconsistency is still reachable. Not blocking, just honest framing.
3. **Reconsider the test seam.** Either extract just a pure `computeLowTiltHit(camera)` helper into `navMath.js` (clean), or skip the helper and write an integration test against `_applyWheelTick` with a stubbed `cursorAnchor` (also clean). The proposed `computeWheelTickHit` mixes a side-effecting raycast into what wants to be a pure helper.
4. **Update the `cursorAnchor.js` doc-comment header** (lines 7-17) alongside the constant move — note that the wheel-zoom consumer now branches on tilt before calling `worldPointAt`.
5. **Minor wording fix in the boundary test description** (`001-tilt-conditional-zoom.md:128`): "low-tilt branch fires (inclusive at 30°)" reads more naturally than "matching decideLbMode" (which is true but indirect).

Beyond those, the plan is sound and the change is worth shipping as scoped. The math is right, the scope is appropriate, and the decisions-log entry tells the story for future maintainers.
