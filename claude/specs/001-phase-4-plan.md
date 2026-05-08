# 001 — Phase 4 Plan: Double-Click Navigation

*Working draft 2026-05-08. Will iterate.*

Phase 4 of the navigation prototype work (see `001-overall-plan.md`). Reworks the existing double-click-to-focus behavior so it produces predictable, intuitive viewpoints across the four target object types (building, lane, generic object, person/vehicle), and fixes the hover-highlight raycast mismatch that makes the current behavior hard to anticipate.

Phase 4 is largely independent of Phase 1–3 mechanics: it consumes the same camera (when flag-on, the experimental camera; when flag-off, the legacy `EditorControls` camera) but its logic lives in the click/raycast path, not the camera-control path. That means it can be planned in detail without waiting on Phase 1 feel-test outcomes — the only real dependency is the `TickAnimator` from Phase 1 for the navigation tween.

## Goals

1. Double-click on a scene object animates the camera to a "good view" of that object, with rules predictable enough that the user can anticipate the result before clicking.
2. Hover highlighting matches what a click would actually select — i.e. respects raycast order — so users can preview the click target.
3. Lane double-click navigates to a sensible point on the lane, not to a face-on view of the lane-as-object.
4. Camera elevation never increases as a result of a double-click. (Decreases are fine.)
5. Resulting camera heading snaps to the closest cardinal direction (N/S/E/W) relative to the user's pre-click heading, so there's no large unwanted rotation.

## Non-goals

