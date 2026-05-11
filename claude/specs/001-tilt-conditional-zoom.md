# 001 — Tilt-conditional wheel zoom

*Working draft 2026-05-11. Will iterate.*

Sub-plan within the navigation prototype work. Splits wheel-zoom behaviour on the existing 30° tilt boundary: cursor-anchored at high tilt (map mode), camera-forward dolly at low tilt (FPS mode). Replaces the earlier "fix `cursorAnchor.worldPointAt` Step 3" approach (`001-cursor-anchor-fallback.md`), which papered over a fallback that only mattered at low tilt anyway.

## Why we're doing this

**User-reported behaviour (2026-05-11):** "Wheel zoom in the top-left corner feels inconsistent — sometimes the point under the cursor is the fixed point, sometimes it's the screen centre."

**Diagnosis traced through `cursorAnchor.js`:** the cursor's ray hits scene mesh or ground when it's pointing into the scene; misses both and falls back to "30m forward along camera direction" (≈ screen centre) when it's pointing into sky. At low tilt with the cursor near the top of the viewport, the ray is often above the horizon and the fallback fires — switching the anchor from "under cursor" to "near screen centre" without warning.

**Why tilt-conditional is the right cut:**

- The bug *only* manifests at low tilt. At high tilt (looking down), the cursor's ray almost always hits the scene or ground — the fallback rarely fires.
- The 30° hard-cut is already the boundary between Phase 2's two camera-control modes: at >30° LB+drag is truck/dolly (map-like), at ≤30° it's truck/pedestal (FPS-like). Wheel-zoom semantics changing across the same boundary aligns with the existing mental model.
- **Google Maps comparison applies only at high tilt.** Cursor-anchored zoom was adopted to match Google Maps' UX. Google Maps has no comparable street-level mode — the cursor-anchored zoom is a map-view feature. At ≤30° we're not in map view, so matching Google Maps doesn't apply.
- **Forward dolly at low tilt has no competing affordance.** "W" is already the WASD command for forward movement at low tilt (horizontal-plane motion). Wheel zoom adds a camera-Z dolly (along the actual view direction) — distinct from W in that it follows the camera's pitch as well, but not redundant.
- **Phase 3 swoop integration is cleaner.** The swoop is conceptually high-tilt-only (transitioning from map-view toward ground). With the tilt-conditional split, swoop applies to the >30° branch; the ≤30° branch stays as plain dolly across all phases.

## Design

`_applyWheelTick` in `ExperimentalControls.js` branches on `cameraTiltDegrees`:

- **Tilt > `TRUCK_PEDESTAL_CUTOFF_DEGREES` (= 30°):** unchanged Phase 1 cursor-anchored zoom. Cursor's `worldPointAt` is the anchor; existing math.
- **Tilt ≤ 30°:** synthesise an anchor at `camera.position + cameraForward * FALLBACK_FORWARD_DIST` (= 30m) and run the same orbit math. Result: camera dollies along its view direction by 10% of the 30m reference per tick (= 3m per zoom-in tick; ~3.3m per zoom-out tick — the existing multiplicative reciprocal asymmetry).

The low-tilt branch is mathematically identical to the current Step 3 fallback in `worldPointAt`, just always invoked at low tilt instead of only on sky-miss. So no new math; the change is one tilt-check inserted at the top of `_applyWheelTick`.

### Forward direction at low tilt: plain `cameraForward`, not horizontal projection

`camera.getWorldDirection()` returns the camera's `-Z` direction in world space, which follows the camera's tilt:

- At 0° tilt (horizontal): forward is purely horizontal.
- At -10° tilt (looking up 10°): forward is mostly horizontal, slightly upward.
- At -45° (looking up 45°): forward is up-and-forward.
- At +29° (looking down 29° — just under the cut): forward is mostly horizontal, slightly downward.

Using plain `cameraForward` means wheel zoom moves you in the direction you're looking. At +29° this means the camera dips slightly down each zoom-in tick; at -45° it rises slightly. Acceptable because:

- The vertical drift is bounded by the tilt: at 0° none, at ±30° at most `sin(30°) ≈ 0.5 × 3m = 1.5m` per tick. At -45° (looking up) it's `sin(45°) × 3m ≈ 2.1m`. These are user-controllable via WASD or Shift+LB tilt.
- Horizontal projection of `cameraForward` is what W already does (per Phase 1 spec: "WASD horizontal motion in the camera-yaw-projected horizontal plane"). Having wheel zoom do exactly the same thing would make the two affordances overlap; following the camera's pitch differentiates them.

### Boundary behaviour

Wheel zoom is tilt-preserving by construction — within a single wheel-zoom gesture, the camera tilt doesn't change. So the tilt-conditional mode is fixed for the duration of any wheel-zoom drag/scroll. The mode only changes *between* separate wheel gestures, if the user has used Shift+LB to re-tilt in between. No mid-gesture switching to worry about.

The gate uses `tiltDeg > TRUCK_PEDESTAL_CUTOFF_DEGREES`. At exactly 30° tilt: the low-tilt branch fires (inclusive at 30°), matching `decideLbMode`'s convention (which uses the same comparator).

