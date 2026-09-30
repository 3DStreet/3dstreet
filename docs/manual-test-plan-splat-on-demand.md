# Manual test plan — splat streaming + on-demand rendering (#2047, PR #2048)

A ~30 minute pass on a real machine with a real GPU and browser. The branch
was only tested in headless Chromium on a software GPU, which proved the
mechanics but not the real-world win. This pass answers two questions:

1. **Does it help?** Idle GPU / CPU / fan with a big streamed `.rad` in the
   editor should drop sharply compared with the same scene on `main`.
2. **Does it break anything?** The editor viewport now skips idle draws
   while a splat is in the scene. Anything that changes on screen without
   raising a signal would look frozen for up to half a second.

Branch: `claude/busy-hopper-y0jlxs`. Run with `npm install && npm start`
(http://localhost:3333). `npm install` matters: the branch moves Spark from
2.2.0 to 2.3.0.

## What changed (so you know what to look at)

| Change                                               | Where                                                                 |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| Fetching pauses while the tab is hidden              | `splat` system, `public/splat-viewer.html`                            |
| `.rad` over 5M splats halves the LOD budget          | `src/tested/splat-streaming.js`                                       |
| Converter drops spherical harmonics (`RAD_MAX_SH=0`) | `rad-converter/` (only affects newly converted assets)                |
| Spark 2.2.0 → 2.3.0                                  | `package.json`, splat-viewer importmap                                |
| Idle editor draws skipped once a splat exists        | `render-on-demand` system, policy in `src/tested/render-on-demand.js` |
| Standalone splat viewer renders only on demand       | `public/splat-viewer.html`                                            |

**When an editor frame still draws:** camera pose, projection or canvas size
changed; for 500 ms after any pointer / wheel / key input or scene event;
when Spark's `onDirty` asks for a frame; and at least every 500 ms as a
safety net. Viewer mode, Play and WebXR draw every frame. Deleting the last
splat restores normal drawing.

## Console helpers

Paste once per page load. `measureRod(10)` samples for 10 seconds and prints
the draw rate by reason.

```js
window.measureRod = async (seconds = 10) => {
  const rod = AFRAME.scenes[0].systems['render-on-demand'];
  const renderer = AFRAME.scenes[0].renderer;
  let raf = 0;
  let on = true;
  const count = () => {
    raf++;
    if (on) requestAnimationFrame(count);
  };
  requestAnimationFrame(count);
  const a = { ...rod.getState().frames };
  const f0 = renderer.info.render.frame;
  await new Promise((r) => setTimeout(r, seconds * 1000));
  on = false;
  const b = rod.getState().frames;
  const per = (k) => +((b[k] - a[k]) / seconds).toFixed(1);
  const out = {
    loopFps: +(raf / seconds).toFixed(1),
    drawsPerSec: +((renderer.info.render.frame - f0) / seconds).toFixed(1),
    skippedPerSec: per('skipped'),
    settlingPerSec: per('settling'),
    requestedPerSec: per('requested'),
    heartbeatPerSec: per('heartbeat'),
    ineligiblePerSec: per('ineligible'),
    holders: rod.holders,
    eligible: rod.getState().eligible
  };
  console.table(out);
  return out;
};
```

Also useful:

```js
STREET.splatDebug.snapshot(); // .renderOnDemand, .streaming
STREET.splatDebug.setRenderOnDemand(false); // A/B: draw every frame
STREET.splatDebug.setRenderOnDemand(true);
```

## Part 1 — Does it help? (~12 min)

Use the 417 MB / 9M-splat scene from #2047 (or the biggest `.rad` you have),
Chrome, and a mains-powered laptop so power management doesn't skew it.
Open Chrome's Task Manager (Shift+Esc) and show the **GPU memory** and **CPU**
columns; macOS Activity Monitor's GPU History is a good second view.

### 1. Idle editor, A/B (5 min)

- [ ] Load the scene in the editor, wait until streaming visibly settles
      (network panel quiet for ~10 s), don't touch the mouse.
- [ ] Run `measureRod(10)` → record it.
      **Pass:** `drawsPerSec` about 2, `skippedPerSec` about 58,
      `requestedPerSec` 0 once settled (a non-zero value that never decays
      means Spark's `onDirty` is looping, a bug).
- [ ] Note the tab's CPU % and GPU usage for 10 s.
- [ ] `STREET.splatDebug.setRenderOnDemand(false)`, keep hands off, run
      `measureRod(10)` and note CPU / GPU again.
- [ ] Turn it back on.

**Record:** idle CPU %, GPU %, and fan / power with on-demand on vs off.
Expected: a large drop with it on. If there is no difference, the cost is
somewhere other than drawing (see "If it doesn't help" below).

### 2. Same scene on `main` (3 min)

- [ ] Check out `main`, `npm install`, reload the same scene, same idle
      measurement (CPU / GPU only; `measureRod` won't exist).

This separates the Spark upgrade and pacing from on-demand rendering.

### 3. Hidden tab (2 min)

- [ ] With the scene still streaming, switch to another tab for 30 s, watch
      the Network panel (keep DevTools undocked so it stays visible).
      **Pass:** new `.rad` range requests stop within a few seconds and
      resume when you come back.

### 4. Moving the camera (2 min)

- [ ] Orbit, pan, wheel-zoom and WASD-fly for ~20 s.
      **Pass:** motion is exactly as smooth as on `main`; no hitch when
      motion starts or when damping coasts to a stop.

## Part 2 — Does it break anything? (~15 min)

All with a splat in the scene (on-demand active). For each, the failure
mode to watch for is **a visual change that lags up to half a second or
appears only after you move the mouse**.

### 5. Editor interaction (6 min)

- [ ] Hover entities: hover outline appears / clears immediately.
- [ ] Click-select and deselect: selection box updates immediately.
- [ ] Gizmo drag (move / rotate / scale) on a model and on the splat.
- [ ] Street gizmos: segment width handles, street node handles.
- [ ] Shape vertex editing: drag a vertex, add / remove one.
- [ ] Undo / redo from the keyboard and from the toolbar buttons.
- [ ] Change a property in the right panel (e.g. a model's color or a
      segment type) with the mouse resting still over the panel.
- [ ] Add a layer from the Add Layer panel; delete one with the Delete key.
- [ ] Toggle layer visibility (eye icon) in the scene graph.

### 6. Things that change on their own (4 min)

These raise no input event; they are the most likely to lag.

- [ ] Drag-upload a new splat: the "Loading…" indicator's dots animate
      smoothly and it disappears when the splat appears.
- [ ] Load a scene with models: ghost boxes swap to the real GLBs promptly.
- [ ] Lazy textures and the sky arrive without needing a mouse move.
- [ ] Google 3D Tiles / OSM buildings / 2D basemap: with the camera still,
      tiles finish loading on their own (they may pop in at the 2 fps
      heartbeat; that is acceptable, never appearing is not).
- [ ] Plan View / compass / focus tweens glide smoothly.
- [ ] An AI-assistant or MCP edit (if you use them) shows up immediately.

### 7. Modes and outputs (4 min)

- [ ] Viewer mode: `measureRod(5)` shows `ineligiblePerSec` near the full
      frame rate. Animated models and traffic run smoothly.
- [ ] Play (Start / Stop / Reset), drive and fly modes behave as on `main`.
- [ ] Back to the editor: skipping resumes (`skippedPerSec` > 0 when idle).
- [ ] Screenshot / set thumbnail / snapshot: images are correct, not black,
      and don't include the editor helpers.
- [ ] Browser window resize and DevTools dock / undock: canvas redraws.
- [ ] Delete every splat: `measureRod(5)` shows `holders: 0` and every frame
      drawing (`ineligiblePerSec` ≈ fps).
- [ ] WebXR, if you have a headset: enter and exit VR from the viewer.

### 8. Standalone splat viewer (1 min)

- [ ] Open the asset modal's splat preview (or
      `/splat-viewer.html?src=<splat url>`): the splat loads and streams in,
      drag / zoom are smooth including damping, and the thumbnail is not
      blank. Idle CPU / GPU for that tab should be near zero.

## If it doesn't help

- `drawsPerSec` high while idle: look at which reason dominates in
  `measureRod`. `settling` means something is invalidating constantly
  (a scene event firing every frame); `requested` means Spark keeps asking.
- Draws low but CPU still high: the cost is outside drawing. Profile 5 s
  of idle with the Performance panel and look for per-frame ticks
  (navigation probes raycasting the splat, tile streamers) or worker
  activity (Spark sort / LoD workers, chunk decode).
- GPU still high with draws low: check for another canvas or render
  target being drawn every frame.

## Tuning knobs

`SETTLE_MS` and `HEARTBEAT_MS` in `src/tested/render-on-demand.js` (both
500 ms). A longer heartbeat saves more on weak GPUs but makes any missed
signal lag longer. If Part 2 finds a lagging case, prefer adding its event
to `SCENE_EVENTS` in `src/aframe-components/render-on-demand.js` or calling
`requestFrame()` from the code that changes the scene.

## What to report back on the PR

- Part 1 numbers: idle CPU / GPU with on-demand on, off, and on `main`,
  plus the `measureRod` table for the idle case.
- Hardware, OS and browser version.
- Any Part 2 item that failed, with steps to reproduce.
