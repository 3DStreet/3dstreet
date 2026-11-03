# Slop New York (mrdoob/slop-newyork)

[Prior-art index](README.md)

- **Repo:** https://github.com/mrdoob/slop-newyork (Mr.doob, three.js's
  author). Live at https://mrdoob.github.io/slop-newyork/.
- **Read at:** `1b54e16` (2026-10-24), 55 commits since the initial commit on
  2026-10-20. We read the README, the whole geodata compiler (`tools/`), the
  generated `js/nyc-geodata.js` header and schema, and the headers and key
  functions of the runtime modules (blocks, buildings, road network, road
  paint, traffic, culling, audio). We did not run the app or its tests.
- **License:** **MIT** (`LICENSE`, added 2026-10-22). The README invites forks
  and remixes. Data: NYC Open Data, plus OSM (ODbL) for Central Park features,
  piers, landmark footprints and the New Jersey shore.
- **Shape:** no `package.json`, no bundler, no binary assets. `index.html`
  imports three.js `@dev` from jsdelivr through an import map (unpinned) and
  loads native ES modules from `js/`. About 33,000 lines of JavaScript.
  Everything you see (buildings, cars, people, trees, sounds) is generated in
  code.

## What it is

A drivable Manhattan built at 1:1 on three.js `WebGPURenderer` with TSL
shaders, with a WebGL2 fallback. You can walk, drive, cycle or fly a
helicopter. Around 200 cars and 12 buses use the Intelligent Driver Model,
change lanes, obey signals and yield to pedestrians on crosswalks. There are
340 skinned pedestrians, a GTA-style minimap and atlas, and synthesized
spatial audio. The other boroughs and New Jersey are a cheap "city carpet"
shader and about 100k instanced boxes.

It is the third NYC project in this folder, and the counterpoint to
[Valdrada](valdrada.md). Both read the same city centreline (CSCL). Valdrada
compiles real buildings and parcels into tiles. Slop New York keeps only
streets, blocks, parks and shore as data and invents every building.

### Pipeline (`tools/build-geodata.mjs`)

1. **Inputs, committed to `tools/data/`** (about 14 MB): NYC DCP borough
   boundaries, CSCL for Manhattan, NYC Parks properties, and four Overpass
   extracts (coastline, Central Park, piers, a list of named landmark
   buildings). `tools/overpass.sh` rotates through three Overpass endpoints
   with backoff. It writes to a temp file and keeps the old data until the
   response parses and has no `remark`. `geo-base.mjs` refers to a
   `tools/fetch-geodata.sh` for the NYC Open Data downloads, but that file
   isn't in the repo.
2. **A grid-aligned frame.** Points go to a local tangent plane at
   5th Ave & 42nd St, then rotate 29.02° (the bearing measured from the
   avenues). The whole Manhattan grid becomes axis-aligned, and most later
   steps (corridors, lots, footprints, colliders) can use axis-aligned
   rectangles.
3. **Streets from CSCL** (`geo-streets.mjs`): for each numbered street, the
   length-weighted median z, x-runs merged across gaps, and each run's
   one-way direction and curb-to-curb width by length-weighted vote.
   Avenues are handled the same way along x. Off the grid (Lower Manhattan,
   Broadway, Riverside, St Nicholas), `geo-roadgraph.mjs` keeps the
   centreline as a graph: nodes merged within 1 m, links carrying width,
   travel lanes and direction.
4. **Blocks from roadways** (`geo-blocks.mjs`): every at-grade roadway is
   stamped as a capsule of its curb-to-curb width on a 1 m land raster. What
   remains is labelled into "curb islands", which are the blocks. Their
   traced outlines are the curbs. Missing pieces get patched by hand:
   Broadway's pedestrian plazas aren't in CSCL, so straight pieces bridge
   them. The property line is a square erosion of each island by a constant
   4.6 m sidewalk, so grid blocks stay rectangular. Lots are greedy
   axis-aligned rectangles from a largest-rectangle-in-histogram pass that
   stops at 93% coverage. Irregular islands get up to three "frontage
   frames": edge directions clustered within ±7°, each cluster rasterized in
   its own rotated frame so a diagonal property line sits exactly one
   sidewalk width from its curb.
