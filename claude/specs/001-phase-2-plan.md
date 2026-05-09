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
- ~~No cylinder-boundary feathering yet.~~ **Updated post-review:** feathering *is* in scope (per inline discussion #2) — the long-thin-street pathology makes it load-bearing. Implemented as a per-frame Rule 2 ↔ Rule 3 lerp over a 10%-of-radius feather zone. See Open Design Call #3.
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
- **Rule 2 (tilt ≤ 30° including negative, scene bounded, camera outside cylinder):** scene bounds center at **eye-height** (`{bounds.center.x, ROTATION_CENTER_EYE_HEIGHT_METRES, bounds.center.z}`, default 1.5m). Eye-height (rather than y=0 ground) prevents the camera arcing underground when the user tilts up to look at buildings. Assumes flat ground at y=0; elevated-terrain scenes are a known Phase 2 gap (see Open Design Call #1).
- **Rule 3 (tilt ≤ 30° including negative, scene unbounded OR camera inside cylinder):** the camera position itself ("Street View"-style: rotate in place).

"Inside the cylinder" means `((cam.x - center.x)² + (cam.z - center.z)²) ≤ radius²`. Y is ignored — bounds are cylindrical.

**Angular blend (20–30°).** When the camera tilt at gesture start is between 20° and 30°, the latched rotation center is a **weighted lerp** between Rule 1's screen-center hit and the rule-2-or-3 center. Weight = `smoothstep(20°, 30°, tilt)` (so 20° → fully rule-2/3, 30° → fully rule-1). One smoothstep, latched once at gesture start. The blend is computed in world-space coordinates, not in tilt-angle space — once latched, the center is a fixed `Vector3` and the rotation math doesn't need to know the blend exists.

**Cylinder-edge feathering — provisionally per-frame, not latched.** Per inline discussion #2, the inside/outside-cylinder choice (Rule 2 ↔ Rule 3) is *not* fully latched at gesture start. Instead: latch which *high-level rule* applies (Rule 1 vs. Rule 2/3 group) but recompute Rule 2 ↔ Rule 3 live on each move. When the camera crosses the cylinder edge mid-gesture, the rotation center smoothly slides from diorama-center toward camera-position over a feather zone (default ±10% of cylinder radius), via a smoothstep on `(distance_to_axis − radius) / featherWidth`. This addresses the long-thin-street pathology where a camera 5m off the side of a 5m × 100m street is technically "inside" the cylinder but feels "outside" — as the user trucks closer to the street, the rotation point smoothly transitions from "scene center far down the road" to "rotate in place". Trade-off: per-frame `_decideRotationCenter` cost (~one Pythagoras + smoothstep, negligible) and a risk of hunting if the camera oscillates near the boundary. Counted as a Phase 2 feel-test risk; if it hunts, fall back to fully-latched.

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

### `sceneBounds.js` — new consumer, no API change

Phase 2 calls `bounds.getBounds()` from `_decideRotationCenter()` (see below). The cache invalidation semantics are unchanged — `getBounds()` returns the cached cylinder, recomputing only after an invalidating event.

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

#### `_decideRotationCenter(camera, screenCenterHit)` — pure, returns `Vector3` + blend metadata

```js
_decideRotationCenter(camera) {
  const tiltDeg = this._cameraTiltDegrees(camera);
  const screenHit = this._screenCenterHit();           // Rule 1 candidate
  const bounds = this._bounds.getBounds();             // cached
  const camPos = camera.position;
  const insideCyl = bounds.bounded
    && Math.hypot(camPos.x - bounds.center.x, camPos.z - bounds.center.z) <= bounds.radius;
  const ruleAB = (!bounds.bounded || insideCyl)
    ? camPos.clone()                                                          // Rule 3
    : new THREE.Vector3(                                                      // Rule 2
        bounds.center.x,
        ROTATION_CENTER_EYE_HEIGHT_METRES,
        bounds.center.z
      );

  // Looking up (negative tilt) always falls in Rule 2/3 — the blend
  // triggers only on the looking-down side, between 20° and 30° down.
  if (tiltDeg >= 30) return screenHit;
  if (tiltDeg <= 20) return ruleAB;          // includes all negative tilts
  const t = (tiltDeg - 20) / 10;             // 0 at 20°, 1 at 30°
  const eased = t * t * (3 - 2 * t);         // smoothstep
  return new THREE.Vector3().lerpVectors(ruleAB, screenHit, eased);
}
```

**Latching scope (post-review).** The high-level Rule-1-vs-Rule-2/3 dispatch is latched at gesture start (so the user doesn't get truck/dolly mode flipping mid-Shift+LB-drag). The `screenHit` and `ruleAB` *positions* used in the lerp are also latched at gesture start *for the >20° branches* — the blend output is a single latched `Vector3`. **Exception:** when the gesture starts in the Rule-2/3 group with `ruleAB` close to the cylinder boundary, switch to per-frame recomputation of just the inside/outside-cylinder feathered lerp (Open Design Call #3). Concretely: latch a flag `liveRuleAB` at gesture start (true if camera is within ±10% of cylinder radius, else false); when set, recompute `ruleAB` each `_shiftRotate` call by smoothstep-lerping between `cameraPos` and `dioramaCenter` based on the camera's live distance to the cylinder axis. `_shiftRotate` itself doesn't need to know — it just reads `this._latch.get('center')` (or, when `liveRuleAB`, the per-frame value the move handler stuffs back in).

#### `_lbPedestalMove(clientX, clientY)` — new branch alongside `_lbTruckMove`

Mirrors `_lbTruckMove` but operates on a vertical plane parallel to screen-X through the latched anchor point:

- At gesture start: latch `anchor` (cursor world hit) and `anchorPlane` = vertical plane through anchor, normal = `screenRight` (horizontal projection of camera +X).
- On move: raycast cursor against the latched plane; camera position += `(anchor - hitNow)` (still "grab the world"). Y component now varies; X/Z move along the screen-right horizontal direction.
- Same 5000m sanity cap as `_lbTruckMove`.

#### `_onMouseDown` — extend the dispatch

```js
_onMouseDown(event) {
  // ... existing inactive guard, _decideMouseMode call ...
  if (mode === 'pan') {
    const lbMode = this._decideLbMode(this._camera);
    // Latch anchor + sub-mode for use by _onMouseMove dispatch.
    if (lbMode === 'pan-truck') {
      // Phase 1 truck path, unchanged.
    } else {
      // Phase 2 pedestal path. Compute vertical-plane anchor.
    }
    this._latch.start({ mode: 'pan', subMode: lbMode, /* ... */ });
  } else if (mode === 'rotate') {
    const center = this._decideRotationCenter(this._camera);
    this._latch.start({ mode: 'rotate', center });
  }
  // ... emit modechange, attach window listeners ...
}
```

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
// is a known Phase 2 gap.
export const ROTATION_CENTER_EYE_HEIGHT_METRES = 1.5;
```

Nothing else moves in `constants.js`. Phase 1 wheel constants, WASD constants, Plan View duration — all unchanged.

### Toolbar restyle plumbing — new `useNavMode` hook + CSS

Two small additions:

1. **`src/editor/lib/nav-experimental/useNavMode.js`** — Zustand selector or React hook that subscribes to `nav-experimental:modechange` from the active `ExperimentalControls` instance and re-renders. Exports `isPedestalMode: boolean`.
2. **`Main.module.scss` / `ToolbarWrapper.module.scss`** — new class `.pedestalMode` that overrides the floating-toolbar geometry (`width: 100vw`, `left: 0`, `right: 0`, `background: #000`, `transition: all 200ms ease-out`).
3. **`ToolbarWrapper.jsx`** and the bottom-toolbar wrapper — read the hook, conditionally apply the class.

Flag-off (no `?nav=experimental`) — no `ExperimentalControls` instance exists, hook returns `false`, toolbars never restyle.

## Truth table — rotation center

Six cases, plus the angular blend:

"Tilt" here is the angle below horizontal (positive = looking down, negative = looking up). The blend triggers only on the looking-down side; looking-up always falls into the Rule 2/3 branch.

| Tilt           | Bounded? | Inside cyl? | Center            |
|----------------|----------|-------------|-------------------|
| > 30°          | —        | —           | Screen-center hit |
| 20–30°         | Yes      | No          | lerp(diorama @ eye-height, screen-hit) |
| 20–30°         | Yes      | Yes         | lerp(camera-pos, screen-hit) |
| 20–30°         | No       | n/a         | lerp(camera-pos, screen-hit) |
| ≤ 20° (incl. negative) | Yes | No       | Diorama center @ eye-height (1.5m) |
| ≤ 20° (incl. negative) | Yes | Yes      | Camera position |
| ≤ 20° (incl. negative) | No  | n/a      | Camera position |

Worth pinning into the code as the comment header on `_decideRotationCenter`.

## Deliverables

1. **`MIN_TILT_DEGREES` lowered** to −89 (and `MAX_TILT_DEGREES = +89`) so the user can drive from near-straight-up through horizontal to near-straight-down.
2. **`_decideLbMode` and `_decideRotationCenter`** in `ExperimentalControls`, with unit-testable shape (pure given camera + bounds — feed test fixtures).
3. **`_lbPedestalMove`** branch implemented, mirroring `_lbTruckMove` for the vertical plane.
4. **Mode-change emission on mouseup** for the visual indicator.
5. **`useNavMode` hook** + toolbar CSS class + `ToolbarWrapper` integration.
6. **Unit tests** for `_decideLbMode` (boundary at 30°), `_decideRotationCenter` (each truth-table row, plus blend at 25°), and the angular smoothstep math.
7. **Manual smoke test** covering each new mechanic, plus regression coverage of Phase 1.
8. **First feel-test pass** on the basic-street default scene + at least one bounded multi-segment scene + one unbounded `street-geo` scene.

## Task breakdown

Sittings (1–3h focused blocks). Suggested order:

1. **`_cameraTiltDegrees` helper + `_decideLbMode`** with tests. Tiny but unblocks everything else. ~0.5 sitting.
2. **`_decideRotationCenter` with the truth table + blend** with tests. ~1 sitting.
3. **Lower `MIN_TILT_DEGREES`**, verify nothing else broke (Plan View end-pose, WASD degenerate case). ~0.5 sitting.
4. **`_lbPedestalMove`** — vertical-plane anchored translation. The math is the riskiest piece — walk through it on paper before coding. ~1–1.5 sittings.
5. **Wire `_onMouseDown` / `_onMouseMove`** to the new sub-mode dispatch. ~0.5 sitting.
6. **`useNavMode` hook + toolbar CSS + `ToolbarWrapper` wiring.** ~1 sitting.
7. **Mode-change emission on mouse-up** — small but needs care to not double-fire during fast gesture sequences. ~0.5 sitting.
8. **Smoke test pass** end-to-end on the basic-street scene. ~1 sitting.
9. **Real-scene smoke pass** — Streetmix import, `street-geo` scene, single intersection. Captures `SceneBounds` correctness gaps. ~1 sitting.
10. **Tune blend constants and toolbar timing** based on feel. Time-boxed to 1 sitting; if it overruns, that's a signal to log issues rather than keep tuning.

Total: ~7–8 sittings. The math-heavy items (pedestal vertical-plane anchor, rotation-center blend) and the visual indicator are the highest-risk for time overrun.

## Risks

- **The 30° hard-cut feels jarring on LB+drag.** This is the load-bearing UX question. If it does, the angular-blend technique used for rotation center is *not* applicable here — truck/dolly and truck/pedestal can't be linearly blended without producing the very "drift up and forward" feel the proposal wants to avoid. Mitigation paths if it feels bad: (a) visual indicator is strong enough that the user adapts; (b) widen the cutoff to a small dead-band (e.g. 25–35° = "either mode is fine, last gesture wins"); (c) revisit the proposal. Capture the feel-test result before reaching for fixes.

- **Vertical-plane anchored pedestal math drift.** The horizontal-plane case in Phase 1 is numerically robust because the plane y-coordinate equals the latched anchor's y. Vertical-plane analogue: ray-plane intersection numerics can blow up when the camera is nearly looking parallel to the plane normal (i.e. drag-direction parallel to camera +X — won't happen in practice, but worth a guard). Mitigation: reuse the 5000m sanity cap from `_lbTruckMove`.

- **Rotation-center hunting near the cylinder boundary.** Per Open Design Call #3, Rule 2 ↔ Rule 3 is *not* latched — `ruleAB` is feathered per-frame when the gesture starts near the boundary. If the camera oscillates across the boundary during a drag, the rotation point hunts. Mitigation: 10%-of-radius feather zone + smoothstep should damp small oscillations. Fall-back: latch fully if hunting is observed in feel-test. The Rule-1-vs-Rule-2/3 high-level dispatch *is* still latched, so this risk only manifests within the Rule-2/3 family.

- **`SceneBounds` correctness on real scenes.** Phase 1 only tested the basic-street default scene. Phase 2 puts `getBounds()` on a hot-ish path. Smoke item #9 is the validation — if Streetmix imports give garbage bounds, rotation centers will be garbage. Plan to debug-render the cylinder during the real-scene smoke pass (transient `<a-entity>` overlay, removed after testing).

- **Toolbar restyle is distracting, not informative.** Already flagged in the skeleton. The CSS transition over 200ms is meant to make the change feel deliberate; if it instead looks like a glitch, the lower-effort fallbacks from the overall plan (cursor-shape change, accent-color overlay, mode badge) are next options. Plan a feel-test exit criterion: "after 30 seconds of use, do I need to look at the toolbars to know what mode I'm in?" — answer should be "no".

- **`MIN_TILT_DEGREES = -89` might collide with Plan View end-pose.** Plan View tweens to a near-vertical down orientation (90° tilt). Clamp now bookends both directions (`MIN = -89`, `MAX = +89`). The clamps live in `_shiftRotate`, not in the Plan View tween, so the tween is unaffected — but worth re-reading the clamp branch to confirm no defensive clamp bites the animation.

- **Mode-emission cadence.** Resolved as (b) — emit on every Shift+LB move when the computed mode differs from the last-emitted mode (Open Design Call #2). Edge case: rapid tilt across the 30° boundary and back within a single frame (could happen with large mouse-move deltas or trackpad bursts) — the comparator catches it but the toolbar restyle may flicker. Mitigation if observed: debounce the *style* application by 50–100ms while keeping the mode-change event uncoalesced.

- **Bounds cylinder for "long thin" scenes.** `SceneBounds` uses the larger horizontal half-extent as the radius (per the proposal's pathology mitigation). For a 100m × 5m street, that's a 50m-radius cylinder — a camera 10m off the side is *inside*, so Rule 3 applies, even though it intuitively feels "outside the scene". The cylinder-edge feathering (per inline discussion #2) plus the per-frame Rule 2 ↔ Rule 3 recompute partially mitigates: as the user trucks across the boundary the rotation point slides smoothly. But the *width* of the cylinder is still wrong — feathering only smooths the edge, doesn't move it. Could revisit with a smaller "core radius" or oriented cylinder if feel-test still feels off. Logged as a feel-test risk.

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
- [ ] **R2.** Tilt ≤ 20° (incl. looking up), scene bounded, camera outside cylinder: rotation center = scene-center at eye-height (1.5m). View orbits around the diorama.
- [ ] **R3.** Tilt ≤ 20° (incl. looking up), scene bounded, camera inside cylinder: rotation center = camera position. Street-View-like in-place pan.
- [ ] **R4.** Tilt ≤ 20° (incl. looking up), scene unbounded (`street-geo` scene): rotation center = camera position regardless of position.
- [ ] **R5.** Tilt = 25° (mid-blend): rotation center is between screen-hit and rule-2/3. Smooth, no hunting.
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
- [ ] **F4.** Angular blend (20–30°) — smooth, or does it hunt/spiral?
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

### 3. Cylinder-boundary feathering

The proposal mentions "weighted blend in the zone around the edge of the scene bounds" between Rule 2 (outside) and Rule 3 (inside).

- **(a) Defer.** Don't implement. Rule 2/3 are sharp transitions but only manifest when the camera is exactly on the cylinder boundary mid-gesture.
- **(b) Implement now, per-frame.** Width = 10% of cylinder radius, smoothstep Rule 2 ↔ Rule 3 *and* recompute live during the gesture (Rule 2/3 not latched).

**Resolved: (b)**, post-review (item #2). The long-thin-street pathology (`SceneBounds` cylinder swallows positions that feel "outside") makes feathering load-bearing rather than nice-to-have, *and* requires that the inside/outside choice not be latched. The Rule-1-vs-Rule-2/3 high-level dispatch *is* still latched (so the user doesn't get truck/dolly mode flipping mid-Shift+LB-drag). Only the inside/outside-cylinder sub-decision is live. Feel-test risk: hunting near the boundary. Fall-back: latch-at-start if hunting bites.

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
- Not the cylinder-feathering implementation. Deferred per Open Design Call #3.

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
