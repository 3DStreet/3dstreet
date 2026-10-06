# BoundlessNYC (mkturkcan/boundless-nyc)

[Prior-art index](README.md)

- **Repo:** https://github.com/mkturkcan/boundless-nyc (M. K. Turkcan)
- **Read at:** `f453c1d` (2026-10-05), 25 commits since 2026-09-24, version
  0.2.1. We read the README, `BUILDING.md`, `LICENSING.md`,
  `boundlessjs/DATA_SOURCES.md`, the compiler (`boundlessjs/tools/pipeline/`,
  about 7.7k lines), the tile writer, the technique and typology docs, and the
  QA tools. We did not run it (the compiled city is a 3.1 GB download).
- **License:** code MIT; docs and figures CC BY 4.0; **compiled city ODbL
  1.0** (it contains OSM-derived data); vehicle and pedestrian models CC BY 4.0
  from CARLA, with a MetaHuman restriction (below); textures CC0.
- **Lineage:** procedural-tokyo's README says it follows this architecture;
  `TKY1` is a sibling of BoundlessNYC's `CTL1` tile format. BoundlessNYC
  itself follows the authors' earlier *Boundless* paper (arXiv:2409.03022).

## What it is

A city-scale digital twin of Manhattan, the Bronx, Brooklyn and Queens,
compiled from public municipal records, built for **synthetic data and
closed-loop simulation**: a WebGL2 renderer, lane-level traffic and
pedestrian simulation, pixel-exact perception ground truth (semantic and
instance segmentation, amodal boxes, metric depth), and a CARLA-style TCP API
with a Python client. Also an OpenUSD export of recorded takes for Blender
Cycles. A browser demo runs on Hugging Face Spaces.

### Sources (from `DATA_SOURCES.md`)

The city's own records first, OSM only to fill gaps:

- **Buildings:** NYC Building Footprints (footprint, roof height, ground
  elevation, `bin` building ID, `mappluto_bbl` parcel ID) joined by BBL to
  **PLUTO** (floors, year built, building class, land use, historic district)
  and by BIN to **DOB facade inspection filings** (FISP / Local Law 11: the real
  exterior wall material per building). OSM fills missing footprints and
  supplies `building:colour`.
- **Streets:** NYC Street Centerline (CSCL): street width, travel lanes,
  parking lanes, one-way, posted speed, bike-lane class, road type, and
  per-end level codes for grade separation. The **planimetric database** adds
  measured sidewalk, roadbed, median, parking lot and plaza polygons. Bus lanes
  come from a separate dataset matched geometrically onto CSCL.
- **Street objects from their own registries:** the 2015 street tree census
  (species, trunk diameter), hydrants, bus shelters, LinkNYC kiosks, 47,267
  bike racks, MTA subway entrances; rooftop water tanks, green roofs and solar
  from inspection and research inventories.
- **Standards:** pavement arrows and lettering traced from the FHWA MUTCD
  2009 figures and Standard Alphabets (public domain).
- **Landmarks:** the city's 2014 CityGML LOD2 model, partly; Central Park
  rebuilt from NAIP imagery, NYS orthos and published surveys.
