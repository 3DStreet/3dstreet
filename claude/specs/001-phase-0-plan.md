# 001 — Phase 0 Plan: Control-Plane Foundation

*Working draft 2026-05-07. Will iterate.*

Phase 0 of the navigation prototype work (see `001-overall-plan.md`). Builds the shared infrastructure all later phases sit on. **No UX-testable artifact at the end of Phase 0** — the deliverable is plumbing, plus enough of a no-op control system to confirm the toggle works.

## Goals

1. Understand and document the existing camera-control wiring well enough that we know exactly what we're displacing.
2. Stand up a parallel "experimental nav" control system, gated by a URL flag, that can fully take over the editor camera when active.
3. Provide reusable infrastructure that Phases 1–5 will consume: gesture-latching, modifier-state tracking, scene bounds with caching, a place for the camera-update loop.
4. Confirm the toggle works cleanly: flag off = current behavior unchanged; flag on = our system in control, with a trivial built-in behavior (e.g. simple LB-drag truck) good enough to prove the loop.

## Non-goals

- No part of the proposed control scheme (pan/tilt semantics, swoop, bounds-based rotation, etc.) lands in Phase 0. Those are Phase 1+.
- No work on viewer-mode controls (`look-controls` / `movement-controls`). The proposal targets the editor camera; the viewer-mode camera is a separate problem.
- No touch / WebXR work.

## Existing camera-control analysis

3DStreet has **two cameras** with **two distinct control systems**, and our work targets only one of them.

**Editor camera (the target).**
- A vanilla `THREE.PerspectiveCamera` created in `src/editor/lib/cameras.js` (`initCameras`), added directly to the scene's `object3D`.
- Driven by `THREE.EditorControls` — a custom class in `src/editor/lib/EditorControls.js` (forked from the three.js editor, originally by qiao/mrdoob/alteredq/WestLangley).
- Wired up in `src/editor/lib/viewport.js` around line 390: `new THREE.EditorControls(camera, inspector.container)`. The instance is exposed as `inspector.controls` and consumed by ActionBar zoom/reset buttons.
- DOM event source: `inspector.container` (the editor viewport DOM element).
- State machine: `STATE = { NONE, ROTATE, ZOOM, PAN }` driven by mouse buttons + modifiers.
- Used during all editor/Inspector work — **this is what users interact with most of the time.**
- Has built-in focus/transition support (`controls.focus(target)`) used by double-click-to-focus today.

**Scene camera (out of scope for now).**
- Defined in `index.html`: `<a-entity id="camera" camera look-controls="reverseMouseDrag: true">` inside `<a-entity id="cameraRig" movement-controls>`.
- Standard A-Frame `look-controls` + aframe-extras `movement-controls`.
- Active in viewer mode and WebXR.
- A separate, later problem.

There is also `src/lib/aframe-orbit-controls.min.js` in the tree, but it is not imported anywhere in `src/`. References in `DEV-NOTES.md` are stale. Treat as dead code for now.

**Implication for the Phase 0 design.** We're displacing `THREE.EditorControls` only. We can write a sibling controls class that takes the same `(camera, domElement)` constructor shape, install it in `viewport.js` behind the flag, and leave the existing `EditorControls` untouched on the off-path. ActionBar callers that use `inspector.controls` will work unchanged so long as our class exposes the same minimal interface (we'll need to identify which methods).

## Architecture

### File layout

```
src/editor/lib/nav-experimental/
├── index.js                # Entry point. Exports the controls class + factory.
├── ExperimentalControls.js # Sibling to EditorControls.js. Owns the camera + event loop.
├── gestureLatch.js         # Generic latching helper (mode + rotation-center).
├── modifierState.js        # Reads/tracks Shift/Ctrl/Alt state.
├── sceneBounds.js          # Cylindrical bounds derivation + cache.
└── flag.js                 # URL-param flag reader.
```

