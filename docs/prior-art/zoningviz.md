# zoningviz (kfarr/zoningviz)

[Prior-art index](README.md)

- **Repo:** https://github.com/kfarr/zoningviz
- **Read at:** `a6bc1aa` (main) and `d07699a` (`poc/3dstreet-integration`,
  the server half of the #1784 POC).
- **License:** MIT. Builds on rezoner (Salim Damerdji), cityscaper (Eric
  Munsing) and the FoglineSF Family Zoning Plan project; see its README for
  attribution.
- **3DStreet side:** branch `poc/zoningviz-parcel-layer-wizard`,
  `docs/POC_ZONINGVIZ.md`. Issue #1784 is the source of truth.

## What it is

A parcel redevelopment simulator: fetch every parcel in a city, attach
zoning rules, score each parcel's redevelopment probability, roll the dice
year by year, and render the resulting buildings in 3DStreet.

Three Python steps (`scripts/1_fetch_data.py`, `2_score_parcels.py`,
`3_simulate.py`) with two plug-in points:

- **Jurisdiction** (`jurisdictions/<city>.py`, `fetch()` → GeoDataFrame):
  the only city-specific code. `sf` works; `dc` is a stub.
- **Scenario** (`scenarios/<name>.py`, `apply(parcels)`): the rules, applied
  in memory; never written back to the facts file.

### The standard parcel schema (`REPLICATE_FOR_YOUR_CITY.md`)

`parcel_id` (stable unique ID), `geometry` (WGS84 polygon),
`current_height` (ft, above grade), `current_zoning`,
`current_height_limit` (ft), `lot_sqft`, `is_corner`, `current_use`.

## What the #1784 POC proved

- Hover and pin against about 3,300 SF parcels with live zoning data, about
  5 draw calls total (merged line segments for footprints, one merged
  buildings mesh).
- **No mesh per parcel:** ground-plane raycast → inverse equirectangular
  around the `street-geo` anchor → point-in-polygon.
- Simulation output cross-references parcels by `parcel_id`.

## Lessons

- **Facts versus scenario.** `sf_parcels.parquet` holds only facts about the
  city; scenarios are applied later, in memory. The same split as #1930's
  "saved scenes carry user intent, not derived trims" and #2083's "saving by
  source". Generalized in the context tile layers issue as *facts in tiles,
  intent in scenes*.
- **A stable `parcel_id` is the join key** between the parcel layer, the
  simulation output and (later) user edits such as #1744's per-parcel
  remove/add. Every context layer needs one.
- **Adapter → normalized schema is the whole portability story.** One module
  per city; everything downstream reads the normalized table. The same shape
  as a "geospatial data source" per jurisdiction.
- **A bbox endpoint is a hand-rolled single-tile server.** The POC's
  `/parcels?bbox=` works for a demo; the production path in #1784 is one
  `parcels.pmtiles` on a CDN (a tippecanoe step), which `3d-tiles-renderer`
  can drape (`PMTilesOverlay` + `ImageOverlayPlugin`) and the client can
  decode for hover metadata. `/simulate` stays a stateless function reading
  GeoParquet. Canonical table for computation, derived tiles for the browser.
- **Heights are relative.** `current_height` is feet above grade, and the
  POC extrudes from z = 0 ("massing on a flat plane"); hilltop and valley
  buildings start at the same elevation. `HOW_IT_WORKS.md` plans a
  `base_elevation_m` column from a DEM, and notes that LiDAR, OSM
  `building:height` and assessor data use different zero points.
- **Ground-plane picking drifts on slopes**; raycasting the active terrain
  (or tile geometry) is the fix listed in #1784.
