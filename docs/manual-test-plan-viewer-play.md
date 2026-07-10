# Manual test plan — Unified Viewer + Play (PR #1812)

A ~20 minute pre-merge pass, weighted toward **regression safety**: most users
won't touch the new play features yet, so 15 minutes go to paths every user
hits today and 5 minutes to smoke-testing the new capabilities.

Run against a dev deploy or `npm start` (http://localhost:3333).

---

## Part 1 — Regression: existing behavior (~15 min)

### 1. Load real saved scenes (3 min)

Load 2–3 real scenes covering different eras:

- [ ] A legacy Streetmix-imported scene
- [ ] A managed-street scene
- [ ] A scene with uploaded user assets (GLB/image)

**Pass:** every scene renders with nothing missing, no duplicated entities,
no console errors on load.

### 1b. Review-fix spot checks (2 min)

Regression checks for the three P0 review fixes (2026-07-10):

- [ ] **Click vs drag:** click an entity without moving the mouse → selects;
      click-drag ~15px ending over an entity → selection does NOT change
      (raycaster now compares raw pixel deltas, ≤2px = click)
- [ ] **Escape + modal in Viewer:** in the Viewer, open the sign-in/profile
      modal, press Escape → modal closes, you STAY in the Viewer
      (second Escape exits as before)
- [ ] **Legacy component strip:** load an old scene → no console errors,
      cameraRig behaves; a scene entity deliberately carrying
      `look-controls` (hand-edited JSON) survives load + re-save

### 2. Editor basics (4 min)

On one loaded scene:

- [ ] Select entities in viewport and scene graph
- [ ] Move an entity, then undo / redo
- [ ] Rename the scene inline (title in the top bar)
- [ ] Toggle panels (scene graph / properties)
- [ ] Open the managed-street sidebar: confirm **Reload from source**,
      **Download Street JSON**, **Convert to Shapes**, and the new
      **Animate in Play** toggle all render (this sidebar had a merge
      conflict with main's Convert to Shapes work)

**Pass:** all interactions work; undo/redo state stays consistent.

### 3. Save round-trip (3 min)

- [ ] Save the scene
- [ ] Hard-reload via `#/scenes/<UUID>`
- [ ] Compare against pre-save state

**Pass:** the scene comes back identical. This exercises the serializer
(`json-utils_1.1.js`), which this PR touched.

### 4. Non-owner / signed-out path (3 min)

Open one of your scenes in an **incognito window, signed out**:

- [ ] Lands in the Viewer (not the editor)
- [ ] Title + VIEW ONLY chip visible; Remix button present (no Edit)
- [ ] WASD locomotion moves the camera
- [ ] **No Start button** on a static (non-playable) scene
- [ ] Saved vantage / default snapshot camera position applied

### 5. Mesh-batching spot check (2 min)

Load a scene with many repeated models (trees, parked cars):

- [ ] Everything renders correctly (batching strips entities' own meshes;
      this interaction caused 3 regressions during PR development)
- [ ] Hide/show an entity via the scene graph still works

---

## Part 2 — New features smoke test (~5 min)

### 6. Drive mode (3 min)

On a scene containing a `drive-controls` entity:

- [ ] **Start** appears in the viewer top bar (also for a signed-out visitor)
- [ ] Start → vehicle drivable (WASD/arrows), chase cam follows
- [ ] Page/UI scroll still works while driving (wheel-listener fix)
- [ ] Pause → inputs stop; Resume → they return
- [ ] Reset → vehicle back at spawn, sim clock back to 0:00.00
- [ ] Stop → back to normal viewer; then Edit → editor intact, undo works
- [ ] Sim clock never shows an illegal time like `1:60.00` at the minute
      boundary

> Note: vehicle/character GLBs load from the assets CDN; if models are slow
> locally, verify the lifecycle (start/pause/reset/stop) regardless — hands-on
> physics feel is best confirmed on staging.

### 7. Traffic-sensor replay (2 min)

On a scene wired to a sample manifest
(`scripts/tmd-replay/sample-waterleaf-busiest-minute.json`):

- [ ] Start → street users (cars, bikes, pedestrians) animate per the
      sensor data
- [ ] **Reset mid-replay** → replay re-arms to the top of the manifest
      (was a bug: previously froze)
- [ ] Stop → entities return to static state, nothing left invisible
      (static clones un-hidden)

---

## Sign-off

| Check | Who | Date | Result |
| --- | --- | --- | --- |
| Part 1 regression | | | |
| Part 2 smoke | | | |
| Staging drive physics | | | |
