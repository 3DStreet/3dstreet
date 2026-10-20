# procedural-tokyo (jeantimex/tokyo)

[Prior-art index](README.md)

- **Repo:** https://github.com/jeantimex/tokyo (`package.json` name `procedural-tokyo`)
- **Read at:** `5a42b00e319b2b7afc717b64cc5a46a20fea4749` (2026-10-04). The
  repo was two days old with about 50 commits, one author, and tile format
  version 7, so expect paths below to drift; read at this SHA.
- **License:** `"license": "MIT"` in `package.json`, no LICENSE file.
  MIT code can be combined with our AGPL, but ask the author to add the file
  before copying anything. Data: PLATEAU (CC BY 4.0-compatible terms), GSI
  (attribution), OSM (ODbL; a redistributed compiled area is a derived
  database).
- **Not verified:** we read the code but did not run it (compiled tiles are
  gitignored; building one area downloads about 1.1 GB of raw data).

## What it is

A three.js driving game in a Tokyo compiled from public data, following the
BoundlessNYC architecture (now Valdrada, [notes](valdrada.md); `TKY1` is a
sibling of its `CTL1` tile format). Areas are blocks of 3×3 PLATEAU grid squares
(about 3.4 × 2.8 km) defined in `tools/pipeline/config.mjs`: Shibuya, Tokyo
Station, Shiba (Tokyo Tower) and Fujinomiya.

**Sources:** PLATEAU CityGML (`bldg`, `tran`, `brid`, `frn`, `veg`: building
footprints, heights, storeys, use codes, LOD2 roof and wall surfaces with
photos; road surfaces split into carriageway, sidewalk and island), OSM via
Overpass (road graph, railways, parks, trees, crossings, signals, furniture),
GSI 5 m / 10 m DEM tiles and aerial photos.

### Three stages

1. **Compiler** (`tools/pipeline/`, Node, about 2.5k lines). Deduplicates
   buildings by `gml:id`, splits outline-only roads into carriageway and
   sidewalk, places paint and street objects from measured geometry, packs
   photo atlases, cuts everything into 256 m tiles.
2. **Tile format `TKY1`** (`src/shared/tileformat.js`, one file for writer
   and reader). Little-endian binary, coordinates as f32 metres in a local
   frame (x east, y up in Tokyo Peil height, z south; origin at the area
   centre). Records: building (footprint, base, height, storeys, use, OSM
   material/colour hint, optional LOD2 surfaces with photo UVs), area (typed
   polygon: road, carriageway, sidewalk, paint, park, water, ...), prop
   (kind, variant, rotation, x, z, scale), wire, wall/barrier, sign (with its
   text). Area-wide side files: `terrain.bin` (5 m height grid), `roads.json`
   (road graph), `rails.json`, `manifest.json`.
3. **Client** (`src/`, about 5k lines). Meshing runs in Web Workers as pure
   functions with no three.js import (`src/world/meshing.js`, also run in Node
   tests). Buildings are extruded footprints whose windows are drawn by the
   shader, not modelled; props are one procedural model per kind, instanced.
   Post-processing: n8ao, `@takram/three-atmosphere` sky and aerial
   perspective, `@takram/three-clouds`, bloom.

## Why we don't adopt TKY1 as our format

- **No stable feature IDs.** Buildings, props and areas carry no OSM or
  PLATEAU ID (only `roads.json` edges keep `way`). #1930's provenance
  (`{source, wayId, piece}`) and edit-pinning need them.
