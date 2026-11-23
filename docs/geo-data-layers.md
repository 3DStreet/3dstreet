# Geospatial data layers

[Back to the codebase guide](../CLAUDE.md) · related:
[streets and geospatial guidance](agent-context/streets-and-geospatial.md),
[prior art](prior-art/README.md),
[#2090 context tile layers](https://github.com/3DStreet/3dstreet/issues/2090)

A **data layer** draws one Geospatial Data Source (an open dataset with a
known location, such as a historical terrain reconstruction, parcels or
zoning) over the scene's base map. The first source is Yelamu, San Francisco
around 1769 ([notes](prior-art/yelamu.md)). This is a first slice of #2090:
the registry, the georeferencing path, and the layer entity, with one layer
kind (`terrain-grid`).

## The model

```
#reference-layers   street-geo = base map + origin (lat, lon, heights)
 ├─ (autocreated)   Google 3D Tiles / 2D tiles / 2.5D OSM, built by street-geo
 └─ a-entity        geo-layer="source: yelamu-1769; opacity: 70"   ← saved
     └─ mesh        built from the source, never saved
```

- **One base map, any number of overlays.** `street-geo.maps` still picks the
  single base map. Each data layer is its own entity with its own opacity,
  so an overlay cross-fades against the base map (1769 vs today).
- **Intent in scenes, facts in sources.** A scene saves the layer entity
  (source id, opacity, radius, feature toggles). The data is fetched from the
  source's pinned URL at load and never serialized.

## Pieces

| Piece                 | File                                                      | Role                                                                                                                                                                                                                 |
| --------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registry              | `src/tested/geo-data-sources.js`                          | One descriptor per source: kind, format, pinned `baseUrl` + `version`, CRS, vertical datum, coverage box, license, attribution, confidence, caveat, opt-in features. `sourcesForLocation` lists what covers a scene. |
| Georeferencing        | `src/tested/geo-reference.js`                             | CRS → lon/lat (EPSG:4326, 3857, UTM 326zz/327zz) → the scene frame, per vertex.                                                                                                                                      |
| Kind model + adapters | `src/tested/terrain-grid.js`                              | The normalized `TerrainGrid`, the format adapter per source format (`yelamu-real-city@1`), windows, vertical anchoring, mesh/texture/ribbon builders. Pure, unit-tested.                                             |
| Kind renderer         | `src/aframe-components/geo-layer-terrain-grid.js`         | Fetch + cache a source, build three meshes for an origin.                                                                                                                                                            |
| Layer entity          | `src/aframe-components/geo-layer.js`                      | The component: finds the origin on the parent's `street-geo`, rebuilds on origin or setting changes, opacity, credits, load indicator.                                                                               |
| UI                    | `src/editor/components/elements/GeoDataLayersSection.jsx` | Geospatial panel → Data Layers: on/off per covering source, opacity, caveat, license; the name selects the layer entity.                                                                                             |

A source resolves in three swappable steps:
**descriptor → format adapter → kind renderer.** A second terrain source in
another format (a Cloud-Optimized GeoTIFF, terrain-RGB tiles) needs only an
adapter; a parcel or zoning source needs a new kind.

## Georeferencing

The scene frame is the plane tangent to the WGS84 ellipsoid at the street-geo
origin, **+X north, +Y up, +Z east**, with y = 0 at the origin's ellipsoidal
height: what `google-maps-aerial` builds with ReorientationPlugin (azimuth
90°) and its `-ellipsoidalHeight` offset. `createSceneFrame` reproduces it
with doubles (ECEF → ENU), including earth curvature, so a layer needs no
tiles to be loaded.

Every vertex goes source CRS → lon/lat → scene. A projected grid is not the
scene frame: in UTM 10N over San Francisco grid north is about 0.35° off true
north, which is 6 m of drift 1 km out, and a single rotation of the layer
cannot remove it.

**Heights** (#2090 leaves the long-term choice open). A terrain layer is
inherently absolute, so `resolveVerticalAnchor` picks:

- `geo` (street-geo activated, `ellipsoidalHeight` known): orthometric source
  heights + the origin's geoid undulation → ellipsoidal → scene. Unchanged
  ground meets the Google tiles; the origin's undulation is used for the whole
  window (it varies by centimetres to decimetres over a few km).
- `self` (no elevation yet): the source's own ground at the origin goes to
  y = 0, like a flat scene.

The 2D/2.5D OSM layers use a Mercator-conformal approximation
(`latLonToLocal`, osm-street-import.js) instead; the two agree to well under
a metre within a couple of kilometres. New layers should use
geo-reference.js.

## Why each layer is an entity

The first draft used multi-instance components on `#reference-layers`
(`geo-layer__yelamu-1769`). The case for each side:

**Components on the street-geo entity**

- A layer has no pose of its own; geography places it. A component cannot be
  moved by accident.
- One instance per source falls out of the name.
- No change to how `#reference-layers` saves.

**An entity per layer** (chosen)

- A data layer has its own identity and lifecycle: users show, hide, select,
  rename, reorder and delete it. The scene graph, properties panel, undo,
  copy, save and the AI tools already do all of that for entities, and a
  component gets none of it without new UI.
- #2090's per-layer state belongs to the layer: skips of features detached by
  source ID, and detached entities pointing back at their layer. That is
  entity-shaped data ("skips live on the layer entity").
- Draw and list order is child order.
- The "no pose" argument is answered by the existing capability system, not
  by the choice of container: the `geo-layer` transform kind
  (`src/tested/transform-kinds.js`) declares no-scale, yaw-only and
  no-reparent at the command layer, and `data-no-transform` hides the gizmo
  and transform rows.

So the UI is not choosing the data model. A data layer is a thing with an
identity, and in A-Frame and 3DStreet the unit of identity is an entity.

**Costs we took on:**

- `#reference-layers` now saves its children (`getElementData`). Everything
  street-geo builds is `autocreated` and still skipped. `newScene` removes
  data layers from the reused entity.
- The command layer has no "never translate" marker, so a scripted
  `entityupdate` of `position` would move a layer. Nothing in the UI offers
  one. A fourth marker (or a "pinned" kind flag) is a follow-up.
- The Layers tab lists only `#street-container`, so data layers show in the
  Geospatial tab's Data Layers section, whose name links select the entity.
  The properties panel then shows the component under **Advanced** only; a
  dedicated layer panel (radius, feature toggles, provenance) is a follow-up.

## Display and credits

- Unlit (the source's shade is baked in), shadow-receiving via `flat-shadow`
  like 3D Tiles. Opacity through `applyReferenceLayerOpacity`, so a
  translucent layer moves to the reference-overlay `renderOrder` band and
  blends over splats. Opacity 0 skips the draw on the layer's own inner group;
  the entity's `visible` remains the user's hide toggle.
- Credits: every built layer adds its name (linked), attribution and caveat
  to `#geo-layer-credits`, above the base map's attribution line.
- Load state: `stream-active` / `stream-idle` with `kind: 'geo-layer'` feed
  the asset-load indicators.

## Adding a source

1. Add a descriptor to `GEO_DATA_SOURCES`; the registry test validates every
   field. Pin `baseUrl` to an immutable version (a commit, a dated archive)
   and put the `version` in it. The host must send CORS headers.
2. If the format is new, add an adapter to `TERRAIN_GRID_FORMATS` (or a new
   kind with its own model and renderer in `GEO_LAYER_KINDS`).
3. Record the license and attribution as published; mark anything that needs
   consent (cultural sites) in `optInFeatures` and do not read it by default.
4. Add a prior-art note if the source has its own pipeline worth learning
   from.

## Follow-ups

- **Parcels / zoning kind** (#1784): vector polygons, picking, the PMTiles
  container from #2090; custom sources from a URL (GeoJSON, PMTiles, COG,
  ArcGIS FeatureServer) behind the same descriptor shape.
- **Layer properties panel** instead of Advanced; a "pinned" transform marker.
- **Pro gating and activation**: the Data Layers section shows once
  geospatial is activated (same gate as the map controls); whether some
  sources are Pro-only is open in #2090.
- **Tiling large sources** rather than one archive; IndexedDB caching.
- **Geoid model** per vertex if a source spans enough area to need it.
- **AI tools**: `entityCreate` with a `geo-layer` component works today;
  a `listDataSources` read tool would let an agent discover sources.
