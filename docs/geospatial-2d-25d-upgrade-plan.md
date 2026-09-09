# Geospatial 2D / 2.5D basemap overhaul — research + epic plan

Status: tracked in epic issue
[#1962](https://github.com/3DStreet/3dstreet/issues/1962) (steps A–G as one
checklist). Step A (planar XYZ basemap POC) is implemented: see
`src/aframe-components/tiled-basemap.js` and the dev-only `tiles2d` map type
in `street-geo` (not yet in the GeoSidebar UI). Verified in-browser:
1:1 meter scale at scene latitude (group scale = circumference × cos(lat)),
scene origin lands exactly on the configured lat/lon, LOD refines levels
0→19 with camera altitude, opacity propagates, and switching map types
disposes cleanly. Gotcha for future plugin work: 3d-tiles-renderer 0.5.x
renamed the tileset event to `load-root-tileset` (pre-0.5 `load-tile-set`
never fires).

Step B (provider registry + key management) is implemented:
`src/tested/basemap-providers.js` (unit-tested, pure) maps provider/style →
keyed XYZ template + attribution. Decision: **MapTiler primary** (hybrid /
satellite / streets styles), Mapbox secondary, OSM strictly a dev-only
fallback — a missing `MAPTILER_API_KEY` falls back to OSM tiles in
development builds and disables the tiles2d layer in production (OSMF usage
policy). Keys live in the committed `config/.env.*` files (same convention
as the Firebase client keys — client-side map keys are browser-visible
regardless, so the real protection is **origin restriction in the provider
dashboard**). The legacy hardcoded Mapbox token moved from street-geo
source to `MAPBOX_ACCESS_TOKEN` in env config. `street-geo` gained a
`basemapStyle` property (hybrid/satellite/streets) that re-resolves the
source on change.

Step C (replace mapbox2d) is implemented: saved scenes migrate at load
(`maps: mapbox2d` → `tiles2d` in json-utils createEntities, opacity
preserved), live values render via street-geo's `activeMapType()` alias,
the GeoSidebar picker offers None / 3D / 2D Satellite / 2.5D, and the
820 KB vendored `aframe-mapbox-component.min.js` is deleted along with its
eager script tags and webpack copies. MAPTILER_API_KEY is provisioned in
`config/.env.*`, origin-restricted to 3dstreet.app / dev-3dstreet.web.app
(add `localhost` in the MapTiler dashboard for local dev tiles).

Step D (2.5D ground rides the tiled basemap) is implemented: `osm3dCreate`
now spawns a `tiled-basemap` ground pinned to the 'streets' style instead
of osm4vr's fixed-zoom `osm-tiles` planes (which are no longer used
anywhere), closing the OSMF-traffic and unbounded-tile-growth problems for
2.5D. The ground honors the opacity slider.

Step E decision: **in-repo Overpass rework** (option 2) — chosen because
#1930 phases 4–5 need an Overpass fetch layer for street centerlines
regardless, so the fetch/cache modules are built to be shared rather than
paying for a second vendor (Cesium Ion) that only covers buildings.

Step F is implemented — osm4vr is fully retired:

- `src/tested/osm-tile-math.js` + `src/tested/osm-building-geometry.js` —
  pure, unit-tested: slippy tile math, and Overpass-shaped elements →
  extruded indexed geometry (earcut; osm4vr's height heuristics preserved;
  multipolygon holes; tile ownership by clipping footprints to the tile
  bbox — border buildings render as abutting per-tile fragments with no
  wall on the clip line, so nothing overlaps and tiles unload cleanly;
  this replaced centroid ownership, which double-rendered buffer-clipped
  vector-tile fragments).
