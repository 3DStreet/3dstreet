# 001 — Phase 1 Plan: Birds-Eye View, Top-Down to Gentle Tilt

*Working draft 2026-05-08. Will iterate.*

Phase 1 of the navigation prototype work (see `001-overall-plan.md`). First UX-testable slice. Replaces the Phase 0 placeholder LB-pan with the real birds-eye control set, while keeping tilt clamped at ≥30° (so low-tilt mode and bounds-based rotation stay deferred to Phase 2).

## Goals

1. Land a working birds-eye control scheme that's directly comparable to Google Maps in feel — that's the load-bearing UX question this phase answers.
2. Validate cursor-anchored zoom in isolation, before the swoop transition (Phase 3) layers on top.
3. Validate the WASD horizontal-motion model.
4. Establish the pattern for plan-view-style animated transitions (used again in Phase 3 / 5).
5. Keep the surface area honest — no Phase 2+ behavior leaks into Phase 1, even if it would be only one more `if`.

## Non-goals

- No tilt below 30°. (Phase 2 unlocks low-tilt and forces the bounds logic into existence.)
- No bounds-based rotation center. Pan/tilt rotates around a screen-center raycast hit, full stop.
- No Phase 2 transition or Phase 3 focal zoom. Wheel zoom is Phase-1-only — straight cursor-anchored dolly.
- No double-click navigation changes. (Phase 4.)
- No FPS mode. (Phase 5.)
- No touch / WebXR / ortho work.

## What Phase 0 left us with

- `ExperimentalControls` owns the editor camera when `?nav=experimental` is set; toggle is verified.
- `ModifierState` and `GestureLatch` are ready to consume.
- `SceneBounds` is ready but Phase 1 does not need it (Phase 2 is the first consumer).
- `focus()`, `newSceneCameraZoom`, ortho-disable behavior already in place — Phase 1 does not touch them.
- Placeholder LB-pan (`panSpeed: 0.002`, screen-space) is what Phase 1 replaces.
- A startup `console.info` from `ExperimentalControls` confirms flag-on; can be downgraded when convenient.

## Mechanics — exact spec

### LB+drag → world-horizontal truck/dolly

- Movement is in the **world horizontal plane** (y unchanged) regardless of camera tilt.
- **Hit-anchored model (locked):** at gesture start, raycast from cursor to find world hit-point H₀ (using the same `cursorAnchor` helper as wheel zoom — scene meshes minus gizmos and animated entities, with the no-hit fallback chain). On each move event, project the current cursor position onto the same horizontal plane (y = H₀.y) to get H_now. The camera moves by −(H_now − H₀) so that the original world point H₀ stays under the cursor for the duration of the drag.
- "Speed-scales-with-height" emerges automatically from this math: at high altitude, a horizontal screen-pixel moves a larger world distance.
- No tilt change.

### Shift+LB+drag → pan/tilt

- **Rotation center:** screen-center raycast hit, latched at gesture start. If raycast misses everything, fall back to ground-plane (y=0) intersection at screen center; if that's behind the camera, fall back to a fixed point 10m forward on the ground plane.
- Horizontal drag → orbit around that center (yaw).
- Vertical drag → tilt around that center.
- **Tilt clamp:** tilt is clamped to ≥30° (≥30° from horizontal, i.e. always at least somewhat looking down). Hitting the clamp stops further tilt — no spring-back, no resistance ramp, just a hard stop.
- Speed: matches Google Maps feel (similar to current `EditorControls.rotationSpeed: 0.0035`).

### Wheel → exponential cursor-anchored dolly

- Each wheel tick moves the camera along the ray from camera position through the cursor's current world hit-point.
- **Anchoring:** the world point under the cursor stays at the same screen pixel (mathematically: translating along that ray preserves the camera→hit direction, hence the screen projection of the hit-point).
- **Tilt-preserving by construction:** translation along the ray does not rotate the camera, so tilt is unchanged. This is structurally different from Google Maps' zoom (which re-aims the camera as part of the operation, and as a result drives tilt below 30° on far-horizon zooms). No tilt clamp is needed on the zoom path.
- **Exponential:** each tick moves the camera by a fixed *percentage* of the current camera-to-hit distance (e.g. 10% per tick). NOT a fixed metric distance.
- **Wheel-event normalization (locked):** raw wheel events are device-dependent (mice send `deltaY ≈ ±100` per click; trackpads send `deltaY ≈ ±1–4` at ~60Hz with an inertial tail; pinch gestures arrive as Ctrl+wheel). Phase 1 normalizes by accumulating `deltaY` (with `deltaMode`-aware scaling — pixel/line/page modes map to a common metric) into a "zoom budget" drained at a capped rate per A-Frame tick. Same gesture from any device produces approximately the same zoom motion.
- **No-hit fallback** (in order):
  1. Raycast against scene meshes — if hit, use that point.
  2. Else intersect the ray with ground plane y=0 — if the intersection is in front of the camera and within a sane distance (≤2km), use that.
  3. Else use a point 30m forward along the camera's view direction (plain camera-Z dolly).