Keeping it under `editor/lib/` (alongside `EditorControls.js`) rather than `aframe-components/` because it's editor-camera-specific, not an A-Frame component. If we later extend to the scene camera, that's a separate component.

### Feature flag

URL parameter, read once at startup.

```
http://localhost:3333?nav=experimental
```

`flag.js` exports `isExperimentalNav()` which returns true when `?nav=experimental` is present. Default off. No build-time toggle, no runtime UI toggle yet (can add later if needed for A/B feel-tests).

### Toggle insertion in `viewport.js`

Around line 390:

```js
const controls = isExperimentalNav()
  ? new ExperimentalControls(camera, inspector.container)
  : new THREE.EditorControls(camera, inspector.container);
inspector.controls = controls;
```

The two control classes are **mutually exclusive at construction time** — only one is ever instantiated for a given session, selected by the URL flag. They never coexist at runtime. This matters because `EditorControls` registers itself with the `focus-animation` component via `setCamera()` at construction (see the focus-animation finding below); having two controls trying to drive that single component would break.

`ExperimentalControls` must implement the full subset of the `EditorControls` API that other editor code calls. From a sweep of `viewport.js` and surrounding editor code, that surface includes:

- `enabled` (read/write — toggled by `transformControls` and `measureLineControls` mouseDown/mouseUp at `viewport.js:340-353` to suppress camera motion during gizmo drags)
- `center` (Vector3, read/write — `viewport.js:392`)
- `rotationSpeed` (`viewport.js:393`)
- `panSpeed`, `zoomSpeed`, `minSpeedFactor` (set by callers configuring feel)
- `setCamera(camera)` (called on `cameratoggle` events at `viewport.js:407-412` to switch perspective ↔ ortho)
- `focus(target)` (called by `Events.on('objectfocus', ...)` at `viewport.js:502-504` — drives double-click-to-focus)
- `newSceneCameraZoom(snapshotCameraState)` (called via the `newScene` event at `viewport.js:404` — animates the camera into a saved scene's stored camera pose)
- `addEventListener('change', ...)` / `dispatchEvent({type: 'change'})` (Three.js EventDispatcher mixin — used by viewport rendering to know when to re-render)

`focus()` and `newSceneCameraZoom()` cannot be no-op stubs without breaking double-click-to-focus and saved-scene loading respectively.

**`focus()` strategy (locked):** `ExperimentalControls.focus()` reuses the existing `focus-animation` A-Frame component, mirroring `EditorControls.focus()`'s structure — query `[focus-animation]` at construction, call `setCamera(camera, changeCallback)`, and on each `focus()` invocation populate `transitionCamPosStart/End` etc. and flip `transitioning = true`. Mutual exclusion at construction guarantees only one camera is registered with `focus-animation` at a time, so this is safe. Catalog `baseRotation` framing logic is replicated as-is for Phase 0; navigation-proposal-aware framing is a Phase 4 problem.

**`setCamera` ortho strategy (locked):** When handed an `OrthographicCamera`, `ExperimentalControls.setCamera()` flips an internal `disabled` flag and stops responding to input, with a `console.info`-level log. Ortho navigation is out of scope for the prototype. Tracked for later in `claude/issues-for-discussion.md` issue #2.

### Latching infrastructure

`gestureLatch.js` exports a small utility used by future phases. At gesture start (mousedown), it captures whatever values the gesture needs to hold constant (mode, rotation-center, anchor point, etc.) and exposes them via a getter. Cleared on mouseup. Phase 0 ships the helper plus a unit test; Phase 1+ wires it into specific gestures.

### Modifier state

`modifierState.js` tracks Shift/Ctrl/Alt key state and current mouse-button state in one place. Avoids each phase reading `event.shiftKey` etc. independently. Also handles edge cases (focus loss → release all modifiers).

### Scene bounds

`sceneBounds.js` exports:
- `getBounds()` → `{ bounded: bool, center: Vec3, radius: number }` — cached.
- Detection: scene is **unbounded** if any `street-geo` or `google-maps-aerial` entity is present. Otherwise bounded.
- Computation when bounded: union AABB of all `managed-street`, `street`, and `intersection` entities. Cylinder = XZ center of AABB, radius = max horizontal half-extent.
- Phase 0 ships this with unit tests but no consumers; Phase 2 is the first consumer.
- **Cache lifetime (locked):** the cache lives on a `SceneBounds` instance, not at module scope. `sceneBounds.js` exports a class (or factory); the `ExperimentalControls` instance owns one. Cleanly torn down on instance destruction, HMR-safe.

**Invalidation policy** — explicit because A-Frame's event coverage for nested mutations is uneven:

- **Invalidates on:** scene-level entity add/remove of any `managed-street`, `street`, `intersection`, `street-geo`, or `google-maps-aerial`; `child-attached` / `child-detached` on any of those entity types (catches `managed-street` rebuilds that detach and reattach segments); `componentchanged` at scene level for a known list of dimension-affecting components on `street-segment` (`width`, `length`, `position`).
- **Does NOT invalidate on:** position changes to non-segment entities; rotation of any entity (cylindrical bounds are rotation-invariant); component changes outside the known list.
- **Fallback:** the cache is also invalidated on `newScene` (saved-scene loads), which catches anything else as a side effect.

Document this contract in `sceneBounds.js` itself so Phase 2 doesn't get confused by a stale cache.

### Camera-update loop

`ExperimentalControls` is **event-driven**, dispatching `'change'` synchronously inside its pan/zoom/rotate/focus callbacks — matching the actual behavior of `EditorControls` (which is *not* RAF-driven, despite a previous version of this plan claiming so).

Where Phase 1+ needs continuous animation (e.g. swoop transitions, focus tweens), it routes through **A-Frame's tick** (the same way `focus-animation` does today via its component `tick`), not a sibling `requestAnimationFrame` loop. A standalone RAF loop would fight A-Frame's render loop and risk double-renders. Phase 0 doesn't need any animation path beyond synchronous `'change'` dispatch, but the constraint is recorded here so Phase 1+ doesn't reintroduce a RAF loop.

## Deliverables

1. **Existing-nav analysis note.** Already drafted above; lift into a short standalone doc (`claude/reference/existing-nav-analysis.md` or similar) if useful as a reference. Optional — can stay in this plan.
2. **Sub-branch off `navigation`** for Phase 0 (`navigation/phase-0` or similar).
3. **`nav-experimental/` directory** with the six files above.
4. **Toggle in `viewport.js`** that selects between `EditorControls` and `ExperimentalControls` based on the URL flag.
5. **Trivial proof-of-life behavior in `ExperimentalControls`**: LB+drag does a screen-space camera pan (just enough to confirm input → camera update → re-render works end-to-end). No part of the real proposal — placeholder only.
6. **Unit tests** for `gestureLatch`, `modifierState`, and `sceneBounds`. Use the existing vitest setup (`npm run test:modern`).
7. **Manual smoke test checklist:**
   - Flag off → existing controls unchanged.
   - Flag on → editor camera responds to LB+drag with placeholder pan.
   - Flag on → ActionBar zoom/reset buttons still work.
   - Flag on → double-click on an entity focuses on it (regression check for `focus()`).
   - Flag on → drag a transform gizmo — camera does **not** pan simultaneously (regression check for `enabled` arbitration).
   - Flag on → load a saved scene — camera animates to the saved pose (regression check for `newSceneCameraZoom`).
   - Flag on → switch to top/front/etc. ortho camera via the toolbar — does not crash; controls disable themselves with a `console.info` log; switching back to perspective re-enables them.

## Task breakdown

Rough sizing in sittings (a sitting is a focused 1–3h block).

1. **Confirm and finalize the `EditorControls` API surface.** Most of the surface is already documented above. Task is to grep-verify (`inspector.controls.`, `controls.` across `src/`), settle the `focus()` / ortho-camera design calls (see "Open design calls" below), and lock the interface. (1 sitting.)
2. **Scaffold `nav-experimental/` directory + `flag.js`.** Trivial. (≤1 sitting.)
3. **`modifierState.js`** with tests. (1 sitting.)
4. **`gestureLatch.js`** with tests. (1 sitting.)
5. **`sceneBounds.js`** with tests. Larger than a single sitting — has to handle: empty scene, scene with `street-geo` sentinel, `managed-street` rebuilds (detach/reattach), `street-segment` resize without parent `componentchanged` firing, and `newScene` fallback. (2 sittings, possibly 3.)
6. **`ExperimentalControls.js` skeleton** implementing the API surface from task 1 + the placeholder LB-pan. Size depends on the `focus()` / ortho design call: a "delegate to a stashed `EditorControls` for ortho + share `focus-animation`" approach is ~1 sitting; a from-scratch focus-animation path is more. (1–2 sittings.)
7. **Wire toggle into `viewport.js`.** (≤1 sitting.)
8. **Manual smoke test** against the basic-street default scene, working through the checklist below. (1 sitting.)
9. **Document any surprises** found during integration in this plan or as follow-ups. (Ongoing.)

## Risks

- **`focus()` design call has implementation depth.** `EditorControls.focus()` is non-trivially coupled to the `focus-animation` A-Frame component (which assumes a single registered camera) and to catalog-driven framing logic. A no-op stub will visibly break double-click-to-focus. Mitigation: settle the design call (see "Open design calls" below) before writing `ExperimentalControls.focus()`.
- **Inspector container event handling collisions.** Editor uses pointer events for both camera control and entity-selection raycasts. If our controls and the selection layer both want LB events, we need the same arbitration `EditorControls` already does. Read `EditorControls.js` carefully before duplicating.
- **Bounds invalidation events uneven.** A-Frame's `componentchanged` does not bubble — changing a `street-segment` width fires on the segment, not the parent `managed-street`. Mitigation: explicit invalidation policy documented above (scene-level subscriptions + `newScene` fallback). Worth profiling once Phase 2 actually consumes bounds.
- **Two-camera confusion.** Easy to start hacking on `look-controls` by mistake. Be explicit in code comments that this is editor-camera only.
- **Webpack HMR can leave stale state in module-level singletons.** If `gestureLatch` or the bounds cache use module-scope state, HMR can preserve it across reloads in surprising ways. Mitigation: keep state per-`ExperimentalControls`-instance where possible, or document that `nav-experimental/` changes need a hard reload during dev.
- **`focus-animation` registration timing.** `EditorControls` queries `[focus-animation]` from the DOM at construction time; if `ExperimentalControls` is constructed before A-Frame has registered that component's instance, the query will fail. Today's setup works, but the timing is implicit. Mitigation: mirror `EditorControls`' construction site exactly; if it works there, it works for us.
- **Ortho camera mode.** `setCamera` can be handed an `OrthographicCamera`. Phase 0 strategy is "disable self, log, wait for return to perspective" — see the toggle-insertion section. Tracked as issue #2 in `claude/issues-for-discussion.md`.

## Exit criteria

Phase 0 is done when:
- [x] All six files in `nav-experimental/` exist and are exercised by tests.
- [x] `?nav=experimental` flag selects `ExperimentalControls`; absence selects `EditorControls`.
- [x] Smoke test passes end-to-end (all seven items in the checklist above). *Confirmed 2026-05-08 against the basic-street default scene.*
- [ ] Sub-branch merged back to `navigation`. *Skipped — work landed directly on `navigation`, no sub-branch was used.*

After exit, Phase 1 begins by replacing the placeholder LB-pan with the real birds-eye control set.

### Test file location

Tests for the `nav-experimental` modules live under:

```
test/editor/lib/nav-experimental/
├── gestureLatch.test.js
├── modifierState.test.js
└── sceneBounds.test.js
```

This follows the dominant repo convention (Vitest tests under `test/<app>/<mirrored source path>`) and establishes the `test/editor/` directory that `test/README.md` anticipates as a TODO. `vitest.config.js:11` explicitly sets `include: ['test/{editor,generator,shared}/**/*.test.{js,jsx}']`, so `test/editor/` is already a known root — no config changes needed *because the include list already covers it*, not because of a default glob. See `claude/issues-for-discussion.md` for a related inconsistency between the README's stated best practice ("co-locate when possible") and actual repo behavior, to raise with Kieran.

## Open questions for review

1. Is `claude/reference/existing-nav-analysis.md` worth extracting as a standalone doc, or fine to keep inline here?
//!! OK here
//** Resolved — keep inline.
2. Are there callers of `inspector.controls` outside the editor (e.g. in viewer-mode code, screentock, focus-animation) that we should sweep for as part of task 1?
//!! I don't know - please check
//** Will check as part of task 1 (the API-surface sweep). Output goes back into this plan if anything surprising shows up.

## Adversarial review findings

*Subagent review, 2026-05-07. Appended to original plan.*

The plan's overall shape is sound — sibling controls class, URL flag, six-file scaffold — and its model of `EditorControls` matches the code I read. But several specifics are wrong or under-specified, and at least one (the Vitest include path) will silently invalidate exit criterion 1 if not fixed first. Findings below ordered roughly by severity.

### Vitest include glob does not pick up `test/editor/`

`vitest.config.js:11` sets `include: ['test/{editor,generator,shared}/**/*.test.{js,jsx}']`. So tests under `test/editor/lib/nav-experimental/` *will* be picked up — but the plan's claim "Vitest picks these up automatically via its default `**/*.test.js` glob — no config changes needed" is wrong on the *reason*: the default glob is overridden, and the include list happens to already contain `test/editor/`. The plan also justifies the directory with "establishes the `test/editor/` directory that `test/README.md` anticipates as a TODO" — fine, but the load-bearing fact is the explicit include in the config, not a default. Worth correcting in the plan so future readers don't think they can drop tests anywhere.

### `controls.focus()` is non-trivially coupled to `focus-animation`

`EditorControls.js:165-170` does `document.querySelector('[focus-animation]').components['focus-animation']` *at construction time*, then calls `setCamera(object, changeEventCallback)` on it. `focus()` (lines 63-163) writes directly into the animation component's `transitionCamPosStart/End`, `transitionCamQuaternionStart/End`, and `transitioning` fields, and the animation component's `tick` (`focus-animation.js:41-76`) then drives the camera each frame and calls back into `changeEventCallback` to dispatch `'change'`. Three implications the plan understates:

- **`focus()` cannot be a no-op stub** without breaking double-click-to-focus, which `viewport.js:502-504` wires unconditionally on `Events.on('objectfocus', ...)`. Flag-on users will double-click an entity and nothing will happen. That's a regression the smoke-test checklist won't catch unless it explicitly tests double-click-to-focus.
- **`ExperimentalControls` will need to either reuse the existing `focus-animation` component (which assumes a single camera registered via `setCamera`) or implement its own animation path.** Reusing means at most one of the two control classes can hold the camera registration at a time; if both register, the last one wins and the off-path class breaks. Keeping them strictly mutually exclusive (selected at construction by the flag) sidesteps this, but the plan's "leave EditorControls untouched on the off-path" framing implies coexistence at runtime that doesn't actually occur.
- **`focus-camera-pose`-aware framing** (`EditorControls.js:99-145`) and the catalog `baseRotation` lookup are non-trivial logic. The plan should call out explicitly that flag-on Phase 0 either replicates this or accepts that double-click navigation feels different.

### `EditorControls` is event-driven, not RAF-driven — the plan has this backwards

The plan says `ExperimentalControls` "runs an animation-frame-driven update loop while active … matching `EditorControls`' behavior." `EditorControls` does *not* run a RAF loop. It dispatches `'change'` synchronously inside its `pan`/`zoom`/`rotate`/`focus`-driven callbacks (see e.g. `EditorControls.js:188, 238, 261, 478`). The only RAF loop in this neighbourhood is in `focus-animation`'s `tick` (which is A-Frame's tick, not raw RAF) and in `newSceneCameraZoom`'s ad-hoc `requestAnimationFrame(animate)` (`EditorControls.js:551-591`). Adding a continuously-running RAF loop in `ExperimentalControls` is a real behavioural change vs. the existing system: it will fight A-Frame's render loop (renders happen inside A-Frame's tick), can cause double-renders if `'change'` triggers a render on a frame A-Frame is already rendering, and changes the cost profile when the camera is idle. If the goal is "drive a smooth dolly/swoop animation", route it through A-Frame's tick (like `focus-animation` does) rather than a sibling RAF loop. At minimum the plan should drop the "matches `EditorControls`" justification — it doesn't.

### `controls.enabled` is toggled by sibling controls — needs explicit handling

`viewport.js:340, 345, 349, 353` toggle `controls.enabled` from inside `transformControls`'s `mouseDown`/`mouseUp` and `measureLineControls`'s `mouseDown`/`mouseUp` listeners. This is the existing mechanism preventing the camera from panning *while a gizmo drag is happening*. `ExperimentalControls` must honour `enabled` for the same reason — if it doesn't, flag-on mode will let users drag transform gizmos and pan the camera simultaneously. The plan lists `enabled` in the API surface but doesn't flag this specific failure mode. Add to the smoke-test checklist: "with flag on, drag a transform gizmo — camera does not move."

### Bounds-invalidation event coverage gap — `componentchanged` does not fire on nested mutations

The plan says subscribe to "A-Frame entity add/remove events and component-change events on those entity types," and notes the risk that this may miss events. Specifically: `managed-street`'s bounds depend on its child `street-segment` widths and lengths. Changing a `street-segment`'s `width` fires `componentchanged` *on the segment*, not on the parent `managed-street`. Anyone subscribing to `componentchanged` on `[managed-street]` only will silently miss this. Two concrete options worth deciding now:

- **Subscribe at scene level** to `componentchanged` for any of a known set of components (`width`, `length`, `position` on segments, etc.), not just on the parent types. Cheap, catches more.
- **Subscribe to `child-attached` / `child-detached` on `managed-street`** in addition to scene-level add/remove. Only these two files in `src/` use those events today (`SceneGraph.jsx`, `index.jsx`), so there's prior art but it's thin.

The plan's "conservative invalidation: any add/remove invalidates" is fine for add/remove, but it doesn't cover the resize-an-existing-segment case at all. Worth being explicit in `sceneBounds.js`'s contract about which mutations *do not* invalidate (so Phase 2 doesn't get confused by a stale cache).

