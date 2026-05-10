# 001 — Phase 2 Plan: Low-Tilt + Bounds-Based Rotation Center

*Working draft 2026-05-09. Will iterate.*

Phase 2 of the navigation prototype work (see `001-overall-plan.md`). Promotes `001-phase-2-skeleton.md` to a full plan now that Phase 1 has shipped and feel-tested. The high-information phase: this is where the bounds-based design either feels good or doesn't.

## Goals

1. Lower or remove the 30° tilt floor on the manual tilt path so the camera can be driven down to street level.
2. Validate the **30° hard-cut** between truck/dolly (looking-down by >30°) and truck/pedestal (everything else, including looking-up) on LB+drag — answer "does mode-flipping at gesture start feel acceptable, or does it feel jarring?".
3. Validate the **three-rule rotation center** logic (camera view / diorama center / camera position) with a 20–30° angular blend — answer "does the bounds-based design feel coherent, or does it hunt/spiral?".
4. Land a **visual indicator** for the truck-mode change strong enough that the user knows which mode they're in without thinking about it.
5. Keep Phase 3 (swoop) deferred. Wheel zoom remains the Phase 1 cursor-anchored exponential dolly throughout — Phase 2 only changes the LB and Shift+LB paths.

## Non-goals

- No swoop transition. Wheel zoom stays as Phase 1 (cursor-anchored, tilt-preserving).
- ~~No cylinder-boundary feathering yet.~~ **Current state (2026-05-10):** scene-edge feathering *is* in scope. Boundary is the scene AABB (not the cylinder — cylinder still computed for Plan View framing); feather is a fixed 5m extending outward from the AABB edge; the inside/outside-AABB feather is evaluated *once at gesture start* and the resulting blended centre is held for the duration of the Shift+LB drag. A live-recompute (per-frame Rule 2 ↔ Rule 3 from the live camera position) was attempted in two variants — blend-the-centres and blend-the-rotation-results — and both were ruled out at feel-test (the first juddered, the second felt "absolutely terrible"). Live-recompute code is preserved on branch `navigation-phase2-nolatch` for reference; the design discussion is on that branch in `claude/specs/001-phase-2-rotation-blend.md` and the two review reports under `claude/reports/`. See Open Design Call #3 below for the brief trail.
- No FPS mode, no double-click changes.
- No new top-level compass button (still tracked as `issues-for-discussion.md` #5).
- No touch / WebXR / ortho work.

## What Phase 1 left us with (the scaffolding we built deliberately)

Reviewed against the skeleton's "Things Phase 1 should accommodate" list:

- ✅ **Gesture-latch composite state.** `GestureLatch` is already a key/value bag (`gestureLatch.js`), not a single-value latch. Phase 2 latches `mode` + `rotationCenter` + `centerBlendWeight` into the same bag without any refactor.
- ✅ **Mode-dispatch hook.** `_decideMouseMode(event)` already returns a token (`'pan'` / `'rotate'`) consumed by the handler. Phase 2 extends the helper, not the call sites.
- ✅ **Tilt-clamp scope.** `MIN_TILT_DEGREES` lives in `constants.js` as a single export, enforced at exactly one site (`_shiftRotate`). Phase 2 changes the constant or removes the clamp branch — one edit.
- ✅ **Mode-change event.** `nav-experimental:modechange` is dispatched on every gesture start/end. Phase 2's visual indicator subscribes to it.
- ✅ **`SceneBounds` cache hot-path.** Phase 1 hit `getBounds()` only on Plan View. Phase 2's mouse-down handler will hit it again; cache short-circuits to a single object lookup. Mouse-move never calls it.
- ✅ **`tickAnimator.subscribe()`** primitive exists for the toolbar transition.

The two skeleton items still open at promote-time:

- **`SceneBounds` correctness on real scenes.** Phase 1 only exercised the default basic-street scene plus unit tests. Phase 2 needs at minimum: an unbounded `street-geo` scene, a multi-managed-street Streetmix import, and a single-intersection scene. Goes into the smoke test.
- **`SceneBounds` cache thrash.** Phase 2 puts bounds reads on the mouse-down hot path (one read per gesture, not per move), so the existing invalidation semantics are fine. The remaining concern is `componentchanged` firing aggressively while a `street-segment` is rebuilt — already mitigated by the dimension-component allowlist. Spike covers this.

## Mechanics — exact spec

### LB+drag — 30° hard-cut between truck/dolly and truck/pedestal

The mode is decided at gesture start from the camera's tilt angle, latched, and held for the duration of the drag.

- **Tilt > 30°** (camera looking down by more than 30°): **truck/dolly** in the world horizontal plane. Identical to Phase 1 — the existing hit-anchored math in `_lbTruckMove` is reused.
- **Tilt ≤ 30°** (camera near horizontal *or* looking up by any amount): **truck/pedestal** in world coordinates. This branch covers the entire range from −89° (near straight up) through horizontal up to 30° down — see "LB-mode dispatch with negative tilt" below.
  - Horizontal drag → world-X / world-Z translate, in the **camera-yaw-projected horizontal plane** (i.e. drag-right moves the camera in the camera's screen-right horizontal direction; same model as WASD A/D).
  - Vertical drag → world-Y translate (pedestal). Drag down = world goes down = camera moves up.
  - Speed: pixel-to-metres scaling that preserves the Phase 1 "speed-scales-with-height" feel. Use the same hit-anchored math but project onto a **vertical plane through the anchor whose normal = the camera's forward direction projected onto the horizontal plane and normalized** (i.e. the plane is parallel to screen-right + world-up, perpendicular to camera-forward-horizontal). The cursor's ray-plane intersection then varies in (camera-right-horizontal, world-Y), which maps cleanly to (truck-right, pedestal-up). Keeps the "world point under cursor stays under cursor" property in 2D.
  - **No tilt change** during truck/pedestal. Tilt is only changed by Shift+LB.

**Mode-flip behavior.** If the user's camera is at exactly 30° tilt at gesture start, the chosen branch is `≤30°` (inclusive). The latched mode persists for the gesture even if Shift+LB drags happen between LB drags and re-tilt the camera across 30° — each new LB-down re-evaluates.

**No mid-gesture flips.** Already deferred per overall-plan; Phase 2 honors it. If the angular blend (below) reveals that a mid-gesture flip would actually feel better, that's the kind of finding Phase 2 is *for*; but the default is latch-at-start.

### Shift+LB+drag — three-rule rotation center, latched

At gesture start, choose the rotation center:

- **Rule 1 (>30° tilt):** screen-center raycast hit. Identical to Phase 1's existing `_shiftRotate` center.
- **Rule 2 (tilt ≤ 30° including negative, scene bounded, camera outside scene AABB):** scene bounds center at **eye-height** (`{bounds.center.x, ROTATION_CENTER_EYE_HEIGHT_METRES, bounds.center.z}`, default 1.5m). Eye-height (rather than y=0 ground) prevents the camera arcing underground when the user tilts up to look at buildings. Assumes flat ground at y=0; elevated-terrain scenes are a known Phase 2 gap (see Open Design Call #1).
- **Rule 3 (tilt ≤ 30° including negative, scene unbounded OR camera inside scene AABB):** the camera position itself ("Street View"-style: rotate in place).

"Inside the AABB" is tested against the scene's actual horizontal footprint: `(cam.x ∈ [aabb.minX, aabb.maxX]) ∧ (cam.z ∈ [aabb.minZ, aabb.maxZ])`. The cylinder version of this test (used in the original spec — `((cam.x - center.x)² + (cam.z - center.z)²) ≤ radius²`) was abandoned during implementation: a 50m-radius cylinder for a 100m × 5m street made a camera 10m off the side "inside" by cylinder reckoning when intuitively it's clearly outside. The cylinder is still computed and exposed on `bounds.{center, radius}` for the Plan View tween's framing math; rotation-center selection now reads `bounds.aabb` instead.

**Angular blend (20–30°).** When the camera tilt at gesture start is between 20° and 30°, the latched rotation center is a **weighted lerp** between Rule 1's screen-center hit and the rule-2-or-3 center. Weight = `smoothstep(20°, 30°, tilt)` (so 20° → fully rule-2/3, 30° → fully rule-1). One smoothstep, latched once at gesture start. The blend is computed in world-space coordinates, not in tilt-angle space — once latched, the center is a fixed `Vector3` and the rotation math doesn't need to know the blend exists.

**Scene-edge feathering — applied at gesture start; rotation center then fully latched.** The feather still applies, but only at latch time: at Shift+LB-down the camera's current position determines a feather-blended center that's held for the gesture. The earlier "live-recompute Rule 2 ↔ Rule 3 on each move" design was reverted post-implementation because it produced visible judder during a rotate gesture near the AABB edge — the camera position changes only because of the orbit math, and feeding that back into the center created a feedback loop. Latching breaks the feedback. Concretely, the feather smoothstep on `distanceToAabb(cam.x, cam.z) / SCENE_FEATHER_METRES` is evaluated once per gesture; the result is mixed with `screenHit` by the tilt-blend weight; and the resulting Vector3 is stored on the GestureLatch as `center` and read by `_shiftRotate` for the duration of the drag. Inside the AABB at gesture start: rotate-in-place. One feather-width outside at gesture start: orbit the diorama. In between: orbit a fixed point partway between camera and diorama. The next Shift+LB-down re-evaluates the live camera state and picks a fresh center, so a user who has moved their camera since the last rotate gets the appropriate behavior. Trade-off vs. the live design: a long Shift+LB rotation that geometrically takes the orbit across the AABB edge will continue orbiting the latched point, even when the camera is now "in" the scene — judged acceptable since the user can release Shift+LB and re-engage to switch modes. The original cylinder-version with a 10%-of-radius feather is documented in Open Design Call #3.

**Tilt clamp expanded.** With Phase 2 the user can drive the camera down to street level *and* tilt up to look at buildings. Implementation: change `MIN_TILT_DEGREES` from +30° to **−89°** (keeps `lookAt` numerically stable just shy of straight-up, mirroring the +89° floor on the down side via `MAX_TILT_DEGREES`). Combined with Rule 2/3's eye-height rotation center, the camera doesn't arc underground when tilting up.

**LB-mode dispatch with negative tilt.** With looking-up enabled, the 30° truck/dolly cutoff needs to be on **absolute angle from horizontal**, not signed tilt — looking up at any angle should fall into truck/pedestal mode (it's never sensible to truck/dolly the world horizontally when the camera is pitched up at the sky). So `_decideLbMode` returns `'pan-pedestal'` when `|tilt| ≤ 30°` and `'pan-truck'` only when `tilt > 30°` (i.e. looking down at >30°). Looking up by any amount = pedestal mode.

**Tilt direction.** Drag-down = tilt-toward-top-down, drag-up = tilt-toward-horizontal. Phase 1's resolved direction; unchanged.

### Visual indicator — toolbar aspect-ratio shift

Per the resolved decision in `001-overall-plan.md` §6: when the LB+drag mode is `truck/pedestal` (≤30° tilt at last gesture start, OR last `nav-experimental:modechange` mode is `'pan-pedestal'`), restyle the floating toolbars (top + bottom) into **full-width black strips**. Aspect-ratio change of the visible viewport area is the signal.

Concrete spec:

- **Subscriber.** A new `useNavMode` Zustand-or-event hook listens for `nav-experimental:modechange` events from the `ExperimentalControls` instance and exposes `isPedestalMode: boolean`.
- **Toolbar style change.** `ToolbarWrapper.jsx` (top) and the bottom action bar wrapper read `isPedestalMode` and apply a CSS class. The class:
  - Sets `width: 100vw`, `left: 0`, `right: 0` (override the centered float).
  - Sets `background: #000` (full opacity, not the existing semi-transparent panel chrome).
  - Animates over 200ms via CSS transition (so the aspect-ratio change feels intentional, not glitchy).
- **Persistence rule.** The mode is held until the next gesture *changes* it — not until the gesture ends. So: user does Shift+LB to tilt down past 30°, releases, mode is now `'pan-pedestal'`. User does LB-drag (truck/pedestal). Releases. Toolbars stay black. User Shift+LB tilts back above 30° — toolbars return to floating.
- **Mode-tracking logic.** `ExperimentalControls` keeps a `_currentLbMode` field. Updated on every Shift+LB *move* (per Open Design Call #2) when the computed mode differs from the last-emitted mode — so the indicator transitions the moment the tilt crosses 30° during the gesture, not at gesture end. Also recomputed at gesture end as a safety net. Emits `nav-experimental:modechange` with the new value on each transition.

This rule means the indicator is a *predictor* of the next LB drag, not a reflection of the current gesture. That's the form the user actually wants — "what will my next LB do?".

**Edge cases:**

- Toolbars hidden (e.g. fullscreen) → no-op; the class still applies but there's nothing to restyle.
- ActionBar / dropdowns open during the transition → CSS handles them via the same wrapper rules.
- Reload mid-gesture → mode resets to `'pan-truck'` (default for fresh camera at default tilt).

### Wheel, WASD, Plan View — unchanged

All Phase 1 mechanics carry over verbatim. Phase 1's wheel handler is reused. Phase 1's WASD is reused. Phase 1's Plan View intercept is reused (and now more important — it's the user's primary "get me back to a sane bird's-eye view" affordance until the compass button lands).

One micro-tweak: with the tilt clamp lowered, the user can now reach near-straight-up tilt via Shift+LB (camera looking ~89° above horizontal). At those angles the camera's `−Z` direction projects almost-zero onto the horizontal plane, just like the looking-straight-down case. Phase 1's `−Z-projection with +Y-projection fallback` covers both extremes — at near-straight-up, `+Y` projects to roughly the negation of the camera-forward-horizontal direction, which is what the user intuits as "WASD-forward should keep going forward". Verify in feel-test rather than re-derive.

## Architecture additions

### `sceneBounds.js` — new consumer, additive shape change

Phase 2 calls `bounds.getBounds()` from `_decideRotationCenter()` (see below). The cache invalidation semantics are unchanged — `getBounds()` returns the cached bounds object, recomputing only after an invalidating event. The bounds object now exposes both representations: `aabb: {minX, maxX, minZ, maxZ}` (read by Phase 2's rotation-center inside/outside test) and `center` + `radius` (kept for the Plan View tween's framing math, unchanged from Phase 1). Adding `aabb` is the only API change.

### `ExperimentalControls.js` — three new internals

#### `_decideLbMode(camera)` — pure, takes current camera, returns mode token

```js
_decideLbMode(camera) {
  const tiltDeg = this._cameraTiltDegrees(camera);
  // Cut on absolute angle from horizontal: looking up by any amount =
  // pedestal mode. Only "looking down by >30°" gets truck/dolly.
  return tiltDeg > TRUCK_PEDESTAL_CUTOFF_DEGREES ? 'pan-truck' : 'pan-pedestal';
}
```

Where `_cameraTiltDegrees` returns the angle of the camera's view direction below horizontal (so 0° = horizontal, 90° = straight down). Phase 2 introduces this helper; Phase 3 reuses it.

#### Rotation-center pipeline — fully latched at gesture start

The rotation center is computed once at gesture start. Latch-time (at Shift+LB-down) snapshots the high-level rule (Rule 1 vs Rule 2/3-group), the screen-center hit (or null), the tilt-blend weight, and the AABB-edge feather-blended Vector3. The `_shiftRotate` math reads only `this._latch.get('center')` for the duration of the drag. (An earlier revision split this into latch-time + live-time, recomputing the feather per move; that produced rotation-judder near the AABB edge and was reverted.)

**At Shift+LB-down (`_latchRotationCenter`):**

```js
_latchRotationCenter(camera) {
  const tiltDeg = this._cameraTiltDegrees(camera);
  const screenHit = (tiltDeg > ROTATION_BLEND_LOW_DEGREES)
    ? this._screenCenterHit()        // null if no scene/ground hit
    : null;                          // not needed for ≤20° branch

  const ruleAB = this._computeRuleAB(camera);

  // Tilt-blend weight (latched).
  let blend = 1;                     // 1 = fully ruleAB, 0 = fully screenHit
  if (tiltDeg > ROTATION_BLEND_HIGH_DEGREES) {
    blend = 0;
  } else if (tiltDeg > ROTATION_BLEND_LOW_DEGREES) {
    const t = (tiltDeg - ROTATION_BLEND_LOW_DEGREES) /
              (ROTATION_BLEND_HIGH_DEGREES - ROTATION_BLEND_LOW_DEGREES);
    blend = 1 - t * t * (3 - 2 * t); // smoothstep, inverted
  }

  // No-screenHit fallback (per A3): if Rule 1 has nothing to anchor to
  // (sky raycast miss), collapse to ruleAB regardless of blend weight.
  const effectiveScreenHit = screenHit ?? ruleAB.clone();
  const center = new THREE.Vector3().lerpVectors(
    effectiveScreenHit, ruleAB, blend
  );

  this._latch.start({
    mode: 'rotate',
    center,
    screenHit: effectiveScreenHit,
    blend
  });
}
```

(There is no per-move recompute method. An earlier revision had `_updateLiveRuleAB` re-evaluating `ruleAB` from the live camera position on each Shift+LB move; reverted post-implementation because the camera-position change is itself the orbit-math output, and feeding it back into the center produced visible judder near the AABB edge.)

**Helper (`_computeRuleAB`)** — handles both the inside/outside test and the feathered transition. Implementation lives in `navMath.js` as a pure function; the controls method is a thin wrapper. (The original pseudocode used the cylinder; revised post-implementation to AABB per item #2.)

```js
// signed-positive distance from a horizontal point to the scene rectangle.
function distanceToAabbXZ(px, pz, aabb) {
  const dx = Math.max(aabb.minX - px, 0, px - aabb.maxX);
  const dz = Math.max(aabb.minZ - pz, 0, pz - aabb.maxZ);
  return Math.hypot(dx, dz);
}

function computeRuleAB(camPos, bounds) {
  if (!bounds || !bounds.bounded || !bounds.aabb) {
    // Unbounded scene — Rule 3 always (per A5).
    return new THREE.Vector3(camPos.x, camPos.y, camPos.z);
  }
  const dist = distanceToAabbXZ(camPos.x, camPos.z, bounds.aabb);
  const fw = SCENE_FEATHER_METRES;                      // 5m default
  // smoothstep from inside-or-at-edge (Rule 3) to outside (Rule 2)
  // over the feather, which extends *outward* from the AABB edge.
  const u = THREE.MathUtils.clamp(dist / fw, 0, 1);
  const w = u * u * (3 - 2 * u);                        // 0 inside, 1 outside
  const dioramaCenter = new THREE.Vector3(
    bounds.center.x, ROTATION_CENTER_EYE_HEIGHT_METRES, bounds.center.z
  );
  const cam = new THREE.Vector3(camPos.x, camPos.y, camPos.z);
  return new THREE.Vector3().lerpVectors(cam, dioramaCenter, w);
}
```

**Latching contract (post-review):**

- **Latched** at gesture start: high-level rule (Rule 1 vs Rule 2/3-group via `tiltDeg > 30`), `screenHit` (with null fallback to `ruleAB`), tilt-blend weight `blend`, the AABB-edge feather-blended ruleAB position, and the final composed `center`.
- **Live** during the gesture: nothing. The center, screenHit, and blend are all latched once and read for every move event. (An earlier revision recomputed the inside/outside-AABB feather position per frame; reverted post-implementation because it caused juddering during rotation near the AABB edge — the camera position changes only because of the orbit math, and feeding that back into the center created a feedback loop.)
- **`_shiftRotate`** reads `this._latch.get('center')` — opaque to it whether the value was set once or per-frame.

**`SCENE_FEATHER_METRES`** is a new constant (default 5m, extending outward from the AABB edge). Lives in `constants.js`; see below. (Was originally `CYLINDER_FEATHER_FRACTION = 0.10` in the spec — replaced post-implementation; see Open Design Call #3 for the trail.)

#### `_lbPedestalMove(clientX, clientY)` — new branch alongside `_lbTruckMove`

Mirrors `_lbTruckMove` but operates on a vertical plane through the latched anchor, oriented to face the camera:

- At gesture start: latch `anchor` (cursor world hit) and `anchorPlane` = vertical plane through anchor with **normal = camera-forward-horizontal** (camera −Z projected onto the horizontal plane and normalized). The plane spans world-Y plus camera-right-horizontal — i.e. it sits "in front of" the camera like a window. (Per inline discussion #1; the earlier "normal = camera-right-horizontal" formulation was wrong.)
- On move: raycast cursor against the latched plane → `hitNow`. Camera position += `(anchor - hitNow)` (still "grab the world"). Mouse-X drives camera-right-horizontal motion (truck-right); mouse-Y drives world-Y motion (pedestal-up).
- **Sanity cap.** Same `LB_PAN_MAX_STEP_METRES = 5000m` as `_lbTruckMove`. When triggered, the per-event delta is clamped to the cap (not zeroed, not snapped back) — matches Phase 1's behavior. Triggered only by numerically-degenerate hits, e.g. cursor ray nearly parallel to plane normal (drag direction parallel to camera-forward-horizontal — vanishingly rare in practice but possible).

#### `_onMouseDown` — extend the dispatch

```js
_onMouseDown(event) {
  // ... existing inactive guard, _decideMouseMode call ...

  // Recompute & emit current LB-mode before latching the gesture (per A6).
  // The camera may have changed tilt since the last `_shiftRotate` —
  // e.g. a Plan View tween or focus-animation finished and the toolbar
  // indicator is now stale. Catching it here keeps the indicator honest
  // for users who never use Shift+LB.
  const liveLbMode = this._decideLbMode(this._camera);
  if (liveLbMode !== this._currentLbMode) {
    this._currentLbMode = liveLbMode;
    this._emitModeChange(liveLbMode);
  }

  if (mode === 'pan') {
    if (liveLbMode === 'pan-truck') {
      // Phase 1 truck path, unchanged.
    } else {
      // Phase 2 pedestal path. Compute vertical-plane anchor.
    }
    this._latch.start({ mode: 'pan', subMode: liveLbMode, /* ... */ });
  } else if (mode === 'rotate') {
    this._latchRotationCenter(this._camera);   // see above
  }
  // ... attach window listeners ...
}
```

The Plan View tween and focus-animation also change tilt outside any mouse gesture; both should fire a mode-change check on completion. Add a tilt-watch in their `onDone` callbacks (one-line: same comparator as above).

`_onMouseMove` dispatches on `subMode` for the `'pan'` mode, calling either `_lbTruckMove` or `_lbPedestalMove`.

#### `_onMouseMove` (Shift+LB branch) and `_onMouseUp` — emit indicator mode on transition

Per Open Design Call #2, the LB-mode is recomputed on every `_shiftRotate` call (not just on mouseup), and the change event fires the moment the mode flips:

```js
// Inside _shiftRotate, after applying the rotation:
const newLbMode = this._decideLbMode(this._camera);
if (newLbMode !== this._currentLbMode) {
  this._currentLbMode = newLbMode;
  this._emitModeChange(newLbMode);
}
```

`_onMouseUp` does the same recompute as a safety net (in case a final move event was missed).

### `constants.js` — adjustments

```js
// Phase 2: tilt floor lowered to allow looking up at buildings. Was 30
// in Phase 1; -89 keeps `lookAt` numerically stable just shy of straight
// up, mirroring the +89 floor on the down side.
export const MIN_TILT_DEGREES = -89;
export const MAX_TILT_DEGREES = 89;

// Phase 2: 30° hard-cut between truck/dolly (>30° down) and truck/pedestal
// (everything else). Cut is on absolute angle from horizontal.
export const TRUCK_PEDESTAL_CUTOFF_DEGREES = 30;

// Phase 2: angular blend zone for rotation-center lerp.
export const ROTATION_BLEND_LOW_DEGREES = 20;
export const ROTATION_BLEND_HIGH_DEGREES = 30;

// Phase 2: Rule 2 (diorama-center) rotation-center y-coordinate.
// Eye-height rather than ground (y=0) so a Shift+LB tilt-up gesture at
// street level orbits around a point above the ground and the camera
// doesn't arc underground. Assumes flat ground at y=0; elevated terrain
// is a known Phase 2 gap. Note: "eye height" implies pedestrian scale —
// for non-pedestrian scene types (drone/satellite) this default would
// be wrong; revisit when such scenes enter scope.
export const ROTATION_CENTER_EYE_HEIGHT_METRES = 1.5;

// Phase 2: scene-edge feathering width in metres. Smoothstep from
// Rule 3 (inside the scene AABB, rotate-in-place) to Rule 2 (outside,
// diorama center) over a feather zone extending outward from the AABB
// boundary. Always active when the scene is bounded (per A4 — no
// activation threshold; the per-frame cost is negligible and constant
// feathering removes the "near-identical gestures behave differently"
// discontinuity). Constant in absolute units rather than a fraction of
// scene size — the user-perceived "I am outside the scene" distance
// is human-scale, not scene-scale (item #2 in inline discussion;
// finalised post-implementation).
export const SCENE_FEATHER_METRES = 5;
```

Nothing else moves in `constants.js`. Phase 1 wheel constants, WASD constants, Plan View duration — all unchanged.

### Toolbar restyle plumbing — new `useNavMode` hook + CSS

Two small additions:

1. **`src/editor/lib/nav-experimental/useNavMode.js`** — Zustand selector or React hook that subscribes to `nav-experimental:modechange` from the active `ExperimentalControls` instance and re-renders. Exports `isPedestalMode: boolean`.
2. **`Main.module.scss` / `ToolbarWrapper.module.scss`** — new class `.pedestalMode` that overrides the floating-toolbar geometry (`width: 100vw`, `left: 0`, `right: 0`, `background: #000`, `transition: all 200ms ease-out`).
3. **`ToolbarWrapper.jsx`** and the bottom-toolbar wrapper — read the hook, conditionally apply the class. **Tail-debounce the class application by ~100ms** (per A9) to absorb rapid toggles when a Shift+LB tilt crosses 30° on a single frame (large mouse delta or trackpad burst). Implementation: keep a small `useEffect` that delays applying the new class until `isPedestalMode` has been stable for the debounce window; the underlying mode-change *event* is uncoalesced for any subscriber that needs the immediate value.

Flag-off (no `?nav=experimental`) — no `ExperimentalControls` instance exists, hook returns `false`, toolbars never restyle.

## Truth table — rotation center

Six cases, plus the angular blend:

"Tilt" here is the angle below horizontal (positive = looking down, negative = looking up). The blend triggers only on the looking-down side; looking-up always falls into the Rule 2/3 branch.

| Tilt          | Bounded? | Inside AABB? | Center            |
|---------------|----------|--------------|-------------------|
| > 30°         | —        | —            | Screen-center hit (Rule 1; falls back to ruleAB if null) |
| 20–30°        | Yes      | No           | lerp(diorama @ eye-height, screen-hit) — feathered live |
| 20–30°        | Yes      | Yes          | lerp(camera-pos, screen-hit) — feathered live |
| 20–30°        | No       | n/a          | lerp(camera-pos, screen-hit) — Rule 3, no feathering needed |
| 0–20°         | Yes      | No           | Diorama center @ eye-height (1.5m) — feathered live |
| 0–20°         | Yes      | Yes          | Camera position — feathered live |
| 0–20°         | No       | n/a          | Camera position |
| < 0° (looking up) | Yes      | No           | Diorama center @ eye-height — feathered live |
| < 0° (looking up) | Yes      | Yes          | Camera position — feathered live |
| < 0° (looking up) | No       | n/a          | Camera position |

"Tilt" is angle below horizontal; positive = looking down, negative = looking up. The Rule-1-vs-Rule-2/3-group split is always at +30° down — looking up is always Rule 2/3. "Feathered live" means `_computeRuleAB` runs each Shift+LB move (per A4 always-on rule), smoothstepping between Rule 2 and Rule 3 across the AABB edge — feather extends outward from the AABB by `SCENE_FEATHER_METRES`.

Worth pinning into the code as the comment header on `_decideRotationCenter`.

## Deliverables

1. **`MIN_TILT_DEGREES` lowered** to −89 (and `MAX_TILT_DEGREES = +89`) so the user can drive from near-straight-up through horizontal to near-straight-down.
2. **`_decideLbMode` and `_decideRotationCenter`** in `ExperimentalControls`, with unit-testable shape (pure given camera + bounds — feed test fixtures).
3. **`_lbPedestalMove`** branch implemented, mirroring `_lbTruckMove` for the vertical plane.
4. **Mode-change emission** for the visual indicator: emit on every `_shiftRotate` move-event when the LB-mode comparator flips, on `_onMouseDown` (LB-only path catches stale-from-tween states, per A6), and on Plan View / focus-animation `onDone` callbacks.
5. **`useNavMode` hook** + toolbar CSS class + `ToolbarWrapper` integration.
6. **Unit tests** for `_decideLbMode` (boundary at 30°), `_decideRotationCenter` (each truth-table row, plus blend at 25°), and the angular smoothstep math.
7. **Manual smoke test** covering each new mechanic, plus regression coverage of Phase 1.
8. **First feel-test pass** on the basic-street default scene + at least one bounded multi-segment scene + one unbounded `street-geo` scene.

## Task breakdown

Sittings (1–3h focused blocks). Suggested order:

1. **`_cameraTiltDegrees` helper + `_decideLbMode`** with tests. Tiny but unblocks everything else. ~0.5 sitting.
2. **`_decideRotationCenter` with the truth table + blend** with tests. ~1 sitting.
3. **Lower `MIN_TILT_DEGREES` to −89, add `MAX_TILT_DEGREES`**, verify nothing else broke. ~0.5 sitting. Includes a 5-min `grep` (per A10) for `MIN_TILT_DEGREES` / `MAX_TILT_DEGREES` references across the codebase to confirm the clamps are read only by `_shiftRotate` — no defensive uses elsewhere that could bite the Plan View tween or future swoop.
4. **`_lbPedestalMove`** — vertical-plane anchored translation. The math is the riskiest piece — walk through it on paper before coding. ~1–1.5 sittings.
5. **Wire `_onMouseDown` / `_onMouseMove`** to the new sub-mode dispatch. ~0.5 sitting.
6. **`useNavMode` hook + toolbar CSS + `ToolbarWrapper` wiring.** ~1 sitting. **Pre-task 15-min spike** (per A11) before committing to a discovery path: instrument `sceneEl` and the active controls instance with logs through a Plan View transition + camera-swap cycle, confirm `sceneEl` is stable across the swap. If yes, ship (b) event-bus-on-`sceneEl`; if no (sceneEl gets recreated), fall back to (a) Zustand slot. Decision recorded in this plan once the spike runs.
7. **Mode-change emission** — wire emit-on-`_shiftRotate-move`, emit-on-`_onMouseDown`, and emit on Plan-View/focus-animation `onDone` (per A6 + Open Design Call #2). Care needed to not double-fire during fast gesture sequences. ~0.5 sitting.
8. **Smoke test pass** end-to-end on the basic-street scene. ~1 sitting.
9. **Real-scene smoke pass** — Streetmix import, `street-geo` scene, single intersection. Captures `SceneBounds` correctness gaps. ~1 sitting.
10. **Tune blend constants and toolbar timing** based on feel. Time-boxed to 1 sitting; if it overruns, that's a signal to log issues rather than keep tuning.

Total: ~7–8 sittings. The math-heavy items (pedestal vertical-plane anchor, rotation-center blend) and the visual indicator are the highest-risk for time overrun.

## Risks

- **The 30° hard-cut feels jarring on LB+drag.** This is the load-bearing UX question. If it does, the angular-blend technique used for rotation center is *not* applicable here — truck/dolly and truck/pedestal can't be linearly blended without producing the very "drift up and forward" feel the proposal wants to avoid. Mitigation paths if it feels bad: (a) visual indicator is strong enough that the user adapts; (b) widen the cutoff to a small dead-band (e.g. 25–35° = "either mode is fine, last gesture wins"); (c) revisit the proposal. Capture the feel-test result before reaching for fixes.

- **Vertical-plane anchored pedestal math drift.** The horizontal-plane case in Phase 1 is numerically robust because the plane y-coordinate equals the latched anchor's y. Vertical-plane analogue: ray-plane intersection numerics can blow up when the camera is nearly looking parallel to the plane normal (i.e. drag-direction parallel to camera +X — won't happen in practice, but worth a guard). Mitigation: reuse the 5000m sanity cap from `_lbTruckMove`.

- ~~**Rotation-centre hunting near the cylinder boundary.**~~ **Resolved post-feel-test (2026-05-10):** moot — the rotation centre is fully latched at gesture start (per Open Design Call #3 current state), so there is no per-frame recompute to hunt. The two live-recompute variants that *would* have had this risk were ruled out at feel-test for unrelated reasons (judder; "absolutely terrible"). See Open Design Call #3 for the trail.

- **Rapid sideways transition during long Shift+LB rotations from outside small scenes.** With the latched rotation centre, a long yaw outside a small scene (e.g. starting 10m off the side of a 5m-wide street) orbits the camera around the latched diorama centre at the start-of-gesture radius — for a 50m radius and a 90° yaw, the camera moves ~50m sideways through the scene during the gesture. This is the trade-off explicitly accepted by ruling out live recompute (per Open Design Call #3). Mitigation: user releases Shift+LB and re-engages to switch the latched centre. Smoke item F4 covers feel-test characterisation; if the trade-off proves unacceptable in practice, the next escalation is a non-result-blend live design that hasn't been tried yet (e.g. quaternion slerp of independent rotations) — but only if the latched feel falls short.

- **`SceneBounds` correctness on real scenes.** Phase 1 only tested the basic-street default scene. Phase 2 puts `getBounds()` on a hot-ish path. Smoke item #9 is the validation — if Streetmix imports give garbage bounds, rotation centers will be garbage. Plan to debug-render the AABB rectangle (and optionally the cylinder) during the real-scene smoke pass (transient `<a-entity>` overlay, removed after testing).

- **Toolbar restyle is distracting, not informative.** Already flagged in the skeleton. The CSS transition over 200ms is meant to make the change feel deliberate; if it instead looks like a glitch, the lower-effort fallbacks from the overall plan (cursor-shape change, accent-color overlay, mode badge) are next options. Plan a feel-test exit criterion: "after 30 seconds of use, do I need to look at the toolbars to know what mode I'm in?" — answer should be "no".

- **Toolbar restyle "predictor-of-next-LB" framing may not read intuitively** (per A14). The current spec persists the indicator between gestures (e.g. after a Shift+LB tilt below 30°, toolbars stay restyled until the next tilt above 30°). Most users don't intuit "this chrome reflects what the next gesture will do, not the current one". If F5 comes back ambiguous, the simpler fallback is "toolbar restyle only while an LB-drag is active in pedestal mode" — reflects the *active* gesture rather than predicting the next. Less ambitious, possibly clearer; logged here so we don't have to redesign during feel-test if the predictor framing fails.

- **`MIN_TILT_DEGREES = -89` might collide with Plan View end-pose.** Plan View tweens to a near-vertical down orientation (90° tilt). Clamp now bookends both directions (`MIN = -89`, `MAX = +89`). The clamps live in `_shiftRotate`, not in the Plan View tween, so the tween is unaffected — but worth re-reading the clamp branch to confirm no defensive clamp bites the animation.

- **Mode-emission cadence.** Resolved as (b) — emit on every Shift+LB move when the computed mode differs from the last-emitted mode (Open Design Call #2). Edge case: rapid tilt across the 30° boundary and back within a single frame (could happen with large mouse-move deltas or trackpad bursts) — the comparator catches it but the toolbar restyle may flicker. Mitigation if observed: debounce the *style* application by 50–100ms while keeping the mode-change event uncoalesced.

- ~~**Bounds cylinder for "long thin" scenes.**~~ **Resolved post-implementation (2026-05-09):** the inside/outside test is now AABB-based, not cylinder-based, so a camera 10m off the side of a 100m × 5m street is correctly outside the scene and orbits the diorama. The cylinder is still computed (Plan View framing reads its radius) but no longer participates in rotation-center selection. The remaining risk in this neighbourhood is the choice of `SCENE_FEATHER_METRES = 5` — too narrow makes the transition feel jumpy on small scenes, too wide makes it mushy on city-scale scenes. Initial pick to evaluate in feel-test F4.

## Exit criteria

Phase 2 is done when:

- [ ] All Phase 2 mechanics implemented per the spec above.
- [ ] All Phase 0 + Phase 1 unit tests still pass; new tests added for `_decideLbMode`, `_decideRotationCenter`, and the angular blend.
- [ ] Smoke test passes end-to-end against the basic-street default scene + at least one Streetmix-imported scene + one `street-geo` scene + one bare-intersection scene.
- [ ] First feel-test against the design intent documented (notes captured in this plan or a follow-up section, mirroring Phase 1's "feel-test notes" section).
- [ ] Visual indicator (toolbar restyle) deemed informative-not-distracting after 30s of use, OR a fallback indicator chosen and implemented.
- [ ] Sub-branch (if used) merged back to `navigation`.

## Smoke test checklist

URL: **http://localhost:3333/?nav=experimental**, against each of the four test scenes in turn.

**Ordering note (per A13).** The smoke checklist assumes Phase 2 lands as a single deliverable. If implementation is split across multiple PRs, individual items have prerequisites:

- **L8b, R7, R8, F6b** require Task 3 (lowered `MIN_TILT_DEGREES`) — can't tilt up before the clamp lifts.
- **L3–L7** require Tasks 1+4 (`_decideLbMode` + `_lbPedestalMove`).
- **R2–R5** require Task 2 (`_decideRotationCenter` pipeline) + Task 3.
- **V1–V3** require Tasks 6+7 (toolbar wiring + mode emission).
- **S1–S4** require everything but Tasks 9–10.

In a multi-PR rollout, mark prerequisite-blocked items as N/A in the interim rather than failing them.

### LB+drag — truck/dolly above 30° (regression of Phase 1)

- [ ] **L1.** Camera at high altitude (>30° tilt). LB-drag right — world slides right; Y unchanged. Same feel as Phase 1.
- [ ] **L2.** Toolbars stay floating (not restyled). Visual indicator = "truck mode".

### LB+drag — truck/pedestal (≤30° down through near-straight-up; new)

- [ ] **L3.** Tilt camera to ~20° via Shift+LB. Release. Toolbars restyle to full-width black strips.
- [ ] **L4.** LB-drag right — camera trucks in the screen-right horizontal direction. Y unchanged.
- [ ] **L5.** LB-drag down — camera moves up (world goes down). Tilt unchanged.
- [ ] **L6.** LB-drag diagonal — camera moves in the corresponding screen-right + screen-up directions, no tilt change.
- [ ] **L7.** Speed-scales-with-height feel preserved (slow at street level, faster up high).

### Mode boundary (30° hard-cut)

- [ ] **L8.** At ~31° tilt, LB-drag — truck/dolly. At ~29° tilt, LB-drag — truck/pedestal. No mid-gesture mode flip.
- [ ] **L8b.** Camera tilted up (negative tilt, e.g. looking 20° above horizontal): LB-drag is **truck/pedestal**, not truck/dolly. Toolbars in pedestal-mode styling.
- [ ] **L9.** During a Shift+LB tilt that crosses 30°, the toolbar restyle happens *during* the gesture, the moment the boundary is crossed (per Open Design Call #2). No flicker, no lag until release.

### Shift+LB — rotation center rules

- [ ] **R1.** Tilt > 30°: rotation center = screen-center hit (Phase 1 behavior preserved).
- [ ] **R2.** Tilt ≤ 20° (incl. looking up), scene bounded, camera outside scene AABB (more than `SCENE_FEATHER_METRES` past the edge): rotation center = scene-center at eye-height (1.5m). View orbits around the diorama.
- [ ] **R3.** Tilt ≤ 20° (incl. looking up), scene bounded, camera inside scene AABB: rotation center = camera position. Street-View-like in-place pan.
- [ ] **R4.** Tilt ≤ 20° (incl. looking up), scene unbounded (`street-geo` scene): rotation center = camera position regardless of position.
- [ ] **R5.** Tilt = +25° (mid-blend, looking down): rotation center is between screen-hit and rule-2/3. Smooth, no hunting.
- [ ] **R5b.** Tilt = −25° (looking up): rotation center is **not** in the blend zone — it's pure ruleAB (per the truth table, looking-up always falls into Rule 2/3 with no Rule-1 blend). Verify the blend code path is gated correctly.
- [ ] **R6.** Tilt clamp engages near +89° (looking nearly straight down). Same behavior as Phase 1's +89°-from-vertical floor.
- [ ] **R7.** Tilt clamp engages near −89° (looking nearly straight up). Symmetric counterpart to R6. No jitter at either extreme.
- [ ] **R8.** At street level (camera y ≈ 1.5m), Shift+LB drag-up tilts the camera up toward looking at buildings. Camera does **not** dip underground; arc orbits cleanly around the eye-height rotation center. Tilt clamp engages near −89° (looking nearly straight up).

### Visual indicator — toolbar restyle

- [ ] **V1.** Truck/dolly mode → floating toolbars (default).
- [ ] **V2.** Truck/pedestal mode → full-width black strips. Transition feels deliberate, not glitchy.
- [ ] **V3.** After 30s of mixed use: do I know what mode I'm in without checking? *Pass criterion is qualitative.*

### `SceneBounds` correctness on real scenes

- [ ] **S1.** Streetmix import (multi-segment): rotation centers in Rule 2 land at scene mid-point, not at one end of the street.
- [ ] **S2.** `street-geo` scene: `bounds.bounded === false`. Rule 3 (rotate-in-place) always applies at low tilt regardless of camera position.
- [ ] **S3.** Bare-intersection scene: bounds derived from the intersection alone. Rule 2 center = intersection center.
- [ ] **S4.** Add an entity mid-test (e.g. drop a building from the asset library). Rule 2 center moves to reflect the new bounds. (Cache invalidates correctly.)

### Compatibility regressions

- [ ] **C1.** Wheel zoom (Phase 1) unchanged: cursor-anchored, exponential, tilt-preserving.
- [ ] **C2.** WASD (Phase 1) unchanged: horizontal motion, ramp, Plan-View degenerate case.
- [ ] **C3.** Plan View animation (Phase 1) unchanged: ~1s ease, end-pose framing.
- [ ] **C4.** ActionBar zoom-in/out/reset still work.
- [ ] **C5.** Double-click an entity — focus animation tweens correctly.
- [ ] **C6.** Drag a transform gizmo — no camera pan; gizmo not raycast-anchored.
- [ ] **C7.** Console hygiene: only the `[nav-experimental]` debug log if `?navDebug=true`, no errors.

### Feel-test against design intent

For each, write a one-line feel note:

- [ ] **F1.** 30° hard-cut on LB+drag (down side; and the looking-up branch) — does mode-flipping at gesture start feel acceptable, or jarring?
- [ ] **F2.** Rotation-center diorama mode — does Rule 2 feel like "the world rotates around the scene", or weird?
- [ ] **F3.** Rotation-center in-place mode — does Rule 3 feel like Street View, or disorienting?
- [ ] **F4.** Angular blend (20–30°) — smooth, or does it hunt/spiral? Does the AABB-edge feather (`SCENE_FEATHER_METRES = 5`) feel right at street scale and city scale, or does it need tuning?
- [ ] **F5.** Toolbar restyle — informative (good) or distracting (bad)?
- [ ] **F6.** Driving the camera all the way down to street level via Shift+LB — does it feel like a continuous gesture, or is there a discontinuity at any point?
- [ ] **F6b.** From street level, looking up at buildings via Shift+LB — does the camera arc feel natural, or does the eye-height rotation center cause weirdness?
- [ ] **F7.** Overall: is street-level usable in this prototype?

The F-row notes are the load-bearing output of Phase 2.

## Open design calls

### 1. Diorama-center y-coordinate (Rule 2)

Updated post-review (item #7): Rule 2 center y = **eye-height (1.5m)** rather than ground (0m). The eye-height choice prevents the camera arcing underground when the user enables looking-up via the lowered MIN_TILT_DEGREES.

- **(a) Eye-height (resolved).** Center = `(bounds.center.x, 1.5, bounds.center.z)`. Pairs with `MIN_TILT_DEGREES = -89` to allow looking up at buildings without underground dipping.
- **(b) Ground-clamp.** Center y=0. Was the initial pick; rejected because it lets the camera arc underground when tilt goes negative.
- **(c) AABB center y.** Center = `bounds.center` y as derived. Rejected — fragile for elevated geometry.

**Resolved: (a) eye-height (1.5m).** Assumes flat ground at y=0; elevated-terrain scenes (e.g. bounded geo-located scenes, if any) are a known Phase 2 gap. Deferred per inline discussion #4.

### 2. Mode-flip emission timing for visual indicator

- **(a) On mouseup only.** Simple. Indicator updates after each gesture. Feels laggy when a Shift+LB tilt visibly crosses 30° before release.
- **(b) On every Shift+LB move when the computed mode differs from the last-emitted mode.** Cheap (~1 cmp/frame). Indicator updates the moment the tilt crosses the threshold, even mid-drag.

**Resolved: (b).** Confirmed during review — (a) feels laggy.

### 3. Scene-boundary feathering

> **Current state (2026-05-10): fully-latched feather-blended centre.** Boundary is the scene AABB; feather is `SCENE_FEATHER_METRES = 5` extending outward from the AABB edge; the feather-blended centre is computed once at Shift+LB-down from the live camera state and held for the duration of the drag. The next Shift+LB-down re-evaluates and picks a fresh centre. See revision blocks below for the trail (cylinder → AABB; live-recompute attempted twice, both ruled out at feel-test).

The proposal mentions "weighted blend in the zone around the edge of the scene bounds" between Rule 2 (outside) and Rule 3 (inside).

- **(a) Defer.** Don't implement. Rule 2/3 are sharp transitions but only manifest when the camera is exactly on the boundary mid-gesture.
- **(b) Implement now, per-frame.** Smoothstep Rule 2 ↔ Rule 3 *and* recompute live during the gesture (Rule 2/3 not latched).

**Resolved post-feel-test (2026-05-10): neither (a) nor (b) — implement now, but compute once at gesture start.** Initial pre-implementation pick was (b); two live-recompute variants were tried and ruled out (see revision blocks below). The shipped design feathers at *latch time* only: the inside/outside-AABB blend uses the live camera position at Shift+LB-down to produce a fixed Vector3 centre that's held for the gesture. This gives the smoothstep feathering the proposal asked for without introducing the feedback loop that the live designs surface during a rotate. Trade-off: a long Shift+LB rotation that geometrically arcs the camera across the AABB edge will continue orbiting the latched point even when the camera is now "in" the scene — judged the least-bad option after both live variants felt worse. The user can release Shift+LB and re-engage to switch modes.

**Boundary geometry — post-implementation revision (2026-05-09).** The original spec used the SceneBounds *cylinder* (`max(width, depth) / 2` radius) as the inside/outside boundary, with the feather being 10% of that radius. Implementation surfaced that this was the wrong boundary: a 100m × 5m street produces a 50m-radius cylinder, and the user feels "outside" the street long before they're 50m away. The boundary is now the scene's *AABB rectangle*, with the feather extending outward from the rectangle edge by `SCENE_FEATHER_METRES = 5`. The cylinder is still computed (Plan View needs it for framing) but no longer participates in rotation-centre selection. This change is what inline discussion item #2 in the planning notes was actually pointing at — the planning trail captured the right diagnosis ("the *width* of the cylinder is still wrong — feathering only smooths the edge, doesn't move it") but didn't propagate the change into the Mechanics / Architecture / Truth Table sections, which kept saying "cylinder" through the adversarial review and into the implementation. Caught at feel-test time.

**Live-recompute attempt #1 — blend-the-centres (2026-05-09, ruled out).** Resolution (b) above committed to per-frame Rule 2 ↔ Rule 3 recompute during the gesture: each frame, `_updateLiveRuleAB` re-blended `center = lerp(camPos, diorama, w)` from the live camera position, then `_shiftRotate` orbited around that centre and `lookAt(center)`. Feel-test confirmed visible judder near the AABB edge: the camera position changes only because of the orbit math, and feeding it back into the centre created a feedback loop. Reverted.

**Live-recompute attempt #2 — blend-the-rotation-results (2026-05-10, ruled out).** Diagnosis of attempt #1's judder was that orientation collapsed to "always look at diorama" through the feather (because `lookAt(centre)` of a centre on the cam-to-diorama line always points at diorama, regardless of yaw input). Fix attempt: compute three candidate `(pos, dir)` pairs each frame (rotate-in-place / orbit-diorama / orbit-screenHit) from the same start-of-frame state, blend their positions with `lerpVectors` and their unit direction vectors with re-normalised lerp, post-blend re-clamp view tilt. Implemented per `claude/specs/001-phase-2-rotation-blend.md` (on branch `navigation-phase2-nolatch`); two adversarial reviews (`claude/reports/001-phase-2-rotation-blend-review.md` and `002-phase-2-rotation-blend-code-review.md` on the branch). Feel-tested: "absolutely terrible". Code preserved on the branch for reference but not viable. Reverted to the latched design above.

**What we learnt.** Live recompute of the rotation centre during a Shift+LB gesture is not workable — both blend-the-centres and blend-the-rotation-results variants surface artefacts the user finds worse than the trade-off of a fully-latched centre (rapid sideways transition through small scenes during long yaws). The latched design is what ships.

### 4. WASD direction at low tilt

Phase 1's WASD model uses camera-yaw-projected horizontal motion. At low tilt this should still work fine — the camera's −Z direction has plenty of horizontal projection. But it's worth verifying in feel-test that "W moves me forward at street level" feels right, given that "forward" is now intuitively along the street rather than down at it.

**Recommended:** no change to WASD. Verify in F6.

### 5. Test scenes for Phase 2 evaluation

Per overall plan §3, Phase 1 was basic-street-only. Phase 2 needs more variety because `SceneBounds` correctness is at stake.

**Recommended set:** basic-street default; one Streetmix import (e.g. the demo URL); one `street-geo` scene with `google-maps-aerial`; one bare-intersection scene. Logged as smoke items S1–S4.

---

All design calls have a recommended resolution. Implementation can start; calls can be revisited if feel-test contradicts the recommendation.

## What this document is NOT

- Not a final design for the visual indicator. The toolbar restyle is the primary candidate; lower-effort fallbacks (cursor change, accent overlay, badge) stay on the table if it doesn't feel right.
- Not the Phase 3 plan. Wheel zoom remains Phase 1's cursor-anchored exponential dolly throughout Phase 2; the swoop is Phase 3's job.
- ~~Not the cylinder-feathering implementation. Deferred per Open Design Call #3.~~ Updated post-implementation: scene-edge feathering *is* implemented (AABB-based, 5m outward), per the resolution of Open Design Call #3.

---

## Items surfaced during planning — for review pass

These came up while writing the plan above. Captured here as a discussion list so the review can address them inline (`//!!` / `//**` markers). Roughly ordered by how much each could change the shape of the implementation.

### Load-bearing — could change the implementation

1. **Pedestal vertical-plane anchor math is not paper-derived.** The plan specifies "vertical plane through anchor, normal = horizontal projection of camera +X" but I haven't actually walked the math on paper. The Phase 1 horizontal-plane case is numerically robust because the latched plane's y = anchor.y, so a vertical drag changes the cursor's intersection with that plane in a predictable way. The vertical-plane analogue has a less obvious "what's the right plane normal?" question — I picked screen-right (camera +X projected horizontal), but an alternative is "plane perpendicular to the cursor's view ray at the anchor depth". The screen-right choice keeps anchor-X behavior identical to LB-truck and gives anchor-Y behavior that scales linearly with vertical drag, which seems right, but worth a reviewer's sanity check before I commit to it.
//!! discussed further, and agreed with agent that:
//!! "item #1 isn't really "is the plane normal a sensible choice?" — it's "I picked the wrong axis when writing the spec, and the right answer is
//!! camera-forward-horizontal, not camera-right-horizontal." Once paper-derived, it's an unambiguous fix. I should correct the spec rather than leave the wrong version sitting there for the reviewer to trip over."
//** Fixed upstream. The LB+drag mechanics section now specifies the plane normal as camera-forward-horizontal (camera -Z projected onto the horizontal plane); the `_lbPedestalMove` architecture section was updated to match.

2. **`SceneBounds` cylinder is probably wrong for long-thin scenes in Rule 2/3 evaluation.** Existing `SceneBounds` uses `max(width, depth) / 2` as the radius. For a 100m × 5m street that's a 50m-radius cylinder, so a camera 10m off the side is *inside* — meaning Rule 3 (rotate-in-place) fires, not Rule 2 (diorama center). The plan's Risks section flags this as "matches proposal intent", but on reflection a user 10m off the side of a 5m-wide street probably doesn't intuit "I am inside the scene". The proposal called the original AABB-radius approach a "long narrow street pathology" and the cylindrical fix doesn't actually escape it — it just moves the pathology from "rotation point 25m down the street" to "rotate-in-place when standing next to the street". Possible answers: (a) use `min(width, depth) / 2` instead, accepting that *both* ends of the street are then "outside"; (b) introduce a separate, smaller "core" radius for the inside/outside test, distinct from the cylinder used for diorama-center positioning; (c) live with it and let feel-test decide. Reviewer's pick?
//!! Agree this is a potential issue.  When I am 5m outside a long thin street I do feel "outside" the scene.  But if we rotate about the scene center (with latching for rotation center), I will soon be moving quickly horizontally across the street which is the situation we are trying to avoid.  One option might be to not latch the rotation center, so that when the user enters the sceme, rotation switches to user-centered?  Hard to imagin how that would feel - I'd be interested to try (probably with feathering as aleady intended for marginal cases)
//** Captured. This is a substantive change — it reverses the latch-at-start design for rule-2/3 specifically (Rule 1's screen-center hit can stay latched). It also makes cylinder-edge feathering load-bearing rather than deferred (Open Design Call #3). New approach for Phase 2 feel-test: try (i) latch the *rotation rule* (which of 2/3 applies) but recompute the *center position* live as the camera moves, so when the user enters the cylinder mid-gesture, the rotation point smoothly slides from diorama-center toward camera-position over the feather zone. The angular blend at 20-30° still latches because tilt doesn't change during a Shift+LB gesture without changing the latched mode itself. Will update the Mechanics, Architecture (`_decideRotationCenter` becomes a per-frame call rather than gesture-start), and Truth Table sections accordingly. Flagging as a candidate-to-feel-test rather than a hard spec change so we can revert if the per-frame recompute hunts.
//** Follow-up (2026-05-09, post-implementation): you were right that the cylinder was the wrong shape and feel-test confirmed it. The diagnosis ("the *width* of the cylinder is still wrong — feathering only smooths the edge, doesn't move it") was captured in the Risks section but didn't propagate into the implementation-facing sections — Mechanics, Architecture, Truth Table, and the post-implementation review all kept saying "cylinder". The fix landed late: the boundary is now the scene AABB and the feather extends 5m outward from the rectangle edge. SceneBounds still publishes the cylinder for Plan View framing. Updated upstream in Mechanics, Architecture/`_computeRuleAB` pseudocode, the constants block (`CYLINDER_FEATHER_FRACTION` → `SCENE_FEATHER_METRES`), the Truth Table heading, smoke items R2/R3, and Open Design Call #3.
//** Follow-up (2026-05-10, post-feel-test): your "don't latch the rotation centre" suggestion (i) was tried in two variants and both ruled out at feel-test. Variant 1 (blend-the-centres + lookAt(centre)) juddered near the AABB edge — the orbit math feeds the camera position back into the centre, creating a feedback loop. Variant 2 (blend-the-rotation-results: three independent candidates with their `(pos, dir)` blended) felt "absolutely terrible". Reverted to the latched design in cf4cd851. Trade-off accepted: a long Shift+LB rotation outside a small scene will arc the camera through the scene at the latched orbit radius (the "rapid sideways transition" you originally raised) — the user can release Shift+LB and re-engage to switch the latched centre. The two attempted live designs are preserved on branch `navigation-phase2-nolatch` along with their plan (`claude/specs/001-phase-2-rotation-blend.md`) and adversarial reviews (`claude/reports/001-phase-2-rotation-blend-review.md`, `002-phase-2-rotation-blend-code-review.md`); none of those files exist on `navigation`. The shipped Mechanics / Architecture / Truth Table / Risks sections describe the latched design.

3. **Mode-emission timing — am I picking the right one?** Two options in Open Design Call #2 (mouseup-only vs. every Shift+LB move); I recommended every-move for indicator feel. But the indicator reflects "what the *next* LB drag will do", which during an active Shift+LB tilt drag means toolbars restyle *while the user is tilting*. That's mid-gesture chrome motion in a phase where the user is focused on the camera. Mouseup-only is calmer and the resulting "tilt finishes, then toolbars settle" sequence might actually read better. I'd weakly defend the every-move choice but a reviewer might land the other way.
//!! Yes, agree (b) - (a) will feel laggy
//** Locked. Updated Open Design Call #2 to make (b) the resolved choice rather than a recommendation. Mode-emission happens on every Shift+LB move when the computed mode differs from the last-emitted mode.

4. **Diorama-center y-coordinate assumes flat ground.** Open Design Call #1 ground-clamps Rule 2's center to y=0. Fine for streets; possibly wrong for geo-located scenes with terrain. Phase 2's `street-geo` smoke test (S2) is the only non-flat scene in the test set and it's *unbounded*, so Rule 2 doesn't fire — the assumption is never exercised by the test set. Either: expand the test set with a bounded-but-elevated scene, or accept that Phase 2 validates only flat-ground scenes. The proposal doesn't say either way. Probably fine to defer but worth a sentence.
//!! this is relevant for Shift+LB+up/down, right?  tilt changes when rotation center is in the scene?  I agree this needs to be at groun level, not y=0 level.  But could defer that to a later phase...?
//** Yes, exactly that case — Shift+LB orbits around the latched rotation center, so if the center y is wrong (sky vs. ground vs. terrain) the tilt arc feels off. Agreed to defer the "ground level ≠ y=0" case to a later phase. Phase 2 keeps the y=0 ground-clamp; will note in Open Design Call #1 that elevated-terrain scenes (geo-located bounded scenes, if any) are a known Phase 2 gap. See item #7 below for the related but distinct change to rotation-center *elevation* (street + 1.5m) for street-view scenarios — that's not about terrain, it's about preventing the camera arcing underground.

### Smaller — probably don't change the shape

5. **Angular blend zone (20°–30°) is taken straight from the proposal with no calibration.** May need widening, narrowing, or different easing. Smoothstep was chosen as the obvious default; could be linear, cubic, or something else. No principled reason for any specific choice yet.
//!! Go with your choice and see.
//** Acknowledged. Sticking with smoothstep over 20–30° as the initial guess; will tune from feel.

6. **`useNavMode` hook plumbing is hand-waved.** The hook needs to locate the active `ExperimentalControls` instance to subscribe to `nav-experimental:modechange`. In flag-off mode there's no instance; in flag-on the hook needs a concrete subscription path. Three plausible options: (a) Zustand slot exposing the controls instance once viewport.js installs it; (b) event bus on `sceneEl` (controls dispatches there, hook subscribes there, no React-side coupling to the instance); (c) singleton module export from `nav-experimental/index.js`. I'd lean (b) since the controls already extend `THREE.EventDispatcher` and `sceneEl` is already a known mounting point, but I haven't checked whether `sceneEl` survives all the camera-swap paths cleanly.
//!! (b) sounds plausible.  Interested in reviewer's take on this.
//** Leaving open for reviewer. No upstream change yet — implementation will tentatively use (b) (event bus on `sceneEl`) but we'll defer the lock-in until reviewer weighs in.

7. **`MIN_TILT_DEGREES = 1` is unverified.** Picked for `lookAt` numerical safety without checking whether 0° actually breaks anything in three.js's spherical math. Could be 0; could need to be larger if nearly-horizontal `lookAt` produces visible roll wobble. Easy to tune but worth a reviewer asking "why 1?".
//!! I think users in a street scene may want to look up at buildings?  On the other hand, we don't want users to be able to rotate themselves underground.  Suggests center of rotation should not be at y=0 or street level, but rather y=1.5 or street level + 1.5?  I think MIN_TILT_DEGREES should possibly by -90?
//** Strong agree, this is a real insight. Two coupled changes: (i) `MIN_TILT_DEGREES = -90` (or close) so users can pitch up to look at buildings; (ii) Rule 2/3 rotation-center y = ~1.5m (eye level) rather than y=0 (ground), so a Shift+LB tilt-up gesture orbits around a point above the ground and the camera doesn't arc underground. The two changes are linked: without (ii), enabling (i) lets the camera dip below ground when tilting past horizontal; without (i), (ii) is unnecessary. Updating upstream:
//**   - Tilt clamp: MIN_TILT_DEGREES becomes -89 (slightly less than -90 for `lookAt` numerical safety at the singularity, mirroring the +89 floor on the down side).
//**   - Rule 2 center: y = 1.5 (eye level), not 0. Rule 3 (camera-position) is unchanged since the camera is already at its own y.
//**   - Constants: add `ROTATION_CENTER_EYE_HEIGHT_METRES = 1.5`.
//**   - Smoke test: add an R8 case ("Shift+LB tilt up at street level — no underground dip; camera looks up at buildings cleanly").
//** Also worth noting: when tilt goes negative (looking up), the `_decideLbMode` 30° cutoff isn't quite right — the LB-mode cut should probably be on |tilt|, or we should treat looking-up the same as low-tilt (truck/pedestal). Initial pick: cut on absolute tilt below 30° from horizontal (so looking-up to any angle = pedestal mode). Add to feel-test.

### Issues-for-discussion log

No new entries added to `claude/issues-for-discussion.md` during this planning pass. Items 2 and 4 above could become Kieran questions if Phase 2 feel-test confirms they bite, but holding off until evidence — the issues log shouldn't grow speculative.

---

## Adversarial review — 2026-05-09

Independent pass over the plan as written. Focus: internal inconsistencies, gaps, and edge cases the spec doesn't yet address. Ordered by how likely each is to cause real trouble during implementation or feel-test.

### Load-bearing — fix before coding

**A1. Pedestal plane normal is contradicted between the Mechanics and Architecture sections.** Item #1 in the planning-pass comments was resolved to "plane normal = camera-forward-horizontal" and line 49 reflects that fix. But `_lbPedestalMove` at line 159 still says `normal = screenRight (horizontal projection of camera +X)`. These are orthogonal directions — one of them is wrong. Per the resolved discussion, line 159 is the stale one and needs updating to match line 49 (camera-forward-horizontal, i.e. camera −Z projected onto the horizontal plane). If the implementer follows the architecture pseudocode literally, they'll build the wrong plane.

**A2. `_decideRotationCenter` pseudocode contradicts its own latching contract.** The function as shown (lines 128–151) is a pure function of current camera state — it recomputes `screenHit`, `ruleAB`, the cylinder test, and the lerp from scratch each call. But the surrounding prose (line 153 "Latching scope") says the high-level rule, the `screenHit`, and `ruleAB` (in the >20° branch) are all latched at gesture start, and only the inside/outside-cylinder sub-decision is live when `liveRuleAB` is set. The code doesn't take a latch parameter, doesn't read prior latch state, and has no branch for `liveRuleAB`. An implementer reading the code block will build a fully-live function and lose all the latching guarantees. Either rewrite the pseudocode to take latch state as input (and split into "compute-at-start" vs. "recompute-during-move" entry points), or replace the code block with prose plus the truth table. Right now the two are out of sync.

**A3. `screenHit` may be `null` (sky/horizon raycast miss) and the lerp will crash.** `_screenCenterHit()` returns the world-space point under the screen center; if the user is looking at sky with no terrain hit, there is no point. Phase 1 must already have a fallback for this in Rule 1, but the Phase 2 pseudocode does `THREE.Vector3().lerpVectors(ruleAB, screenHit, eased)` unconditionally in the 20–30° blend branch, and `screenHit` is always called even on `tiltDeg <= 20` paths where the result is unused. Spec needs to (a) define the fallback when `screenHit` is null (likely: collapse to `ruleAB`), and (b) defer the screen-hit raycast until the branch that needs it.

**A4. `liveRuleAB` activation threshold creates a discontinuity in feel.** The flag is set at gesture start "if camera is within ±10% of cylinder radius". So two near-identical gestures, one starting at 11% outside the cylinder and one at 9% outside, get fundamentally different rotation behavior — the first uses a stationary diorama center, the second feathers live as the camera moves. This is the kind of "two things that look the same behave differently" boundary that breeds bug reports. Options: (a) always use the live feather (simpler, but pays per-frame cost on every Shift+LB drag whether useful or not — cost is negligible per the spec, so this is probably the right move); (b) widen the activation zone substantially so the boundary feels less sharp; (c) accept and document. Recommend (a) — kills the discontinuity for free.

**A5. The `liveRuleAB` path doesn't specify `bounded === false` short-circuit.** When the scene is unbounded, there's no cylinder, so `ruleAB === camPos` always. `liveRuleAB` should be forced false in this case. Pseudocode at 153 doesn't say so explicitly. Trivial to fix but worth pinning.

### Smaller — fix or note before merging

**A6. LB-only gesture never updates the toolbar indicator.** The mode-emission rule (lines 188–198) only fires inside `_shiftRotate` (Shift+LB moves) and at gesture end. If the user has been doing LB-drags only — never Shift+LB — `_currentLbMode` is set at LB-down (via the latch) but never compared to a fresh evaluation. If the camera reaches a state where the *next* LB drag would be a different mode (e.g. an entity-double-click animation tweens the camera across the 30° boundary), the toolbar indicator won't reflect the new mode until the next Shift+LB gesture. Consider also recomputing on LB-down before the gesture latches, and emitting if changed. Same applies to wheel-zoom-induced tilt changes — there are none in Phase 2 (wheel preserves tilt) but Plan View tweens *do* change tilt without going through `_shiftRotate`.

**A7. The 5000m sanity-cap behavior isn't specified for `_lbPedestalMove`.** Phase 1's `_lbTruckMove` has the cap; the spec says "same 5000m sanity cap" (line 162) but doesn't say what happens when it triggers — does the camera freeze, snap-back, or clamp the delta? Whatever Phase 1 does is presumably fine to inherit, but the plan should name the behavior so the reader doesn't have to dig.

**A8. Truth table omits looking-up cases explicitly.** The table at lines 245–253 lumps "negative tilt" into the `≤ 20°` rows via the parenthetical "(incl. negative)". A reader scanning the table for "looking up by 60°" has to do the mental conversion. Consider adding two explicit rows for `< 0°` (looking up) for clarity. Same applies to smoke item R5 — only tests `tilt = 25°` (down side); should also test `tilt = -25°` to verify the looking-up branch never enters the blend.

**A9. Mode-emission "fast-flip flicker" mitigation is conditional.** Risk note (line 299) says "if observed, debounce the *style* application by 50–100ms". Better to define the behavior up front: rapid mode toggling on the Shift+LB tilt threshold is a real risk (large mouse delta + boundary crossing), and adding the debounce after the fact means one extra round of feel-testing. Cheap to add a 100ms tail-debounce to the CSS class application from day one.

**A10. `MIN_TILT_DEGREES = -89` interaction with Plan View not actually re-checked.** Risk note (line 297) says the clamp lives in `_shiftRotate`, not the Plan View tween, so the tween is unaffected — but qualifies "worth re-reading the clamp branch to confirm no defensive clamp bites the animation". This is listed as a risk but not as a task. Promote to a 5-minute item under Task #3 (lower MIN_TILT_DEGREES): grep for `MIN_TILT_DEGREES` and `MAX_TILT_DEGREES` usage and confirm only `_shiftRotate` reads them.

**A11. `useNavMode` instance-discovery path still unresolved (item #6 in planning notes, deferred to reviewer).** This isn't an architectural showstopper but the spec lists it as a Phase 2 deliverable (line 263). Picking and committing to one of (a/b/c) before coding avoids a mid-implementation rewrite. The (b) event-bus-on-`sceneEl` choice is the cheapest but the "does `sceneEl` survive camera-swap paths cleanly?" question is unanswered. Spike (15 minutes: log all `sceneEl` references during a Plan View transition + camera swap) before committing.

**A12. Eye-height constant placement is policy, not just a number.** `ROTATION_CENTER_EYE_HEIGHT_METRES = 1.5` is fine as a default but worth flagging that the constant name implies "human eye height" — for non-pedestrian scenes (drone, satellite) it's wrong. No action for Phase 2 (the scene set is street-scale), but a future scene-aware override is foreseeable. Worth a one-line comment on the constant.

**A13. Smoke item L8b can't actually be reached without first lowering `MIN_TILT_DEGREES`.** The smoke checklist orders items as if they're independent, but you can only test "camera tilted up by 20°" after the Phase 2 tilt clamp change has landed. Smoke ordering implicitly assumes all mechanics ship together; if the implementation is staged across more than one PR (and Task breakdown #3 is "Lower `MIN_TILT_DEGREES`" as a discrete sitting), L8b runs blank in the interim. Minor — call out which smoke items require which deliverables.

### Risks worth widening

**A14. The "predictor of the next LB drag" framing of the toolbar indicator (line 90) is subtle.** Most users won't intuit "this chrome reflects what the next gesture will do, not the current one". If feel-test F5 comes back ambiguous, consider whether the indicator should *only* show during a held LB-drag (reflecting the active mode) rather than persisting between gestures. The current spec is the more ambitious choice; mention the simpler alternative as a fallback in the risks.

**A15. No exit criterion for the cylinder-feathering hunting risk.** Risk A3 in the original Risks section says "if it hunts, fall back to fully-latched". But there's no objective threshold for "hunts" — feel-test is qualitative. Suggest a concrete trigger: "if during smoke item R5/F4 the rotation point visibly moves more than X cm/frame when the camera is held still near the boundary, latch fully". Otherwise the fallback decision drags into Phase 3.

### Things the plan got right (worth preserving)

- The decision in #2 to cut the LB-mode dispatch on absolute angle from horizontal (not signed tilt) is correct and the negative-tilt smoke cases (L8b, R7, R8, F6b) are well-targeted.
- The eye-height rotation center coupling to `MIN_TILT_DEGREES = -89` (item #7 resolution) is the right structural insight — those two changes should not be separable.
- The decision to keep wheel zoom unchanged from Phase 1 isolates the Phase 2 feel-test variables cleanly.
- The "F-row notes are the load-bearing output of Phase 2" framing keeps the goal honest — implementation completeness without feel-test answers is not "done".

### Suggested action list before starting Task #1

1. Fix A1 (pedestal plane normal in `_lbPedestalMove` architecture block).
2. Rewrite the `_decideRotationCenter` pseudocode (A2) — either as latch-aware or replace with prose.
3. Decide A4 (always-live feather vs. activation threshold) — recommend always-live.
4. Specify A3 (screenHit-null fallback).
5. Resolve A11 (`useNavMode` discovery path) with a 15-minute spike.
6. Add A8/A13 truth-table-and-smoke-ordering clarifications.

The remaining items can be tracked alongside implementation but won't change the shape of the code.

---

## Ready-to-implement note (2026-05-09)

Plan promoted from skeleton, inline-reviewed, adversarially reviewed, and post-review patches applied. All review items A1–A15 are either resolved in the spec body above or carried forward as feel-test risks. Open Design Calls #1–#3 are all resolved. Safe to `/clear` and start Phase 2 in a fresh context.

Reading order for the next session:

1. `claude/CLAUDE.md` — folder conventions and `//!!` / `//**` markers.
2. `claude/specs/001-overall-plan.md` — phase map.
3. `claude/specs/001-phase-2-plan.md` — this file. The "Mechanics — exact spec", "Architecture additions", "Truth table", "Task breakdown", and "Smoke test checklist" sections are the implementation-facing parts; the inline-discussion and adversarial-review sections at the bottom are the trail.
4. `claude/specs/001-phase-1-plan.md` — especially the "Phase 1 feel-test notes" section (lessons that should carry forward).
5. `src/editor/lib/nav-experimental/` — read fresh; the Phase 1 code is the substrate Phase 2 extends.

Entry point: **Task 1** (`_cameraTiltDegrees` + `_decideLbMode` with tests). Task ordering in §"Task breakdown" is the suggested sequence.

One open spike to resolve before Task 6: the `useNavMode` discovery-path question (A11). Plan is to spike (b) event-bus-on-`sceneEl`, fall back to (a) Zustand-slot if `sceneEl` doesn't survive camera swaps cleanly. 15 minutes; not blocking earlier tasks.

Issues-for-discussion log was reviewed during planning; no new entries added. Items surfaced from feel-test (especially anything near the cylinder-edge feathering in F4, the toolbar-restyle predictor framing in F5, and the long-thin-street pathology hinted at in §Risks) are candidates if they bite.
