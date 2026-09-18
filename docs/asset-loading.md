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

Still open from the issue: converting the four ~1 MB seamless JPEGs to WebP /
1024 px lives in the assets repository, not here.

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
  tick, and a late settle still overrides it. Batched duplicates never emit
  `model-loading`, and a `model-loaded` without a matching begin is ignored,
  so they are not counted.
- **Streaming** (activity only, excluded from the count): splats via
  `splat-loading` / `splat-loaded` / `splat-error`, tile layers
  (`google-maps-aerial`, `tiled-basemap`) via `stream-active` / `stream-idle`
  driven by the tiles renderer's `tiles-load-start` / `tiles-load-end`. A new
  streaming component should emit those two events with `{ kind }`.

Entries keyed by an element are forgotten by the tick once the element leaves
the document. Entries are replaced, never mutated, so React can compare them
by identity through `useSyncExternalStore`.

Editor surfaces (`src/editor/components/scenegraph/`):

- `EntityLoadBadge.jsx` in each layer row's badge bar: spinner → check (lingers
  2 s) for deterministic loads, a warning that stays on error / timeout, a
  pulsing light while a streaming layer is active.
- `SceneLoadIndicator.jsx` at the foot of the layers panel: "Loading assets
  N / M" with a thin bar, "Streaming" while any stream is active, a persistent
  "N assets did not load" line (tooltip lists them), and a brief "All assets
  loaded". Hidden when idle.
- `useAssetLoadTracker.js` holds the hooks; the tracker is reachable at
  `AFRAME.scenes[0].systems['asset-load-status'].tracker`.

Per-entity texture state is not tracked (textures are shared across many
striping / stencil clones); textures count only in the global summary.