- **Roads are stored at the wrong level.** Lane paint is baked into polygons;
  our managed street draws its own striping, stencils and clones from a
  segment array, so we need the lane model per way (#2004 / #2005). Its
  buildings, by contrast, are stored at the right level (a spec the client
  renders).
- **Japan-specific fields:** PLATEAU use codes, Tokyo Peil heights, Japanese
  defaults.
- **Format churn:** version 7 in two days, fixed binary record layouts.

The architecture is the lesson, not the bytes.

## Lessons by issue

### Architecture (context tile layers)

- **One pure shared module for compiler and client.** `src/shared/` is
  imported by both the Node compiler and the browser. Our `src/tested/`
  modules are pure too, so `crossSectionFromTags` could run in an offline
  pipeline unchanged: #2004's tag mapping becomes #2005's compiler for free.
- **Tile local things, keep the network whole.** Buildings and props stream
  per tile; the road graph is one file per area because topology does not
  tile cleanly. If our graph is tiled, node IDs must be stable across tile
  boundaries.
- **f32 metres relative to a local origin** give about 15 µm steps at 256 m,
  far past our 1 mm ceiling; useful if vector-tile integer quantization turns
  out to be the limiting factor.

### #1930 (street node graph, LOD, structures)

- **The graph splits at every node shared by two or more drivable ways**
  (`tools/pipeline/osm.mjs`, `buildRoadGraph`), independently matching the
  September decision that every junction node is a street end.
- **Vertical rules** (`tools/pipeline/roadprofile.mjs`): an ordinary road
  bridge is never lifted; it runs level bank to bank over a dip. The
  expressway and bridges tagged with an upper `layer` are lifted to a
  clearance. Ramps always land, because a node also used by a ground street
  stays on the ground. A **deck corridor** (`src/shared/decks.js`: bridge
  centreline plus half-width) holds paint and props at deck level. A ready
  rulebook for roadmap phase 2 (structure treatment).
- **Markings share the terrain triangulation** (`src/world/drape.js`), so
  paint never sinks into asphalt on slopes or across tile edges. Relevant if
  streets ever drape onto terrain instead of flattening it.
- **Traffic on the graph** (`src/world/traffic.js`): keep-left, one-ways,
  signal cycles shared with the signal shader, give-way rules, queueing at
  merges, no entering a junction without room. Reference for play-mode traffic.

### #2004 (cross-section fidelity)

- **Measured carriageway** (`tools/pipeline/markings.mjs`): at each sample
  along a road, the distance to the kerb on both sides (PLATEAU carriageway
  polygons) gives the true centre and width, so paint does not inherit the
  offset of the OSM centreline. This is Phase B's `placement` problem; OSM's
  equivalent ground truth is `area:highway`.
- **Right-of-way split** (`tools/pipeline/roadsplit.mjs`): where only the
  building-line-to-building-line outline is known, carriageway = centreline
  buffered to the width its lanes need, clipped to the outline; the rest is
  sidewalk; the strip between twin one-ways is a median. **Possible global
  heuristic:** OSM building footprints (already loaded by `osm-buildings`)
  approximate the right-of-way, so untagged sidewalk width ≈
  (right-of-way − carriageway) / 2.
- **Per-country defaults:** Japanese speed defaults, keep-left, the usual
  lane layouts for untagged approaches. #2005 already notes strassenraumkarte's
  defaults are German; the defaults table should be per jurisdiction.
- **Phase D:** `furniture.mjs`, `extras.mjs`, `landscape.mjs` map OSM point
  features to prop kinds; poles and lights stand at the measured road edge,
  with wires strung between poles.

### #2083 (Streetmix buildings) and lots

- **Tokyo's building record is a lot plus a spec:** footprint, base, height,
  storeys, use, material hint. It maps onto the kernel's `outline` parameter.
- **Two detail tiers.** The kernel builds 2k–21k vertices per building,
  fine for a street, not for a city. Tokyo draws windows in the shader from
  per-vertex attributes (`aFacade`: window column, height above base, floor
  height, seed; `aBldg`: height, category, kind, bay width;
  `src/world/materials.js`), so a building costs about a box. Kernel for
  near, hydrated or edited buildings; shader boxes for distant context
  (`osm-buildings`). #1930's LOD0/LOD1 split applied to buildings.
- **Use code → facade style table** (PLATEAU use codes → wall materials) has
  the same shape as the Streetmix style → kernel preset mapping.

## Performance notes

User feedback on the live demo: "I think my computer might catch fire."
Because tiles are semantic, almost all of the cost is a client choice:

- `radius` defaults to `1e5` in `src/main.js`, which loads the whole area at
  once (a "progressive view" toggle switches to streaming).
- Full-screen post-processing (AO, physical sky, volumetric clouds, bloom).
- `PCFSoftShadowMap` shadows, ez-tree trees, about 260 cars and birds by default.

A 3DStreet consumer would choose a 1 km radius, no post-processing, simple
shadows and simplified trees, and keep the window shader (much of the visual
payoff, cheap). Post-processing in our stack would also have to coexist with
WebXR, editor gizmo outlines and the splat `renderOrder` band.

## If we integrate it as a layer

- Frame: theirs is x east, z south; our OSM layers are x north, z east. A 90°
  turn about y plus the origin offset to `street-geo`'s lat/lon.
- Heights: Tokyo Peil (close to orthometric) vs `street-geo`'s
  orthometric/ellipsoidal pair. See the height open question in #2090.
- Their worker meshing already obeys our "worker code never imports `three`" rule.
- three.js 0.186 vs our 0.184: fine for meshing and shader code.
- Outreach first: LICENSE file, and whether they would publish the format
  and meshing as a package, or emit our context tile layers (#2090) from their compiler.
