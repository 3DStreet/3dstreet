# Host primitive + generator pattern

This pattern lets a plain editable primitive (a "host") carry an optional managed
"generator" component that procedurally decorates it, with **both** the host's
geometry/material **and** the generator's options surfaced as first-class controls
in the properties sidebar.

The first example is the **Grass Box**: a plain green ground box
(`geometry` + `material`) plus an optional `street-generated-grass` generator that
spawns an instanced, wind-animated field of grass blades on top. We expect other
combinations in the future (other surfaces, other procedural decorations).

## The two parts

### 1. First-class geometry / material in the sidebar

The properties sidebar promotes selected components to an expanded **featured**
section above the collapsed "Advanced Components" toggle. This is driven by a
generalized allow-list, not a per-shape sidebar:

- `src/editor/lib/featuredComponents.js` — `FEATURED_COMPONENT_PREFIXES`
  (`geometry`, `material`, `street-generated-`) and helpers. This generalizes a
  mechanism that previously lived only in `StreetSegmentSidebar`.
- `FeaturedComponents.jsx` — renders the featured components for any entity.
  `geometry` and generators reuse the generic schema-driven `Component` widget;
  `material` gets a curated panel.
- `MaterialControls.jsx` — curated material editing (color, texture with a
  one-click **Make Solid** to drop the texture, a real **opacity slider** with
  live preview that also toggles `transparent`, and roughness).
- `AdvancedComponents.jsx` excludes featured components so nothing is shown twice.

Any primitive — Building Box, Asphalt Circle, Grass Box, image planes — gets its
key dimensions and material color/texture as first-class controls for free.

### 2. The generator component

Generators follow the canonical `street-generated-*` managed-children pattern
(see `src/aframe-components/street-generated-clones.js`). Using
`street-generated-grass.js` as the reference:

- Track spawned entities in `this.createdEntities`; `clearEntities()` on
  `update()`/`remove()`.
- Tag spawned entities `class: autocreated`, `data-no-transform`,
  `data-layer-name`, and `data-parent-component` so the SceneGraph treats them as
  managed (the sidebar's "Edit Settings / Detach" flow works automatically).
- Wrap heavy GPU objects (e.g. a `THREE.InstancedMesh`) under an `autocreated`
  child entity via `setObject3D`, so the SceneGraph behaves and the mesh is
  regenerated rather than saved.
- **Serialization is automatic.** The serializer skips `autocreated` children
  (`src/json-utils_1.1.js`), so the scene saves only the generator's config
  (e.g. `{ density, grassHeight, ... }`) on the host entity and regenerates the
  decoration on load — never thousands of entities.
- Size the decoration off the host's geometry when relevant and listen for
  `componentchanged` on the host so editing the host's first-class geometry
  rebuilds the decoration live.

### Generator implementation checklist (learned from the grass prototype)

- Animate from A-Frame's `tick(time, delta)`, **not** `window.requestAnimationFrame`
  — so it pauses with the scene, drives correctly under WebXR, and never spawns
  competing loops.
- Dispose GPU resources in `clearEntities()` (`geometry.dispose()` /
  `material.dispose()`) to avoid leaks on repeated add/remove.
- Scale work with area and apply a quality cap (grass caps blades at
  `MAX_BLADES`) so large hosts / mobile GPUs stay healthy.
- Seed any RNG (via `src/lib/rng.js`) so the layout is stable across reloads,
  since children regenerate from config. Default `seed: 0` → pick one and persist
  it via `setAttribute`.
- Rebuild on every relevant schema change (the grass `update()` rebuilds on
  density/blade size and recolors in place on color-only changes).

## Adding a new host + generator combination

1. Add an Add-Layer card / `createLayerFunctions.js` factory that creates the
   host primitive (geometry + material) and attaches your generator component.
2. Implement the generator as a `street-generated-*` component following the
   checklist above, and register it in `src/index.js`.
3. Nothing else is required for the sidebar: geometry, material, and the
   `street-generated-*` generator options are surfaced as first-class controls
   automatically.
