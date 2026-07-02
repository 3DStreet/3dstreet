# ZoningViz POC: Parcel Data Layer + Zoning Simulation Wizard (shelved)

Hackathon POC (July 2026). Demoed successfully; shelved on this branch for a
future hardened PR.

**Counterpart branch:** `poc/3dstreet-integration` in the
[zoningviz repo](https://github.com/kfarr/zoningviz) — it contains the local
API server (`server.py`, port 8081) this UI talks to, plus the parcel data
pipeline. See `INTEGRATE_WITH_3DSTREET_POC.md` there.

## Running it

```bash
# zoningviz repo (needs data/sf_parcels.parquet — see its README)
uvicorn server:app --port 8081

# this repo, on this branch
npm start
```

Then in the editor: set a geospatial location in San Francisco, and use
Add Layer → Custom → **Tax Parcels Data Layer** and/or **Zoning Simulation
Wizard** (Pro-gated card).

## What's here

New files:
- `src/aframe-components/parcel-data-layer.js` — the hover/inspect layer.
  Fetches parcels around the `street-geo` anchor from the zoningviz server,
  raycasts the mouse onto the y=0 plane, inverts the `geojson` component's
  equirectangular projection (via `worldToLocal`, so the `0 -90 0` "X+ north"
  entity rotation is handled generically), point-in-polygon lookup, hover
  tooltip + extruded height-envelope highlight, click to pin. Reloads on the
  `newGeo` event. Cross-references any scene geojson entity whose features
  carry `parcel_id` (cached per-entity index) to report simulation outcomes.
- `src/editor/components/elements/ParcelLayerSidebar.jsx` — pinned parcels
  are pseudo entities: pinning selects the layer entity and this sidebar
  renders read-only metadata rows (no transform UI; Show Advanced retained
  for the layer's own settings). Re-renders on `parcelpinnedchanged`.
- `src/editor/components/modals/ZoningModal/` — 3-step wizard (location &
  jurisdiction detection → scenario/years/radius/seed → run & review).
  Creates the buildings entity anchored at the street-geo lat/lon; auto-adds
  the parcel layer if absent; re-roll draws a fresh seed and writes it back
  to the form for reproducibility. Opens via `setModal('zoning', ...)`;
  "Set Scene Location" uses `rememberPrevious` so the GeoModal returns here.

Modified: `src/index.js` (component registration), `Main.jsx` (modal mount),
`AddLayerPanel/layersData.js` + `createLayerFunctions.js` (the two Custom
cards; wizard card is `requiresPro: true`), `Sidebar.jsx` (parcel-layer
branch, mirrors the measure-line pattern), `src/store.js` (dev-only
`window.useStore` debug aid).

## Verified behavior (headless-browser tested during the hackathon)

Hover/pin against ~3,300 SF parcels with correct zoning values; wizard end to
end (simulation → extruded buildings aligned with the geo anchor); Pro gate
(signed-out click → checkout); parcel↔simulation cross-reference in tooltip
and sidebar; `showFootprints` toggle; re-roll variability. Perf: footprints
are one merged LineSegments, sim buildings one merged mesh — the whole POC
adds ~5 draw calls.

## Known gaps / hardening notes

- **PMTiles is the production data path.** The installed `3d-tiles-renderer`
  already exports `PMTilesOverlay` (peer deps `pmtiles`, `@mapbox/vector-tile`
  already in node_modules). One `parcels.pmtiles` on a CDN can (a) drape
  terrain-hugging, zoning-colored parcel outlines onto the Google 3D tiles
  via `ImageOverlayPlugin` + `getStyle`, and (b) be decoded client-side for
  hover metadata — replacing the `/parcels` endpoint entirely. The current
  depth-test-off footprint lines and y=0 highlights are workarounds for
  terrain burial that the overlay approach solves properly.
- Ground-plane picking ignores terrain elevation (drifts on steep slopes);
  raycast the tiles geometry instead.
- Parcel fetch is a fixed radius around the anchor, not viewport-driven.
- Parcel↔simulation association is duck-typed (any geojson layer with
  `parcel_id` features participates); a hardened version should stamp wizard
  output entities explicitly.
- Wizard styling is inline; move to the modal SCSS-module pattern.
- i18n: new UI strings are hardcoded English.
