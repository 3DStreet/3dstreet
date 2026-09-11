# Play Mode & Viewer

[Back to the codebase guide](../../CLAUDE.md). Source paths start at the
repository root; bare filenames name modules within this subsystem.

Unified Viewer presentation with a Start/Stop play lifecycle. Playing is presentation-only (nothing persists, no edit permission needed). Code lives in `src/aframe-components/play/` plus `src/aframe-components/mode-manager.js`.

**Lifecycle:** `play-mode` system owns start/stop/pause/reset and emits `play-mode-start|stop|reset` scene events; features subscribe independently and do their own setup/teardown. The canonical clock is `scene-timer.simulationTime` — advanced by physics sub-steps while driving (deterministic, slow-motion on weak CPUs), else at wall-clock rate.

**Mode arbitration:** `mode-manager` system arbitrates control modes (`editor` / `viewer` / `drive`) and aggregates per-feature "playable checks" that light up the Play UI. Edit and View share the editor's camera + controls (ExperimentalControls, the only viewport control class since the legacy THREE.EditorControls / `?nav=classic` scheme was retired in #1956) (#1848) — there is no separate viewer control scheme; drive mode (and WebXR) borrow the scene's `#cameraRig` camera via `activateSceneCamera()`/`activateEditorCamera()` and give it back.

**Features (all play-mode subscribers, unaware of each other):**

- `drive-mode` + `play-mode-vehicle` / `play-mode-physics` — Rapier raycast-wheel driving sim (WASM lazy-loaded on first Play); spawns the player car from a `[drive-controls]` entity; keyboard + gamepad input
- `fly-mode` + `play-mode-helicopter` — GTA-style arcade helicopter (`fly-mode.js` is the eager bootstrap; the rig + flight model + audio are a lazy webpack chunk loaded on first Play to keep the core bundle under its 4 MiB budget; attitude-command cyclic + velocity-command vertical flight model in `heli-flight-model.js`, pure + unit-tested; releasing the climb key settles toward hover); spawns from a `[fly-controls]` entity (procedural `helicopter-mesh` visual); shares the Rapier world and the street/obstacle collider seeding (`scene-colliders.js`) with drive-mode; if both a drive and a fly entity exist, drive wins the session. Google 3D Tiles get trimesh colliders during play for both car and heli (`tiles-colliders.js`, tracks the tileset's LOD selection via `tile-visibility-change`)
- `street-traffic` — animates the edit-time cast on `[managed-street][playable]` lanes (each static clone gets an animated twin; a lane with no clones plays empty by design), pure function of sim-time
- `street-traffic-replay` — replays anonymized roadside-sensor manifests as agents on a linked managed-street; suppresses synthetic traffic on its target street
- `race-target`, `collision-marker`, `best-times` — race finish gate, crash markers (session-only, stripped on stop/reset), localStorage best times

**Shared gotchas:** hide/restore of static street clones during play goes through the refcounted registry in `src/aframe-components/play/clone-visibility.js` (never hide independently — double-hide breaks restore); visibility changes must use `setAttribute('visible', ...)`, never raw `object3D.visible` (mesh batching). Dev-only `?replay=sample` bootstrap (`src/aframe-components/play/replay-demo.js`) is gated out of production builds.
