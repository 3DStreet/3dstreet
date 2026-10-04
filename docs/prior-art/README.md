# Prior art: external projects that inform 3DStreet's geospatial work

[Back to the codebase guide](../../CLAUDE.md) · related:
[streets and geospatial guidance](../agent-context/streets-and-geospatial.md),
[OSM street LOD roadmap](../osm-street-lod.md)

Research notes on other people's (and our own side-project) pipelines that
solve a piece of the "open data → editable digital twin" problem. Each entry
records what the project is, its license, the exact commit we read, and which
3DStreet issues each lesson feeds. They are reference material, not
dependencies: nothing here is imported, and copying code from any of them
needs a license check first (our code is AGPL-3.0).

## Index

| Project | What it is | License | Read at | Feeds |
|---|---|---|---|---|
| [jeantimex/tokyo](https://github.com/jeantimex/tokyo) ("procedural-tokyo") | three.js driving game: PLATEAU + OSM + GSI compiled offline into binary 256 m tiles, procedural detail in the client | MIT per `package.json` (no LICENSE file yet) | `5a42b00` (2026-10-04) | #1930, #2004, #2083, #2090; [notes](procedural-tokyo.md) |
| [kfarr/zoningviz](https://github.com/kfarr/zoningviz) | parcel redevelopment simulator: per-city adapter → normalized parcel parquet → Monte Carlo; 3DStreet POC | MIT | `a6bc1aa` (main), `d07699a` (`poc/3dstreet-integration`) | #1784, #1744, #2083, #2090; [notes](zoningviz.md) |
| [osmberlin/strassenraumkarte](https://github.com/osmberlin/strassenraumkarte) | Berlin street-space micromap: osm2pgsql + `lanes.lua` lane model per way + PostGIS | Apache-2.0 | see the issues | #2004, #2005 (the research lives in those issue bodies) |
| buildings-generator kernel (`archkit.js` / `recipe.js`) | pure-JS parametric building kernel, JSON recipe → buffers | see the issue | see the issue | #2083 ([research comment](https://github.com/3DStreet/3dstreet/issues/2083#issuecomment-5977826658)) |
| [alzin/japan-rail-sim](https://github.com/alzin/japan-rail-sim) | rail sim; track profile, sleeper and catenary dimensions | MIT | see the issue | #2004 rail fidelity |
| [mkturkcan/boundless-nyc](https://github.com/mkturkcan/boundless-nyc) | NYC open data compiled into streamed tiles; the architecture procedural-tokyo copies | not reviewed | not reviewed | background only |

## The pattern they converge on

Every pipeline that turns open data into a browsable or editable city has an
**offline step between the raw source and the client**. Querying the source
(Overpass, a city's ArcGIS server, PLATEAU CityGML) once per object at
runtime does not scale past a single click (see #2005 and the Overpass
measurements in [geospatial-2d-25d-upgrade-plan.md](../geospatial-2d-25d-upgrade-plan.md)):

```
source adapter        →  normalized facts           →  streamable tiles      →  client hydrates on demand
(one per city/source)    (canonical table)              (derived, on a CDN)      (hover, pick, generate)
```

- zoningviz: `jurisdictions/<city>.py` → `sf_parcels.parquet` → (planned) PMTiles
- strassenraumkarte: osm2pgsql flex + `lanes.lua` → PostGIS → vector tiles
- procedural-tokyo: PLATEAU/OSM/GSI fetchers → (in memory) → `TKY1` binary tiles

3DStreet's version of this is proposed as **context tile layers**
([#2090](https://github.com/3DStreet/3dstreet/issues/2090)): facts live in streamable tiles keyed by
stable IDs, and scenes store only user intent (references by ID plus
overrides).

## Adding an entry

- Pin the commit SHA you read; young repos change daily and file links rot.
- Record the license as found (a `package.json` field without a LICENSE file
  is worth noting).
- Organize lessons by the 3DStreet issue or phase they inform, not as a tour
  of the other repo.
- Say what you did not verify (for example, a pipeline you read but did not run).
- Link the issue back here with a short cross-reference comment, so the
  issue body stays a spec rather than a research dump.