- No new types of selection or click interaction (e.g. right-click context menu — that's a separate proposal).
- No keyboard shortcut for "navigate to selection" (could be added later).
- No re-design of the selection-box visual.
- No work on touch / WebXR.
- No changes to the existing entity-focus pathway used by external callers (`Events.emit('objectfocus', ...)` at `viewport.js:511`) — Phase 4 hooks the double-click handler, not the focus event.

## What current behavior is

(Findings from a brief scan; verify in implementation.)

- Double-click is wired through `THREE.EditorControls.focus(object)` (`viewport.js:512`), which animates the camera to a face-on view of the object's bounding sphere.
- Hover highlighting is driven by the A-Frame raycaster on `mouseCursor` (`raycaster.js`), which uses different filtering rules from what double-click ends up acting on. Net effect: hovering a car shows the lane highlighted, but clicking selects the car. (The proposal's screenshots demonstrate this.)
- There is no special handling for lanes (treated as ordinary objects, with the lane's bounding sphere driving the focus pose).
- There is no cardinal-snap; the focus animation rotates the camera to look directly at the object center from its "front" (or arbitrary direction for symmetric objects).

## Mechanics — exact spec

### Hover highlight: respect raycast order

- The hover highlight target is computed from the **same raycast** that a click would consume — currently they diverge.
- Concretely: on hover, run the click-raycast logic in dry-run mode (no selection side-effects), and use its result as the hover target. The existing `mouseCursor` raycaster's `objects` filter (`raycaster.js:21`) is the source of truth for "what is clickable."
- Exclusions (already partly in place; verify): transform gizmos, helpers, selection box, measure-line markers, and any entity with `data-no-transform` that's not meant to be selectable.

### Double-click: navigate-to rules

When the user double-clicks, classify the clicked entity into one of four categories and apply the corresponding rule. Classification is by component presence, not by bounding-box heuristics.

#### Category A — Lane (street-segment children, lane geometry)

Detection: clicked entity has component `street-segment`, OR is a child of a `street-segment` entity *and* the click hit-point lies on the lane's surface mesh (not on a vehicle/object placed within the lane).

- Treat the click as a **point on the lane**, not the lane-as-object.
- Resolved point: the world-space hit-point of the click ray on the lane mesh (UV not strictly needed — world-space is sufficient).
- Camera target: the resolved point, treated as a street-level location.
- Camera position: at street-eye height (1.5m) above the resolved point, offset back along the cardinal-snapped heading by a sane viewing distance (TBD; tune for human scale, candidate: 5m).
- Camera tilt: horizontal (looking forward, not down).
- **Elevation rule: clamp.** If the user's current camera elevation is below 1.5m, keep the current elevation (don't raise). If above 1.5m, descend to 1.5m.

#### Category B — Building

Detection: clicked entity has a "building" tag/component (TBD — needs scan; may need a heuristic like "closed solid mesh with footprint > Nm² and height > 2m" if no explicit tag exists). Tracked as an open call below.

- Camera target: the click hit-point on the building face.
- Camera position: standoff distance from the building wall along the wall's outward normal, but **rotated to the cardinal-snapped heading** of the user's pre-click camera. (I.e. don't necessarily look at the wall face-on; preserve the user's approximate viewing direction.)
- Camera elevation: **never higher than current elevation.**
  - If the user is high above the scene: drop to a height equal to ~⅓ of the building's height (or click-point height, whichever is lower) — gives a "see the building" view, not a top-of-tower view.
  - If the user is at street level: stay at street level. View the building from the street.
  - If the user is at mid-storey level: stay at that level (matches the proposal's example).
- Camera tilt: tilt to look at the click hit-point from the resulting position.

#### Category C — Generic object (vehicle, person, prop, tree, etc.)

Detection: anything mixin-instanced from the catalog that isn't a building or lane.

- Camera target: object's bounding-box center.
- Camera position: at the cardinal-snapped heading from the object's center, at a standoff distance proportional to object bounding-radius (e.g. 3× radius), at the object's center height.
- Camera elevation: clamped — never raise. If current elevation is above the object's center, descend to the object's center height. If below, stay at current elevation but still look at the object.
- Camera tilt: aimed at the object center.

#### Category D — Empty space / no hit

Do nothing. (Current behavior.)

### Cardinal-direction snap

For all categories, the resulting camera heading is the closest of N/S/E/W to the user's pre-click camera yaw. This:
- Avoids large unwanted rotations (rotation is bounded at ≤45°).
- Gives a predictable rule that doesn't require objects to define a "front."
- Is the load-bearing simplification — most of the inconsistency in the current behavior comes from per-object "front" assumptions.

Concretely: take the user's current camera yaw, snap to the nearest of {0°, 90°, 180°, 270°} (world-aligned), use that as the final yaw.

### Elevation rule: monotonic non-raising

Across all categories, the camera's final elevation is `min(currentElevation, ruleSpecificTargetElevation)`. The rules above describe the target; the clamp is the universal post-processing step.

Rationale: per the proposal, the user's complaint is the "shoot 2-3 storeys into the air" surprise. Strict non-raising eliminates it. Users who want to go up use mouse-wheel-down (Phase 3 reverse-swoop) or shift-tilt, which are explicit.

### Animation

- ~1s tween, easeInOutQuad (consistent with Phase 1's Plan View transition).
- Routed through `TickAnimator` from Phase 1.
- During the tween: input is queued, not raced, so the user can't fight the animation. (Same approach as Plan View per Phase 1 plan, item P3.)
- Cancellable: a new double-click during a tween cancels and starts the new one from the current camera pose.

## Architecture additions

### `src/editor/lib/nav-experimental/doubleClickNav.js`

New module. Decoupled from `ExperimentalControls` because the rules are pure-ish (input: click, camera state, scene; output: target camera pose). Easier to unit-test in isolation.

API sketch:

```js
export class DoubleClickNav {
  constructor({ camera, sceneEl, tickAnimator, cursorAnchor }) { ... }

  // Called from the existing double-click handler.
  // Returns true if the click was handled (and animation started),
  // false if no-hit (caller may want to fall through to default).
  handleDoubleClick(domEvent) { ... }

  dispose() { ... }
}
```

Internally:
- Reuses `cursorAnchor.worldPointAt()` for the click ray's hit-point + no-hit fallback.
- Has a small classifier function that maps an entity to category A/B/C/D.
- Computes the target pose, then drives `tickAnimator.animate(...)`.

### Hover-highlight fix: `src/editor/lib/raycaster.js`

The current `raycaster.js` filters the raycaster's `objects` list and emits `raycastermouseenter` / `raycastermouseleave` events. The fix is to align the event-emission target with the click-handler's selection target:

- Audit which raycast result the click handler uses vs which one the hover-highlight uses.
- If they're computed by different code paths, unify on one (the click path is authoritative).

This is a **scoped existing-code fix**, not a new module. Likely small (10s of lines), but worth its own commit so it's easy to revert if it breaks something else.

### Flag-off behavior

Phase 4 is gated on `?nav=experimental` like the other phases. Flag-off retains the existing `controls.focus(object)` flow (`viewport.js:512`). The hover-highlight fix in `raycaster.js` is **not flag-gated** — it's a pure bug fix that helps both the new and old flows, and there's no reason to leave the legacy hover behavior wrong.

## Deliverables

1. `doubleClickNav.js` with unit tests for: classifier (A/B/C/D), cardinal-snap math, elevation clamp, target-pose computation per category.
2. Hover-highlight raycast fix in `raycaster.js`.
3. Wiring change in `viewport.js` (or wherever the double-click event currently dispatches): in flag-on mode, route through `DoubleClickNav.handleDoubleClick`; in flag-off mode, unchanged.
4. Manual smoke test checklist.
5. Update `claude/issues-for-discussion.md` if the building-detection question (open call below) needs Kieran's input.

## Task breakdown

Sittings (1–3h focused blocks):

1. **Hover-highlight raycast fix** in `raycaster.js`. Scoped, testable, lowers Phase 4 risk by removing one variable. ~1 sitting.
2. **Entity classifier** (A/B/C/D) with unit tests. Mostly component-presence checks. ~1 sitting; building detection is the unknown.
3. **Cardinal-snap math + elevation clamp** as pure functions, with unit tests. ~½ sitting.
4. **Target-pose computation per category** — five small functions (lane, building, generic, with the elevation clamp post-processing). ~1 sitting.
5. **Wiring + animation** through `TickAnimator`. ~1 sitting.
6. **Smoke test** against the basic-street default scene. ~1 sitting.
7. **Tuning** of standoff distances, tween duration, building-elevation fraction. Ongoing.

Total: ~5–6 sittings.

## Risks

- **Building detection.** No obvious "this is a building" component or mixin convention. May need a heuristic, may need a tagging change in the asset system. If heuristic: false-positives (a tall tree classified as a building) are the worst case; design rules so categories C and B differ only in elevation handling, minimizing the cost of misclassification.
- **Hover/click raycast unification regressions.** The two code paths exist for a reason — they may have diverged because of legitimate differences (e.g. the click path includes invisible interaction-targets the hover path correctly hides). Audit before "fixing."
- **Cardinal-snap surprise on near-cardinal headings.** If user is at heading 44°, snap goes to 0°. At 46°, snap goes to 90°. A 2° swing in the user's pre-click pose causes a 90° swing in the result. Mitigation: hysteresis (snap to last-snapped cardinal if within ±5° of the boundary) or accept the surprise (it's still bounded at ≤45° rotation per click). Decide in feel-test.
- **Elevation-clamp + lane interaction.** If the user is at 50m altitude and double-clicks a lane, they descend to 1.5m — a big drop. Tween still 1s. May feel jarring for very large drops; consider scaling tween duration with distance.
- **Mid-tween second double-click.** Cancelling and restarting from current pose could land the user mid-air with no clear stable end-state. Smoke-test specifically.

## Open design calls

### 1. How do we detect a "building"?

Three candidates, ordered by preference:

- **(a) Explicit tag/component.** Check whether `building` mixin or a `data-category="building"` attribute exists. Cleanest. Assumes the asset catalog already classifies; needs verification.
- **(b) Geometry heuristic.** Footprint area > 4m² AND height > 2m AND closed mesh. Works without asset changes; risks false positives (tall trees, large trucks).
- **(c) Mixin name match.** Any mixin in catalog under a "buildings" category. Depends on `catalog.json` structure — verify.

**To resolve at planning time** by inspecting `catalog.json` and a couple of representative scenes. If no explicit tag exists, propose adding one as part of Phase 4 — likely cheaper than a heuristic.

### 2. Hysteresis on cardinal snap?

Two options. Decide in the first feel-test sitting (cheap to flip):
- **(a) Pure snap.** Always nearest cardinal, no memory.
- **(b) Sticky snap.** Once snapped to N, only switch to E/W when current heading is past 50° from N (i.e. ±5° hysteresis around the 45° boundary).

(b) feels more stable but is more code. Try (a) first; switch if it feels twitchy.

### 3. Standoff distances

Hard-coded numbers will feel wrong somewhere. Candidates:
- Lane: 5m back from hit-point, at 1.5m.
- Generic object: 3× bounding-radius from object center, at object center height.
- Building: 1.5× building footprint diagonal, at building height × ⅓.

All three are first-pass guesses. Tune in feel-test.

## Smoke test checklist

URL: **http://localhost:3333/?nav=experimental**, against the basic-street default scene.

### Hover highlight fix

- [ ] **H1.** Hover over a parked car in a lane — the car (not the lane) is highlighted.
- [ ] **H2.** Hover over an empty stretch of lane — the lane is highlighted.
- [ ] **H3.** Hover then click — selection matches the highlight in every case tested above.
- [ ] **H4.** Hover over a transform gizmo or selection box — no highlight; highlight stays on the underlying entity.

### Double-click — lane

- [ ] **DA1.** From a high birds-eye view, double-click a lane mid-block → camera descends to 1.5m at the click point, looking along the cardinal-snapped heading. Tween smooth.
- [ ] **DA2.** Already at street level, double-click another lane → camera translates along the ground to the new point at 1.5m. Heading snaps to nearest cardinal.
- [ ] **DA3.** Double-click happens cleanly at the click point, not the lane center.

### Double-click — building

- [ ] **DB1.** From high altitude, double-click a 4-storey building → camera ends at ~mid-building height (not above). Heading is cardinal-snapped, ≤45° from previous.
- [ ] **DB2.** From street level, double-click the same building → camera stays at street level, looking up at the building.
- [ ] **DB3.** From mid-storey altitude, double-click the building → camera elevation roughly preserved.

### Double-click — generic object

- [ ] **DC1.** Double-click a car from above → camera descends to car-height, cardinal-snapped heading.
- [ ] **DC2.** Double-click a person — same behavior, smaller standoff.
- [ ] **DC3.** Double-click a tree (no clear "front") — sensible view, no large rotation.

### Cardinal snap

- [ ] **CS1.** With camera heading near 0°, double-click any object → final heading is 0°.
- [ ] **CS2.** With camera heading at 50°, double-click → final heading is 90°.
- [ ] **CS3.** Final heading is always one of {0, 90, 180, 270}° (within float epsilon).

### Elevation monotonicity

- [ ] **EM1.** No double-click ever increases camera elevation. Verified across all three categories from a low-altitude start.

### Mid-tween interactions

- [ ] **MT1.** Second double-click during tween cancels and starts new tween from current pose; no jump.
- [ ] **MT2.** Manual camera input (LB-drag, wheel) during tween is queued or ignored; tween runs to completion.

### Compatibility regressions

- [ ] **C1.** Single-click selection still works as before.
- [ ] **C2.** Flag-off mode (no `?nav=experimental`) behaves exactly as today (focus animation per `EditorControls.focus`).
- [ ] **C3.** Hover-highlight fix applies in flag-off mode too (it's not gated). No regressions to legacy click flow.

## Exit criteria

- [ ] All Phase 4 mechanics implemented per the spec above.
- [ ] Hover-highlight fix lands cleanly in both flag modes.
- [ ] Smoke test passes end-to-end.
- [ ] Building-detection method resolved (explicit tag, heuristic, or catalog-category lookup) and documented.
- [ ] Sub-branch merged back to `navigation`.