- Tilt is preserved through the move.
- **Mid-zoom cursor movement:** each wheel tick re-raycasts. If the cursor is moving while wheeling, the anchor updates per tick (matches Google Maps).
- **Mac pinch (Ctrl+wheel):** Phase 1 treats Ctrl+wheel identically to plain wheel for now — both drive cursor-anchored dolly. The "fixed-tilt vs swoop" distinction lives in Phase 3, where the swoop transition lands. Phase 1 has no swoop, so the Ctrl modifier has nothing to differentiate.

### WASD → camera-yaw-projected horizontal motion

- Movement is **always in the horizontal plane** (y unchanged), regardless of camera tilt. This is true for all of Phase 1 — the 30° tilt clamp ensures the camera always has a coherent forward direction in horizontal world space.
- "Forward" (W) is the projection of the camera's −Z direction onto the horizontal plane, then normalized.
- **Degenerate case (camera looking straight down, after Plan View):** the camera's −Z direction projects to ~zero on the horizontal plane. Fall back to the camera's local +Y direction projected to horizontal — when the camera has no roll (true throughout Phase 1), this is the same direction the upper-screen-edge points to in world space, which is what the user intuits as "forward". For an upright camera with no roll, −Z and +Y project to the *same* horizontal direction differing only in magnitude, so use −Z whenever its horizontal-projection magnitude is > ~0.01, else fall back to +Y. No discontinuity in practice.
- A/D = strafe (perpendicular to W in the horizontal plane).
- S = reverse W.
- Speed proportional to camera height, with sane bounds (e.g. 5–500 m/s ramp).
- Multiple keys held = vector addition then re-normalized (so W+D moves at the same speed as W alone, just diagonally).

### Plan View action → animated reset to top-down

The "Plan View" action is currently surfaced in three places, all of which fire the same `cameraorthographictoggle` event with payload `'top'`:

- App menu: View → Plan View (`AppMenu.jsx`)
- Camera toolbar: the "Plan View" button alongside "3D View" (`CameraToolbar.component.jsx`)
- Keyboard shortcut (`shortcuts.js`)

Phase 1 intercepts that event in flag-on mode regardless of UI path:

- Do **not** switch to ortho. Instead, animate the perspective camera to a top-down view aligned with world North.
  - End pose: camera at current XZ, elevated (preserve current height or pick something based on scene bounds — implementation detail, tune in feel-test), looking straight down (−Y), oriented so screen-up = world +Z.
  - Animation: ~1s easeInOutQuad, routed through A-Frame's tick (consistent with `focus-animation`; no sibling RAF loop).
- Flag-off behavior is unchanged — the existing path switches to the ortho top camera as today.

**Top-level compass button (new UI affordance) — deferred to a separate UI ticket.** The proposal calls for surfacing reset-to-plan-view as a top-level compass-style button (analogous to Google Maps), not just a menu item. That UI work is out of scope for Phase 1 (which is controls + intercept logic only) — the intercept above means *any* trigger of the existing Plan View action gets the new behavior, so the menu item or toolbar button serves as the placeholder during Phase 1 prototyping. The compass button itself should land before Phase 2 feel-testing begins, so quick reset-to-plan-view is a single click rather than a menu dive. Tracked as `claude/issues-for-discussion.md` issue #5.

## Architecture additions

### New module: `cursorAnchor.js`

Exports a helper that, given a camera, a DOM event with `clientX/clientY`, and the scene root, returns the cursor's world hit-point with the no-hit fallback applied. Pure-ish: takes the scene/raycaster as an injected dependency for testability.

```
src/editor/lib/nav-experimental/cursorAnchor.js
```

API (sketch):

```js
export class CursorAnchor {
  constructor({ camera, sceneEl, domElement }) { ... }
  // Returns { x, y, z, source: 'mesh'|'ground'|'fallback' }
  worldPointAt(clientX, clientY) { ... }
  dispose() { ... }
}
```

