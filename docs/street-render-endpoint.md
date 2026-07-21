# Street Render Endpoint (`renderStreet`)

A public HTTP endpoint that accepts a **managed-street JSON** blob and
returns a rendered **"beauty shot"** image: an angled pseudo-orthographic
view (a real perspective camera with a narrow FOV, so parallel lanes stay
near-parallel) with the street-label cross-section bar, rendered by the same
A-Frame component stack the 3DStreet app uses.

Built for **LLM / skill / MCP callers**: turn a user's text request into a
managed-street JSON, POST it, get back an image (or several variations), and
hand the user the returned `openInEditorUrl` deep link — which loads the same
street in the full 3DStreet editor for the next steps that only the app can
do: adding 3D maps (Google 3D Tiles), AI rendering with frontier image
models, editing, saving, and sharing. The endpoint is intentionally a
freemium on-ramp / traffic generator for 3dstreet.app.

## Endpoints

- `https://3dstreet.app/render-street` (hosting rewrite)
- `https://us-central1-<project>.cloudfunctions.net/renderStreet` (direct)

No authentication. Abuse is bounded by instance caps (`concurrency: 2`,
`maxInstances: 2`) and payload limits; see Limits below.

## Request

### POST (preferred)

```bash
curl -X POST https://3dstreet.app/render-street \
  -H 'Content-Type: application/json' \
  -o street.png \
  -d '{
    "street": {
      "name": "Maple Avenue Protected Bikeway",
      "length": 60,
      "segments": [
        { "name": "Sidewalk", "type": "sidewalk", "width": 3,
          "elevation": 0.15, "direction": "none", "surface": "sidewalk",
          "generated": { "pedestrians": [{ "density": "normal" }] } },
        { "name": "Protected Bike Lane", "type": "bike-lane", "width": 2,
          "elevation": 0.1, "direction": "inbound", "color": "#adff83",
          "surface": "asphalt" },
        { "name": "Drive Lane", "type": "drive-lane", "width": 3,
          "elevation": 0, "direction": "inbound", "surface": "asphalt",
          "generated": { "clones": [{ "mode": "random",
            "modelsArray": "sedan-rig, suv-rig", "spacing": 20, "count": 2 }] } }
      ]
    },
    "options": { "width": 1280, "height": 800 }
  }'
```

A bare street object (`{ "name": ..., "segments": [...] }`) as the whole body
also works.

### GET

`?data=<base64url of the same JSON>` — handy for quick links. Flat query
params are merged as options and win over options inside the `data`
payload: `&width=1600&type=jpg&environment=sunset`.

### Options

| option           | default     | notes                                                 |
| ---------------- | ----------- | ----------------------------------------------------- |
| `width`/`height` | 1280×800    | image size in px (320–2560)                           |
| `fov`            | 20          | camera FOV in degrees; smaller = more orthographic    |
| `azimuth`        | 20          | camera angle around the street (degrees; sign = side) |
| `elevation`      | 30          | camera height angle above the horizon                 |
| `margin`         | 1.12        | fit margin around the street bounding box             |
| `environment`    | `day`       | `street-environment` preset (day, night, sunset, …)   |
| `labels`         | true        | show the cross-section label bar                      |
| `vehicles`       | true        | show generated vehicle clones                         |
| `ground`         | true        | show the dirt ground slab                             |
| `boundaries`     | true        | show boundary segments (buildings, fences, …)         |
| `units`          | metric      | label units: `metric` or `imperial`                   |
| `title`          | street name | title annotation ("" to hide)                         |
| `branding`       | true        | "made with 3DStreet" annotation                       |
| `type`           | `png`       | `png` or `jpg` (`quality` 0–1 for jpg)                |

## Response

- Default: raw image bytes (`image/png` or `image/jpeg`), with the editor
  deep link in the `X-3DStreet-Editor-Url` response header and the stable
  image URL (see below) in `X-3DStreet-Image-Url`. For large streets whose
  deep link exceeds ~8 KB the header is omitted (hosting caps response
  header size); use `?format=json` to always get `openInEditorUrl`.
- `?format=json` (or `Accept: application/json`):

```json
{
  "image": "data:image/png;base64,...",
  "imageUrl": "https://3dstreet.app/render/img/v1/8f2a9c4d1e0b7a3f5c6d.png",
  "openInEditorUrl": "https://3dstreet.app/#managed-street-json:%7B...%7D",
  "meta": {
    "name": "...",
    "width": 28.9,
    "length": 60,
    "segments": 9,
    "timedOut": false
  },
  "width": 1280,
  "height": 800
}
```

### Stable image URLs

Every successful render is cached and addressable at
`/render/img/<version>/<hash>.<png|jpg>` — a durable URL that is safe to
embed in artifacts, chats, and docs (`imageUrl` /
`X-3DStreet-Image-Url`). `imageUrl` may be `null` if the cache write
failed; the render itself still succeeds.

- `<hash>` is a truncated sha256 of the canonicalized (sorted-key) street
  JSON + sanitized options, so identical requests share one URL and one
  stored image.
- The URL is a proxy contract (hosting rewrite → `serveRenderImage`
  function → Cloud Storage `renders/<version>/<hash>.*`): the storage
  backend can move without breaking published URLs.
- Responses are served with immutable year-long cache headers, so the CDN
  absorbs repeat traffic. The `<version>` segment invalidates cleanly if
  the renderer's look changes.
- Alongside each image sits a `<hash>.json` sidecar with the exact input,
  enabling future re-rendering, share pages, and editor links derived
  from the hash alone.

