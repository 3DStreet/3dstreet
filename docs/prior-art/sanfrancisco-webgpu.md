# San Francisco on WebGPU (ericrius1/SanFrancisco)

[Prior-art index](README.md)

- **Repo:** https://github.com/ericrius1/SanFrancisco (Eric). Found while
  looking for the r/threejs "real SF city running in the browser on WebGPU"
  post; that post turned out to be a different project,
  [Teleoperator](teleoperator.md). We found no stated link between the two.
- **Read at:** `696f7f7` (2026-10-01), 987 commits since 2026-07-04. We read
  the README, `AGENTS.md`, the CityGen module and its data, the tile streamer
  and facade code, and the post-processing and performance docs. We did not
  run it (it needs a WebGPU browser; desktop Chrome/Edge is the tested path).
- **License:** **none.** No LICENSE file and no `license` field in
  `package.json`, so the code is all rights reserved by default: read for
  ideas, copy nothing. City data is OSM-derived (ODbL).
- **Built by agents:** `AGENTS.md`, `.claude/` and `.cursor/` folders, Blender
  driven through an MCP add-on, and performance work run in "waves" of
  parallel agents with disjoint file ownership.

## What it is

An open-world multiplayer sandbox of the whole city: walk, drive, scoot,
skate, surf, fly, sail. Everything is a rigid body (Box3D compiled to WASM),
buildings are solid, the bay is a spectral FFT ocean. Rendering is three.js
WebGPU with TSL and WGSL compute; **WebGPU-only by policy** ("a new fallback
renderer is treated as a regression"). One small Node WebSocket relay handles
multiplayer; the city ships as committed data, so there's no world build at
install.

### Pipeline

1. **Fetch:** AWS Terrarium DEM tiles (terrain) and Overpass (OSM buildings,
   roads, water, parks).
2. **`tools/prepare-city.mjs`:** flood-fills the DEM from the map edges to find
   bay water, shapes a bay floor, rasterizes parks and sand, extrudes OSM
   footprints to heights, fits a minimum-area oriented box collider per
   building, and buckets everything into **800 m tiles**.
3. **Blender (`tools/blender_city.py`, through MCP):** builds each tile's
   buildings, roads and parks, plus authored landmarks (Palace of Fine Arts,
   Sutro Tower), and exports GLB per tile. `sanfrancisco.blend` becomes the
   editable master after the first bake.
4. **`tools/optimize-tiles.mjs`:** glTF-Transform pass with 16-bit position
   quantization and meshopt compression. **207 GLBs for the whole city:
   28.3 MB on disk, 14.3 MB gzipped.**
5. **CityGen export:** `public/citygen/buildings.json` (21 MB), one record per
   building per 800 m cell: OSM ID, the real footprint polygon, base and top
   heights, an archetype baked by a neighbourhood classifier, and a seed.

At runtime a WebGPU clipmap draws the terrain from the height grid, GLB tiles
and JSON colliders stream by distance, authored sites stream as their own
regions, and CityGen grows full facade grammar and walkable interiors near the
player, crossfading from a cheap chunked skyline farther out.

## Why it looks so good in real time

- **A full film-style post chain** (`docs/POSTFX_CINEMATIC_PATHWAY.md`): one
  jittered beauty pass writing colour, depth and a small g-buffer, then
  velocity, GTAO ambient occlusion and screen-space reflections at half
  resolution, a temporal pass that both anti-aliases and upsamples (TAAU),
  bloom, and a LUT grade including AgX tone mapping.
- **Rendering below output resolution, upsampled**, with adaptive resolution
  and laptop quality profiles (`src/render/adaptiveResolution.ts`,
  `laptopProfiles.ts`): the main reason the post chain is affordable.
- **GPU compute for the expensive nature:** grass generation, the ocean
  spectrum, fluids, indirect draws, volumetric clouds and live fog.
- **Real terrain under real footprints**, with authored landmarks where
  procedural ones would read wrong.
- **One shared vegetation runtime**: house rule 3 bans hand-rolled
  primitive trees; regions only state botanical intent (positions,
  archetype, yaw, scale).
- **Lazy by default** (house rule 2, `docs/LAZY_LOADING.md`): boot loads only
  the starting area; every region, activity and vehicle loads on first use or
  proximity, verified by checking the request waterfall.

Caution on its numbers: `docs/PERF_LEVELUP.md` has a section titled "the probe
was lying, and every number above is suspect", so treat its earlier
frame-time tables as indicative only.

## How it relates to our topics

### #2090 (context tile layers)

- **`buildings.json` is close to our proposed buildings layer:** OSM ID,
  real polygon, base, top, height, archetype, seed, bucketed per tile. Unlike
  TKY1 and Valdrada's `CTL1`, **it keeps the stable source ID.**
- **A render-side skip by ID.** Building geometry carries a per-vertex
  building ID (`_BID`, deliberately left unquantized so neighbours don't round
  into each other), and each resident tile has a small **"alive" texture**:
  R hides a building, G/B hold its base height and A its roof height. A
  building can be hidden or re-heightened without re-uploading geometry. That
  is the runtime half of #2090's "skip by source ID" (and #1744's Remove), and
  a cheap way to apply per-building overrides.
- **Compute once, at export.** The archetype classifier runs at export and is
  baked into each record "so the runtime never re-classifies and the
  geography lives in exactly one place." Same principle as provenance and
  AI-surveyed recipes in #2090.
- **Precision data point:** 16-bit quantized positions over an 800 m tile give
  about a 1.2 cm grid, right at our 1 cm minimum, while meshopt makes a whole
  city 14 MB over the wire.
- **Heights: real terrain, done carefully.** Valdrada chose a flat city; this
  project can't (SF's hills are the point) and instead keeps the DEM as the
  runtime terrain authority, gives buildings DEM-sampled base heights, and
  lifts draped roads and parks by sub-centimetre offsets to avoid z-fighting.
  The two projects bracket #2090's heights question.

