# 001 — Shift+LB rotation: "museum diorama" rotation feel

*Working draft 2026-05-11. Will iterate.*

Sub-plan within the navigation prototype work. Fixes the first-move snap on Shift+LB drag where the camera's orientation jumps to look at the latched rotation centre, even when the user wasn't already aiming there. Replaces the current "orbit-and-lookAt(centre)" semantics with rotation that preserves the scene's angular position in the user's view — the "museum diorama" mental model below. Implementation: dual-spherical rotation (apply yaw/tilt deltas to *both* the camera-around-centre offset and the camera's view direction); remove the `camera.lookAt(center)` call that was the snap source.

## The museum analogy (UX justification)

Imagine you're standing in front of a diorama in a museum. There's a control that rotates the diorama around its centre. You press it: the diorama rotates in front of you. Your position doesn't change; your view direction doesn't change; the diorama rotates in place and you see it from a new side.

Now walk across the room. The diorama is now in the periphery of your vision. Press the rotate control again: the diorama rotates around its centre, and you see it rotate — still in the periphery. The control didn't "grab your focus" and pull you back to face the diorama. It rotated the diorama; that's the only thing that changed.

That's the behaviour we want from Shift+LB. In 3D-camera-controls terms, we can't literally rotate the scene (the scene is fixed in world space), so we move the camera to simulate it — but the **user-perceived effect** should match the museum: the scene rotates around its centre, the angular position of the scene in the user's view is preserved.

**The current behaviour doesn't do this.** Phase 2's `_shiftRotate` orbits the camera around the latched centre AND calls `camera.lookAt(centre)` on every move. The lookAt yanks the scene's centre to the centre of view on the first drag, regardless of where the user was aiming. From the user's POV: they pressed Shift+LB while looking off to the side, and the system "grabbed their focus" and pulled the scene into the centre of view. That's the snap, and it conflicts with the museum mental model.

The fix is to remove the lookAt-grab: orbit the camera around the centre, but rotate the view direction by the same yaw/tilt deltas independently of where the centre is. This preserves the angular relationship between view direction and centre across the rotation — exactly the museum behaviour.

## Why we're doing this

**User-reported behaviour (2026-05-11):** "The very first time I Shift+LB and start to drag the mouse, there is a sudden jump in the camera position and/or orientation. This isn't brand new — I was seeing it earlier as well."

**Diagnosis** (traced in `src/editor/lib/nav-experimental/ExperimentalControls.js`):

`_shiftRotate`'s non-rotate-in-place branch (lines 1097–1106) ends with:

```js
camera.position.copy(center).add(newOffset);
camera.lookAt(center);                          // <— the snap source
```

The math is "orbit around centre; camera always looks at centre". On the first mouse-move event after Shift+LB-down (even with tiny `dxPx`, `dyPx`), `camera.lookAt(center)` re-orients the camera to look at `center`. If the camera wasn't already aimed there, the orientation snaps.

**When does this manifest?**

- **High tilt (>30°):** `center` = screen-centre raycast hit (Rule 1). The screen-centre raycast is along the camera's forward direction by construction, so the hit is on the camera's forward ray. `camera.lookAt(hit)` is a no-op. **No snap.**
- **Low tilt, outside scene AABB:** `center` = diorama centre at eye-height (Rule 2). The diorama is *not* in general where the camera is aimed. The jump magnitude = angular distance between camera-forward and direction-to-diorama. **Snap.**
- **Low tilt, inside AABB or unbounded scene:** `center` = camera position (Rule 3). The rotate-in-place virtual-offset trick (`offset.lengthSq() < 1e-6`) fires; view direction follows user input. **No snap.**

So the snap is the **Rule 2 case**: low tilt + outside AABB + camera not aimed at diorama.

This isn't a math bug — it's the natural consequence of "orbit-and-lookAt(centre)" semantics applied to a centre the camera isn't initially looking at. Phase 2 chose this design deliberately to give a map-mode rotation feel ("orbit the diorama"), but the snap-on-engage is the cost.

## Design

Replace the `lookAt(center)` semantics with **dual-spherical rotation** (the implementation realisation of the museum analogy above): apply the same yaw/tilt deltas to both the position-offset (camera-around-centre) and the camera's view direction (virtual-offset trick from the existing rotate-in-place branch). The two rotations are independent in their starting state but share the input deltas.

### How it realises the museum analogy

- **At gesture start (zero deltas):** position-offset unchanged → camera position unchanged. View-direction unchanged → camera orientation unchanged. **No snap — the user's view is preserved on engagement.**
- **After non-zero deltas:**
  - Position orbits around the scene centre by (yaw, tilt) — the camera "walks around" the diorama.
  - View direction rotates by the same (yaw, tilt) — equivalent to the diorama rotating in place from the user's POV; the user's angular relationship to the diorama is preserved.

**Concrete trace (off-centre 90° drag-right yaw):**

- Setup: diorama at origin, camera at (10, 0, 0), looking 30° off from diorama (forward ≈ (−0.87, 0, −0.5)). Diorama is in the user's peripheral vision.
- Apply drag-right 90° yaw via dual-spherical (`dxPx > 0`, so the code's `theta -= dxPx * speed` decreases theta by π/2):
  - Position rotates 90° around centre: (10, 0, 0) → (0, 0, **+10**). (Spherical theta π/2 → 0 maps +X to +Z.)
  - View direction rotates 90° in the same sense: (−0.87, 0, −0.5) → (0.5, 0, −0.866).
  - Direction from new camera position to diorama: (0, 0, −1).
  - Angle between new view direction and direction-to-diorama: arccos(0.866) = **30°**. (Diorama still 30° off from view centre.)

After the rotation, the diorama is still 30° off from view centre — same peripheral position, just seen from a different side of the scene. Museum behaviour confirmed.

(Note: the sign/handedness here depends on the spherical convention. THREE.Spherical uses `x = r·sin(phi)·sin(theta)`, `z = r·sin(phi)·cos(theta)`; the code's `theta -= dxPx * speed` produces the trace above. The earlier draft of this section had `(0, 0, −10)`, which would correspond to the opposite sign convention. The user-perceived effect is invariant to handedness — the museum property is preserved either way.)

### Why this is "behaviour identical to current" when the user IS aimed at centre

If the user was looking directly at centre at gesture start, view direction and direction-to-centre are anti-parallel (view points from camera toward centre; centre-offset points the opposite way). The two spherical decompositions are related by negation; applying the same yaw/tilt to both rotates them consistently. After the rotation, view direction still points toward the (rotated) centre — i.e. camera still looks at centre, same as current behaviour. The user can't tell the difference.

So dual-spherical is a strict generalisation: identical to current when aimed at centre, museum-correct when not.

### Tilt-clamp coherence

Currently the clamp is applied to a single spherical (the position-offset, which doubles as view-direction proxy because lookAt(centre) ties them). After decoupling, the camera's *view tilt* should remain the clamp authority — that's what the user perceives as "tilt".

Clamp policy:

- Compute `dPhi` (intended tilt delta from `dyPx`).
- Look at the view-direction spherical's current phi. Compute the largest `dPhi'` that doesn't push it outside `[MIN_SPHERICAL_PHI, MAX_SPHERICAL_PHI]`.
- Apply `dPhi'` (not the raw `dPhi`) to **both** position-offset's phi and view-direction's phi.

This way the tilt clamp gates the view direction (user-perceived tilt) consistently across both rotations. Yaw (`dTheta`) is applied fully to both, no clamp.

If only the view-direction is clamped and position keeps rotating, the camera would drift around centre while view-tilt stays fixed — bad feel. Gating both via the view-direction's clamp is the right move.

### Centre-at-camera-position (Rule 3 / rotate-in-place) case

When `offset.lengthSq() < 1e-6` (centre coincides with camera, Rule 3), position-offset is degenerate. Treat this as "no position change; only view direction rotates". Implementation: skip the position-offset spherical math; apply yaw/tilt deltas only to the view-direction spherical; set `camera.position` unchanged.

This subsumes the existing rotate-in-place virtual-offset trick — the view-direction spherical IS the virtual-offset trick.

### `this.center` API contract

`this.center` is the back-compat EditorControls API field consumed by `_zoomActionBar` and `_applyWheelTick` (the cursor-anchored branch reads `this.center` indirectly; the new tilt-conditional path uses it via `camera.position.distanceTo(this.center)` for the far-plane). Current `_shiftRotate` sets `this.center.copy(center)` (the latched rotation centre) for the orbit case, and `this.center.copy(camera.position)` for the rotate-in-place case.

Under the new design, `this.center` semantics stay the same: the latched rotation centre. ActionBar zoom uses it as a distance reference; that's still correct (camera-to-rotation-centre distance is what ActionBar zoom should scale by).

## Code changes

### `src/editor/lib/nav-experimental/ExperimentalControls.js`

`_shiftRotate` — rewrite the orbit and rotate-in-place branches into a single dual-spherical computation:

```js
_shiftRotate(dxPx, dyPx) {
  const camera = this._camera;
  const center = this._latch.get('center');
  if (!center) return;

  // (1) Position offset from centre (in world spherical coords).
  const offsetPos = this._tmpV3a.copy(camera.position).sub(center);
  const hasPositionOrbit = offsetPos.lengthSq() >= 1e-6;
  // For the rotate-in-place case (centre at camera), there's no
  // position to orbit. We still rotate the view direction below.

  // (2) View direction (virtual offset = −camera.forward, unit length).
  const fwd = this._tmpV3c;
  camera.getWorldDirection(fwd);
  const offsetView = this._tmpV3b.copy(fwd).multiplyScalar(-1);

  // (3) Tilt clamp gated by the view direction's phi. Reduce dyPx to
  //     whatever doesn't push view-phi outside [MIN, MAX]. dxPx (yaw)
  //     unaffected.
  const sphView = new THREE.Spherical().setFromVector3(offsetView);
  const wantDPhi = -dyPx * this.rotationSpeed;
  const newPhi = sphView.phi + wantDPhi;
  let actualDPhi = wantDPhi;
  if (newPhi < MIN_SPHERICAL_PHI) {
    actualDPhi = MIN_SPHERICAL_PHI - sphView.phi;
  } else if (newPhi > MAX_SPHERICAL_PHI) {
    actualDPhi = MAX_SPHERICAL_PHI - sphView.phi;
  }
  const dTheta = -dxPx * this.rotationSpeed;

  // (4) Apply to view direction.
  sphView.theta += dTheta;
  sphView.phi += actualDPhi;
  const newOffsetView = new THREE.Vector3().setFromSpherical(sphView);

  // (5) Apply to position offset (only when not rotate-in-place).
  if (hasPositionOrbit) {
    const sphPos = this._spherical.setFromVector3(offsetPos);
    sphPos.theta += dTheta;
    sphPos.phi += actualDPhi;
    // No separate phi clamp — view-tilt clamp gates dPhi above.
    const newOffsetPos = new THREE.Vector3().setFromSpherical(sphPos);
    camera.position.copy(center).add(newOffsetPos);
  }

  // (6) Apply view direction. lookAt at `pos + (−newOffsetView)` —
  //     newOffsetView is the virtual offset opposite the view direction,
  //     so the lookAt target is one unit along the new view direction.
  const lookTarget = this._tmpV3a
    .copy(camera.position)
    .sub(newOffsetView);
  camera.lookAt(lookTarget);

  this.center.copy(center);
  camera.updateMatrixWorld();
  this.dispatchEvent(this._changeEvent);
}
```

Key changes vs current:

- No more `camera.lookAt(center)` — replaced by `lookAt(pos − newOffsetView)`, which uses the rotated view direction independently.
- The rotate-in-place branch is now an automatic consequence of the position-offset being zero (no special case needed).
- Tilt clamp gates `dPhi` once via view-direction; applied identically to position.
- The existing `MIN/MAX_SPHERICAL_PHI` constants are reused.

No imports change. `_tmpV3a/b/c` reused as scratch (already declared). `_spherical` instance member reused for position-offset; a fresh `THREE.Spherical()` allocates for the view-offset spherical (could be added as `_sphericalView` for hot-path tidiness, but the allocation is one per move event — negligible).

### No other files touched

The dual-spherical math is local to `_shiftRotate`. No changes to `navMath.js`, `cursorAnchor.js`, `constants.js`, or any test scaffolding consumed by other paths.

`_latchRotationCenter` is unchanged — it still computes `screenHit` + `tiltBlend` + `center` at gesture start. The `center` field on the latch retains its semantics ("the world point to orbit around"). Only how the orbit math consumes it changes.

## Test changes

### `test/editor/lib/nav-experimental/...`

The current `_shiftRotate` isn't directly unit-tested (the math is in an instance method that needs a stub camera + latch). Two viable approaches:

**Option A — integration test against `_shiftRotate` via a constructed `ExperimentalControls`.** Requires stubbing more scaffolding; matches existing pattern in `cursorAnchor.test.js` for setup-heavy tests.

**Option B — extract a pure helper `shiftRotateStep(camera, center, dxPx, dyPx, speed) → {pos, lookTarget}` into `navMath.js`.** Test that directly without the latch / event machinery. Lighter setup; matches the recent `computeLowTiltWheelHit` pattern.

**Recommend Option B.** Extract `shiftRotateStep` into `navMath.js`. `_shiftRotate` becomes a thin wrapper that reads from the latch and writes to the camera + dispatches the change event.

Test cases for the pure helper:

- **Zero deltas, camera aimed at centre.** Expect `pos` unchanged, `lookTarget` essentially unchanged (within numerical precision).
- **Zero deltas, camera NOT aimed at centre** (the snap-cause case). Expect `pos` unchanged, `lookTarget` unchanged — **the explicit no-snap regression check.**
- **Yaw delta, camera at orbit position aimed at centre.** Expect position to rotate around centre; view direction to track centre.
- **Yaw delta, camera at orbit position NOT aimed at centre.** Expect position to rotate around centre; view direction to rotate by the same yaw, preserving the initial offset from centre.
- **Tilt delta hits clamp.** Expect view direction to clamp at the limit; position-offset to clamp consistently (no continued rotation while view-tilt is stuck).
- **Rotate-in-place (offset.lengthSq < 1e-6).** Expect position unchanged; view direction rotates by yaw/tilt.

These cover the load-bearing properties: no snap, orbit-when-aligned, decoupled-when-not, clamp consistency.

## Spec doc updates

### `claude/specs/001-phase-2-plan.md`

§"Architecture additions" — currently describes the orbit math as "rotate the camera around the latched centre" without going into the lookAt-centre vs. decoupled-view distinction. Add one paragraph noting the museum analogy + dual-spherical implementation:

> Shift+LB rotation realises the "museum diorama" UX mental model: rotating the diorama in place; the user's angular relationship to it (e.g. "scene is in the periphery of my view") is preserved across the rotation. Implementation: apply yaw/tilt deltas to both the camera's position-offset-from-centre AND the camera's view direction (via virtual-offset spherical decomposition), independently. This removes the first-move snap that the earlier "orbit and `lookAt(center)`" semantics produced when the camera wasn't aimed at centre at gesture start (which conflicts with the museum mental model — the lookAt "grabs focus" and pulls the scene into screen-centre). See `claude/specs/001-shiftrotate-decoupled-view.md`.

### `claude/decisions.md`

Add an entry at the top (newest first):

> **2026-05-11 — Shift+LB rotation: museum-diorama feel via dual-spherical math.**
>
> Mental model: the rotation gesture is "rotate the scene around its centre". User's position and view direction are preserved across the rotation; only the scene's apparent orientation changes. If the scene was in the user's peripheral vision before the gesture, it stays in periphery during and after. Equivalent to walking around a diorama in a museum — the diorama doesn't grab your focus when you rotate it from off to one side.
>
> Implementation: apply yaw/tilt deltas to both the camera's position-offset-from-centre and the camera's view direction (virtual-offset spherical decomposition), independently. Removes `camera.lookAt(centre)` from `_shiftRotate`, which was the focus-grab that produced the first-move snap on Rule 2 (low tilt, scene bounded, camera outside AABB) gestures.
>
> **Rationale:** the snap was an emergent consequence of "orbit and lookAt(centre)" semantics — fine when the camera was already looking at centre (Rule 1 high tilt → screen-centre raycast is on the forward ray by construction; no snap), but jarring when not (Rule 2). User reported the snap on 2026-05-11. Tried "smooth transition" approach (animate centre over ~150ms); architecturally complex (would need per-tick orientation tracking to avoid pause-snap reintroduction), and on reflection the museum framing is cleaner anyway — there's no reason to "transition" toward looking at centre if the user wasn't trying to.
>
> See `claude/specs/001-shiftrotate-decoupled-view.md`.

### Other docs

`001-phase-1-plan.md` doesn't describe Shift+LB rotate in implementation detail; no change. `001-tilt-conditional-zoom.md` is wheel-zoom-specific; no overlap. `001-cursor-anchor-fallback.md` and the rotation-blend docs are superseded; no change.

## Risks

- **"Off-centre orbit" semantics: scene stays in periphery, doesn't get pulled to centre.** If the user starts Shift+LB while looking off to one side of the diorama, then drags a 180° yaw, the camera ends up on the opposite side of the diorama, still seeing it 30° off in the periphery (the same angular position it had at gesture start). With current (snap) behaviour, the camera would yank the diorama to screen centre on first move and orbit while continuously looking at it. The museum analogy says the new behaviour is correct: rotating the diorama from "off to one side" shouldn't reposition the user's view. The current snap behaviour grabs the user's focus; the new behaviour respects where they were looking.

- **Allocation cost of fresh `THREE.Spherical()` per move event.** One additional `new THREE.Spherical()` per `_shiftRotate` call. Move events fire at mouse-move rate; allocation is in the V8 nursery. Negligible. If profiling shows it, hoist to an instance scratch field `_sphericalView` alongside `_spherical`.

- **Tilt-clamp interaction with non-aligned starts.** When position-offset and view-direction have very different starting phi values (e.g. user looking up while orbiting around a low diorama), the clamp gates `dPhi` based on view-direction phi only. Position-offset phi might be far from the clamp — that's fine, position can rotate freely; the user perceives tilt via the view direction, which is what's clamped.

- **Edge case: camera looking exactly along the axis from centre.** If `offsetPos` is exactly along the camera's `-fwd` direction, position-offset and view-direction spherical decompositions have the same theta/phi. Applying same deltas keeps them aligned (matches current behaviour exactly). No edge case to handle.

## Out of scope

- Changing what `_latchRotationCenter` puts in the latch. The Rule 1/2/3 selection at gesture start stays as-is.
- Touching the rotate-in-place virtual-offset constant `1e-6` (squared metres threshold). It's still used to detect "centre coincides with camera".
- Restoring live-recompute of the rotation centre. That was ruled out in `decisions.md` 2026-05-10; this plan doesn't reopen it.
- ActionBar zoom and wheel zoom paths.

## Migration plan

1. Extract `shiftRotateStep` pure helper into `navMath.js`.
2. Refactor `_shiftRotate` to call the helper.
3. Add tests for the helper (6 cases above).
4. Update `001-phase-2-plan.md` and `claude/decisions.md`.
5. Single commit.
6. Hand to user for live feel-test.
