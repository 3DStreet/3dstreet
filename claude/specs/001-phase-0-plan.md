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
