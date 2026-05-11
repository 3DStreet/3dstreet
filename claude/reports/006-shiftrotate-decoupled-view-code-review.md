# 006 — Shift+LB decoupled-view sub-plan: code-vs-plan adversarial review

*Working draft 2026-05-11.*

Review of the (uncommitted, working-tree) implementation of
`claude/specs/001-shiftrotate-decoupled-view.md`. Changed files:
`src/editor/lib/nav-experimental/navMath.js` (new `shiftRotateStep`),
`src/editor/lib/nav-experimental/ExperimentalControls.js` (rewritten
`_shiftRotate` wrapper + scratch/constant cleanup),
`test/editor/lib/nav-experimental/navMath.test.js` (new `describe` block,
6 cases), `claude/specs/001-phase-2-plan.md` (one-paragraph architecture
note), `claude/decisions.md` (new top entry).

Headline: the implementation is faithful to the plan. The dual-spherical
math is correct, sign conventions resolve to museum-feel, the wrapper
preserves the six required steps, the tilt-clamp gating uses
`actualDPhi` consistently across view and position, and the cleanup of
`_spherical` / `MIN_SPHERICAL_PHI` / `MAX_SPHERICAL_PHI` /
`MIN_TILT_DEGREES` / `MAX_TILT_DEGREES` imports is complete.

The only first-tier concern is a small redundancy in the wrapper's
`this.center.copy(center)` semantics that the in-code comment
acknowledges. Findings below, ordered by significance.

## Findings

- **Test 4 ("yaw delta with camera NOT aimed at centre") only weakly checks the museum property.** The test asserts the angle between the new view direction and the new direction-to-centre is 30°. That assertion is satisfied trivially because *the math preserves it by construction* (both vectors rotate by the same `dTheta` around +Y). What it does *not* check is the bug-relevant property: that the new view direction was rotated by the *same delta* as the position (i.e. that the view direction wasn't yanked toward centre). A mutation that put `camera.lookAt(centre)` back would still pass the 30° check after 90° yaw — because position is now on the +Z axis and the centre is on -Z from there, so view-after-`lookAt(centre)` = (0,0,-1), but the test compares angle to `dirToCentre = (0,0,-1)`, giving angle = 0°, not 30°. Wait — re-tracing: with the lookAt-at-centre bug, after 90° yaw position = (0,0,10), `lookAt(0,0,0)` gives viewDir = (0,0,-1), `dirToCentre` from (0,0,10) is (0,0,-1), `angle = 0°`. Test would fail. **OK — the test does catch the bug.** Withdraw. (Leaving the trace here so the next reviewer doesn't re-derive it.) `test/editor/lib/nav-experimental/navMath.test.js:454`.

- **Test 6 ("rotate-in-place 45° yaw") does not verify the spec's stronger claim that `pos === camPos` exactly (not just within 1e-6).** The plan said position is unchanged in the rotate-in-place case. The test asserts `step.pos.distanceTo(camPos) < 1e-6`. The implementation actually returns `new THREE.Vector3(camPos.x, camPos.y, camPos.z)` — i.e. an exact copy, distance == 0. The test is correct but loose. Not a bug, just a missed opportunity to lock in the contract. Optional tightening: `expect(step.pos.x).toBe(camPos.x)` etc. `navMath.js:262-264`, `navMath.test.js:498`.
//** Accept. Tightening to per-component equality.

- **The plan's `this.center.copy(center)` claim for the rotate-in-place case has a sub-mm wrinkle that the wrapper comment acknowledges but worth flagging.** Pre-fix, `_shiftRotate` did `this.center.copy(camera.position)` in the rotate-in-place branch (centre coincides with camera, but only to within 1e-6 m by the `lengthSq < 1e-6` test — which is squared metres, so the linear threshold is 1mm). Post-fix, `this.center.copy(center)` is used unconditionally — i.e. `this.center` is set to the latched rotation centre rather than the live camera position. Difference is sub-mm. `_zoomActionBar` uses `camera.position.distanceTo(this.center)` — sub-mm noise in the distance is negligible (it's then multiplied by `zoomSpeed` and added to a `Math.max(this.minSpeedFactor, distance)`). **Behaviour identical at user-visible level.** Plan-review 005 flagged this; the wrapper comment at `ExperimentalControls.js:1088-1092` documents it. Acceptable; no change needed.

