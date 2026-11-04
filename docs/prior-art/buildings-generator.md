# buildings-generator (akbartus/buildings-generator)

[Prior-art index](README.md)

- **Repo:** https://github.com/akbartus/buildings-generator (Akbar)
- **Read:** the README only, supplied by Kieran on 2026-10-04; the repo
  itself was not readable from our research session, so no commit is
  pinned. Kernel internals (`3d/mesh/archkit.js`, `recipe.js`, the worker
  client, Streetmix presets, measured heights and gaps) are covered in the
  [#2083 research comment](https://github.com/3DStreet/3dstreet/issues/2083#issuecomment-5977826658).
- **License:** not stated in the README; check before copying code. Data
  credits: OSM (ODbL), Mapillary photographs (CC BY-SA, attribute in
  published renders), Esri/Maxar aerial imagery, USGS 3DEP lidar (public
  domain), MakeHuman and Quaternius models (CC0).
- **Background:** grew out of Akbar's experience with
  [fable51-worlds](fable51-worlds.md).

## What it is

A local browser app (plus a small Node server) that builds the buildings of
a real place from street photographs:

1. **Map:** pick an area; the site is made from OSM footprints, streets and
   map objects, flat ground (or sampled USGS ground heights), and aerial
   imagery.
2. **Photos:** fetch Mapillary 360° photographs; each is matched to the
   buildings it shows by position and compass heading.
3. **Scene:** a vision model surveys each building's photographs and
   describes it facade by facade (storeys, windows, entrances, signs, roof,
   colours). **"The model never draws geometry itself. It fills in a building
   recipe (JSON), and the kernel turns the recipe into the 3D model"** on the
   real footprint.

Heights come from **USGS 3DEP lidar** where covered (measured to about
15 cm; US only), then OSM height tags, then the model's reading of the
photographs. A full 3D editor lets a user change any building's recipe (type,
size, windows, roof, walls, colours, per-facade settings, entrances, signs)
and save it back to the site. The model connection is pluggable (OpenAI,
local llama.cpp / Ollama, or the Claude API).

## Lessons

- **Constrain the model to parameters.** The vision model is a one-pass
  classifier into a fixed recipe schema; a deterministic kernel owns the
  geometry. Per Akbar's experience this gave much higher quality than
  fable51-worlds, and it rules out a class of close-range errors seen there
  (windows floating with no wall, doubled window grids): a kernel that builds
  walls and openings together doesn't leave them apart.
- **Measured data outranks inference.** A clear priority order for each fact
  (lidar → OSM tag → model reading) is the same provenance idea as #2004's
  `facts` record (`mapped` vs `derived`). Worth adopting for building height
  in #2090's buildings layer, with the source recorded per value.
- **The recipe is the durable artifact.** A surveyed recipe is a fact about
  one real building, keyed to its footprint. Under #2090 it could be computed
  once and served as a buildings-layer property (with source and
  confidence), so every scene at that place reuses it instead of paying for a
  new survey; user edits stay in the scene as overrides.
- **Editable after the fact.** Because the result is a recipe, "make it five
  storeys" or "brick instead of stucco" is a parameter change, which is the
  #2083 acceptance criterion (change style and floors after import, with
  undo) and the #1744 "add massing" step.
- **Lidar as a height source for the US.** About 15 cm measured heights and
  roof shapes, but large downloads (often 50–300 MB per site) and a Python
  dependency. Better as an offline step in a data-source pipeline than in the
  client; relevant to the heights open question in #2090.
- **Mapillary is CC BY-SA.** Renders made from its photographs need
  attribution; a cached recipe derived from them may carry that obligation
  too (check before serving recipes as shared data).