The `source` field is for debugging / logging only.

### New module: `tickAnimator.js`

Encapsulates one-shot camera tweens (used by Plan View and reused later by Phase 3 swoop and Phase 5 transitions). Routes through A-Frame's `tick`, not RAF.

```
src/editor/lib/nav-experimental/tickAnimator.js
```

API (sketch):

```js
export class TickAnimator {
  constructor(sceneEl) { ... }
  // ease defaults to easeInOutQuad
  animate({ from, to, durationMs, ease, onTick, onDone }) { ... }
  cancel() { ... }
  dispose() { ... }
}
```

It registers a once-per-call dummy A-Frame component or hooks the scene's existing tick — TBD in implementation. Simplest path: register a single `nav-experimental-tick` component once, and have `TickAnimator` push/pop callbacks onto it.

### `ExperimentalControls.js` — substantial rewrite of internals

Public API unchanged from Phase 0. Internals replaced:
- `_onMouseDown/Move/Up`: now dispatches between LB-pan, Shift+LB pan/tilt, based on `ModifierState` at gesture start (latched via `GestureLatch`).
- `_onWheel`: replaced with cursor-anchored exponential dolly + `deltaY` accumulator.
- New `_onKeyDown/Up` handlers: drives WASD movement, integrated per A-Frame tick.
- New `handlePlanViewRequest()`: invoked by `viewport.js`'s flag-checked `cameratoggle` handler when the user triggers Plan View; kicks off a `TickAnimator` tween to top-down N-S.