- **Sign convention: museum-feel verified by numerical trace.** Setup: camPos=(10,0,0), viewDir=(−cos30°,0,−sin30°)≈(−0.866,0,−0.5), centre=origin, dxPx = (π/2)/SPEED (90° yaw to the right of the user, in the test's convention). Trace through `shiftRotateStep`:
  - `offsetPos=(10,0,0)`; sphPos: r=10, theta=atan2(10,0)=π/2, phi=π/2.
  - `offsetView=(0.866,0,0.5)`; sphView: theta=atan2(0.866,0.5)=π/3, phi=π/2.
  - `dTheta = -dxPx*speed = -π/2`.
  - sphPos.theta becomes 0; `newOffsetPos = (0, 0, 10)` → `pos = (0, 0, 10)`.
  - sphView.theta becomes π/3 − π/2 = −π/6; `newOffsetView = (sin(−π/6), 0, cos(−π/6)) = (−0.5, 0, 0.866)`.
  - `newViewDir = -newOffsetView = (0.5, 0, -0.866)`.
  - `dirToCentre = normalize(centre − pos) = (0, 0, -1)`.
  - `dot(newViewDir, dirToCentre) = 0.866` → `arccos = 30°`. ✓
  Museum property holds at the new position. Note: the plan's §"Concrete trace" stated the post-yaw position as `(0, 0, −10)` — the impl produces `(0, 0, +10)`. This is a yaw-handedness/sign convention difference between plan prose and impl; the property test only checks distance + angles, so it's invariant. Worth a one-line note in the spec to avoid confusion when the next reader compares the trace.

- **Zero-deltas no-snap regression check is mathematically airtight.** `wantDPhi = 0`, `dTheta = 0` → `actualDPhi = 0` (the `if` branches don't fire because `newPhi == sphView.phi`). `sphView.theta/phi` unchanged → `setFromSpherical` of a re-decomposed unit vector round-trips to within ~1e-15. Same applies to `sphPos` — `setFromSpherical(setFromVector3(v))` round-trips `v` exactly when v is axis-aligned (atan2 returns exact π/2 etc.) and to ~1e-15 otherwise. With `< 1e-6` test thresholds, the assertions are safe. **No position OR orientation jump on gesture-start.** `navMath.js:233-272`, tests at `navMath.test.js:373-407`.

- **Tilt-clamp coherence: `actualDPhi` applied to both view and position, as the plan required.** `navMath.js:244-245` (`sphView.theta += dTheta; sphView.phi += actualDPhi;`) and `navMath.js:251-253` (`sphPos.theta += dTheta; sphPos.phi += actualDPhi;`). Both use the gated `actualDPhi`, not the raw `wantDPhi`. ✓ Clamp test verified by trace: viewDir=(−1,0,0), dyPx=−1000, speed=0.0035. wantDPhi = +3.5; sphView.phi starts at π/2 ≈ 1.5708; newPhi = 5.07 > MAX (≈3.124). actualDPhi = 3.124 − π/2 ≈ 1.553. New phi = π/2 + 1.553 ≈ 3.124 (= MAX). `setFromSpherical` at phi≈π gives offsetView ≈ (0, −1, 0); newViewDir ≈ (0, +1, 0); test asserts `newDir.y > 0.999`. ✓ `navMath.test.js:467-485`.

- **Rotate-in-place case subsumed automatically — verified.** When `offsetPos.lengthSq() < 1e-6`, the `if (hasPositionOrbit)` branch (`navMath.js:250`) is skipped; `pos = camPos.clone()` (line 263); view-direction spherical math runs as normal; `lookTarget = pos − newOffsetView` aims along the rotated view direction with the camera in-place. No special branch, no `1e-6` weirdness propagating into the view math. ✓ Test 6 at `navMath.test.js:489-509` covers this case.

- **Imports and constant cleanup are complete.** `MIN_TILT_DEGREES` / `MAX_TILT_DEGREES` removed from `ExperimentalControls.js` imports (`git diff` shows the import-list edit at lines 30-49). `MIN_SPHERICAL_PHI` / `MAX_SPHERICAL_PHI` const declarations removed from the file (replaced by a comment at `ExperimentalControls.js:55-59` pointing to navMath). `this._spherical` instance field removed (`ExperimentalControls.js:103` shows the removal). `_tmpV3a` and `_tmpV3b` are no longer used by `_shiftRotate` (the wrapper uses only `_tmpV3c` for the world-direction read) but both are still consumed elsewhere in the class, so they stay. `_tmpV3c` is read at `_shiftRotate:1075` and reused inside `shiftRotateStep`, which creates fresh `THREE.Vector3` and `THREE.Spherical` allocations. No leftover references. ✓ `navMath.js:22-23` re-derives `MIN_SPHERICAL_PHI` / `MAX_SPHERICAL_PHI` from `MIN_TILT_DEGREES` / `MAX_TILT_DEGREES`. ✓

- **`_shiftRotate` wrapper: all six steps present and ordered correctly.** `ExperimentalControls.js:1066-1096`:
  1. Read `centre` from latch — line 1067.
  2. Get camera view direction — line 1075 (`camera.getWorldDirection(fwd)`).
  3. Call `shiftRotateStep` with `(camPos, viewDir, centre, dxPx, dyPx, speed)` — lines 1076-1084.
  4. Apply result: `camera.position.copy(pos)` + `camera.lookAt(lookTarget)` — lines 1086-1087.
  5. Update `this.center.copy(center)` — line 1093.
  6. `camera.updateMatrixWorld()` + `dispatchEvent(this._changeEvent)` — lines 1094-1095.
  ✓ All present, correct order.

- **Allocation cost matches plan's stance ("negligible, hoist if profiling shows it").** `shiftRotateStep` allocates per call: 1 × `offsetPos` Vector3, 1 × `offsetView` Vector3, 1 × `sphView` Spherical, 1 × `newOffsetView` Vector3, 0 or 1 × `sphPos` Spherical, 0 or 1 × `newOffsetPos` Vector3, 1 × `pos` Vector3, 1 × `lookTarget` Vector3. ~6–8 allocations per move event. Move events fire at mouse-move rate; allocations are nursery-local; the plan explicitly accepted this. Impl did not over-engineer (no scratch caching); did not under-engineer (no extra reduce/inline). ✓ `navMath.js:212-274`.

- **Spec-drift items are minor.** `claude/specs/001-phase-2-plan.md:106-108` adds the one-paragraph architecture note as the plan required. `claude/decisions.md:5-13` adds the new top entry as specified. Both describe the implementation accurately. The plan's `001-shiftrotate-decoupled-view.md:55-63` "concrete trace" produces `(0, 0, −10)` for the 90° yaw case; the impl's actual sign convention gives `(0, 0, +10)`. The test only checks distance + angular relationships, so it's invariant — but the spec prose-trace and impl don't match in handedness. Suggest a one-line spec edit to either the §"Concrete trace" example or a parenthetical "(sign convention: dxPx > 0 yaws the orbit in the direction the impl gives — handedness depends on the spherical convention)".
//** Accept. Fix the trace in the spec to match the impl's sign convention.

- **No pre-existing regressions introduced in adjacent methods.** Walked `_zoomActionBar` (line 1101), `_applyWheelTick` (grepped, lower in file, unchanged shape), `_lbPedestalMove` / `_lbTruckMove` / `_drainWASD` — none read `this._spherical` or the removed `MIN/MAX_SPHERICAL_PHI` constants. The wrapper's removal of those is genuinely scoped to `_shiftRotate`. ✓

## Tilt-clamp at non-aligned starting poses — verified, no issue

A worry from plan-review 005 was that position-offset and view-direction can start at very different phi values (e.g. camera 100m above scene, looking down). Traced: camPos=(10, 100, 0), centre=origin, viewDir=(−0.1, −0.99, 0). sphPos.phi ≈ 0.0998; sphView.phi ≈ 0.1413. Apply dyPx=−1000 (tilt up): wantDPhi=+3.5 → newPhi(view)=3.6413 → clamps. actualDPhi = 3.124 − 0.1413 ≈ 2.983. sphPos.phi becomes 0.0998 + 2.983 = 3.0825 — still within [MIN, MAX]. Position doesn't desync. The gated `actualDPhi` is small enough relative to the spherical range that position stays in-bounds for any normal pose. ✓ (Pathological poses where position-phi starts at exactly MIN/MAX could in theory drive it out via the view-clamp's gated dPhi, but only by a few mrad; THREE.Spherical handles out-of-range phi fine — `setFromSpherical` doesn't NaN. Not a feel-test concern.)

## Things the implementation got right

- The pure-helper signature matches plan-review 005's recommendation to take `(camPos, viewDir, centre, dxPx, dyPx, speed)` rather than a THREE camera, decoupling the helper from `THREE.Camera`-shape.
- `MIN_SPHERICAL_PHI` / `MAX_SPHERICAL_PHI` are re-derived inside `navMath.js` from `MIN_TILT_DEGREES` / `MAX_TILT_DEGREES`, with a clear comment about the mapping (`navMath.js:19-23`). Single source of truth preserved.
- The wrapper-method comment block (`ExperimentalControls.js:1062-1066`) and the helper-method doc block (`navMath.js:174-204`) both reference `001-shiftrotate-decoupled-view.md` and explain the museum-feel framing. Future readers will find the design rationale.
- The fix sticks to the plan's scope: only `_shiftRotate` and its dependencies changed. No incidental refactors of `_lbTruckMove`, `_applyWheelTick`, etc. that would have widened the diff and risked regression.
- The doc-comment at `navMath.js:226-228` explicitly enumerates the phi → tilt mapping for three reference cases (horizontal, looking-down-89°, looking-up-89°), which is the kind of inline math comment that prevents future "wait, which sign is which?" confusion.

## Suggested actions before live feel-test

1. **(Optional spec polish.)** Reconcile the plan's `(0, 0, −10)` trace at `001-shiftrotate-decoupled-view.md:60` with the impl's `(0, 0, +10)` actual behaviour. Either edit the spec's example to match, or note the sign-convention dependence.
2. **(Optional test tightening.)** In test 6 (rotate-in-place), change `expect(step.pos.distanceTo(camPos)).toBeLessThan(1e-6)` to a strict equality check on each component, locking in the "pos is an exact copy of camPos" contract. Low value, low cost.
3. **(Optional, blocked on feel-test.)** Plan-review 005's "off-centre orbit feel" concern: smoke-test the scenario where the user stands 30m off the side of a small diorama at street level and drags a slow 180° yaw. Verify the resulting camera pose feels intentional rather than disorienting. If the museum-feel feels *too* hands-off (user wanted some focus-tracking), the fallback is plan-review 005's hybrid suggestion.

No blocking issues; implementation is ready for live feel-test.