### #2083 (buildings) and lots

- **CityGen is the same architecture we planned:** a city-agnostic core (no
  three.js, no textures: footprint maths, massing, merged meshes, colliders)
  plus a swappable theme pack (archetype specs, materials) and a classifier.
  "The engine is city-agnostic; a city is data + a theme."
- **Build on the real polygon, never a bounding box.** It replaced a vendored
  kit that approximated footprints as rectangles, so generated buildings
  "visibly shifted" from their baked originals and entrances faced alleys.
- **Determinism from a per-building seed**, so every client and visit sees the
  same building; matches #2083's seeded `variant`.
- **Distance tiers:** a chunked skyline far away crossfading into full grammar
  meshes and walkable interiors up close. Same LOD split as kernel near /
  shader boxes far.

### Play mode

Building colliders as one minimum-area oriented box per building, plus a
moving "carpet" of static ground boxes around the player in Box3D. A cheap
model for play-mode collisions against context buildings.

### Rendering in 3DStreet

The quality comes mostly from the post chain, upsampling and GPU compute, all
in WebGPU. 3DStreet runs on A-Frame 1.8's WebGL renderer and supports WebXR;
a WebGPU-only policy like this one would drop browsers and headsets we
support, so the transferable parts are the techniques that exist on WebGL
too (temporal upsampling with adaptive resolution, GTAO-style AO, a LUT grade)
and the lazy-loading discipline, which matches our asset-loading rules.

## Cautions

- No license: ideas only.
- The committed `.env` holds an API key for a third-party 3D generation
  service even though `AGENTS.md` describes the file as gitignored.
- WebGPU-only; mobile support arrived late (2026-09-27).

## Related

- [Teleoperator](teleoperator.md): the closed-source robotaxi game in San
  Francisco that the r/threejs post was actually about.