The pan/tilt math stays self-contained — no consumer of `SceneBounds` yet (that's Phase 2).

**Structural patterns to honor (so Phase 2/3 extend cheaply, not retrofit):**

- **Mouse-mode dispatch via a `_decideMouseMode(event)` helper** that returns a mode token; the handler consumes the token. Phase 1 has two modes (`'pan'` for LB-drag, `'rotate'` for Shift+LB). Phase 2 extends the helper with a tilt-angle branch (≤30° → `'truck-pedestal'`); the handler shape doesn't change.
- **Wheel-phase dispatch via a `_decideZoomPhase(event)` helper** that returns a phase token. Phase 1 has one phase (`'phase1'` cursor-anchored). Phase 3 extends to `'phase2'` (transition) and `'phase3'` (focal). Same shape, more branches.
- **`nav-experimental:modechange` event emitted** whenever a gesture mode is set or cleared. Phase 1 emits but has no consumer. Phase 2's visual-indicator (toolbar aspect-ratio shift) subscribes to this event rather than reaching into controls internals.
- **`tilt-clamp constant** lives in `src/editor/lib/nav-experimental/constants.js` as a single named export (`MIN_TILT_DEGREES = 30`). Phase 2 changes the value or removes the enforcement site, not multiple sprinkled places.

### `viewport.js` — Plan View intercept

The Plan View flow today is: CameraToolbar/menu/shortcut fires `cameraorthographictoggle` 'top' → `cameras.js` swaps `sceneEl.camera` to ortho and emits `cameratoggle` → `viewport.js` calls `controls.setCamera(ortho)`. By the time `ExperimentalControls.setCamera` is called, the camera has already been swapped. So a "swallow the event from inside ExperimentalControls" approach doesn't work.

**Locked approach: viewport.js flag-checks the `cameratoggle` handler.** When `data.value === 'orthotop'` and `isExperimentalNav()` is true, viewport.js (a) reverts `sceneEl.camera` and `inspector.camera` back to the perspective camera, and (b) calls `controls.handlePlanViewRequest()`, which kicks off the `TickAnimator` tween to top-down N-S. The brief revert happens before any frame renders, so there is no visual flicker. Other ortho-toggle paths (left/right/etc., currently commented out in CameraToolbar) are unaffected by the intercept.

This is option (b) from an earlier draft of the architecture, accepted now over the originally-resolved (a) after the adversarial review surfaced that registration order makes (a) unworkable.

## Deliverables

1. **Real Phase 1 mechanics** in `ExperimentalControls.js`, replacing the Phase 0 placeholder.
2. **`cursorAnchor.js`** with unit tests for the no-hit fallback chain and ground-plane intersection math.
3. **`tickAnimator.js`** with unit tests for animation progression, easing, and cancellation.
4. **Plan View intercept** in flag-on mode, with smooth ~1s tween to top-down N-S oriented view.
5. **Tilt clamp** enforced at the controls level, with a single source-of-truth constant.
6. **WASD handling** with the camera-yaw-projection model, including the straight-down degenerate case.
7. **Manual smoke test checklist** covering each of the five mechanics, with comparison points against Google Maps.
8. **Update Phase 0's `[nav-experimental] active` `console.info`** to be debug-level (or wrap behind a `?navDebug=true` URL switch) — by Phase 1 end the toggle is reliable and the log is just noise.

## Task breakdown

Sittings (1–3h focused blocks). Suggested order:

1. **`tickAnimator.js`** with tests. Smallest building block. ~1 sitting.
2. **`cursorAnchor.js`** with tests. Pure-ish math + raycaster wiring. ~1–2 sittings.
3. **Tilt-clamp + Shift+LB pan/tilt** in `ExperimentalControls`. ~1 sitting (no bounds logic, screen-center raycast only).
4. **LB+drag world-horizontal truck/dolly** — replaces the placeholder. ~1 sitting.
5. **Wheel cursor-anchored exponential dolly** — uses `cursorAnchor.js`. ~1 sitting.
6. **WASD** — needs per-frame integration via `TickAnimator` or a subscription mechanism. ~1 sitting; degenerate case needs care.
7. **Plan View intercept + animated transition** — uses `TickAnimator`. ~1 sitting.
8. **Manual smoke test** with comparison notes against Google Maps. ~1 sitting.
9. **Tune speeds and easing** based on smoke test. Ongoing.

Total: ~7–10 sittings. The math-heavy items (cursorAnchor, WASD degenerate case) are the highest-risk for time overrun.

## Risks

- **Cursor anchoring math feels wrong.** Translating along the camera→hit ray *does* mathematically preserve cursor anchor (camera→hit direction unchanged → screen projection of hit-point unchanged). But subtle bugs in raycast timing (e.g. hit-point computed from a stale camera matrix) can break the illusion. Mitigation: write a manual visual test that draws a debug crosshair at the live hit-point during wheel events, so drift is obvious.
- **Tilt clamp does NOT need to apply to wheel zoom.** Wheel zoom is pure translation along the camera→hit ray, so the camera's orientation (and therefore its tilt) is mathematically unchanged by the operation. No clamping required on the zoom path; Shift+LB tilt drag is the only place the 30° floor needs enforcing. (An earlier draft of this plan had this wrong.)
- **Mac trackpad inertial scroll.** Inertial momentum sends wheel events for ~1s after the user's gesture. Per-tick raycast cost at 60+ events/sec could be measurable. Mitigation: debounce raycasts to 60Hz max, or cache the hit-point for the duration of an inertial scroll burst.
- **WASD straight-down degenerate case.** Camera looking exactly down (90° tilt) is unreachable in Phase 1 due to the 30° clamp — but Plan View animates *to* straight-down, and the tilt-clamp logic must allow the Plan View end-state. So either Plan View bypasses the clamp during the animation but the user can't manually drive there (cleanest), or the clamp lives only in the manual tilt path and doesn't apply to Plan View / future Phase 2 transitions. Worth deciding before implementation.
- **Plan View intercept point.** Resolved during planning (see Open Design Calls #1): viewport.js flag-checks the `cameratoggle` handler and reverts the camera swap before `ExperimentalControls` is involved. No race remaining; left here as a flag in case the implementation introduces another path that bypasses the flag check.
- **A-Frame tick subscription.** Hooking into A-Frame's tick from a non-component class is a bit unusual. The cleanest path is to register a tiny `nav-experimental-tick` A-Frame component once and route subscribers through it. Alternative: the scene's `tick` events. Worth a 30-min spike before committing.
- **Speed tuning is feel-driven.** Initial guesses will be wrong. Plan for a tuning pass after first end-to-end implementation.

## Exit criteria

Phase 1 is done when:

- [ ] All Phase 1 mechanics implemented per the spec above.
- [ ] All Phase 0 tests still pass; new modules (`cursorAnchor`, `tickAnimator`) have unit tests.
- [ ] Smoke test passes end-to-end against the basic-street default scene (checklist below).
- [ ] First feel-test against Google Maps documented (notes captured in this plan or a follow-up).
- [ ] `console.info` startup banner downgraded or gated.
- [ ] Sub-branch (if used) merged back to `navigation`.

## Smoke test checklist

URL: **http://localhost:3333/?nav=experimental**, against the default basic-street scene.

### Birds-eye motion (LB+drag truck/dolly)

- [ ] **L1.** LB-drag right — world appears to slide right; camera position moves left in world coordinates. Y stays constant.
- [ ] **L2.** LB-drag with camera at high altitude vs low altitude — speed scales with height (faster up high, slower close).
- [ ] **L3.** Camera tilt is unchanged after a long LB-drag.
- [ ] **L4.** No drift / no jitter when drag stops.

### Shift+LB pan/tilt

- [ ] **R1.** Shift+LB-drag horizontally — view yaws around the screen-center hit point.
- [ ] **R2.** Shift+LB-drag vertically — view tilts around the screen-center hit point.
- [ ] **R3.** Tilt clamp engages at 30° from horizontal — vertical drag past that point has no effect; no jitter at the boundary.
- [ ] **R4.** Tilt up toward 90° (looking down) — works freely, no clamp on that side.
- [ ] **R5.** Shift+LB over empty sky (nothing to raycast) — no crash; ground-plane fallback engages.

### Wheel cursor-anchored zoom

- [ ] **W1.** Cursor over a building, wheel up — that building stays under the cursor; camera approaches.
- [ ] **W2.** Cursor over street, wheel up — same anchoring on the street point.
- [ ] **W3.** Wheel speed feels exponential — early ticks cover lots of ground at altitude, later ticks are finer-grained close in.
- [ ] **W4.** Wheel down (zoom out) — camera retreats along the same ray.
- [ ] **W5.** Cursor over empty sky (no scene hit) — falls back to ground plane; smooth zoom.
- [ ] **W6.** Cursor near horizon (ground plane intersection far/behind camera) — falls back to forward 30m; zoom feels sane, no teleports.
- [ ] **W7.** Move cursor mid-wheel — anchor updates; no lag.
- [ ] **W8.** Trackpad two-finger scroll (Mac) — same anchoring; no stutter.
- [ ] **W9.** Trackpad pinch (Mac) — Ctrl+wheel; same behavior as plain wheel in Phase 1.

### WASD movement

- [ ] **K1.** W moves camera in the direction the camera is facing (horizontally projected).
- [ ] **K2.** A/D strafes left/right.
- [ ] **K3.** S reverses W.
- [ ] **K4.** W+D feels diagonal — same speed as W alone, just at 45°.
- [ ] **K5.** Camera tilted at 30° — W still moves camera in the camera's facing direction (not into the ground).
- [ ] **K6.** Camera tilted near 90° (looking down, after Plan View) — W moves camera in screen-up direction (i.e. +Z if N-S aligned).
- [ ] **K7.** Speed scales with camera height — faster at altitude, slower close in.
- [ ] **K8.** Hold W for 5s — no acceleration runaway, no abrupt stop.

### Plan View button

- [ ] **P1.** Click "Plan View" — camera animates smoothly to top-down view, oriented North-up.
- [ ] **P2.** Animation lasts ~1 second, eased (not linear).
- [ ] **P3.** During animation, mouse input is either ignored or queued (not racing the animation).
- [ ] **P4.** End state: camera looking straight down; LB-drag pans in world horizontal; Shift+LB tilts back down toward 30° (clamp engaged on the floor).
- [ ] **P5.** Click "3D View" after Plan View — camera returns to perspective at a sensible default angle (or stays where it is, depending on what feels right; both are defensible — decide in tuning).

### Compatibility regressions

- [ ] **C1.** ActionBar zoom-in/out/reset still work.
- [ ] **C2.** Double-click an entity — focus animation still tweens correctly.
- [ ] **C3.** Drag a transform gizmo — camera does not pan.
- [ ] **C4.** Load a saved scene — camera snaps to saved pose (Phase 0 behavior).
- [ ] **C5.** Console hygiene — no errors; only the `[nav-experimental]` startup banner, the Plan View intercept's debug log if any, and pre-existing third-party logs.

### Feel-test against Google Maps

Open Google Maps in another tab on the same monitor, satellite view, tilted. For each pair below, switch back and forth and write a one-line feel note:

- [ ] **F1.** LB-drag pan. Closer-or-further to Google Maps?
- [ ] **F2.** Wheel zoom. Speed and anchoring quality vs Google Maps?
- [ ] **F3.** Shift+LB tilt. Reasonable proxy for Google Maps' Ctrl+drag tilt? (Google Maps uses Ctrl on Windows / Cmd on Mac, not Shift.)
- [ ] **F4.** Overall: would you rather use this or Google Maps for a 30-second exploration of a new area?

The F-row notes are the load-bearing output of Phase 1.

## Open design calls

Two decisions, both resolved 2026-05-08. (A third — tilt clamp on cursor-anchored zoom — was withdrawn after recognising that pure-translation zoom is tilt-preserving by construction; see Risks.)

### 1. Plan View button: intercept or replace?

The existing **Plan View** button emits `cameraorthographictoggle` 'top'.

- **(a) Intercept (recommended).** In flag-on mode, `ExperimentalControls` listens for the event and swallows it; the camera does not switch to ortho. UI unchanged, no parallel path. Implementation tradeoff: event-listener registration order matters.
- **(b) Replace.** Modify `CameraToolbar` to emit a different event in flag-on mode. Cleaner separation, but spreads the flag check into UI code.
- **(c) Add a separate button.** Phase 1 ships a new "Reset to Plan View" button visible only in flag-on mode. UI clutter, more code.

**Resolved: (b) viewport.js delegation, after the adversarial review.** Initially resolved as (a) "intercept from ExperimentalControls", but registration order makes (a) unworkable: `cameras.js` registers its handler at editor init, before `ExperimentalControls` is constructed. By the time our listener fires, the camera has already been swapped to ortho. The adopted fix is for `viewport.js`'s existing `cameratoggle` handler to flag-check: if flag-on and `data.value === 'orthotop'`, revert the camera swap and delegate to `controls.handlePlanViewRequest()` instead. See the architecture section.

### 2. Cursor-anchoring raycast scope

What does the raycast hit?

- **(a) Scene meshes only (recommended).** Default raycaster scope. Anchors to whatever the user can see — buildings, vehicles, ground meshes. Falls back to virtual ground plane if nothing is hit. Most intuitive feel.
- **(b) Virtual ground plane only.** Always anchor to y=0 plane regardless of what's visible. Simpler, more predictable, but feels weird when zooming toward a tall building (anchor is at its base, not its visible peak).
- **(c) Hybrid with hover-respect.** Use scene meshes but exclude transform gizmos, helpers, and selection boxes from the raycast.

**Resolved: (a) with the gizmo/helper exclusion from (c) folded in.** Transform gizmos and editor helpers must not be raycast targets.

### 3. Wheel-event normalization

Mice, trackpads, and pinch all deliver wildly different `deltaY` magnitudes for similar physical gestures. Phase 1 normalizes via a `deltaMode`-aware accumulator drained at a capped per-tick rate. Pinch (Ctrl+wheel) is treated as plain wheel in Phase 1 — the swoop-vs-fixed-tilt distinction lives in Phase 3.

**Resolved: accumulator with `deltaMode` scaling.** Same gesture from any device produces approximately the same zoom motion.

### 4. LB-truck math model

Hit-anchored vs. screen-pixel-with-height-coefficient. Resolved hit-anchored (raycast at gesture start, world-point-under-cursor stays anchored for the whole drag). Speed-scales-with-height emerges from the math.

**Resolved: hit-anchored.**

### 5. Mid-Plan-View-animation cancellation

User input during the ~1s Plan View tween: ignored, queued, or cancels-the-animation?

**Resolved: ignored** (matches existing `EditorControls.focus()` pattern). User cannot interrupt the Plan View tween; it always plays to completion.

### 6. Animated-entity exclusion from cursor anchoring

Default basic-street scene currently has no animated vehicles, but `street-generated-clones` and similar can produce them in other scenes. Anchoring on a moving entity would cause "lock-on" behavior on subsequent wheel ticks.

**Resolved: exclude animated entities from raycast** regardless of scene contents. List maintained alongside the gizmo/helper exclusion in `cursorAnchor.js`.

### 7. WASD direction switching

Reviewer flagged a potential discontinuity in W direction near 90° tilt. Recognized as a non-issue for upright cameras (no roll, which Phase 1 never introduces): −Z and +Y project to the same horizontal direction, so using −Z with a +Y fallback only when degenerate produces no jump.

**Resolved: −Z projection with +Y fallback, no blend needed.**

---

All design calls resolved. Phase 1 is ready to start.

---

## Adversarial review (2026-05-08)

Pass over the plan looking for gaps, hidden coupling, and load-bearing claims that don't survive contact. Ordered roughly by severity.

### High severity

- **Wheel-event normalization is unspecified, and "10% per tick" is load-bearing.** Discrete mouse-wheel ticks (`deltaY` ≈ ±100) and Mac trackpad two-finger scroll (`deltaY` ≈ ±1–4 at ~60Hz, plus inertial tail) deliver wildly different event volumes for the same physical gesture. Treating each event as "a tick" with a flat 10% multiplier means the trackpad zooms ~5–10× faster than a mouse for the same human intent — and inertial scrolls keep zooming for a second after the user lifts. The plan mentions debouncing the *raycast* to 60Hz but says nothing about normalizing the *zoom step*. Without this, the W-row smoke tests will look fine on whatever device the implementer uses and broken on the other. Need an explicit `deltaY → metric step` mapping (e.g. `deltaMode`-aware, or accumulate `deltaY` into a budget that's drained at fixed rate).

- **WASD "degenerate case" has a discontinuity, not a special case.** The spec switches to "camera local +Y projected to horizontal" only when `-Z` projects to "~zero". But the projection magnitude varies smoothly from 1 (camera horizontal) to 0 (camera straight down). At 89° tilt, `-Z`'s horizontal projection is ~0.017 — tiny but nonzero, normalizing it gives a perfectly valid (and very-screen-up-aligned) direction. The threshold for switching to the +Y fallback is unspecified, and *any* threshold produces a discrete jump in W direction at the boundary. This will be visible to the user as "W suddenly turns 90°". Either (i) blend between the two as a function of tilt, or (ii) accept the jump but test it deliberately. K6 in the smoke test only exercises the post-Plan-View extreme; nothing tests the transition.

- **LB-drag truck/dolly has two incompatible specifications and no resolution.** The spec says both "drag direction is grab the world and move it" (which is a hit-anchored model — drag distance = world-space distance from the cursor's start hit-point to its end hit-point) and "speed proportional to camera height" (which is a screen-space-velocity-times-altitude-coefficient model). These produce different feels and different math. The hit-anchored model gives perfect "grab" feel but only if you raycast at gesture start (and the speed-vs-height behavior emerges automatically). The coefficient model is simpler but doesn't actually "grab" the world — at high tilt the grabbed point drifts under the cursor. Decide before implementation; the smoke test L1/L2 cover both phenomena but won't distinguish a half-correct implementation from a correct one.

- **Plan View intercept races `viewport.js`.** The plan flags this in Risks ("Subscribe to the event at module load, before the existing viewport.js handler if possible — event order is by registration order"). But `ExperimentalControls` is constructed *after* `viewport.js` runs (it's installed by viewport.js per the Phase 0 plan), so registration order naturally puts the existing handler first. The Risks note is wishful. Either (i) viewport.js explicitly checks `isExperimentalNav()` before dispatching the camera switch (option (b) from the architecture section, which the plan rejected for spreading the flag check), or (ii) the existing handler is wrapped/decorated. The (a) intercept-from-ExperimentalControls path as written will not work without a structural change to how the event is dispatched, and the plan resolves to (a) without acknowledging that.

### Medium severity

- **`tickAnimator` and WASD have a vocabulary mismatch.** `TickAnimator` is described as one-shot tweens (`from`, `to`, `durationMs`, `onDone`) — Plan View, future swoop. WASD is continuous integration driven by held keys, no `to`, no `onDone`. The task breakdown says "per-frame integration via `TickAnimator` or a subscription mechanism" — those are different things. Forcing WASD through `TickAnimator` is misuse; building a separate tick subscription means there are now two ways to hook the tick. Decide: either `TickAnimator` exposes a lower-level "subscribe to tick" primitive that one-shot tweens build on top of, or WASD opens its own subscription. Picking the former unifies the "how do we hook A-Frame's tick" question that's listed as a 30-minute spike in Risks.

- **No mid-animation cancellation policy.** Plan View animates over ~1s. What happens if the user wheels, drags, or hits W during that second? P3 lists "ignored or queued" as the choice. "Queued" is almost never what feels right (input lag of up to 1s); "ignored" means the user's input is lost. Common pattern is "user input cancels animation" — but then Plan View can be aborted halfway, leaving the camera at an arbitrary tilt, which interacts with the 30° clamp (the camera might land at, say, 60° tilt, which is fine, but if cancellation happens at the very start the camera barely moved — confusing UX). The deferred decision will become a real one the first time it's tested.

- **Cursor-anchor raycast scope: what's "scene meshes"?** Resolved (a) "scene meshes only with gizmo exclusion." But 3DStreet scenes don't necessarily have a ground mesh — `street-segment` lays out lane geometry but the surface between/under them may be empty. Cursor over the gap-between-segments will fall through to the ground-plane fallback. That's fine, but the *transition* between mesh-hit and ground-hit anchors is a discontinuity — the anchor point can jump 0.1m vertically as the cursor crosses a segment edge, and that jump propagates into camera position via the exponential factor. Visible as zoom "stuttering" near segment boundaries. Worth a smoke-test entry.

- **Animated vehicles as anchor targets.** The default basic-street scene includes moving cars (street-generated-clones with animation). If the cursor is over a moving car at the moment of a wheel tick, the anchor is on the car — which is moving. Mid-burst raycast updates re-anchor each tick to the car's *new* position, so the camera tracks the car. Unintended "lock-on" behavior. Either exclude animated entities from the raycast (extends the gizmo-exclusion list) or accept that the cursor anchor follows whatever's under it. Should be decided before W7 testing.

- **Pan/tilt fallback chain is mostly dead code in Phase 1.** Shift+LB rotation center says: screen-center mesh raycast → ground-plane intersection → "fixed 10m forward on the ground plane" if behind camera. With the ≥30° tilt clamp, the screen-center ray always points down-and-forward, so the ground-plane intersection is always in front of the camera. The third fallback can't fire in Phase 1. Either drop it from Phase 1 (and add it back in Phase 2 when low-tilt unlocks), or test the path explicitly by temporarily removing the clamp during dev. As written it's untested code.

- **Speed coefficients diverge across mechanics.** WASD has explicit bounds (5–500 m/s). LB-truck and Shift+LB rotation are "proportional to camera height" with no bounds. At Google 3D Tiles altitudes (1km+), unbounded LB-truck pans the world several screens per drag. Pick a consistent bounds model across the three height-scaled mechanics, even if the constants differ.

### Lower severity / nits

- **`console.info` startup banner.** Deliverable 8 says downgrade or gate it. Decide which — "downgrade" (to `console.debug`, invisible by default) and "gate behind `?navDebug=true`" (visible only with the flag) are different shipping postures. Pick one rather than carrying both options into implementation.

- **Tilt-clamp constant location.** Deliverable 5 says "single source-of-truth constant" — good — but doesn't say where. If it lives in `ExperimentalControls.js`, Phase 2's removal becomes an internal change; if in a shared `nav-experimental/constants.js`, Phase 2 just flips it. Trivial but worth deciding now.

- **`ExperimentalControls` API contract for ActionBar consumers is implicit.** Phase 0's plan listed `focus()`, zoom callers etc. Phase 1 says "Public API unchanged from Phase 0" but doesn't restate the contract. Smoke test C1/C2 catch regressions but a one-line list of methods that must keep working would prevent accidental breakage during the rewrite.

- **"Tune speeds and easing" listed as task 9 / "Ongoing".** That's a footnote, not a task. Either timebox it (e.g. "1 sitting after first end-to-end") or move it into the smoke-test loop where speed feedback originates. As-is, it's the kind of item that silently absorbs an extra week.

- **Smoke test C5 "console hygiene" lists "the Plan View intercept's debug log if any".** If we don't know yet whether there's a debug log, the test can't pass-or-fail cleanly. Decide before testing.

- **Feel-test against Google Maps (F-row) is the load-bearing output, but the test rubric is one-line free-text per row.** Risk that comparison notes drift across sessions. Worth pre-defining 2–3 axes per row (e.g. "speed: too fast / right / too slow", "anchor accuracy: tight / loose / drift") so notes from session N+1 are commensurable with session N.

### Things the plan got right (worth flagging so they don't regress)

- The "tilt clamp does NOT apply to wheel zoom" insight is correct and well-reasoned. Pure-translation along the camera→hit ray is rotation-preserving. Don't let a future cleanup pass "helpfully" add a clamp there.
- The Plan View intercept-vs-replace decision is the right call — keeping the existing UI and intercepting the event keeps the flag check in one place.
- Splitting the compass-button UI work to a separate ticket is correct scope discipline.
- The exponential (percentage-of-distance) zoom model is correct; fixed-metric zoom feels broken at altitude. Worth keeping.

### Recommendation

Three items are worth resolving *before* implementation starts, because they change the shape of the code:

1. Wheel-event normalization model (deltaY → step).
2. LB-truck math model (hit-anchored vs height-coefficient).
3. Plan View intercept mechanism (ExperimentalControls listener vs viewport.js delegation) — the resolved option (a) likely doesn't work as described.

The rest can be flagged in code comments and resolved during the smoke-test pass.