### High-tilt sky-miss case unchanged

At high tilt, `_applyWheelTick` still calls `cursorAnchor.worldPointAt`, which can still hit Step 3 (camera-forward fallback) on a sky-miss. At high tilt this is rare (cursor mostly points at ground/scene), and when it does fire, camera-forward points downward — zoom-in moves the camera toward the scene, which is reasonable. Not worth a separate code path; the earlier cursor-anchor-fallback plan is superseded for this reason.

**Known residual (per `claude/reports/004-tilt-conditional-zoom-review.md` finding 3):** the high-tilt sky-miss case isn't *as* rare as "almost never". For FOV=60° at tilt ≈ 30°–60° with the cursor near the top of the viewport, the ray can still point above the horizon and Step 3 fires (giving non-cursor-anchored behaviour). The user's reported bug at low tilt is solved; this residual band remains. Acceptable for the prototype — fixable later if feel-test surfaces it.

### What `_zoomActionBar` does

ActionBar zoom-in/out is a separate code path. It already uses `camera.position.distanceTo(this.center) * zoomSpeed` as its step — not cursor-anchored. Stays unchanged.

## Code changes

### `src/editor/lib/nav-experimental/constants.js`

Move `FALLBACK_FORWARD_DIST = 30` from `cursorAnchor.js` (where it's currently a module-private const) to `constants.js`, so both `cursorAnchor.js` and `ExperimentalControls.js` can import it from one place. Constant value unchanged.

Optionally also move `MAX_GROUND_DIST` for consistency — it lives in `cursorAnchor.js` for the same reason. Skip if the diff gets noisy; the wheel-zoom branch doesn't need it.

### `src/editor/lib/nav-experimental/cursorAnchor.js`

Replace the local `FALLBACK_FORWARD_DIST` constant with an import from `constants.js`. The `_internals` test seam continues to re-export it. No behavioural change.

Doc-comment header (lines 7–17) updated to note that the wheel-zoom consumer in `ExperimentalControls._applyWheelTick` now branches on the 30° tilt cut *before* calling `worldPointAt` — so Step 3 of the fallback chain only fires for wheel zoom at high tilt. (LB-pan still calls `worldPointAt` unconditionally; the chain applies to it as before.)

### `src/editor/lib/nav-experimental/navMath.js`

Add a pure helper that synthesises the low-tilt wheel-zoom anchor. Matches the existing small-helper pattern (`cameraTiltDegrees`, `decideLbMode`):

```js
// Synthetic wheel-zoom anchor for the low-tilt branch: a point
// FALLBACK_FORWARD_DIST metres along the camera's view direction.
// Reused as the "hit point" in the existing orbit-step math so wheel
// zoom at low tilt gives a 3m-per-tick camera-Z dolly. Pure.
export function computeLowTiltWheelHit(camera) {
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  return new THREE.Vector3()
    .copy(camera.position)
    .addScaledVector(fwd, FALLBACK_FORWARD_DIST);
}
```

Imports `FALLBACK_FORWARD_DIST` from `constants.js`.

### `src/editor/lib/nav-experimental/ExperimentalControls.js`

`_applyWheelTick` — add tilt branch at the top:

```js
_applyWheelTick(sign) {
  const camera = this._camera;
  const tiltDeg = cameraTiltDegrees(camera);

  let hit;
  if (tiltDeg > TRUCK_PEDESTAL_CUTOFF_DEGREES) {
    // High tilt (map mode): cursor-anchored zoom. Existing Phase 1 behaviour.
    const x = this._lastWheelClientX;
    const y = this._lastWheelClientY;
    if (x == null || y == null) return;
    hit = this._cursorAnchor.worldPointAt(x, y);
  } else {
    // Low tilt (FPS mode): plain camera-Z dolly. No cursor anchoring.
    // Synthesise an anchor at FALLBACK_FORWARD_DIST along camera-forward
    // so the existing orbit math gives a 3m-per-tick forward step.
    hit = computeLowTiltWheelHit(camera);
  }

  let factor;
  if (sign < 0) factor = 1 - ZOOM_PER_WHEEL_TICK;
  else factor = 1 / (1 - ZOOM_PER_WHEEL_TICK);

  // ... existing orbit math (unchanged) ...
}
```

Imports added:
- `cameraTiltDegrees` and `computeLowTiltWheelHit` from `navMath.js`.
- `TRUCK_PEDESTAL_CUTOFF_DEGREES` from `constants.js`.

No new instance state.

### No other files touched

`cursorAnchor.worldPointAt`'s Step 3 fallback is untouched — it still exists as the camera-forward fallback, but it only fires at high tilt now (where it's adequate). The earlier sub-plan that proposed changing Step 3 to a cursor-ray-direction fallback is superseded; that work is preserved in `claude/specs/001-cursor-anchor-fallback.md` (marked superseded) and `claude/reports/003-cursor-anchor-fallback-review.md`.

The Shift+LB rotation-centre raycast at `001-phase-1-plan.md:44` is a separate code path with its own fallback rules — not touched.

