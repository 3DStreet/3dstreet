# Asset loading: async scene init, lazy textures, load indicators

[Back to the codebase guide](../CLAUDE.md). Issue: [#2009](https://github.com/3DStreet/3dstreet/issues/2009).

There are two loading concepts and they must never be conflated:

1. **App** – the page shell and the React editor. The "Loading 3DStreet"
   splash in `index.html` gates this and only this. It clears one second after
   `<a-scene>` emits `loaded`, which is when the editor mounts.
2. **Scene assets** – GLBs, textures, catalog assets, user uploads, splats,
   tiles. Open-ended, never blocking. They report through the asset-load
   indicators described below.

## Async scene init (`index.html`)

A-Frame refuses to initialize any element until `document.readyState ===
'complete'` (window `load`), which on a cold cache waits for every `<img>` in
the document. `index.html` sets `window.AFRAME_ASYNC = true` before the
A-Frame script and calls `AFRAME.emitReady()` on `DOMContentLoaded`, so the
scene initializes as soon as the DOM is parsed. The 3DStreet bundle's own
`DOMContentLoaded` listener (`src/assets.js`) runs first and injects
`<street-assets>` before the scene wakes up.

Consequences to keep in mind:

- Nothing may assume window `load` has fired when the scene initializes.
- `<a-assets>` scans its children at `readyState === 'interactive'`, before
  `<street-assets>` injects anything, so it never gated on our assets and
  still does not. GLB `<a-asset-item>`s are fetched via `THREE.FileLoader`,
  which dedupes concurrent requests for the same URL.
- The other HTML pages (`public/model-viewer.html`, `splat-viewer.html`, …)
  do not set the flag and keep A-Frame's default behavior.

## Lazy textures (`src/lazy-textures.js`, `src/assets.js`)

`<street-assets>` injects every texture as `<img id="…" data-src="…"
crossorigin="anonymous">` — no `src`. Nothing downloads until a material
references the asset (`material="src: #seamless-road"`), so an empty scene
fetches zero textures and a typical street fetches the two to six it uses.
Asset ids are unchanged: saved scene JSON, legacy ground mixins, striping and
stencil atlases all keep working.

`installLazyTextureSource()` patches A-Frame's material system prototype at
bundle load (before any scene exists). On `loadTextureSource(<img>)` it copies
`data-src` → `src`, waits for the image to load, and only then hands a
`THREE.Source` to the material. That matters because A-Frame otherwise passes
an incomplete image to three.js, which refuses to upload it and warns every
frame; with the hook the surface shows its flat base color until the texture
pops in and A-Frame's `materialtextureloaded` fires when it is real. The
material system's `sourceCache` (keyed by element id) still dedupes across
entities, so each texture downloads once per page.

### Placeholders while a texture is pending

A surface whose texture has not arrived would otherwise render its bare
material color (bright white for an asphalt lane), which reads as broken. Each
lazy `<img>` therefore carries `data-placeholder`: the texture's measured
average color, or `transparent` for the alpha-cutout atlases and striping.
`installMaterialPlaceholders()` wraps A-Frame's material component `update`:
while `src` is a pending lazy image, an opaque surface is tinted with the
placeholder times its own `color`, and a cutout is hidden (`material.visible`)
instead of rendering as a solid quad. `materialtextureloaded` undoes it, which
is also before batch-models clones the material (it waits on the same event
via `waitForMaterialTexture`). The tint is written straight to the THREE
material, never through `setAttribute`, so nothing about it is serialized. A
texture that fails keeps its placeholder. Materials built by hand with
`THREE.TextureLoader` (intersections) do the same with
`getAssetPlaceholderColor()`.

Rules:

- **A new lazy asset image needs a `data-placeholder`** (canvas average of
  the image, or `transparent` for cutouts); without one it shows white.
- **Read an asset image's URL with `getAssetImageSrc(img)`**, never `img.src`
  (empty until first use). `getUrlFromId` / `getIdFromUrl` in
  `src/editor/lib/assetsUtils.js` already do.
- Anything that loads a texture by URL outside the material system
  (`THREE.TextureLoader` in `intersection.js` / `managed-intersection.js`, the
  editor swatches) goes through the same helper.
- Editor UI must not enumerate `a-assets img` on mount. The texture picker
  (`ModalTextures.jsx`) used to build its gallery on mount and render an
  `<img>` per asset while closed, which re-downloaded every texture twice
  on page load; it now builds only when opened and renders nothing while
  closed.
- User-added textures (`insertNewAsset`) still get an eager `src`; that is a
  deliberate use.

The four ~1 MB seamless textures from the issue are served as WebP: the
conversion lives in the assets repository and `src/assets.js` references the
`.webp` files. Any further shrinking (resolution, other formats) is likewise an
assets-repository change plus a reference update here.

## Sky placeholder (`src/sky-placeholder.js`, `street-environment`)

Every `street-environment` preset except `color` sets `scene.background` and
`scene.environment` from a ~150–220 KB equirect JPEG on the assets CDN. That
download used to be the longest black screen of a scene load: the renderer's
clear color showed until the texture arrived. The component now assigns a
placeholder the moment a preset is applied: `createSkyPlaceholderTexture()`
paints a vertical gradient on an 8×128 canvas from color stops sampled off the
real image (zenith → horizon → nadir, `SKY_GRADIENTS`) and returns it as an
equirect sRGB `CanvasTexture`. It is assigned as `scene.environment` too;
on the editor scene A-Frame's `reflection` component overrides that with its
own probe at init, which renders the placeholder sky anyway. The real texture
replaces both when it lands; a failed download keeps the gradient. A texture
that is already showing (`userData.skySrc`) or already downloading
(`pendingBackground`) is never re-requested, so re-applying the same preset
does not flash the placeholder. Switching preset (including to `color`) while
a sky is in flight abandons that download: its callback applies nothing.
Flipping back before it lands reuses the same in-flight request
(`loadSkyTexture` keeps one promise per path) instead of starting a second.

Rules:

- **A new sky preset needs an entry in `SKY_GRADIENTS`** (row averages of
  the image at evenly spaced latitudes); unknown presets fall back to `day`.
- The sky download is reported to the tracker as a texture keyed
  `sky:<preset>` (`texture-loading` / `-loaded` / `-error` on the scene).
- Anything that swaps `scene.background` for a texture must dispose the
  previous one; `disposeSceneTexture()` on the component does that for real
  and placeholder textures alike.

## Model placeholders (`src/aframe-components/model-placeholder.js`)

Props, people and vehicles used to pop into an empty street as each GLB
finished downloading. The `model-placeholder` system draws a translucent
ghost box of the model's known bounds where the entity is from the moment its
`gltf-model` or `gltf-part` component initializes (which covers batching's
deferred duplicates, which never download on their own) until that entity's
`model-loaded` or `model-error`, then removes it. A src or part change while
pending swaps the box (`componentchanged`); clearing the src drops it.

A deferred duplicate's `model-loaded` comes from batch-models when its group
is built, and the initial pass builds each key group as soon as that group's
own reference model has loaded (`batchKeyGroupWhenReady` in
`src/batch-models.js`), not after every model in the scene. So a duplicate's
box clears together with its original; one slow or stalled GLB elsewhere only
delays its own group (#2033). A duplicate whose reference fails is released to
load on its own at the same point.

All ghosts are instances of one `THREE.InstancedMesh` (one draw call however
many clones are loading; a shader draws the frame on the box faces). The
scene renders with a logarithmic depth buffer, so that shader, like any
custom `ShaderMaterial` here, must include three's `logdepthbuf` chunks or
street surfaces occlude it at random. The mesh
hangs off an autocreated `#model-placeholders-root` entity under the scene,
hidden from the scene graph and never serialized, so the editor's raycaster
still hits it: an intersection's `instanceId` maps back to the entity through
`mesh._placeholderEls` (`raycaster.js`). Each tick writes the instance
matrices from the entities' world matrices and zeroes instances whose entity
is invisible or detached. The box's local bounds are mirrored on
`el.object3D._placeholderBbox`, which the editor's selection and hover box
helper reads like batch-models' `_batchLocalBbox` (`viewport.js`). The mesh
is tagged `userData.source = 'INSPECTOR'` so exports hide it. Nothing here
touches the `mesh` object3D that the model components and batch-models own.

Where bounds come from (`src/model-bounds.js`):

- **Catalog models and legacy mixins:** `src/model-bounds.json`, generated by
  `npm run assets:bounds` (`scripts/assets/compute-model-bounds.mjs`), keyed by
  asset path relative to the CDN root, with `#part` for gltf-part entries.
  Lookup matches a URL's path suffix, so a custom `<street-assets url>` base
  still resolves. **Re-run the script when a model changes shape or a
  catalog entry is added**; an entry that is missing simply means no box.
- **User uploads:** the optimizer worker computes the served model's bounds
  and `assetsService.addAsset` stores them top-level on the asset doc as
  `bounds: { min, max }` (Reoptimize refreshes them). On scene load
  `resolveCloudAssetUrls` registers them per entity through the runtime
  registry; **bounds never enter the scene JSON**. Assets uploaded before
  this field existed are backfilled lazily: when such a model loads for its
  signed-in owner, the client computes bounds from the mesh and writes them
  once per session.

Bounds are model-space meters (Y up), before the entity's own transform.

## Asset load tracker and indicators

`src/asset-load-tracker.js` is pure bookkeeping (unit tests in
`test/editor/assetLoadTracker.test.js`). The `asset-load-status` system
(`src/aframe-components/asset-load-status.js`) feeds it from scene events and
mirrors `tracker.getSummary()` into the store as `assetLoadSummary`.

Two classes of entity:

- **Deterministic** (counted, real progress): `gltf-model` and `gltf-part`
  entities — `model-loading` opens an entry keyed by the element,
  `model-loaded` / `model-error` settle it. Textures — the lazy hook emits
  `texture-loading` / `texture-loaded` / `texture-error` on the scene, keyed
  `texture:<asset id>`. A pending entry older than 30 s (matching
  batch-models' `LOAD_TIMEOUT_MS`) is reported as `timed-out` by the 1 s
  tick: it counts as neither pending nor settled, holds `done` back, and a
  late settle still overrides it. Batched duplicates never emit
  `model-loading`, and a `model-loaded` without a matching begin is ignored,
  so they are not counted. A model component that changes to point at
  nothing (`gltf-model` src cleared, `gltf-part` without src or part) or is
  removed never settles, so the system forgets its entry on
  `componentchanged` / `componentremoved` (capture phase; they don't bubble).
- **Streaming** (activity only, excluded from the count): splats via
  `splat-loading` / `splat-loaded` / `splat-error`, tile layers
  (`google-maps-aerial`, `tiled-basemap`) via `stream-active` / `stream-idle`
  driven by the tiles renderer's `tiles-load-start` / `tiles-load-end`. A new
  streaming component should emit those two events with `{ kind }`.

Entries keyed by an element are forgotten by the tick once the element leaves
the document. Entries are replaced, never mutated, so React can compare them
by identity through `useSyncExternalStore`. Events that feed the tracker
must reach the scene element: emit them bubbling (A-Frame's default), as the
splat, model and tile components do.

Editor surfaces (`src/editor/components/scenegraph/`) are deliberately
ambient: no icons, counts, bars or text, so loading is visible to anyone who
looks and invisible to anyone who does not.

- `EntityLoadSheen.jsx`, the first child of each layer row, is a layer
  painted behind the row content (the row isolates its stacking context; the
  sheen sits at z-index -1). While the row's model downloads a soft sheen
  sweeps across; once loaded it fades out; a failed load settles to a thin
  warning accent on the row's left edge. Hovering the row shows a tooltip
  with the state. Streaming
  layers (splats, tiles) show nothing.
- `PanelLoadSheen.jsx`, behind the left panel's title + save row: a faint
  fill tracks overall progress (`--load-progress`) with a sheen across it,
  fading out once every model and texture has settled (a timed-out load
  keeps it going, like the row's slow state). Always mounted so the fade is
  a CSS transition.
- `useAssetLoadTracker.js` holds the hooks; the tracker is reachable at
  `AFRAME.scenes[0].systems['asset-load-status'].tracker` (the hooks attach
  on the scene's `loaded` if they render before it exists), and the store's
  `assetLoadSummary` carries the counts for tooling (MCP, tests).
- Both honor `prefers-reduced-motion` (static wash instead of animation).

Per-entity texture state is not tracked (textures are shared across many
striping / stencil clones); textures count only in the global summary.
