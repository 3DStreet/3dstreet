# Yelamu (ThomasParas/yelamu)

[Prior-art index](README.md)

- **Repo:** https://github.com/ThomasParas/yelamu · site:
  https://yelamu.thomasparas.com/
- **Read at:** `57867f1` (2026-11-21), main. Issues: none open.
- **License:** GPL-3.0-or-later for the pipeline, the viewer **and the
  published data** (reconstructed terrain, habitat raster, pond files);
  `NOTICE.md` lists per-source terms. Not AGPL, but GPLv3 §13 and AGPLv3 §13
  each allow combining with the other. 3DStreet imports none of its code; it
  fetches the published data at runtime and credits it.
- **3DStreet side:** the first Geospatial Data Source, `yelamu-1769`
  ([docs/geo-data-layers.md](../geo-data-layers.md)); #2090.

## What it is

An interactive three.js map of the San Francisco peninsula as it was around
1769, the homeland of the Ramaytush Ohlone: reconstructed terrain, shoreline,
habitats, ponds and creeks. It states it is "not a survey and is not for
navigation, engineering or legal use".

- **Pipeline** (`pipeline/`, Python + uv): USGS 3DEP DEM, SFEI Hidden Nature
  SF habitat GeoJSON (confirmed GPL-3.0-or-later by SFEI in writing),
  SFEI historical-creek ArcGIS layers, NOAA Shoreline Data Rescue Project
  1850s shorelines, Census TIGER/Line streets, plus hand-drawn, cited
  corrections (`pipeline/data/full-city/hand/`). Landforms that were graded
  away (Rincon Hill, the Mission Plank Road sand hill) are re-sculpted from
  written sources, each with the metres added and the radius assumed.
- **Viewer** (`viewer/`, Vite + three.js + TypeScript): no map library;
  terrain chunks, habitat material, haze, water.

## Published data format (`viewer/public/assets/real-city/`, about 11 MB)

| File                                        | Contents                                                                                                                                                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta.json`                                 | Grid: `crs` EPSG:32610 (UTM 10N), `west/south/east/north` metres, `cell_m` 10, `width` 1771 × `height` 1565, `min_m`/`max_m`, `water_level_m` 0.6, habitat class table, shade params, per-layer `source`/`confidence`/`attribution` |
| `heightmap.u16`                             | uint16 LE, row-major, **row 0 = north**, linear over [`min_m`, `max_m`] (0.0043 m steps); orthometric (3DEP, NAVD88)                                                                                                                |
| `habitat.u8`                                | uint8 class id per cell, same grid; 36 classes in 12 groups                                                                                                                                                                         |
| `shade.u8`                                  | baked hillshade + ambient occlusion, 0..255 = 0..1 multiplier, every 2nd cell                                                                                                                                                       |
| `ponds.json`, `creeks.json`, `overlay.json` | vectors in the viewer's local frame: **metres from the grid centre, x east, z south** (`x = E − centreE`, `z = centreN − N`)                                                                                                        |
| `context.json` / `context.u16`              | modern 3DEP surround at 60 m, "for orientation only"                                                                                                                                                                                |

Raw binaries rather than PNG on purpose (`pipeline/yelamu/export.py`: browser
PNG decoding can colour-manage and lose 16-bit precision).

## Lessons

- **Provenance per layer and per feature.** Every layer in `meta.json`, every
  pond and every creek carries `source` and `confidence` (documented /
  inferred / illustrative). This is #2090's "every value carries its
  provenance" in practice, and the vocabulary `GEO_CONFIDENCE` adopts.
- **A projected grid is not the scene frame.** UTM grid north is about 0.35°
  off true north over San Francisco (6 m of drift 1 km out). 3DStreet
  reprojects each vertex through lon/lat into the ellipsoid tangent frame
  Google 3D Tiles use (`src/tested/geo-reference.js`) rather than rotating
  the layer once.
- **Orthometric heights meet Google tiles through the geoid.** Heights are
  NAVD88; adding the origin's geoid undulation (`street-geo.geoidHeight`)
  lines unchanged ground up with the tiles, so made land (Mission Bay, the
  Marina, Yerba Buena Cove) shows as the water and marsh it was.
- **One static archive, no tiles.** 11 MB loads in one go for a city;
  3DStreet crops a window around the scene (2 km radius by default) and
  decimates vertices, keeping one texture pixel per cell. A larger or finer
  source should be tiled (#2090's PMTiles container, or a terrain tile
  pyramid) behind a new format adapter.
- **Cultural content needs consent.** Yelamu excludes cultural content
  without the Association of Ramaytush Ohlone's permission and marks its
  five village sites as approximate and not official. 3DStreet keeps them
  off (`optInFeatures: ['villages']`, and the adapter does not read them).
- **Ask upstream for a standard export.** A Cloud-Optimized GeoTIFF (heights,
  habitat) plus GeoJSON in EPSG:4326 (ponds, creeks) would let the generic
  adapters read it with no Yelamu-specific code.

## Not verified

- Alignment against live Google 3D Tiles (no Maps key in the session that
  built the integration); the math is checked against PROJ.
- The 1769 creek and village layers' own accuracy; we take the confidence
  labels as published.