## Test changes

### `test/editor/lib/nav-experimental/navMath.test.js`

Add unit tests for `computeLowTiltWheelHit`. The pure helper is small but covers the load-bearing math; a few targeted tests are enough:

- **Horizontal camera.** Camera at (0, 1.6, 10) looking toward origin. Expect returned hit ≈ `(0, 1.6, 10) + (0, 0, -1) * 30 = (0, 1.6, -20)`.
- **Camera pitched up 45° (looking up).** Expect returned hit's y > camera.y (drift upward).
- **Camera pitched down 45° (looking down).** Expect returned hit's y < camera.y.
- **Vertical drift quantification at street level.** Camera at y=1.6 with tilt = -89°; expect `(hit − camera).y ≈ 30 * sin(89°) ≈ 30m` (the worst case in the Risks section).

No need to test the branch dispatch in `_applyWheelTick` itself — that's a 2-line if/else; the math under each branch is independently tested (`computeLowTiltWheelHit` here; cursor-anchored math is unchanged from Phase 1).

### `test/editor/lib/nav-experimental/cursorAnchor.test.js`

`FALLBACK_FORWARD_DIST` moves to `constants.js`. Existing tests reference it via `_internals` (in `cursorAnchor.js`), which continues to re-export the (now-imported) value. Verify the existing test suite passes unchanged.

## Spec doc updates

### `claude/specs/001-phase-1-plan.md`

§"Wheel → exponential cursor-anchored dolly". Add a sub-section or leading note clarifying that the cursor-anchored behaviour applies at tilt > 30° only. At tilt ≤ 30°, wheel zoom is a plain camera-Z dolly (3m forward per tick, multiplicative).

Item 3 of the no-hit fallback chain ("Else use a point 30m forward along the camera's view direction") stays as written — that's the fallback when `worldPointAt` is called and misses; it still applies at high tilt. No edit needed.

### `claude/specs/001-cursor-anchor-fallback.md` and `claude/reports/003-cursor-anchor-fallback-review.md`

Already marked superseded in the plan's header line. No further updates needed.

### `claude/specs/001-phase-2-plan.md`

Add one line under §"Wheel, WASD, Plan View — unchanged" noting the tilt-conditional split:

> One micro-tweak (post-implementation 2026-05-11, per `001-tilt-conditional-zoom.md`): wheel zoom now branches on the 30° tilt cut. >30° = cursor-anchored (unchanged). ≤30° = plain camera-Z dolly. Sidesteps the "cursor over sky → screen-centre-feeling zoom" inconsistency at low tilt.

## Risks

- **Forward dolly at low tilt with non-zero pitch lets the camera drift up/down.** Per-tick vertical drift is `3m * sin(-tilt)`:
  - tilt = 0° → 0
  - tilt = +30° (boundary, looking down) → −1.5m/tick downward
  - tilt = −30° (looking up 30°) → +1.5m/tick upward
  - tilt = −45° → ~+2.1m/tick
  - tilt = −60° → ~+2.6m/tick
  - tilt = −89° (clamp) → ~+3m/tick

  At the looking-up extreme a 10-tick trackpad burst lifts the camera ~30m — roof-of-a-10-storey-building height from street level (1.6m). At the +30° boundary, the equivalent burst sinks the camera ~15m. Mitigation paths if feel-test surfaces this: (a) project forward onto horizontal plane (matches W's behaviour, but removes the differentiation); (b) clamp the camera's y after each tick to a sensible floor (e.g. y ≥ 0.5 — prevents below-ground states without changing felt behaviour above ground; one-line change).
- **Discovering the boundary.** Users may not realise wheel-zoom feel changes at the 30° tilt cut. Mitigation: the toolbar indicator (Phase 2's visual indicator for the same 30° cut) already exists; it covers both LB+drag and wheel-zoom semantics.
- **Phase 3 swoop integration.** The swoop is high-tilt-only by current Phase 3 design — but Phase 3 isn't fully specced yet. If Phase 3 turns out to want a "transition out of map mode" that's actually tilt-conditional itself, this design composes cleanly. If it wants something else, may need revisit. Low risk; logged.

## Out of scope

- Touching `cursorAnchor.worldPointAt`. The earlier sub-plan to change Step 3's fallback shape is superseded.
- Horizontal projection at low tilt (already differentiated from W; see "Forward direction at low tilt" above).
- ActionBar zoom-in/out (`_zoomActionBar`) — separate code path, stays unchanged.
- The `MAX_GROUND_DIST = 2000m` step-size cliff at high tilt — out of scope; out-of-range ground hits at high tilt fall back to Step 3 (camera-forward), giving 3m/tick. Inconsistent with the 200m/tick step right before the cliff, but not the user's reported bug.

## Migration plan

1. Move `FALLBACK_FORWARD_DIST` (and optionally `MAX_GROUND_DIST`) from `cursorAnchor.js` to `constants.js`.
2. Add tilt branch in `_applyWheelTick`.
3. Add tests for the tilt branches.
4. Update spec docs.
5. One commit covering all of the above.
6. Hand to user for live feel-test.