### Sibling-class strategy is fine, but `setCamera` semantics need pinning down

`viewport.js:407-412` calls `controls.setCamera(data.camera)` on every `cameratoggle` (perspective ↔ ortho). `EditorControls.setCamera` (lines 47-57) flips `isOrthographic` and `rotationEnabled` based on camera type. `ExperimentalControls` either has to support orthographic cameras too — which the navigation proposal implicitly doesn't — or has to gracefully handle being told "switch to ortho" without breaking. Not addressed in the plan. Simplest answer: when handed an orthographic camera, fall back to delegating to a stashed `EditorControls` instance, or just disable yourself and let the user understand that the experimental scheme is perspective-only. Either way, decide and write it down.

### Sizing realism — task 5 is bigger than "a single sitting"

The `sceneBounds.js` task has to: pick the right A-Frame events to subscribe to (see above), handle the timing where `componentchanged` fires before `object3D` is updated, deal with managed-street rebuilds (which detach and reattach children), and ship with tests that exercise invalidation. Plus the cylindrical bounds derivation itself, which needs to handle empty scenes and scenes with `street-geo` sentinel correctly. Two sittings, more likely. Also, task 1 (the API-surface sweep) is honestly trivial *if* you accept "`focus` is a no-op stub" — but the focus-animation finding above means task 1 turns into a real design call about how to handle `focus()`, which bleeds into task 6.

