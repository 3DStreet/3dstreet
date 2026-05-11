# 001 — Cursor-anchor fallback: project along cursor ray, not camera forward

*Working draft 2026-05-11. **Superseded 2026-05-11** by `001-tilt-conditional-zoom.md` — the user's "make wheel zoom tilt-conditional" approach sidesteps the bug at its source rather than fixing Step 3's fallback shape. This file and its adversarial review (`claude/reports/003-cursor-anchor-fallback-review.md`) preserved as the design trail. Plan body below is unchanged from the draft.*

Sub-plan within the navigation prototype work. Changes `cursorAnchor.worldPointAt`'s no-hit fallback (Step 3) so it preserves the cursor's direction instead of snapping to the camera's forward direction. Caller-visible effect: wheel zoom no longer feels inconsistent in corners — cursor-direction always controls zoom direction, even when the cursor's ray misses scene and ground.

## Why we're doing this

**User-reported behaviour (2026-05-11):** "Sometimes wheel zoom anchors on the point under the cursor; sometimes it anchors on what feels like the screen centre. Inconsistent, especially in the top-left corner."

**Diagnosis:** `cursorAnchor.js:97–149` (`worldPointAt`) has a three-step fallback chain:

1. Scene-mesh raycast.
2. y=0 ground-plane intersection (forward of camera, within `MAX_GROUND_DIST = 2000m`).
3. Fallback: a fixed point at `FALLBACK_FORWARD_DIST = 30m` along the camera's *forward* direction.

Step 3 is the source of the asymmetry. When the cursor's ray misses both scene and ground (cursor pointing above horizon at low-tilt camera; cursor pointing past 2km in shallow grazing; cursor pointing at sky on an unbounded `street-geo` scene), the anchor snaps from "under the cursor" to "30m forward of camera". 30m forward projects near the *screen centre*, not under the cursor — so zoom-in/out behaves as if centre-anchored. Cursor in the top-left corner is the most exposed location because its ray most often points above the horizon at any given camera tilt.

## Design

Replace Step 3's `camera.forward * FALLBACK_FORWARD_DIST` with a point at `FALLBACK_FORWARD_DIST` along the *cursor's* ray:

```js
// Step 3 — current:
const fwd = new THREE.Vector3();
camera.getWorldDirection(fwd);
const fp = new THREE.Vector3()
  .copy(camera.position)
  .addScaledVector(fwd, FALLBACK_FORWARD_DIST);
```

```js
// Step 3 — proposed:
const fp = new THREE.Vector3()
  .copy(this._raycaster.ray.origin)
  .addScaledVector(this._raycaster.ray.direction, FALLBACK_FORWARD_DIST);
```

The raycaster is already configured for the cursor via `setFromCamera(this._ndc, camera)` at line 104, so `this._raycaster.ray.origin` and `.direction` describe the cursor's ray in world space. The new Step 3 picks a synthetic point along that ray at the same depth the old fallback used.

### Why this fixes the asymmetry

Wheel-zoom anchor math (in `_applyWheelTick` at `ExperimentalControls.js:790–800`): given an anchor point `H`, the camera position moves to `H + (camPos − H) * factor`. The "world point under cursor stays under cursor" property holds whenever `H` lies on the cursor's ray, because translating the camera along a ray preserves the screen projection of any point on that ray.

- Current Step 3: `H = camPos + camForward * 30m`. `H` is on the camera-forward ray, NOT the cursor's ray. The zoom anchor projects near screen centre, not under the cursor.
- Proposed Step 3: `H = camPos + cursorRayDir * 30m`. `H` is on the cursor's ray. The zoom appears cursor-anchored — the cursor still points "at" the (now synthetic, sky-located) anchor before and after the zoom.

User-visible: zoom direction tracks cursor direction in every case, not just when there's geometry under the cursor.

### Edge cases

- **Cursor ray points behind the camera.** Theoretically impossible for a perspective camera with NDC in [-1, 1] — the ray always points forward through the screen. Defensive guard not needed.

