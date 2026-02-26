# InstancedMesh for Street-Generated Clones

## Overview

Street scenes generate large numbers of repeated objects (cars, people, trees, etc.) via the `street-generated-clones` and `street-generated-pedestrians` components. Originally each clone was an individual A-Frame entity with its own Three.js mesh, which caused high draw call counts and memory usage — complex scenes could hit 2,000+ draw calls and freeze the browser.

As of PR #1460, these components use `THREE.InstancedMesh` to batch identical models into single draw calls, dramatically reducing GPU overhead.

## Architecture

### instanced-mesh-helper.js (`src/lib/instanced-mesh-helper.js`)

Shared utility used by both clone and pedestrian components:

- **`loadMixinModel(mixinId)`** — Creates a temporary hidden A-Frame entity with the given mixin, waits for the model to load, extracts the source `Object3D`, and removes the temp entity.
- **`createInstancedGroup(sourceObject, instances)`** — Traverses the source model to find all `Mesh` children. For each mesh, creates a `THREE.InstancedMesh(geometry, material, count)` and sets per-instance transforms from the `instances` array of `{position, rotation}`. Returns a `THREE.Group` containing the instanced meshes.

Handles both single-mesh models (e.g. `gltf-part` characters) and multi-mesh models (e.g. `gltf-model` vehicles with body, wheels, etc.).

### How the components work

1. **Generation phase** — `generateFixed/Random/Single/Fit` methods collect clone specifications into a `this.cloneSpecs` array: `{mixinId, position: {x,y,z}, rotation: {x,y,z}}`
2. **Instancing phase** — Specs are grouped by `mixinId`. For each unique mixin, `loadMixinModel()` loads the geometry once, then `createInstancedGroup()` creates batched instanced meshes.
3. **Rendering** — The instanced groups are added directly to `this.el.object3D`. No individual DOM entities are created.

### Detach support

The editor's "Detach" feature (converting generated clones into individually editable entities) still works. `detach()` iterates `this.cloneSpecs` to build entity creation commands, producing the same result as before.

### Cleanup

`remove()` disposes instanced mesh groups (geometries and materials) and clears them from `this.el.object3D`.

## What's not instanced

- **Striping** (`street-generated-striping`) — 1 entity per segment, not a bottleneck
- **Stencils** (`street-generated-stencil`) — Fewer instances, uses atlas UVs which complicate instancing. Can be optimized later if needed.

## Performance impact

Measured on a complex scene with multiple managed streets:

| Metric | Before | After (approx.) |
|---|---|---|
| Draw calls | ~2,400 | ~400-600 |
| Entities | ~5,500 | ~200-400 |
| JS Heap | ~2,400 MB | ~500-800 MB |

## Key files

- `src/lib/instanced-mesh-helper.js` — Shared instancing utility
- `src/aframe-components/street-generated-clones.js` — Clone generation with instancing
- `src/aframe-components/street-generated-pedestrians.js` — Pedestrian generation with instancing

## Performance profiling tool

A Puppeteer-based profiling script is available for measuring scene performance:

```bash
# Profile default test scenes
npm run perf

# Profile a specific scene URL
npm run perf -- "https://3dstreet.app/#/scenes/<scene-id>"
```

### What it measures

- **FPS** — Average, min, max, P5, median, P95 over a 10-second sample
- **Renderer stats** — Draw calls, triangles, geometries, textures (from `renderer.info`)
- **Scene stats** — Entity count, Three.js object count
- **Memory** — JS heap usage (when available via Chrome flags)

### How it works

The script (`scripts/perf-profile.js`) uses Puppeteer to:
1. Launch Chrome in headful mode (GPU rendering required for meaningful FPS)
2. Navigate to the scene URL and wait for A-Frame scene load
3. Wait 5 seconds for assets (models, textures) to settle
4. Measure frame times via `requestAnimationFrame` over 10 seconds
5. Collect renderer and memory stats
6. Print a formatted report

### Default test scenes

The script includes three built-in test scenes of increasing complexity. Run `npm run perf` with no arguments to profile all three. Useful for before/after comparisons when making rendering changes.

### Requirements

- `puppeteer` must be installed (`npm install puppeteer --save-dev`)
- Runs Chrome in headful mode — requires a display (won't work in headless CI without Xvfb)
