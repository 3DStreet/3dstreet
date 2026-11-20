# WebGPU procedural buildings in A‑Frame — MVP

Investigation for [issue #1763](https://github.com/3DStreet/3dstreet/issues/1763): can we render
mrdoob's procedural skyscrapers — which use **WebGPU‑only TSL node shaders** — inside
A‑Frame / 3DStreet? This doubles as the most demanding possible smoke‑test of **WebGPU in
A‑Frame**, since the buildings won't render at all unless A‑Frame is actually driving a
`WebGPURenderer`.

**TL;DR: yes, it works.** A‑Frame master will instantiate a real `WebGPURenderer` with no
patching, and mrdoob's `SkyscraperGenerator` + TSL material run unmodified inside an A‑Frame
component. Try it: **`/webgpu-buildings.html`** (served by the dev server at the repo root).

---

## How it works

Three facts line up to make this a ~120‑line standalone page with **no changes to A‑Frame or
the 3DStreet bundle**:

1. **A‑Frame's ESM build externalizes three.** `aframe-master.module.min.js` contains exactly
   one bare import: `import * as THREE from 'three'`. So an **importmap** entry for `three`
   completely controls which three.js A‑Frame uses.

2. **A‑Frame master already auto‑detects WebGPU.** Its `a-scene` picks a renderer with:

   ```js
   var rendererImpl = ['WebGLRenderer', 'WebGPURenderer'].find(x => THREE[x]);
   renderer = new THREE[rendererImpl](rendererConfig);
   ```

3. **`three.webgpu.js` exports `WebGPURenderer` but not `WebGLRenderer`.** (The only mentions of
   `WebGLRenderer` in that bundle are in doc‑comments.) So when we point the importmap's `three`
   at `three.webgpu.js`, `THREE.WebGLRenderer` is `undefined`, the `.find()` lands on
   `'WebGPURenderer'`, and **A‑Frame instantiates WebGPU on its own.**

The importmap maps all four three specifiers to one pinned three.js commit so A‑Frame and the
mrdoob generators share a single THREE instance:

```json
{
  "three":         ".../build/three.webgpu.js",
  "three/webgpu":  ".../build/three.webgpu.js",
  "three/tsl":     ".../build/three.tsl.js",
  "three/addons/": ".../examples/jsm/"
}
```

The building itself is wrapped as an ordinary A‑Frame component. `SkyscraperGenerator.build()`
returns a single `THREE.Mesh` already carrying the TSL `MeshStandardNodeMaterial`, so the
component just does `this.el.setObject3D('mesh', building)`:

```js
AFRAME.registerComponent('webgpu-skyscraper', {
  schema: { seed: {default: 7}, height: {default: 100}, /* … */ },
  init() {
    const baseColor = uniform(new THREE.Color(pickBuildingColor(this.data.seed)));
    const material  = createSkyscraperMaterial(baseColor);
    const generator = new SkyscraperGenerator({ seed, totalHeight, footprint, … }, material);
    this.el.setObject3D('mesh', generator.build());
  }
});
```

### Pinned versions

| Dependency | Pin | Why |
|---|---|---|
| A‑Frame ESM build | `aframevr/aframe@6a054e8` (`aframe-master.module.min.js`) | Same master commit 3DStreet already ships in `index.html`; WebGPU‑aware `a-scene`. |
| three.js (webgpu + tsl + jsm) | `mrdoob/three.js@6ee0a42` | First commit carrying the `SkyscraperGenerator` / `CityGenerator` city example. Reports `THREE.REVISION === "186dev"`, matching A‑Frame master's three. |

Both are loaded from `cdn.jsdelivr.net/gh/...` in the browser.

---

## What was verified

The page was assembled into a local mirror and driven headless (Chromium + Playwright) so the
integration could be checked without a CDN round‑trip. Confirmed:

- `scene.renderer.constructor.name === "WebGPURenderer"` and `isWebGPURenderer === true` — **A‑Frame
  created a WebGPU renderer automatically**, no monkeypatching.
- `scene.renderer.backend.isWebGPUBackend === true` — a **real WebGPU backend** (not the WebGL
  fallback), `navigator.gpu` present.
- `SkyscraperGenerator` + `createSkyscraperMaterial` ran inside the A‑Frame component and produced
  geometry (**~35,000 triangles** across three procedurally‑seeded towers).
- With the caveat below bridged, the A‑Frame render loop ran with **no errors**.

The page reports all of this live in an on‑screen HUD (`navigator.gpu`, renderer class, active
backend, three revision) so the same checks are visible in a real browser.

---

## Caveats / rough edges

These are the things to expect when pushing this past an MVP — none are blockers.

1. **Bleeding‑edge WebGPU APIs vs. browser version.** three `r186dev` emits a
   `swizzle` field on `GPUTextureViewDescriptor` (the new `texture-component-swizzle` feature).
   Browsers/GPU stacks that predate it throw
   `Failed to read the 'swizzle' property … not of type 'GPUTextureComponentSwizzle'`. Use a
   current Chrome/Edge. If you see this, the three build is ahead of the browser — pin three a bit
   older or update the browser. (In the headless harness, the bundled Chromium was too old; the
   field was nulled out **locally only**, never in the shipped page, to confirm the rest of the
   pipeline paints.)

2. **Async renderer init.** `WebGPURenderer` needs `await renderer.init()`, but A‑Frame master's
   `setupRenderer()` doesn't await it — it just calls `setAnimationLoop`. In practice WebGPURenderer
   self‑initializes on the first frame, so the loop recovers after a frame or two. The page also
   calls `await scene.renderer.init()` in the `loaded` handler before baking the IBL. A first‑class
   integration should teach A‑Frame to await init before `renderStarted`.

3. **Headless capture.** WebGPU swapchain compositing into a headless screenshot, and offscreen
   pixel‑readback under SwiftShader, were both unreliable in the sandbox (blank captures, Dawn
   "device lost"). This is a headless‑GPU limitation, not a rendering bug — verification relied on
   the renderer/backend/geometry assertions above. Visual confirmation should be done in a real
   browser.

4. **Lighting/IBL.** The mrdoob example dresses the towers with a physical `SkyMesh` + PMREM IBL +
   a directional sun. The MVP uses A‑Frame lights plus a neutral `RoomEnvironment` PMREM so the PBR
   glass isn't flat. Expect to port the sky/sun rig for the "at sunset" look.

---

## Path to real 3DStreet integration

The MVP proves feasibility as a standalone page. Folding it into the editor is a larger effort
because 3DStreet's webpack bundle currently externalizes `three` to the **global `window.THREE`**
(the WebGL build A‑Frame ships in `index.html`), not to a WebGPU build. Rough sequence:

1. **Renderer swap.** Load A‑Frame's ESM build + a `three.webgpu.js` importmap in `index.html`
   (replacing the UMD `aframe-master.min.js` script tag) so the whole app runs on `WebGPURenderer`.
   This is the high‑risk step — every custom component, the Spark splat library, Mapbox/3D‑Tiles,
   and `screentock` need to survive on WebGPU. Gate it behind a flag/URL param.
2. **Await init.** Ensure WebGPU init completes before the first render (patch A‑Frame or delay
   `renderStarted`).
3. **Generators as a component.** Promote `webgpu-skyscraper` (and a `webgpu-city` wrapping
   `CityGenerator`) into `src/aframe-components/`, vendoring or importing the mrdoob `jsm`
   generators. Wire parameters (seed, height, footprint) into the editor properties panel.
4. **Streetmix alignment.** `CityGenerator` exposes its block layout; align generated towers to the
   3DStreet street grid / building lots.

A safer near‑term option is a **hybrid**: keep the editor on WebGL and offer the WebGPU city as an
opt‑in standalone viewer (this page), until A‑Frame's WebGPU path matures.

## Files

- `webgpu-buildings.html` — the MVP (repo root; open `/webgpu-buildings.html` on the dev server).
- `docs/webgpu-buildings-mvp.md` — this document.
