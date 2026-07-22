# street-to-glb

A DOM-free Node pipeline that turns a **managed-street JSON** blob into a GLB
and then into a labeled "beauty shot" PNG — the offline, Blender-rendered
counterpart to the browser `renderStreet` endpoint.

```
managed-street JSON
  ─▶ [pure-THREE assembler, no A-Frame/DOM]  ─▶  GLB
  ─▶ [Blender Cycles, CPU]                   ─▶  PNG
  ─▶ [Pillow: cross-section label bar]       ─▶  labeled beauty shot
```

Scope is the **managed-street family only** (`managed-street`, `street-segment`,
`street-align`, `street-generated-{clones,stencil,striping,pedestrians,rail}`,
`street-label`, `street-environment`). GLB is the interchange format — there is
no generalized scene-manifest/IR. Legacy `street`/`streetmix-loader`,
`intersection`, geospatial layers and arbitrary user entities are out of scope.

## Task 1 — the assembler (JSON → GLB)

`streetToGlb(payload)` builds a `THREE.Scene` with pure `three` (no A-Frame, no
jsdom) and exports it with `GLTFExporter`. It ports, verbatim where it matters:

- **surface slabs** — `below-box` geometry, `calculateHeight` elevation math,
  surface→texture mapping and tint (`street-segment.js`);
- **alignment** — cross-street centering + boundary stacking (`street-align.js`);
- **generated content** — `fixed`/`random`/`single`/`fit` model placement,
  stencils, striping, pedestrians, rail (`street-generated-*.js`);
- **auto-striping** and **boundary-variant synthesis** (`managed-street.js`);
- a byte-for-byte **mulberry32** RNG (`src/lib/rng.js`) so a fixed `seed` gives
  byte-stable GLB — the invariant the endpoint's content-hash cache relies on.

Catalog models are fetched from `assets.3dstreet.app`, Draco-decoded with
`@gltf-transform` + `draco3dgltf`, and parsed by `three`'s `GLTFLoader`.
Source-model **textures are preserved** through the assemble→export round trip
via a small `@napi-rs/canvas` DOM shim (`src/three-node.js`).

```bash
npm install
node cli.js golden/suburban-arterial.json out.glb
npm test        # determinism + golden-shape assertions
```

## Task 2 — Blender render + Pillow labels

`render/render_blender.py` (Cycles, CPU) imports the GLB, builds the environment
rig (sky HDRI + sun + ambient, ported from `street-environment.js` presets),
adds a ground plane, and frames the camera with the analytic corner-fit +
screen-space refit from `street-render-harness.js frameCamera()` (run in glTF
space, converted to Blender's Z-up).

`render/composite_labels.py` (Pillow) overlays the 2D cross-section label bar
(cell widths / names / accent colors from the travelled-way segments, matching
`street-label.js`) plus the title and "made with 3DStreet" branding. Labels are
**not** baked into the GLB.

```bash
# whole pipeline, JSON -> GLB -> PNG:
BLENDER_BIN=/path/to/blender node render/pipeline.mjs golden/avenue-with-boundaries.json out
```

### Cycles-CPU bake-off (1280×800, denoised)

| samples | render time |
|--------:|------------:|
|       8 |      ~9.7 s |
|      12 |     ~12.2 s |
|      16 |     ~16.4 s |
|      32 |     ~23.8 s |

Default is **12 samples (~12 s)**, comfortably inside the ~3–15 s target.

## Golden streets

- `golden/suburban-arterial.json` — sidewalks + pedestrians + 3 random drive
  lanes (seeds pinned).
- `golden/avenue-with-boundaries.json` — drive lanes + sidewalks + a
  `brownstone` boundary on **both** sides (exercises `buildingWidths`/fit
  tiling).

## Wire-up

`public/functions/render-street-glb.js` exposes `renderStreetGlb` behind the
same POST/GET contract as `renderStreet`, returning `{ imageUrl, glbUrl }` and
caching **both** artifacts at content-hash paths (`glb-renders/v1/<hash>.{png,glb}`),
mirroring the existing `/render/img/v1/` cache. It needs Blender + Python/Pillow
+ this tool's Node deps, so it targets a Cloud Run container
(`render/Dockerfile`). The legacy browser `renderStreet` endpoint stays the live
path; **prod deploy is deferred.**
