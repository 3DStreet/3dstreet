# Hosting Shiny apps in 3DStreet

Experimental support for embedding an R/Python [Shiny](https://shiny.posit.co/)
reactive web app inside a 3DStreet scene, with the app's **map output rendered
in the 3D scene** and the rest of its UI in a side panel. The goal is for the
app author to keep writing **canonical Shiny** — `leafletOutput`/`renderLeaflet`
in the UI, ordinary `observeEvent(input$map_*)` reactivity in the server.

## Why this works

A Shiny page is a thin client that talks to an R "server" over a websocket.
Leaflet, used via `leafletOutput`, is an htmlwidget with a documented contract
in **both** directions:

- **server → client**: the map's drawing instructions arrive as `x.calls`
  (`addPolylines`, `addPolygons`, `addCircleMarkers`, …).
- **client → server**: Leaflet writes back a fixed set of Shiny inputs —
  `input$MAPID_click`, `input$MAPID_shape_click`, `input$MAPID_marker_click`,
  `input$MAPID_bounds`, `input$MAPID_zoom`, `input$MAPID_center`.

So if the 3D scene **emits those exact inputs** and **consumes those drawing
instructions**, it is a drop-in replacement for the 2D Leaflet map and the
server code never knows the difference.

Hosting without R infrastructure is handled by
[shinylive](https://posit-dev.github.io/r-shinylive/), which compiles the app to
WebAssembly (webR / Pyodide) and exports **static files** that run the app
entirely in the browser tab. Those static files are same-origin when we host
them, which is what lets us add the bridge script and cooperate with the app.

## Architecture

```
┌─ 3DStreet editor ───────────────────────────────────────────┐
│  Viewport (A-Frame)                  RightPanel "Shiny" tab  │
│  ┌───────────────────────────┐       ┌───────────────────┐  │
│  │ shiny-app entity          │       │ <iframe           │  │
│  │  → geojson child renders  │◄────► │  id=shiny-app-    │  │
│  │    the map in 3D          │postMsg│  frame>           │  │
│  └───────────────────────────┘       │  shinylive bundle │  │
│                                       │  + bridge.js      │  │
│                                       └───────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

### Pieces

| Piece | File | Role |
| --- | --- | --- |
| `shiny-app` A-Frame component | `src/aframe-components/shiny-app.js` | Scene side of the bridge. Receives the map payload, **delegates rendering to the `geojson` component**, and sends Leaflet-shaped inputs back on 3D clicks. Schema (`src`, `mapOutputId`, `lat`, `lon`) serializes into the saved scene. |
| `geojson` component | `src/aframe-components/geojson.js` | The shared GIS interpreter. Now renders `LineString`/`MultiLineString` (streets/routes) in addition to polygon buildings. |
| `ShinyPanel` | `src/editor/components/scenegraph/ShinyPanel.jsx` | Right-panel "Shiny" tab. Hosts the `<iframe>` for the entity's `src`; can add a demo entity. |
| `bridge.js` | `public/shiny/bridge.js` | Author-facing shim included **inside** the hosted app. Forwards 3D clicks → Shiny inputs, and map renders → 3D scene. |
| mock fixture | `public/shiny/mock-streets.html` + `sample-streets.geojson` | Static stand-in for `StreetsDataSF` so the pipeline is testable without R. |

### postMessage protocol

All messages are tagged `__shiny3dstreet: true`.

```
app  -> host : { dir:'app->host', type:'ready'|'features'|'clear', mapId, geojson? }
host -> app  : { dir:'host->app', type:'set-input', mapId, name, value }
```

`features.geojson` is a plain GeoJSON `FeatureCollection`, which is why the
scene side can hand it straight to the `geojson` component.

## Trying it

1. `npm start`, open the editor.
2. Right panel → **Shiny** tab → **Add Shiny App (SF Streets demo)**.
3. The mock app loads in the panel and pushes the sample arterial streets; they
   appear as colored lines in the 3D scene.
4. Click a street in the 3D viewport → the panel's readout shows
   `input$map_click = {…}` (the reverse channel).

## Author integration (real app)

Keep canonical Shiny and add the bridge script to the page head:

```r
ui <- fluidPage(
  tags$head(tags$script(src = "bridge.js")),
  h4("Arterial Streets from DataSF"),
  uiOutput("tab"),
  leafletOutput("map")
)
```

Then `shinylive::export(app_dir, output_dir)` and host the bundle (e.g. under
`/public`). Point a `shiny-app` entity's `src` at it.

- The bridge's **best-effort auto-hook** intercepts `renderLeaflet` output and
  forwards it with no further code — fully canonical.
- For full control, call `Shiny3DStreet.sendFeatures(geojson, { mapId: 'map' })`
  from app JS (this is what the mock does).

## Status / limitations (MVP)

- **Rendering**: `LineString`/`MultiLineString` and polygons go through the
  `geojson` interpreter. Points/markers are not rendered yet.
- **Reverse channel**: `input$MAPID_click` (lat/lng) is emitted. Per-feature
  `input$MAPID_shape_click` (with a feature `id`) needs the shared interpreter
  to **retain feature ids through the geometry merge** — a `geojson`
  enhancement, tracked here.
- **Auto-hook fidelity**: `bridge.js`'s Leaflet `x.calls` parser covers
  polyline/polygon calls and is best-effort across leaflet versions; it falls
  back to logging and the explicit `sendFeatures` API.
- **Same-origin requirement**: the bridge can only cooperate with a same-origin
  app (the shinylive-hosted case). A cross-origin live app (e.g. shinyapps.io)
  can still be embedded in the panel, but its map cannot be hijacked.
- **Toward one GIS interpreter**: `geojson` is becoming the shared renderer for
  geographic inputs. Unifying it with the Streetmix/StreetPlan parsers behind a
  single interpreter is a larger, separate refactor.
```