- **Data source (2026-09-09 swap, #1964 testing):** the provider's vector
  tiles, not Overpass. The public Overpass mirrors rate-limit to two slots
  per IP and shed load with 504s (measured: 36–40 s to a "server too busy"
  504 on kumi.systems, immediate refusal on overpass-api.de), so a 1 km
  radius of ~55 z17 tiles took minutes and often never finished.
  `VECTOR_TILE_SOURCES` + `resolveVectorTileSource` in
  `src/tested/basemap-providers.js` map the MapTiler Planet (`tiles/v3`,
  z14 max, ~1.9 km tiles, `render_height`/`render_min_height`) and Mapbox
  Streets v8 building layers; `src/tested/vector-tile-buildings.js`
  (pbf + @mapbox/vector-tile, unit-tested) decodes the `building` layer
  into the same Overpass-shaped elements so the extrusion module is
  unchanged. `hide_3d` outlines are skipped (their parts ship separately —
  the MapLibre convention). Without a MapTiler key the 2.5D layer renders
  ground only (no dev fallback for buildings).
- `src/osm/overpass-fetch.js` — endpoint rotation (overpass-api.de +
  kumi.systems) with timeout/backoff; query-agnostic. No longer used by
  the buildings layer; kept for **#1930's centerline import**, which should
  expect the same public-mirror flakiness.
- `src/osm/overpass-cache.js` — IndexedDB tile cache (1-week TTL, worker-
  compatible, degrades to network-only when storage is unavailable);
  shared store, per-feature key prefixes (buildings cache decoded elements
  under `buildings/v2/`, which also keeps MapTiler request billing down).
- `src/osm/building-tiles.worker.js` + `building-tile-client.js` — the
  whole per-tile pipeline (cached fetch, decode, triangulate) runs in a Web
  Worker; the main thread receives transferable arrays. NOTE: worker code
  must never import `three` (webpack externalizes it to the A-Frame page
  global, absent in workers) — geometry stays raw arrays until the
  component wraps it.
- `src/aframe-components/osm-buildings.js` — camera-following tile manager
  (nearest-first within radius, 1.5× unload hysteresis, 4 concurrent
  loads), one merged mesh per tile via setObject3D (bvh-geometry picks it
  up), and the #1861 fix: failed tiles retry with backoff, surface one
  user-facing notice when exhausted, and keep retrying on a long cycle.
  Shading: `MeshLambertMaterial` with vertex colors and flat per-face
  normals computed in the geometry module (roof/wall palette in
  `DEFAULT_ROOF_COLOR` / `DEFAULT_WALL_COLOR`), so the environment's
  ambient + directional lights separate lit walls, shaded walls and roofs
  (the first cut was unlit `MeshBasicMaterial` — every face one gray).
  Tiles cast and receive shadows within the street's shadow frustum. Edge
  outlines are a possible follow-up if same-height row houses still merge
  from above.
  The radius is centered on the camera's **look-at ground point** (view
  ray ∩ entity y=0, nadir fallback beyond 5 km or when looking up): a
  high tilted editor camera sits kilometers from the street it frames,
  and centering on the nadir unloaded the neighborhood on screen.

Browser-verified with Overpass fixtures: buildings extrude correctly
(including a multipolygon courtyard), neighbor tiles stay empty under
centroid ownership, and a forced-504 session produces zero page errors
plus exactly one notice (previously: unhandled rejection and silent
absence). Known scope cut: `building:part` is not rendered (outlines
only) — parts need outline-suppression logic; revisit if fancy-roof
fidelity matters. This documents the current
state of the non-Google map layers, why they underperform, and a ticket
breakdown for replacing them on infrastructure we already ship. Ordering
rationale: fix the 2D and 2.5D basemaps **before** the automatic
OSM-streets/managed-intersection work (#1930) — see "Relationship to #1930"
at the end.

Related issues: #299, #787, #1232, #1237, #1861, #188 (closed, still
describes live problems), #1624 (bundle size), #1930 (street node graph).

---

## 1. Current state

`street-geo` (src/aframe-components/street-geo.js) offers four map types:
`google3d`, `mapbox2d`, `osm3d`, `none`. `google3d` is in good shape — it
rides NASA-AMMOS `3d-tiles-renderer` (`google-maps-aerial.js`) with proper
camera-driven LOD, a download priority queue, tile fade, compression,
flattening, failed-tile recovery, and opacity. The other two layers predate
that stack and share none of it.

### 1.1 `mapbox2d` — single static plane, not a tiled map