5. **Output:** one generated ES module, `js/nyc-geodata.js` (1.1 MB,
   `export const GEO = {...}`). Coordinates are rounded to 0.1 m and
   polylines are RDP-simplified at 0.4–1.5 m. No tiles: the whole island
   loads at once.

### Runtime

- **Buildings are procedural, on real blocks** (`buildings.js`).
  `districtAt(x, z)` in `city-config.js` maps a point to about 30 named
  neighbourhoods using hand-written street and avenue cutoffs. Each
  neighbourhood picks a profile: storey ranges per type, materials, row-house
  mixes, what the avenue ends of a block tend to be. Lots are filled the way
  Manhattan blocks are: apartment houses on avenue corners, brownstones and
  tenements along side streets around a rear-yard "donut", towers on
  podiums. Footprints are unions of axis-aligned boxes (courts, dumbbell
  tenements, setback towers). The RNG is mulberry32, re-seeded from each
  block's position, so a block is the same on every visit. Detail (cornices,
  water towers, fire escapes, awnings, scaffolding) streams around the player
  from a quadtree.
- **Landmarks** are custom models placed on their OSM footprint's
  grid-aligned bounding box, with height from the OSM tag.
- **The road network comes from the city as built, not from the data**
  (`road-network.js`). Avenue corridors are the gaps between the raised
  curbs that `city-grid.js` built. Lanes are dropped where medians, plazas or
  steam stacks block them. Lane count comes from curb-to-curb width alone:
  3.6 m lanes, five for half-widths of 10 m and up, down to two from 4.4 m.
  Turns are cubic Béziers with arc-length tables and maximum curvature.
  `road-paint.js` then draws markings from that graph (dashes, double
  yellows, stop bars, continental crosswalks), "so the paint matches where
  traffic actually drives and stops".
