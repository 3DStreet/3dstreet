# Low Power Mode — WIP notes

Status as of 2026-06-29. Branch `feat/low-power-mode`, PR #1723.

Continuation notes for the splat-performance work layered on top of the original
pixel-ratio toggle. The component is `src/aframe-components/low-power-mode.js`.

## Problem being solved

Heavy scene (Google 3D Tiles + Gaussian splats + managed-street geometry) on a
fanless M2 Air sits at ~9 FPS and **gets worse as the scene loads**, because
more splat LOD pages stream in over time.

## Key finding: Spark LOD is not FPS-reactive

Spark's `SparkRenderer` LOD is distance / screen-size driven against a **fixed
splat budget**, not a frame-rate governor. There is no built-in "FPS dropped,
shed detail" loop. On desktop-class hardware (the M2 Air is detected as desktop)
the target is **2.5M splats**, and Spark fills toward it as pages load — which is
why FPS degrades the longer the scene is open.

Relevant Spark source (`node_modules/@sparkjsdev/spark/dist/spark.module.js`):
- `defaultSplatTarget()` ~line 10361 → desktop 2.5M, iOS 1.5M, Android 1M, VisionPro 750K, Oculus 500K
- `driveLod()` ~line 10372: `const maxSplats = (this.lodSplatCount ?? defaultSplatTarget()) * this.lodSplatScale;`
- `pixelScaleLimit *= this.lodRenderScale;` ~line 10384 (sub-pixel cull threshold)
- `maxStdDev` field → uniform copy ~line 10093 (Gaussian quad / fragment discard radius)
- `SplatPager` built once with `maxSplats: this.maxPagedSplats` ~line 10443 (so
  `maxPagedSplats` only bites at pager-creation time, i.e. when low-power is on
  *before* the splat loads)

All of `lodSplatScale`, `lodRenderScale`, `maxStdDev` are read live each frame,
so changing them takes effect next frame with no reload.

## Measured so far

- Pixel-ratio cap to 1: **9 → 15 FPS** (the bulk of the win; global, immediate)
- Tiles alone (3D Tiles + mesh, no splat): already 30 FPS — so the splat is the
  bottleneck, not tiles or geometry.
- Target: get the splat-heavy case from 15 → 30.

## What the master toggle currently applies (`SPLAT_LEVERS` + the rest)

| lever | default | low-power | notes |
|---|---|---|---|
| pixel ratio | devicePixelRatio (2) | 1 | global; the 9→15 win |
| `lodSplatScale` | 1.0 | **0.5** | LOD count target 2.5M → 1.25M; the fix for "loads toward max LOD". Safe (renders fewer). |
| `maxStdDev` | √8 ≈ 2.83 | **2.0** | shrinks quad → ~half fill-rate. Safe (smaller, not culled). |
| `maxPagedSplats` | platform default | half | only bites at pager creation; reliable only if on before splat load |
| tiles `errorTarget` | 16 | 40 | coarser/cheaper tiles |

### Dangerous knob, console-only (NOT in the toggle)

- `lodRenderScale` (default 1.0): raises the sub-pixel cull threshold. At **2.0
  it made entire splats vanish at distance** (caused the "no splats show" bug).
  If revisited, only try gentle values (1.1–1.5) via the console handle.

## Console handle for tuning (`STREET.lowPower`)

```js
STREET.lowPower.status()                     // live values + captured defaults
STREET.lowPower.pixelRatio(1)                // or window.devicePixelRatio
STREET.lowPower.errorTarget(40)
STREET.lowPower.splat('lodSplatScale', 0.3)  // set ANY SparkRenderer prop live
STREET.lowPower.splat('maxStdDev', 1.85)
STREET.lowPower.reset()                       // restore all captured defaults
```

Each captured-default is stored on first touch so `reset()` / toggle-off is exact.

## How to measure

- Chrome DevTools → Cmd+Shift+P → "Show Rendering" → check **Frame Rendering
  Stats** (FPS + GPU memory overlay). Easiest, no code.
- `STREET.splatDebug.start()` for splat LOD thrash warnings.

## Next steps

1. **Dial in the values** on a real heavy scene with low-power ON:
   - `lodSplatScale` ~0.25–0.35 is the main dial for 15→30 (each halving ~halves
     splat work). Push until the splat looks too sparse, back off one step.
   - `maxStdDev` ~1.85–2.0 for extra fill-rate trim.
   - Then update the `low:` values in `SPLAT_LEVERS` to the chosen numbers.
2. **Decide on `lodRenderScale`**: test 1.1–1.5 by eye; promote into the toggle
   only if it holds up while orbiting/zooming (watch for splats dropping out).
3. **Optional follow-up (separate PR): FPS-reactive auto-scaler.** A small tick
   loop that nudges `lodSplatScale` up/down to hold a target FPS — the
   "adaptive" behavior Spark does not do itself. Real feature, not a one-liner.
4. Re-verify the original PR caveat: pixel-ratio cap applies on first load (not
   just after toggling) in the master A-Frame build.

## Files

- `src/aframe-components/low-power-mode.js` — the component (levers + console handle)
- `src/store.js` — `lowPowerMode` persisted preference
- `src/editor/components/scenegraph/AppMenu.jsx` — View menu checkbox
- `index.html` — `low-power-mode` on `<a-scene>`