- **Evaluated and not used:** Google Street View (licence prohibits
  extraction); Mapillary ("viable future path ... heavy pipeline; not
  implemented").

### Compiler and tiles

A Node compiler (`npm run fetch` then `npm run compile -- --boro 1,2,3,4`)
writes **2,884 near tiles (512 m) and 210 far-field tiles (2,048 m)**, bridge
alignments and a city-wide sky-occlusion bake. Distributed as a Hugging Face
dataset: 3,738 files, 3.1 GB, versioned by tag (`--revision v0.2.1`).

**Tile format `CTL1`** (`tools/pipeline/binio.mjs`): magic, a JSON header,
then **named typed-array sections** described in the header (`bldgXZ`,
`bldg`, `bholes`, `roads`, `furn`, `terrain`, `asphalt`, `sidewalk`, `curb`,
`paintW`, `paintY`, `grass`, `busred`, ...). Coordinates are f32 metres local
to the tile. Ground surfaces and paint are stored **already triangulated**;
buildings as footprint rings plus a 44-byte parametric record (base, height,
floors, typology, floor height, window width, storefront height, roof kind,
colours, which edge is the front, a blind-wall mask); roads as a 24-byte
record (class, one-way, width, lanes, parking, level, speed, name, CSCL
`segId`, and a **junction-mouth distance per end**).

## How it relates to our topics

### #2090 (context tile layers)

- **Self-describing sections are the versioning lesson.** Adding courtyard
  holes became a new section; "a pre-r12 runtime ignores an unknown section
  and a pre-r12 tile simply has none, so both directions load." TKY1's fixed
  records bumped the version instead (v7 in two days). MVT layers give us the
  same property: add a layer or attribute, old clients ignore it.
- **The same ID gap as TKY1.** The compiler joins on BIN and BBL but neither
  is written to the building record; only roads keep their CSCL `segId`. A
  BoundlessNYC building can't be pinned, skipped or joined after compile.
  Confirms #2090's rule that every feature carries its source ID, and that
  BBL (NYC's parcel ID) should ride on buildings so parcel-keyed skips work.
- **BBL is the parcel join, at city scale.** Footprints → PLUTO by BBL is
  exactly zoningviz's parcel table and #2090's `parcel_id` join, already
  proven across four boroughs.
- **Provenance in priority order.** Real FISP wall material, then OSM colour,
  then classifier palettes "used only where no FISP/OSM real data exists".
  Same chain as buildings-generator's heights (lidar → OSM → inferred).
- **An official source can outrank OSM.** For NYC, CSCL carries lanes,
  parking lanes, widths and speed for every segment, and the planimetric
  polygons give measured kerb lines. For "Geospatial Data Sources" per
  jurisdiction, a city's centreline and planimetric data may beat OSM for
  #2004 cross-sections where they exist.
- **Heights: they chose flat.** The default compile puts the whole city "on
  ONE flat base plane so every overlay sits at a known offset from it ... No
  clipping, no gaps between a surface and the terrain under it." Real terrain
  stays behind `TERRAIN=real`. A strong data point for #2090's heights v1
  (relative only), and a reminder that terrain is where layered surfaces fight.
- **ODbL spreads to the whole compiled city.** OSM gap-fill footprints and
  colours are a small ingredient, but they make the entire compiled database
  ODbL. Evidence for keeping OSM-derived layers in their own archives.
- **Hosting:** one file per tile on a versioned dataset (Hugging Face), not a
  single archive. Works, but thousands of files per release; PMTiles would be
  one versioned file per source.
- **Two detail levels:** near tiles at full detail and coarse far-field tiles
  beyond. An MVT zoom pyramid gives the same thing for 2D facts.

### #1930 (street graph and insets)

- **Per-end junction mouth distances are stored on each road** (0.25 m units):
  the compile-time version of #1930's per-end inset `{start, end}`.
- CSCL segments become a routable lane graph plus a sidewalk graph; signals
  are derived at junctions; per-end level codes carry grade separation
  (bridges, viaducts).
- Bus lanes from a separate dataset matched geometrically onto centrelines:
  the same proximity association #2004 Phase B needs for street-running transit.

### #2004 (cross-section fidelity)

- Lane counts, parking lanes, bike-lane class, speed and width come straight
  from an authoritative centreline file, with no tag parsing.
- **MUTCD arrows and Series C lettering traced from FHWA PDFs** (public
  domain): a ready source for US-standard stencils.
- Phase D street furniture from city registries (hydrants, shelters, kiosks,
  bike racks, subway entrances, trees with species and trunk size), not OSM points.

### #2083 (buildings) and lots

- **The typology docs are directly reusable research** (`docs/typology/`,
  `docs/techniques.md`): seven NYC typologies with dimensional constants (for
  example brownstones on 20 ft lots, 3–5 storeys over a basement, floor
  heights that *decrease* upward), a split-grammar engine, and **adjacency
  rules**: row houses come in runs of 3–10, corners go commercial or tall,
  avenues get bigger buildings, and a run shares cornice and floor lines
  ("snap lines"). That is how a Streetmix boundary split into several lots
  should read as one street.
- **The building record is a compact recipe** (floors, typology, floor
  height, window width, storefront height, roof kind, front edge, colours),
  a third example next to buildings-generator's JSON recipe and Tokyo's record.
- **Budget discipline:** merged shells plus instanced parts, targeting
  85–140 draw calls and about 1 M triangles in the main pass for about 120
  buildings. Compare fable51-worlds at 2,000–3,500 draw calls.

### Play mode and AI rendering

- IDM car following with signal phases and turn planning, pedestrians on a
  sidewalk graph with signal-aware crossings, the NYC fleet on real routes.
  Reference for play-mode traffic.
- Pixel-exact segmentation and depth per frame are the control signals AI
  image generation conditions on. Worth a look for 3DStreet's generator.

### QA that scales (contrast with fable51-worlds)

Automated invariants instead of reviewer loops: `npm test` runs 81 geometry
checks over the compiled tiles ("inward walls, sunken roads, downward roofs,
NaNs" fail loudly; fable51-worlds shipped an inward-wound wall bug found by a
reviewer). Purpose-built probes hunt z-fighting (`tools/zfight.mjs`),
temporal flicker (`tools/tflick.mjs`), floating walkers
(`tools/ad/floatprobe.mjs`) and camera clearance through viaducts
(`tools/ad/clearance.mjs`). Each class of defect becomes a check that runs
over the whole city, not a judgement per place.

## Cautions

- **Asset licences can forbid the obvious use.** The photoreal pedestrians
  derive from CARLA assets with MetaHuman components, whose licence forbids
  using them to build datasets or train or test AI; the project ships a
  procedural crowd for that. Check asset terms before using renders as
  training data or AI-render conditioning.
- **Heavy:** reference hardware is an RTX 3060 laptop GPU; 3.1 GB of banks;
  compiling needs about 3.3 GB of raw downloads and a 6 GB Node heap.
- **Simulator-first:** its goal is perception ground truth, not editing.
  Nothing in the tiles is meant to be detached or overridden by a user.
