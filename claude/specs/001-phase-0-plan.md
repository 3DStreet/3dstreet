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

`ExperimentalControls` exposes the subset of the `EditorControls` API that other code calls (`focus`, `enabled`, `setCamera`, `dispatchEvent('change')`, plus any methods ActionBar uses for zoom/reset). Identifying that subset is a Phase 0 task.

### Latching infrastructure

`gestureLatch.js` exports a small utility used by future phases. At gesture start (mousedown), it captures whatever values the gesture needs to hold constant (mode, rotation-center, anchor point, etc.) and exposes them via a getter. Cleared on mouseup. Phase 0 ships the helper plus a unit test; Phase 1+ wires it into specific gestures.

### Modifier state

`modifierState.js` tracks Shift/Ctrl/Alt key state and current mouse-button state in one place. Avoids each phase reading `event.shiftKey` etc. independently. Also handles edge cases (focus loss → release all modifiers).

### Scene bounds

`sceneBounds.js` exports:
- `getBounds()` → `{ bounded: bool, center: Vec3, radius: number }` — cached.
- Detection: scene is **unbounded** if any `street-geo` or `google-maps-aerial` entity is present. Otherwise bounded.
- Computation when bounded: union AABB of all `managed-street`, `street`, and `intersection` entities. Cylinder = XZ center of AABB, radius = max horizontal half-extent.
- Invalidation: subscribes to A-Frame entity add/remove events and component-change events on those entity types. On invalidation, the next `getBounds()` call recomputes.
- Phase 0 ships this with unit tests but no consumers; Phase 2 is the first consumer.

### Camera-update loop

`ExperimentalControls` runs an animation-frame-driven update loop while active. For Phase 0 it just calls `dispatchEvent({type: 'change'})` after gesture-driven camera updates (matching `EditorControls`' behavior, so the rest of the editor re-renders correctly).

## Deliverables

1. **Existing-nav analysis note.** Already drafted above; lift into a short standalone doc (`claude/reference/existing-nav-analysis.md` or similar) if useful as a reference. Optional — can stay in this plan.
2. **Sub-branch off `navigation`** for Phase 0 (`navigation/phase-0` or similar).
3. **`nav-experimental/` directory** with the six files above.
4. **Toggle in `viewport.js`** that selects between `EditorControls` and `ExperimentalControls` based on the URL flag.
5. **Trivial proof-of-life behavior in `ExperimentalControls`**: LB+drag does a screen-space camera pan (just enough to confirm input → camera update → re-render works end-to-end). No part of the real proposal — placeholder only.
6. **Unit tests** for `gestureLatch`, `modifierState`, and `sceneBounds`. Use the existing vitest setup (`npm run test:modern`).
7. **Manual smoke test checklist** documenting:
   - Flag off → existing controls unchanged.
   - Flag on → editor camera responds to LB+drag with placeholder pan; ActionBar zoom/reset buttons still work.

## Task breakdown

Rough sizing — each task is a single sitting unless noted.

1. **Identify the `EditorControls` API surface that other code consumes.** Grep `inspector.controls.` and `controls.` across editor code; list every method/property called externally. Output: short list, drives the `ExperimentalControls` interface.
2. **Scaffold `nav-experimental/` directory + `flag.js`.** Trivial.
3. **`modifierState.js`** with tests.
4. **`gestureLatch.js`** with tests.
5. **`sceneBounds.js`** with tests. Largest single task — cache invalidation hookup needs care.
6. **`ExperimentalControls.js` skeleton** implementing the API subset from task 1 + the placeholder LB-pan behavior.
7. **Wire toggle into `viewport.js`.**
8. **Manual smoke test** against the basic-street default scene.
9. **Document any surprises** found during integration in this plan or as follow-ups.

## Risks

- **`EditorControls` API surface larger than expected.** Some methods may be tightly coupled to `EditorControls` internals. Mitigation: list them all (task 1) before designing the class. Worst case: stub unknown methods as no-ops in Phase 0, address in Phase 1.
- **Inspector container event handling collisions.** Editor uses pointer events for both camera control and entity-selection raycasts. If our controls and the selection layer both want LB events, we need the same arbitration `EditorControls` already does. Read `EditorControls.js` carefully before duplicating.
- **Bounds invalidation events unreliable.** A-Frame's component-change event coverage for nested entity changes (e.g. resizing a `street-segment` that affects `managed-street` bounds) may not fire on every relevant case. Mitigation: start with conservative invalidation (any add/remove invalidates; recompute is cheap), tighten only if profiling shows it matters.
- **Two-camera confusion.** Easy to start hacking on `look-controls` by mistake. Be explicit in code comments that this is editor-camera only.

## Exit criteria

Phase 0 is done when:
- [ ] All six files in `nav-experimental/` exist and are exercised by tests.
- [ ] `?nav=experimental` flag selects `ExperimentalControls`; absence selects `EditorControls`.
- [ ] Smoke test passes: flag off behaves identically to current; flag on responds to LB-drag with placeholder pan and re-renders correctly.
- [ ] ActionBar zoom/reset still work with flag on.
- [ ] Sub-branch merged back to `navigation`.

After exit, Phase 1 begins by replacing the placeholder LB-pan with the real birds-eye control set.

### Test file location

Tests for the `nav-experimental` modules live under:

```
test/editor/lib/nav-experimental/
├── gestureLatch.test.js
├── modifierState.test.js
└── sceneBounds.test.js
```

This follows the dominant repo convention (Vitest tests under `test/<app>/<mirrored source path>`) and establishes the `test/editor/` directory that `test/README.md` anticipates as a TODO. Vitest picks these up automatically via its default `**/*.test.js` glob — no config changes needed. See `claude/issues-for-discussion.md` for a related inconsistency between the README's stated best practice ("co-locate when possible") and actual repo behavior, to raise with Kieran.

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