- Implementation: `src/lib/aframe-mapbox-component.min.js` — an **820 KB**
  vendored fork (kfarr fork of mattrei/aframe-mapbox-component) bundling a
  webpack-1-era mapbox-gl-js. Loaded **eagerly via `<script>` in
  `index.html` for every visitor**, geo scene or not (a chunk of the #1624
  bundle problem, and ~800 KB of the savings promised in #787).
- Renders one **512×512 m plane** at fixed `zoom: 18`,
  `pxToWorldRatio: 4`, style `satellite-streets-v11`. mapbox-gl renders to
  an offscreen canvas that is draped onto the plane once.
- **No tiling, no LOD, no camera following**: coverage ends 256 m from the
  scene origin; zooming out just shows a floating postage stamp. Scale is
  approximate — plane meters vs. map meters were never rigorously aligned
  (the "vibe check": #188 reported "does not accurately size the map (1:1)"
  in 2022 and the closing fix kept the same plane approach).
- A **public Mapbox token is hardcoded in committed source**
  (`street-geo.js:6`). Works, but no rotation story, no per-env keys, and it
  meters against a personal account.
- `mapbox2dUpdate` only re-centers on lat/lon; nothing responds to camera
  movement.

### 1.2 `osm3d` (2.5D) — camera-tracked but fixed-zoom, unbounded, fragile

Implementation: vendored `src/lib/osm4vr.min.js` (lazy-loaded — good),
providing two components that `street-geo` instantiates together:

**`osm-tiles` (raster ground):**

- Fixed zoom (17) regardless of camera altitude — **no LOD at all**. Each
  tile is a separate `<a-plane>` with its own texture and draw call.
- `radius_m: 2000` → on load, a ~13×13 grid ≈ **170 planes/textures**
  fetched at once; the `tick` handler tracks the camera and keeps appending
  tiles as it moves, but **nothing is ever unloaded** (`tilesLoaded` only
  grows) — memory and draw calls grow without bound in a long session.
- Tiles come from **`tile.openstreetmap.org`** — the OSMF donation-funded
  server, whose usage policy prohibits exactly this kind of production app
  use. No API-key support for switching to a paid host (#787).

**`osm-geojson` (extruded buildings):**

- Per-tile **Overpass API** POSTs to the public `overpass-api.de` instance,
  then osmtogeojson conversion + polygon triangulation + extrusion **on the
  main thread** — visible jank while tiles stream in.
- Overpass 504s throw unhandled errors and buildings silently never load
  (#1861). No retry, no user-facing notice, no caching (the same
  neighborhood re-fetches every session), no unload.
- Same fixed-zoom tile grid (z17, `radius_m: 1000`) and camera tracking.

**Shared gaps:** the `street-geo` opacity slider only applies to
`google3d`/`mapbox2d` (GeoSidebar gates the control accordingly; `osm3dUpdate`
ignores opacity). Terrain flattening is google3d-only. Play-mode colliders
(`tiles-colliders.js`) only understand the google3d tileset.

---

## 2. Key finding: the replacement stack is already in our dependency tree

We ship `3d-tiles-renderer` (NASA-AMMOS 3DTilesRendererJS, `^0.5.0`;
verified against 0.5.2) for google3d. As of 0.5.x the same library includes
a full **raster / terrain / vector basemap suite** under
`3d-tiles-renderer/plugins`:

- **`ImageOverlayPlugin`** with tiled overlay sources:
  `XYZTilesOverlay` (any slippy-map XYZ URL template — MapTiler, Mapbox
  raster API, Stadia, self-hosted), `TMSTilesOverlay`, `WMTSTilesOverlay`,
  `WMSTilesOverlay`, `CesiumIonOverlay`, `GoogleMapsOverlay` (2D Map Tiles
  API sessions — #1232), plus `GeoJSONOverlay`. Every source takes
  `preprocessURL` (API-key injection), `opacity`, and `frame`.
- **`GeneratedSurfacePlugin`** — generates tiled surface geometry from an
  overlay's tiling scheme with `shape: 'planar'` or `'ellipsoid'` and
  `applyOverlayTexture: true`. This _is_ a proper 2D tiled basemap: the
  TilesRenderer core drives camera-based refinement, the download queue,
  fade (TilesFadePlugin), unload (UnloadTilesPlugin), and error handling —
  the exact machinery google3d already uses.
- **`TerrainRGBMeshPlugin` / `TerrariumMeshPlugin`** — real terrain meshes
  streamed from Mapbox/MapTiler terrain-rgb or AWS Terrarium elevation
  tiles, with imagery draped on top: a true 2.5D ground.
- **`QuantizedMeshPlugin`** + `CesiumIonAuthPlugin` — Cesium Ion terrain and
  any Ion-hosted 3D Tiles asset (notably **Cesium OSM Buildings**, a
  planet-wide streamed-LOD 3D Tiles tileset of OSM buildings).
- MVT (Mapbox Vector Tiles) overlay + annotation plugins for vector
  street/label rendering, for later.

So the upgrade is mostly _deleting_ bespoke/vendored map code and
configuring plugins on the renderer we already maintain, keeping Google 3D
as a deliberately separate vendor while the 2D/2.5D layers get their own
(also separate) provider.

---

## 3. Proposed architecture

```
street-geo (unchanged orchestrator, same maps switch pattern)
├── google3d  → google-maps-aerial            (unchanged)
├── 2D        → new `tiled-basemap` component  (TilesRenderer +
│               GeneratedSurfacePlugin planar + ImageOverlayPlugin/XYZ)
├── 2.5D      → same `tiled-basemap` ground (or TerrainRGB terrain variant)
│               + buildings layer (see decision spike)
└── none
```

- **One new A-Frame component (`tiled-basemap`)** wraps
  TilesRenderer + GeneratedSurfacePlugin + ImageOverlayPlugin, mirroring
  `google-maps-aerial`'s lifecycle (camera tracking, resolution,
  visibility/opacity gating, `resetFailedTiles` on tab-visibility,
  dispose). Schema: `provider`, `style`, `projection` (planar), lat/lon,
  opacity. Both the 2D map type and the 2.5D ground reuse it.
- **Provider abstraction + key hygiene.** A small provider registry maps
  `provider/style` → URL template + attribution + key source. Keys come
  from env config (`config/.env.*`) — never committed — injected via
  `preprocessURL`; optionally proxied through a Firebase function later if
  key-scraping becomes a problem. Preferred providers (both OSM-ecosystem,
  both vendor-separate from Google):
  - **MapTiler** — satellite, OSM streets/hybrid, _and_ terrain-rgb tiles
    from one account/key (covers the 2.5D terrain ticket too).
  - **Mapbox Raster Tiles API** — account already exists; raster XYZ
    endpoint of any style, plus terrain-rgb.
  - Keep `tile.openstreetmap.org` only as a dev-time fallback, off in
    production (usage policy).
- **Buildings for 2.5D**: decision spike, two credible paths (§5, ticket E).
- **Scene compatibility:** keep the stored `maps` values (`mapbox2d`,
  `osm3d`) working via the existing `json-utils_1.1.js` migration pattern —
  either keep the names as aliases or migrate to new values (`tiles2d`,
  `osm25d`) at load. UI labels/i18n update regardless.

---

## 4. Epic + ticket breakdown

**Epic: Geospatial 2D + 2.5D basemap overhaul — unify on 3d-tiles-renderer**

> The non-Google map layers are pre-2023 vendored one-offs: 2D is a single
> static 512 m Mapbox plane (820 KB eager lib, hardcoded token, no tiling);
> 2.5D is fixed-zoom OSM planes + main-thread Overpass extrusion with no
> unload and no error handling, hitting free public servers against usage
> policy. Replace both with the raster/terrain plugin suite of the
> 3d-tiles-renderer we already ship for Google 3D, behind a paid
> OSM-ecosystem provider that keeps 2D/2.5D vendor-separate from Google.

### Ticket A — Spike: planar XYZ basemap POC on 3d-tiles-renderer _(S, 1–2 days)_

New `tiled-basemap` component: TilesRenderer + `GeneratedSurfacePlugin
({ shape:'planar', applyOverlayTexture:true })` + `XYZTilesOverlay`, wired
into `street-geo` behind a dev-only map type. Prove: correct 1:1 meter
scale at scene latitude, camera-driven LOD from street level to high
altitude, fade, unload, opacity, attribution string. Confirms plugin
maturity before committing (the plugin suite is new in 0.5.x; a version
bump to latest 0.5.x may be part of this).
_Exit criteria: side-by-side with mapbox2d at 3 test locations; frame time
and memory over a 5-minute fly-around; decision note._

### Ticket B — Provider abstraction + key management _(S)_

Provider registry (URL template, attribution, key env var, styles:
satellite / streets / hybrid), `preprocessURL` key injection, env-based
config, dynamic attribution into `#map-copyright` (OSM attribution is a
license requirement, not a nicety). Choose and provision the paid provider
(MapTiler vs Mapbox raster — pick one, keep the registry so the other is a
config entry). Remove the hardcoded Mapbox token from source as part of
this. Optional follow-up noted (not built now): Firebase proxy for keys.

### Ticket C — Replace `mapbox2d` with the tiled 2D basemap _(M)_

Swap `street-geo`'s `mapbox2dCreate/Update` to the new component; scene
JSON migration/aliasing; GeoSidebar buttons + i18n (label becomes provider-
neutral "2D Satellite"); delete `aframe-mapbox-component.min.js` from
`index.html`, `streetplan.html`, webpack copies, and `src/lib/` (−820 KB
for every page load); update `src/aframe-components/README.md`, browser
test page. Parity checklist: opacity slider, `bvh-geometry`/raycast
behavior, `data-ignore-raycaster`, AR mode suppression, plan view (#1229).

### Ticket D — 2.5D ground rides the same basemap _(S, after C)_

Replace `osm-tiles` (fixed-zoom planes) in the `osm3d` map type with a
second `tiled-basemap` instance (OSM streets or satellite style). Kills the
unbounded tile growth and the OSMF tile-server dependency (#787) with code
that already exists after C. Opacity now works for 2.5D too.

### Ticket E — Spike: 2.5D buildings source decision _(S spike → M/L impl)_

Compare, with POCs at the same 3 locations:

1. **Cesium OSM Buildings via Ion** (`CesiumIonAuthPlugin` + a second
   TilesRenderer): planet-scale streamed LOD, zero Overpass, commercial
   SLA; costs: Ion pricing/quotas, attribution, styling control is limited
   (uniform material fine — matches today's gray boxes).
2. **In-repo Overpass extrusion rework**: keep the free/open pipeline but
   rebuild properly — Web Worker fetch/parse/triangulate, IndexedDB tile
   cache, merged BufferGeometry per tile, LRU unload, camera-distance
   radius, 504/timeout retry + user-facing toast (#1861), pluggable
   Overpass endpoint (paid mirrors exist).

Decision input: #1930 phases 4–5 need an Overpass/OSM-data fetch layer for
_street centerlines_ regardless; if (2) is chosen its fetch/cache module
should be designed as that shared service. If (1) is chosen, (2)'s scope
shrinks to centerlines-only later. Either way `osm-geojson` and the
`osm4vr.min.js` vendored bundle are retired at the end.

### Ticket F — Implement chosen buildings path + hardening _(M/L)_

Whichever E picks: implement, wire into `osm3d` (now "2.5D") map type,
retire `osm4vr.min.js`, cover the #1861 failure modes (explicit error
surface, retry, degraded-mode messaging), and parity items (BVH raycast,
play-mode colliders if buildings should be drivable-into, flattening
interaction documented).

### Ticket G — Optional/stretch: terrain-elevation 2.5D ground _(M)_

`TerrainRGBMeshPlugin` with the same provider key: real hillsides under
scenes on sloped sites, imagery draped. Interactions to resolve:
street-align/street-ground assume flat y=0; geo-flatten today only talks to
google3d — decide whether terrain mode reuses the geo-flatten registry
(likely yes, plugin API is shared) or ships as flat-only-adjacent
experiment first. This is the ticket that makes "2.5D" mean terrain, not
just extruded buildings — worth doing, but nothing above depends on it.

**Suggested sequencing:** A → B → C (2D fixed) → D (2.5D ground fixed) →
E → F (2.5D buildings fixed) → G. A+B+C+D alone remove both vendored map
libraries, the hardcoded token, the OSMF policy problem, and the two worst
performance cliffs.

---

## 5. Relationship to #1930 (OSM auto-streets + managed-intersection)

Do this epic first — agreed. Rationale:

- **No architectural dependency in either direction.** #1930's LOD0/LOD1
  street hydration is vector-data work (Overpass ways → ribbons → managed
  streets); this epic is basemap presentation. They meet only at (a) a
  possibly-shared OSM fetch/cache service (ticket E, option 2) and (b) the
  visual expectation that auto-generated streets sit on a credible basemap
  — which is exactly why the basemap should be fixed first.
- **User trust:** auto-populated OSM streets rendered on top of today's
  2.5D layer would inherit its jank and failure modes and be judged by
  them.
- **Bounded scope:** A–D are configuration-heavy, low-risk, and mostly
  delete code; #1930 is a multi-month architecture program. Shipping the
  basemap wins first is the better ROI order.

One deliberate design constraint to carry into #1930: keep the buildings
decision (ticket E) informed by phase 4–5 needs so we don't build two
Overpass clients.