- **Cursor ray near-parallel to the world horizontal plane.** Step 2 already rejects via `dist <= MAX_GROUND_DIST` when the ground hit is too far. Step 3 fires; the new fallback places `H` at 30m along the (nearly-horizontal) cursor ray. Zoom-in moves the camera slightly forward + slightly to the side along the cursor's horizontal direction — feels right.

- **Cursor ray points upward (above horizon) into open sky.** This is the case the user is hitting. New Step 3 places `H` at 30m up-and-forward along the cursor ray. Zoom-in moves the camera 3m up-and-forward (toward the cursor's direction). **Quantified expectation for feel-test:** camera at street level (y=1.6) looking horizontally, cursor at NDC (−0.9, +0.9) (top-left corner), FOV 60° — the cursor ray's y-component is ~0.43. Per-tick vertical motion = `ZOOM_PER_WHEEL_TICK · 30m · 0.43` ≈ **1.3m upward per tick**. A 10-tick burst lifts the camera ~10–15m. That's "first-floor-window height" if started at street level; still well within any realistic scene's vertical extent, but the user should expect it. If feel-test rates this as worse-than-status-quo, mitigation is to clamp the cursor ray to the lower hemisphere (only allow zoom toward ground/scene), or revert.

- **Very shallow grazing rays where Step 2 *almost* succeeds.** If the ground hit is at 1999m, Step 2 fires (current behaviour preserved). At 2001m, Step 3 fires; the new fallback places `H` at 30m along the same near-horizontal ray. The transition from cursor-anchored to (still-cursor-anchored, just at a synthetic 30m point) is now seamless rather than snapping to camera-forward.

### Choice of `FALLBACK_FORWARD_DIST = 30m`

Kept at 30m. The constant controls the *step size* of each wheel tick when the fallback fires: each zoom-in tick moves the camera by `ZOOM_PER_WHEEL_TICK * 30m = 3m`. For scenes where the fallback is the typical anchor (unbounded `street-geo`, looking at sky), 3m/tick is consistent with the rest of the codebase. Tuning is out of scope for this change.

## Code changes

### `src/editor/lib/nav-experimental/cursorAnchor.js`

Step 3 rewrite as above. ~3 lines changed.

Doc-comment header (lines 7–17) updated to reflect the new fallback semantics: "Step 3 falls back to a point along the cursor's ray (not the camera's forward direction)".

### No other files touched

`_applyWheelTick` in `ExperimentalControls.js` consumes the anchor opaquely — no change. LB-pan uses `worldPointAt` for the gesture-start anchor (Phase 1 §"Hit-anchored model"); the fallback affects that path too. On sky-miss gesture starts, the LB-pan's `anchorPlane` is latched to a *non-zero y* — old fallback gave `y ≈ camera.y + camForward.y · 30m`; new fallback gives `y ≈ camera.y + cursorRayDir.y · 30m`. Both place the truck-drag plane at an elevated height (e.g. ~17m for a 30°-up cursor ray at 1.6m camera height). This is **parity-not-fix**: the new behaviour has the same elevated-plane issue as the old, just with the elevation derived from the cursor direction rather than camera-forward. If feel-test surfaces the elevated-plane LB-truck as an issue, a sibling change would clamp LB-pan's fallback to the ground plane (y=0); logged as a follow-up but out of scope for this commit.

A separate raycast-with-fallback exists at `001-phase-1-plan.md:44` for the Shift+LB rotation-centre anchor ("ground-plane intersection at screen center; ... fall back to a fixed point 10m forward on the ground plane"). Different code path, different constant, different "y=0 enforced" semantics — explicitly not unified with this change.

## Test changes

### `test/editor/lib/nav-experimental/cursorAnchor.test.js`

Existing tests cover Step 1 (scene mesh) and a trivial Step 2 case (camera looking straight down). Add coverage of Step 3 plus a non-trivial Step 2 regression:

All new tests use a **non-degenerate camera setup**: camera at street level (y ≈ 1.6) with a normal `up = (0, 1, 0)`, looking horizontally toward −Z (or 45° down for the oblique-camera test). The existing fallback test uses `up = (0, 0, -1)` and a straight-up look direction — degenerate; copying that camera would produce trivially-passing tests for the new assertions.

- **Sky-miss above horizon.** Cursor at top edge of viewport → ray points above horizon. Assert `source === 'fallback'`. Assert the returned point lies on the cursor's ray at 30m: `(returned − cam).length() ≈ 30` and `(returned − cam).normalize().dot(cursor_ray_dir) ≈ 1`.
- **Sky-miss with non-trivial X offset.** Cursor in top-left vs top-right of viewport. Assert the returned fallback points are mirror images about the camera-forward direction — left cursor gives anchor with negative x-offset, right gives positive, both with the same upward y-offset. Distinguishes from the old behaviour (which would give identical fallback points regardless of cursor X).
- **Step 2 wins on an oblique camera (regression).** Camera at y=10 looking 45° down, cursor at viewport centre. Assert `source === 'ground'` and the ground hit is in front of the camera within `MAX_GROUND_DIST`. Closes the gap that the existing top-down-camera "Step 2 wins" test doesn't cover.

## Spec doc updates

### `claude/specs/001-phase-1-plan.md`

§"Wheel → exponential cursor-anchored dolly" item 3 of the no-hit fallback list. Current:

> 3. Else use a point 30m forward along the camera's view direction (plain camera-Z dolly).

Update to:

> 3. Else use a point 30m forward along the *cursor's* ray (preserves cursor-direction anchoring even on sky-miss; see `claude/specs/001-cursor-anchor-fallback.md` for the design and feel-test motivation).

### `claude/specs/001-cursor-anchor-fallback.md`

This file. Stays as the design record.

### `claude/specs/001-phase-2-plan.md` / `001-phase-2-rotation-blend.md`

No changes — neither references the fallback semantics directly.

## Risks

- **"Zoom went up when I expected forward."** When the cursor ray points significantly above horizon and the user wheel-zooms, the camera now moves up-along-cursor rather than forward-along-camera. Could feel like the camera is escaping the scene. Mitigation: feel-test; if it bites, clamp the cursor ray to the lower hemisphere (allow up to e.g. +10° above horizon, then project the ray onto a horizontal plane). One-line follow-up.
- **Consistency artefact at the Step-2-to-Step-3 boundary.** Currently, the transition from "ground hit at 1999m" to "sky-miss" snaps the anchor from cursor-position to camera-forward — a visible discontinuity. With the new Step 3, the transition is from "ground hit at 1999m, cursor-anchored" to "30m along the cursor ray, still cursor-anchored". Continuous. No risk; this is an improvement.
- **MAX_GROUND_DIST = 2000m still produces an arbitrary cliff at 2km.** With the new Step 3, the *direction* is continuous across the cliff (Step 2's ground-anchor and Step 3's synthetic anchor are both on the cursor ray), but the *magnitude* still cliffs ~66× (200m/tick at 1999m ground hit → 3m/tick at 2001m sky-miss). Less perceptually nasty than the old "anchor flipped sides" cliff, but if the user pans the cursor across the horizon while wheeling, they'll feel zoom step snap from "huge" to "tiny" at the boundary. Out of scope; flagged for future cleanup if it bites.

## Out of scope

- Changing `FALLBACK_FORWARD_DIST` from 30m. Tuning is a separate concern; this change is shape-of-behaviour only.
- Changing `MAX_GROUND_DIST`.
- Adding a visual indicator for "fallback-anchored zoom" (option (c) from the discussion).
- Touching the LB-pan path that also uses `worldPointAt` — the fallback affects it identically, in the same direction.

## Migration plan

1. Code + test changes in one commit.
2. Spec doc update (`001-phase-1-plan.md` line) in the same commit.
3. Run unit tests; lint.
4. Hand back to user for live feel-test (top-left corner zoom-in/out across various camera tilts).
5. If the "zoom went up" risk bites: small follow-up to clamp the cursor ray to lower hemisphere.

No adversarial review for a 3-line behavioural change; happy to add one if you want.