### Risks list misses a few

Worth adding:

- **Hot-reload during dev.** Webpack HMR can re-evaluate modules while the editor is live. If `ExperimentalControls` adds module-level singletons (e.g. a single `gestureLatch` instance, a singleton bounds cache), HMR can leave stale state behind. Either keep state per-instance, or document that HMR requires a hard reload for `nav-experimental/` changes.
- **`focus-animation` component registration.** `EditorControls.js:166` queries the DOM for `[focus-animation]` *during construction*. If `ExperimentalControls` is constructed before A-Frame has registered the component (timing depends on whether viewport init runs before/after the component's `init`), it'll throw. The plan should mirror `EditorControls`' assumption (it works today, so it's fine to assume — but call it out).
- **Smoke test does not exercise the ortho path.** Flag-on with the user pressing the top/front/etc. ortho-camera buttons will trigger `setCamera` with an `OrthographicCamera`. Add to the checklist.

### Exit criteria gaps

The five-item exit list will not catch:

- Double-click-to-focus broken in flag-on (`focus()` regression).
- Transform-gizmo drags double-pan in flag-on (`enabled` not honoured).
- Ortho camera mode broken in flag-on (`setCamera` not handling ortho).
- `newSceneCameraZoom` broken in flag-on (loading a saved scene in flag-on mode triggers `controls.newSceneCameraZoom(snapshotCameraState)` at `viewport.js:404`; not in the plan's listed API surface).

The last one is particularly easy to miss because it's wired via the `newScene` event, not a direct caller. Worth at least listing in the "ActionBar callers" sentence as "ActionBar zoom/reset *and* `newScene` snapshot animation."

### Minor: dead-code claim about `aframe-orbit-controls.min.js`

Confirmed. `src/lib/aframe-orbit-controls.min.js` has no `import`/`require` references in `src/`. The only reference is in `vehicle-wheel-animation.html`, a standalone test page that loads it from unpkg — the local copy in `src/lib/` is genuinely unused. Plan is correct here.

## Response to adversarial review

*Mapping each finding to plan changes or open decisions, 2026-05-07.*

| Finding | Status |
|---|---|
| Vitest include glob | **Fixed** — Test-file location section corrected to cite the explicit `vitest.config.js` include rather than a non-existent default glob. |
| `controls.focus()` coupling | **Fixed in plan + open design call.** API surface now lists `focus` as a real obligation, not a stub. Recommended approach below in "Open design calls." |
| Event-driven vs RAF-driven | **Fixed.** Camera-update-loop section now correctly says event-driven, with a constraint on Phase 1+ animations going through A-Frame's tick. |
| `controls.enabled` toggled by gizmos | **Fixed.** API surface now flags this. Smoke test now includes a transform-gizmo regression check. |
| Bounds-invalidation gap | **Fixed.** Scene-bounds section now has an explicit invalidation policy, including the `street-segment` resize case and `newScene` fallback. |
| `setCamera` ortho semantics | **Open design call** below. Plan now lists ortho as a risk and a smoke-test item, but the strategy needs your call. |
| Sizing realism | **Fixed.** Task 5 bumped to 2–3 sittings; task 1 framing changed to "confirm and finalize" rather than "discover from scratch." |
| Risks list omissions | **Fixed.** HMR, focus-animation registration timing, and ortho-mode added. |
| Exit-criteria gaps | **Fixed.** Smoke test checklist now covers double-click focus, gizmo arbitration, ortho mode, and `newSceneCameraZoom`. Exit criteria collapsed to reference the full checklist. |
| Dead-code claim | **No action needed.** Confirmed. |

## Open design calls

Three decisions surfaced by the review that need your input before Phase 0 implementation begins. Recommended defaults given for each.

### 1. How does `ExperimentalControls.focus()` work?

`focus()` is wired to double-click-to-focus and is non-trivially coupled to the `focus-animation` A-Frame component. Three options:

- **(a) Reuse `focus-animation` (recommended).** Mutual-exclusion-at-construction means only one control class is alive per session, so only one camera registration with `focus-animation` exists at a time. `ExperimentalControls.focus()` mirrors `EditorControls.focus()`'s logic — write into `transitionCamPosStart/End` etc., flip `transitioning = true`, let the existing tick drive the animation. Lowest risk, fastest path; double-click-to-focus behaves identically in flag-on and flag-off mode.
- **(b) Implement own animation path.** `ExperimentalControls` ticks its own focus animation through A-Frame's tick (separate from `focus-animation`). More code, but decouples us from the existing component. Worth doing only if the navigation proposal calls for materially different focus behavior — which it doesn't.
- **(c) No-op stub.** Double-click-to-focus broken in flag-on. Not viable for prototype use.

**Recommendation: (a).** Confirm.
//!! Agree
//** Locked in. `ExperimentalControls.focus()` will reuse `focus-animation`, mirroring the structure of `EditorControls.focus()`. Reflected in the toggle-insertion section (focus() obligation made concrete) and risks list.

### 2. Ortho camera mode in flag-on

The toolbar's top/front/side ortho buttons trigger `controls.setCamera(orthoCamera)`. The navigation proposal is silent on ortho. Three options:

- **(a) Disable self in ortho mode (recommended).** When handed an `OrthographicCamera`, `ExperimentalControls.setCamera()` flips an internal `disabled` flag and stops responding to input. Ortho buttons effectively freeze the camera at the chosen ortho view; user has to click "Plan view" or similar to return to perspective and regain control. Acceptable because ortho mode is rarely used in nav workflows, and Phase 0 is not about ortho.
- **(b) Delegate to a stashed `EditorControls` for ortho.** Construct an `EditorControls` lazily on first `setCamera(orthoCamera)` call and route input there. Preserves existing ortho behavior exactly, but breaks the "mutual exclusion at construction" model and means two controls *can* exist at once. Adds complexity for a rarely-used path.
- **(c) Implement ortho support in `ExperimentalControls` from scratch.** Pan + zoom only, no rotate. Out of scope for Phase 0.

**Recommendation: (a).** Phase 0 ships with ortho mode effectively disabled in flag-on, with a clear log message. Phase 1+ can revisit if ortho turns out to matter.
//!! Agree.  Not needed for prototyping.  Please surface an issue for discussion re: ortho mode.
//** Locked in. Recorded as issue #2 in `claude/issues-for-discussion.md` for later discussion with Kieran. Smoke-test item updated to specify the disable-self behavior.

### 3. Where does the bounds-cache live?

The plan currently implies module-level state. With HMR, that's a footgun (stale state across reloads). Two options:

- **(a) Per-`ExperimentalControls` instance (recommended).** The cache lives on the controls instance; `sceneBounds.js` exports a class or factory. Cleanly destroyed when the instance is torn down. HMR-safe.
- **(b) Module-level singleton.** Slightly simpler API, but susceptible to HMR weirdness. Document "hard reload after `nav-experimental/` changes."

**Recommendation: (a).** Modest extra plumbing, avoids a class of dev-experience bug.
//!! Happy with recommendation.
//** Locked in. `sceneBounds.js` exports a class (or factory); cache lives on the instance. Reflected in the scene-bounds section.

All three resolved (see `//**` confirmations above). Phase 0 is ready to start.
