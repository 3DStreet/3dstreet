# fable51-worlds (PhiloLabs/fable51-worlds)

[Prior-art index](README.md)

- **Repo:** https://github.com/PhiloLabs/fable51-worlds
- **Read at:** `d240284` (2026-09-08), 17 commits. We read the READMEs, the
  Union Square brief, QA reports, scores and discrepancy log, and the Kyoto
  README; we did not run the worlds.
- **License:** MIT (code and generated assets). Geometry from OSM (ODbL),
  USGS 3DEP and GSI; reference photographs are not redistributed.
- **What it led to:** Akbar's
  [buildings-generator](buildings-generator.md), which keeps the AI but
  changes its job: the model fills in a JSON recipe and a parametric kernel
  builds the geometry.

## What it is

"Worlds as code": agent swarms take a brief (a sentence, a photo or a film
clip), research the place, write a plain Three.js app that builds it, and
check it against photographs. Worlds so far: Union Square (San Francisco),
Higashiyama (Kyoto) and a Death Star trench run, each shown head-to-head
with another model's attempt at the same brief.

Its pipeline (Union Square, from `union-square-sf/README.md`):

1. **Reconnaissance.** Eleven parallel research agents build a source-cited
   database: 453 OSM footprints, 1,317 USGS 3DEP elevation samples, a street
   and transit spec, a plaza survey, a 122-entry storefront census, studies of
   the two hero stores, 34 reference viewpoints.
2. **Offline asset kits.** Blender-as-a-library scripts generate 206 GLB
   modules (windows, cornices, storefronts, street furniture, vehicles).
3. **Spec-driven façades.** A façade engine turns a JSON description of a
   building into geometry. 75 buildings get agent-authored specs; the rest
   are derived automatically from footprints and the census.
4. **Visual feedback loop.** Playwright drives the app to fixed viewpoints
   and overlays each render on a photograph from the same spot. Nine
   independent reviewer agents (geometric, semantic, architect, local,
   environment art, technical art, interaction) score the result and file
   reports that drive fix cycles. Builders never grade their own work.

## The lesson: a visual feedback loop is the expensive way to make a twin

This is the other pipeline shape, next to the offline data compile in
[procedural-tokyo](procedural-tokyo.md) and [zoningviz](zoningviz.md):

```
raw visual data + existing data  →  agents author per-place specs  →  render  →  compare to photos  →  reviewers  →  fix  →  (repeat)
```

It works, and the published results are impressive at a distance. But per
Akbar's experience building on it (as relayed by Kieran) and the repo's own
QA record:

- **It is laborious and costly.** Every fix cycle is screenshots, image
  comparison and multiple reviewer agents, so token spend grows with each
  building and each round. The repo publishes no cost figures; its own
  roadmap lists "measure how world quality changes with more inference time
  and compute" as future work.
- **Fidelity is middling, and worse up close.** After the fix cycles the
  reviewers' unadjusted second-pass scores (`union-square-sf/qa/scores.json`)
  sit at 5.5–7.5 / 10 against 8.5–9 targets: building recognizability 5.5
  (estimated 6.5 after a later fix), street-level detail 6, materials 6,
  performance 6. The architect's per-building scorecard and
  `qa/discrepancies.md` list close-range errors: window rows floating with no
  wall behind them, rooftop boxes floating metres above their roofs, a doubled
  window grid where two masses overlap, footprints drawn to the property line
  leaving a 2.1 m sidewalk where the real one is about 4 m, an inward-wound
  wall bug that hid façades when the camera looked up.
- **Heavy to run.** 2,000–3,500 draw calls and 6–8.5 M triangles per frame,
  32–79 fps by day in headless Chromium at 1080p (ANGLE/Metal) on the build machine.
- **The agent work is spent per place.** Each building's look is authored by
  eye against photos for one location, so the next neighborhood starts over.

**What held up was the reusable part.** The pieces that generalize are the
generators: the façade engine, the parametric kits, "a district is a few
hundred lines that calls them". Akbar got much higher quality by moving to
procedural building models, which became
[buildings-generator](buildings-generator.md). It still uses a vision model,
but differently:

| | fable51-worlds | buildings-generator |
|---|---|---|
| Who makes geometry | agents write and revise the code per place | a hand-built parametric kernel; "the model never draws geometry itself" |
| What the AI does | authors specs, renders, compares to photos, reviews, fixes, in rounds | reads each building's photos once and fills in a JSON recipe (storeys, windows, entrances, signs, roof, colours) |
| Where heights come from | OSM footprints plus agent judgement | USGS 3DEP lidar (about 15 cm), then OSM height tags, then the AI's reading |
| Cost shape | grows with buildings × fix rounds × reviewers | one survey per building (facade by facade); the recipe is stored and editable |

The shift is from **AI as a builder in a loop** to **AI as a one-pass
classifier that emits structured parameters**, with measured data taking
priority over anything the model infers.

## Implications for 3DStreet

- **Spend agent and token budget on generators, not on places.** Build or
  improve a generator once (buildings-generator for #2083, the managed-street
  segment generators, cross-section rules for #2004) and run it on data
  everywhere. Don't make a per-scene visual loop the main way a twin gets made.
- **Facts from data, not from looking.** Footprints, heights, storeys, lane
  models and parcel IDs come from data sources (#2090), where they are
  cheaper, citable and more accurate than what agents infer from photos.
- **Visual comparison is a QA tool, not the production path.** Rendering
  fixed viewpoints and diffing them against references is valuable for
  checking a generator or a data source on a sample, which is what `/verify`
  and the parity harness do (`npm run test:parity`). It is too costly to be
  how every scene is built.
- **Worth borrowing as-is:** independent reviewers with named roles who never
  grade their own work; every fact carrying a source and a confidence level,
  and unverified things rendered neutrally (a blank fascia) instead of
  invented; a reference-photo overlay for spot checks; publishing unadjusted
  scores and open defects next to the result.
- **AI rendering stays on top, not underneath.** 3DStreet's generator
  (image and video from a scene) adds photographic finish to geometry that
  comes from data and generators. It doesn't need the geometry to have been
  made by a visual loop.