`openInEditorUrl` uses the same `#managed-street-json:` hash scheme the app's
`set-loader-from-hash` component understands — opening it recreates the street
in the editor. **Always surface this link to the user**; it is the point of
the endpoint.

Errors: `400` invalid payload, `422` render failed, `500` internal. A scene
where some assets fail to load still renders (readiness times out gracefully;
`meta.timedOut: true`).

## Managed-street JSON format

The same Format-2 blob `managed-street` imports via `sourceType: json-blob`
(and exports via `STREET.utils.getManagedStreetJSON` / the sidebar's
`.managed-street.json` download):

```
{ name, length,               // street length in meters (default 27)
  segments: [ {
    name, type, width,        // type: drive-lane | bike-lane | bus-lane |
                              //   parking-lane | sidewalk | divider | boundary | ...
    elevation,                // meters: 0 road, 0.1 curb, 0.15 sidewalk
    direction,                // inbound | outbound | none
    surface, color, variant, side,   // side/variant for boundary segments
    floors,                   // boundary building floors
    generated: {              // optional procedural content
      clones:      [{ mode, modelsArray, spacing, count }],
      pedestrians: [{ density }],
      stencil:     [{ stencils, spacing }],
      striping:    [{ striping }]
    }
  } ] }
```

Segment types/defaults live in `street-segment.js` (`STREET.types`); boundary
variants include `brownstone`, `suburban`, `arcade`, `grass`, `water`,
`parking`, `fence`. Model ids (`modelsArray`) come from the asset catalog
(`src/catalog.json`, `STREET.catalog`). The round-trip contract is tested in
`test/components/managed-street-json.test.js`.

## How it works

```
caller ──POST──▶ renderStreet (Cloud Function v2, 2GiB, puppeteer-core +
                 @sparticuz/chromium, SwiftShader WebGL)
                    │  window.__STREET_RENDER_PAYLOAD__ = {street, options}
                    ▼
                 render.html + dist/street-render.js   (Firebase Hosting)
                    │  lean bundle: managed-street stack + street-label +
                    │  street-environment — no React editor
                    ▼
                 street-render-harness (scene component)
                    ├─ creates <a-entity managed-street="json-blob …">
                    ├─ readiness = all segments loaded + THREE
                    │  DefaultLoadingManager idle + event quiescence
                    ├─ frames camera: corner-fit of the street bounding box
                    │  at (azimuth, elevation) with narrow FOV
                    └─ capture(): render → 2D canvas + title/branding → dataURL
```

- Page contract: `window.__STREET_RENDER__ = { status, error, meta, start,
capture }` (see `src/render/street-render-harness.js`).
- Debug in a browser:
  `/render.html#managed-street-json:<uri-encoded JSON>`.

## Deploy notes

- `npm run dist` builds `dist/street-render.js` (a `render` webpack entry);
  `npm run prefirebase` copies `render.html` + `dist/` into `public/` — the
  render page ships with normal hosting deploys.
- The function needs the page **deployed** (it loads `RENDER_PAGE_URL`) —
  deploy hosting before or with the function. The page and editor URLs are
  resolved per project automatically from `GCLOUD_PROJECT` (prod
  `dstreet-305604` → `https://3dstreet.app`, everything else →
  `https://dev-3dstreet.web.app`), so a plain `firebase deploy --only
  functions` targets the right environment with no per-deploy flags. An
  explicit `RENDER_PAGE_URL` / `EDITOR_BASE_URL` env var still overrides (e.g.
  local dev).
- `@sparticuz/chromium` unpacks its Chromium into `/tmp` at cold start;
  first render on a cold instance takes noticeably longer (asset downloads
  populate the browser cache — subsequent renders on a warm instance reuse
  it). Budget 30–90 s per render on a cold instance; the function timeout is
  180 s. In **production only** one instance is kept warm (`minInstances`
  gated on `GCLOUD_PROJECT`) so agent callers (ChatGPT/GPT Actions, skills)
  avoid that cold-start hit — Firebase estimates ~$21/mo for the warm 2GiB
  instance. Dev/staging default to `0` (no idle cost), so a disposable
  project nobody hits pays nothing; the first render there just eats the cold
  start.
- Local dev: set `PUPPETEER_EXECUTABLE_PATH` to a system Chromium and
  `RENDER_PAGE_URL=http://localhost:3333/render.html` with `npm start`
  running.
- Discord showcase: a successful **fresh** render is posted to the 3DStreet
  Discord via the shared `DISCORD_WEBHOOK_URL` secret (the same webhook the AI
  generators use) — an embed with the rendered image, the street name/stats,
  and the "Open in editor" deep link. Best-effort and bounded, so a Discord
  outage never fails or noticeably delays a render. Cache hits don't re-post
  (one post per new render), and posting is skipped entirely if
  `DISCORD_WEBHOOK_URL` is unset or the render's stable `imageUrl` is
  unavailable (a base64 data URL can't embed).

## Limits and future work

- Payload: ≤ 256 KB street JSON, ≤ 64 segments; options are clamped.
- No auth / no tokens today (deliberate: zero-friction top-of-funnel). If
  abuse shows up: App Check, per-IP rate limiting, or a token-metered tier.
- Nothing is evicted from the render cache today; misses on the stable URL
  mean an unknown hash (404). When eviction/GC arrives, `serveRenderImage`
  can re-render from the `.json` sidecar instead of 404ing.
- A user-facing share page per hash (og:image + "Open in editor") and the
  rest of the distribution follow-ups are tracked in #1864.
- Variations: callers fan out N POSTs with modified segment lists; the
  endpoint is stateless, so this parallelizes trivially.
