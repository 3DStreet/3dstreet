# Changelog

Human-facing notes for each 3DStreet release. See `docs/releasing.md` for how
releases are versioned and cut. Versions use CalVer (`YYYY.M.patch`); the build
SHA shown in-app (`+a1b2c3d`) identifies the exact deployed commit.

## 2026.9.0

Managed Street features below are still labeled "(Beta)" in the Add Layer
panel. Streetmix URL imports continue to build legacy streets; use the
"(Beta) Managed Street from Streetmix URL" card to get the new editing tools.

- **Streets from OpenStreetMap.** In 2.5D map mode, click any street on the
  basemap and press "Generate Street": one managed street bent along the
  real centerline, split at junctions with managed intersections minted where
  generated streets meet, all as a single undo step (#1974). Cross-sections
  come from OSM tags where present (lanes, oneway, sidewalks, parking,
  cycleways, bus lanes, surface), with rail and transit presets (#2004,
  #2006). The chip explains when a stretch can't be generated.
- **Curved streets (prototype).** A managed street can follow a drawn shape:
  smooth, arc, or linear curve styles, live re-layout when a vertex moves,
  shift-drag a vertex to ramp the street up or down. Surfaces, striping,
  clones, play-mode traffic, and plan export all follow the curve (#1920).
- **Street gizmos.** Draggable endpoint handles on every managed street: drag
  one end, the other stays fixed, and position, rotation, and length update
  as one undo step; segment width drag bars (#1096, #1218). Drags preview as a
  footprint outline and apply on release, fixing freezes on heavy scenes
  (#1940). Cascading click selection (#1958) and gizmo hiding for selected
  segments (#1961).
- **Shapes.** New draw tool (`r`) replaces the ruler: polylines and closed
  polygons with area readout, on-canvas vertex insert/move/delete, fill and
  line styling with opacity, an x-ray mode, and inclusion in DXF/PDF plan
  export (#1920, #1926). Saved rulers migrate automatically.
- **Managed street editing.** Condensed sidebar with a live cross-section
  strip, units-aware rows, and fit-to-width focus (#1957, #1960); hatched and
  auto-updating striping (#1907); right-click context menu on scene-graph rows
  (#1950); "(Beta) Managed Intersection" card with auto geometry and
  snap/trim.
- **Geospatial 2D/2.5D overhaul.** New tiled 2D basemap with level-of-detail
  (hybrid, satellite, streets) replaces Mapbox 2D, with automatic migration of
  saved scenes; 2.5D buildings now come from vector tiles built in a Web
  Worker, shaded and lit, with tile-border duplicates fixed; map picker is
  None / 3D / 2D Satellite / 2.5D (#1964). Missing-building retries with a
  single notice (#1861); geo readout shows true bearing (#1940); session
  re-established after tab inactivity (#1882).
- **Faster scene loading.** Textures load lazily and only when used, so the
  splash clears at ~3 s instead of ~8 s on a cold cache; seamless textures
  converted to WebP (about 4.3 MB to 1.4 MB); placeholder tints, ghost boxes
  sized to each model while it downloads, a sky gradient placeholder, and
  ambient load indicators in the scene graph (#2009, #2010). The vendored
  Mapbox script no longer loads on every page (#1964); no-cache headers so
  deploys reach browsers immediately (#1945).
- **Custom assets.** Uploads now get mesh simplification on top of Draco and
  WebP texture compression, so dense AI-generated and photogrammetry models
  shrink by up to ~90% (#1985, #1986); Reoptimize / Remove optimized controls
  in the asset details modal (#1986); `.gltf` uploads converted to GLB
  (#1953, #1954); "Copy to my library" swaps the copy into the scene (#1997).
- **Play mode and viewer.** Flyable helicopter with arcade physics, audio,
  and collision against 3D tiles (#1955, #2014); focus hotspots glide the
  camera to a clicked block and open an info panel (#1971); View › Set as
  Starting View.
- **Navigation.** New default controls with cursor-anchored zoom, compass,
  Plan View, and rotation ring are now the only scheme (#1851, #1963); faster
  sustained wheel zoom (#1967).
- **AI.** WebMCP support so in-browser agents can drive the editor (#1931,
  #1936–#1944); editor chat upgraded to a newer Gemini Flash model, sends a
  viewport screenshot, and verifies its own edits (#1918); render prompt
  limit raised to 2000 characters; new "Marker Sketch", "Cartoon",
  "Urban Diagram", and "Miniature" render presets.
- **Localization.** Language switcher moved to the top of Help › Language,
  also available from the profile menu when signed out.
- **Fixes.** Editor grid and ghost boxes write logarithmic depth so they no
  longer fight street surfaces (#2016); GLB export reliability.

Thanks to **Diarmid Mackenzie** (navigation overhaul, shapes) and **Vincent
Fretin** (A-Frame 1.8 upgrade, runtime batching, asset Reoptimize, GLB export
fixes, test tooling) for critical contributions to this release.

## 2026.8.0

- **Play mode & driving sim.** Unified Viewer with a Start/Stop play lifecycle
  (#1812): drive a car through your scene with keyboard or gamepad (Rapier
  physics), race a finish gate with local best times, and watch animated
  traffic that mirrors the vehicles you placed while editing (#1845). Scenes
  can also replay real roadside-sensor traffic manifests (#1875, #1878).
  Anyone with view access can press Start — no edit permission needed.
- **Localization.** The editor UI now ships in Spanish, French, and Brazilian
  Portuguese (#1747, #1776, #1857), and account emails arrive in your language
  too (#1854).
- **Export overhaul.** New Export modal (#1811) with DXF and PDF plan-view
  export (Pro) covering the whole scene (#1821, #1852), `.managed-street.json`
  export with round-trip import (#1809), GLB export fixes for the new batching
  system (#1794–#1796), and a blocking progress indicator (#1798).
- **Editing quality-of-life.** Edit menu with copy/cut/paste for streets,
  segments, and entities (#1814); inline scene-title rename (#1808); Convert
  to Shapes turns a whole managed street into plain editable entities (#1822);
  snapshot camera focus and auto-named clones (#1778); first-class
  geometry/material sidebar plus an animated grass generator (#1756).
- **Managed streets.** Boundary import with a layout model, metric elevation
  migration, per-segment content toggles, and segment slope (#1792).
- **Geospatial.** Terrain flattening volumes via the new `geo-flatten`
  component — streets flatten 3D tiles under their footprint by default
  (#1902); map opacity control and a `3d-tiles-renderer` 0.5.0 performance
  upgrade (#1862); "Use My Location" and typed-address fixes in the Geo modal
  (#1899, #1903).
- **Performance.** Runtime batching of repeated models cuts draw calls
  dramatically in dense scenes (#1755); faster navigation raycasts (#1855) and
  frame-rate-independent wheel zoom (#1859), plus a round of nav fixes
  (#1851, #1868, #1881).
- **Platform.** Upgraded to A-Frame 1.8.0 / three.js r184 (#1801).
- **AI Generator.** Medium-based tabs with async image→3D model generation via
  Hunyuan3D and TRELLIS (#1779); all image generations now run as background
  jobs that survive a closed tab, with optional outcome emails (#1836);
  stylistic render presets like watercolor, blue pencil, and street diagram
  (#1846).
- **Accounts.** Lifecycle emails with per-category unsubscribe (#1819);
  self-service one-time generation-token packs for paid plans (#1905, #1909).
- **Bollard Buddy Web.** Browser-based AR street capture via 8th Wall, with
  iOS-first CTAs and a photo→AI flow (#1793).

## 2026.6.0

- Adopt CalVer + git build-stamp versioning, replacing the legacy `0.5.x`
  npm-library version. The deployed build identity (`YYYY.M.patch+sha`) is now
  shown in the Profile modal and tagged on every Sentry issue.