- **Culling** (`scene-culling.js`): island-wide `InstancedMesh`es have
  bounding spheres about 7 km across, which three.js never culls. A pass run
  once after build splits them into spatial cells with distance cutoffs
  (about one pixel tall, from each mesh's 90th-percentile instance size). The
  big shadow casters get position-only stand-ins on a layer only the shadow
  cascades render.
- **Audio is synthesized** (engines, sirens, bicycle drivetrain, crashes,
  ambience). Occlusion reuses the collision grid's building bounds rather
  than raycasting meshes.

## How it relates to our topics

### #2090 (context tile layers)

- **A whole city's street facts fit in 1.1 MB when buildings aren't data.**
  Streets, blocks, lots, parks, shore and the off-grid road graph for
  Manhattan load as one module with no tiling. Compare
  [SanFrancisco](sanfrancisco-webgpu.md)'s 21 MB `buildings.json` and
  Valdrada's tiled per-building records. For #2090, the street and block
  layers are cheap. Volume comes from the buildings layer, so tile that layer
  first.
- **The same ID gap as TKY1 and Valdrada, more so.** Blocks and lots carry
  no source ID, and roads keep only the street name, not CSCL's segment ID.
  Generated buildings are keyed by position (`${district}_${cx}_${cz}`).
  Nothing can be pinned, skipped or joined later. This repeats #2090's rule:
  carry the source ID on every feature.
- **Overpass hygiene** (`overpass.sh`): rotate mirrors, back off, validate
  before replacing, rename atomically. Our runtime fetch in `src/osm/`
  (#2005) already avoids per-object Overpass queries. The script is a good
  model for an offline fetch step if #2090 adds one.
- **0.1 m rounding** is coarser than our 1 cm minimum. Fine for a map,
  marginal for editing.

### #2083 (buildings) and lots

- **Blocks as the complement of roadways.** Stamping each centreline at its
  curb-to-curb width and labelling what's left gives block and curb outlines
  with no footprint or planimetric data. It needs only a centreline with a
  width attribute, which OSM roads (with our class-width rules) also give. A
  possible fallback where #2090 has no parcel or footprint layer: generated
  lots on derived blocks.
- **Lots from blocks:** erode by the sidewalk width, then cover with greedy
  rectangles to 93%. Irregular blocks are split into frontage frames, so lots
  on a diagonal street face that street. This is close to what splitting a
  Streetmix boundary into lots needs.
- **Neighbourhood profiles plus adjacency.** Corner versus mid-block
  typologies, avenue-specific corner tables, and storeys counted in whole
  floors "so every window row lines up across tiers". These are the same
  adjacency rules as Valdrada's typology docs, written as data tables. The
  district lookup is hand-written cutoffs, which would not transfer to other
  cities. A zoning or land-use layer would.
- **Deterministic seed from position** matches #2083's seeded `variant`.
  Position seeds break when a block moves, so 3DStreet should keep seeding
  from a stable ID.

### #2004 (cross-section fidelity) and #1930 (street graph)

- **What not to copy for cross-sections:** CSCL carries parking lanes,
  bike-lane class and speed (see [Valdrada](valdrada.md)). This project uses
  only width, travel lanes and direction. Lanes are uniform 3.6 m and bike
  lanes are painted on "wide one-way avenues" by rule. It shows how far
  width plus direction alone gets you, much like our class+subclass fallback
  in `src/tested/osm-street-import.js`. #2004 should still read the richer
  attributes when a source has them.
- **Derive traffic and paint from the built surface.** The lane graph comes
  from the curbs, medians and obstacles actually built, and markings come
  from that graph. Traffic never drives through a median the data didn't
  mention, and paint never disagrees with where cars stop. 3DStreet already
  does a version of this: segments own their markings and `managed-intersection`
  owns its crosswalks. The lesson for #1930's lane graph is to build it from
  the generated streets and intersections, not from the raw OSM ways.
- **Patch data gaps explicitly.** The plazas missing from CSCL are bridged
  by a named list (`PLAZAS`) in the compiler, not by a heuristic. That's a
  small, auditable override table, which is the pattern for #2090's
  user-intent overrides too.
- **Grid-rotated frame:** turning the world so the dominant grid is
  axis-aligned simplifies corridors, lots and colliders. It only works for
  one grid per city. For 3DStreet, per-street local frames
  (`managed-street`'s own axes) are the general version.

### Play mode

- **IDM traffic, signals and crosswalk yielding on a lane graph**, with
  fixed-size local populations that refill distant roads and keep nearby
  visible roads free of pop-in. A second, lighter model runs the shore
  highways: no lane changes, so each car's leader is simply the next car in
  its lane. Both are cheap patterns for play-mode traffic.
- **Collision and audio share one set of static bounds** (building boxes,
  oriented-rectangle tests for cars), the same idea as SanFrancisco's
  oriented box per building.

#### Vehicle physics (`controllers.js`, `traffic.js`)

The player vehicles are arcade kinematics, not a physics engine:

- **Car:** speed is a scalar along the heading. `driveSpeed()` adds
  throttle acceleration up to a top speed (23.5 m/s, 36 boosted), then
  subtracts constant rolling resistance, extra drag when coasting, braking
  proportional to opposite input, and a quadratic air-drag term. It's
  written so speed never crosses zero and stays stable at large `dt`.
  Steering eases toward 0.52 rad, and yaw rate is steer × speed, saturating
  at 8 m/s. There are no tyres, slip angles or weight transfer.
- **Body motion is faked.** A three-axis spring-damper (pitch from
  acceleration, roll from steer × speed, heave) moves only the chassis mesh.
  The wheels spin from distance travelled.
- **Collisions are hand-written impulses.** Building boxes are bucketed into
  48 m cells. The car is an oriented rectangle tested against them with a
  four-axis SAT check; walkers, bikes and the helicopter are circles. A hit
  pushes the car out along the contact normal. Over 0.5 m/s it adds a
  sideways slide (damped as tyre grip), bounces back at 25% head-on, and
  sets off spin, pitch, roll and heave kicks plus sparks and a crash sound.
- **Against traffic**, the same SAT check runs against each AI car with a
  mass ratio for how the overlap is split: a bus takes 15% of the push, a
  car half, an SUV 58% (slightly more than a car, which looks unintended).
  They trade an impulse of (1 + 0.28) × approach speed, and the AI car
  spins from the contact offset. AI cars then pick up their IDM following again (`a` 2.0, `b` 3.0,
  `T` 1.2 s, `s0` 2 m; buses gentler), with a lateral-acceleration limit
  that sets cornering speed.
- **Bike and helicopter** use the same speed model without the body: the
  bike leans by turn × speed, and the helicopter has separate horizontal and
  vertical speeds with exponential decay, plus tilt from speed and yaw.
- **Ground is flat.** Ground height is a lookup (0 m road, a sidewalk
  height for walkers, fixed heights for two parks). There is no terrain,
  ramps or airborne state.

Compared with 3DStreet, this is simpler than what we have. `play-mode-vehicle`
runs a Rapier raycast-wheel sim with fixed sub-steps that drive the scene
clock, and `heli-flight-model.js` is its own flight model. Don't swap
either for this. What transfers is on the traffic side:

- **Traffic that reacts.** Our `street-traffic` is a pure function of sim
  time; its kinematic Rapier colliders block the player but never yield,
  brake or get shoved. Here AI cars follow the car ahead, stop at signals,
  yield to people on crosswalks and absorb a hit, then recover. Adopting
  that means giving up "pure function of sim time" (replay and seeking get
  harder), so it would be an opt-in mode, not a replacement.
- **Cheap contacts without an engine:** an oriented-box SAT test, a mass
  ratio per vehicle class and a scripted spin and suspension kick read as a
  crash at almost no cost. That could be the model for traffic-to-traffic
  contact, which Rapier doesn't give us today because AI cars are kinematic.
- **The `driveSpeed()` shape** (rolling + coast + brake + quadratic drag,
  never crossing zero) is a compact, stable speed model for non-player
  agents or a low-end fallback.

### Rendering in 3DStreet

- **Chunking island-wide instanced meshes** for culling is directly
  relevant to our mesh batching (`BatchedMesh` bounds, #2101). One
  instanced mesh across a whole scene is never culled, so split by cell
  with a size-based cull distance. Shadow-only position stand-ins are a
  cheap way to cut shadow-pass cost.
- The look comes from TSL procedural materials (ray-marched interiors
  behind windows, procedural bump, AO), ACES with a grade and bloom, and
  cascaded shadows. Several materials and the lofted car geometry are ported
  from three.js's `webgpu_generator_city` example. We run A-Frame on WebGL,
  so the TSL code isn't usable as-is. The ideas (interior mapping, analytic
  anti-aliased markings via `fwidth`) port to GLSL.
- **Mip-coverage-preserving alpha** for foliage atlases (`trees.js`): alpha
  is rescaled per mip so the share of texels above the cutoff stays constant
  and distant crowns don't thin out. Worth doing for any alpha-tested asset
  we generate.

## Cautions

- Buildings, lots, heights and districts are invented, not surveyed. It
  looks like Manhattan; it is not a twin of any block.
- three.js is imported from `@dev` on a CDN, unpinned, so the live site can
  break or change without a commit. Pin the commit you read when citing
  behaviour.
- Very young (five days of history at the commit read). Expect file layout
  and numbers to move.
- `tools/fetch-geodata.sh` is referenced but missing, so the NYC Open Data
  inputs can only be rebuilt from the dataset IDs in `geo-base.mjs`'s
  header.

## Related

- [Valdrada](valdrada.md): the same city and centreline, compiled into real
  buildings and parcels.
- [San Francisco on WebGPU](sanfrancisco-webgpu.md): the other three.js
  WebGPU city, with real footprints and procedural facades.
