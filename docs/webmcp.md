# AI agent integration: WebMCP (primary) + MCP relay (fallback)

3DStreet's editor exposes its AI tool surface over two transports that share
one implementation. **WebMCP is the primary interface**; the WebSocket relay is
kept only for clients that cannot use WebMCP.

1. **WebMCP** (primary, this doc): the page registers its tools directly with
   the _browser_ via [`document.modelContext`](https://github.com/webmachinelearning/webmcp),
   and an agent driving that browser (ChatGPT's desktop browser, Chrome 149+
   with the origin trial or flag, Gemini in Chrome) calls them in-process. No
   relay, no pairing, no port, nothing to install — the agent operates the
   user's own signed-in tab. **If your agent runs inside a browser, just open
   3dstreet.app.**
2. **MCP relay** (fallback, [#1582](https://github.com/3DStreet/3dstreet/issues/1582)):
   for MCP clients that have no browser of their own or don't read
   `document.modelContext` — Claude Desktop, Claude Code, Cursor, headless
   scripts. The browser tab is the MCP server; the external
   [`3dstreet-mcp`](https://github.com/3DStreet/3dstreet-mcp) npm relay bridges
   a stdio MCP client to the tab over `ws://127.0.0.1:51735`. Same tools,
   same executor, same read-only gate; the only difference is the hop.

Retirement trigger for the relay: when Claude Desktop / Claude in Chrome (or
whichever out-of-browser clients we care about) read WebMCP tools natively,
delete `useMCPClient.js`, the `#mcp` pairing UI, and deprecate the npm package.
Until then it is a thin pipe over the shared registry and costs little.

## How it works

```
                         ┌── ws://127.0.0.1:51735 ── 3dstreet-mcp relay ── Claude (stdio MCP)
registry.js ─ dispatch.js┤
 (21 tools)              └── document.modelContext ── browser-embedded agent (WebMCP)
```

- `src/editor/lib/commands/registry.js` — single source of truth for tool
  definitions (`{name, description, inputSchema}`) and execution
  (`dispatchToolCall` → `INSPECTOR.execute`, so every mutation lands in undo
  history).
- `src/editor/lib/mcp/dispatch.js` — `callToolAsMCPContent()` executes one
  tool and wraps the result as an MCP `content` array (including the
  `takeSnapshot` image content block). Shared verbatim by both transports,
  including the read-only gate.
- `src/editor/lib/mcp/useWebMCP.js` — the WebMCP hook. Feature-detects
  `document.modelContext` (with the deprecated `navigator.modelContext`
  alias), registers every tool from `listMCPTools()` (registry commands +
  MCP read tools), and funnels each `execute()` through
  `callToolAsMCPContent`. Tool calls append to the same transcript UI the
  relay uses, so the chat panel shows the agent working
  (`webmcp · managedStreetCreate`, …).
- `src/editor/components/scenegraph/AIChatPanel.jsx` — mounts the hook (the
  panel stays mounted across right-panel tab switches, so registration
  persists), renders the **WebMCP active (N tools)** status bar whenever the
  browser exposes the API, and shares the **Read-only** toggle between both
  transports.

Registration uses per-tool
`document.modelContext.registerTool({ name, description, inputSchema, execute })`
(the current explainer's API, lifetime scoped to an AbortSignal), falling back
to bulk `provideContext({ tools })` on older builds. Tool handler failures
return
`{ content: [{type:'text', text}], isError: true }` rather than throwing, so
the agent can read the error and self-correct.

## Trying it

WebMCP is **not in production browsers** — it's a Chrome origin trial
(Chrome 149–156, ends no later than Nov 16, 2026).

- **`3dstreet.app` or `dev-3dstreet.web.app` (+ subdomains) in stock Chrome
  149+:** works with no flag — `index.html` script-injects our
  [origin-trial tokens](https://developer.chrome.com/origintrials/#/view_trial/4163014905550602241),
  one per origin (registered third-party + match-subdomains; tokens are public
  by design, and must be injected via script rather than a static meta tag per
  the
  [third-party token docs](https://developer.chrome.com/docs/web-platform/third-party-origin-trials)).
  When the trial expires or a token needs rotating, update the list in
  `index.html`.
- **Any other origin (e.g. localhost dev) in Chrome 149+:** enable
  `chrome://flags/#enable-webmcp-testing` and restart — the tokens are
  origin-bound. The Console tab's status bar shows **WebMCP active
  (N tools)**. Use a WebMCP-capable agent or extension (e.g. Chrome's
  WebMCP DevTools tooling) to list and call tools.
- **ChatGPT desktop browser:** open the editor and ask the agent to, e.g.,
  "make a street with two drive lanes, bike lanes and sidewalks, then take a
  snapshot."
- Everyone else: no `modelContext` global → the hook is a no-op and no
  WebMCP UI appears.

`/mcp` in the chat console prints setup help for both transports.

## Geospatial alignment tools

An agent aligning a generated street with the real road under the Google 3D
Tiles layer needs a machine-readable link between scene units and the map,
and a camera view it can trust. Three additions cover that (all in the MCP
read-tool list, so they work under the read-only gate):

- **`getGeoContext`** (`src/editor/lib/geo/geoFrame.js`) — the scene origin's
  lat/lon, the compass bearing of the scene +X/+Z axes, the camera pose, and
  optionally one entity converted to lat/lon + heading (managed streets also
  get both centerline endpoints) and/or a lat/lon converted to a scene world
  position. Conversions go through the live `google-maps-aerial`
  `TilesRenderer` (WGS84 `ellipsoid` + `tiles.group.matrixWorld`), the same
  transform terrain flattening uses, so results match where tiles render.
  Throws a `GeoFrameError` with a `reason` (`no-location`, `not-google3d`,
  `not-activated`, `no-tiles`, `tiles-loading`) rather than guessing.
- **`orientPlanView`** (`src/editor/lib/geo/cameraState.js`) — drives the
  editor camera to top-down + north-up by calling the exact compass-body
  action a user clicks (`controls.handleCompassBodyClick`, staged, tweened)
  and judging "done" with the compass widget's own predicates
  (`cameraTiltDegrees`, `needleScreenAngle`, shared tolerances). Perspective
  camera, whole-scene framing; unavailable under `nav=classic` or an
  orthographic camera.
- **`takeSnapshot` `type: "plan"`** runs `orientPlanView` first. Every
  snapshot now also returns `metadata.camera` (tilt, `isTopDown`,
  `isNorthUp`, `screenUpBearingDeg`, lat/lon) as a text content block so a
  picture is never the only evidence. `focusCamera`'s description warns that
  it reframes and is not an orientation reference.

**Segment presets and the catalog.** `managedStreetCreate` /
`managedStreetUpdate` apply the same `STREET.types` preset the sidebar applies
when a user picks a segment type (surface, color, elevation, default
direction, stencils, clones, pedestrians) to every field the model omits
(`src/editor/lib/commands/segmentPresets.js`), and report `presetsApplied`.
`listSegmentPresets` shows the table. `listMixins` tags every id with the
generator that accepts it (`clones` for 3D models, `stencil` for painted
markings) and appends the stencil ids that are not catalog mixins, and the
`generated` schema copy says which system is for what — the agent no longer
guesses `bus` as a stencil. `managedStreetCreate` also waits for the street
to settle (segments mounted, generated children stable, bounded at ~4 s) and
returns a `readBack` with per-segment generators and placed-model counts.
`getGeoContext` reports `crossSection` edge bearings (segments[0] at the
local -X edge; boundary `side: left` = inbound side, `right` = outbound,
right-hand-drive convention).

`managedStreetCreate` / `managedStreetUpdate` validate segment `type`,
`surface`, `direction`, boundary `variant`/`side`, stencil names and clone
model ids against the live component schemas
(`src/editor/lib/commands/managedStreetValidation.js`) and throw listing the
valid values, so "created" means the content can actually render. Create
also passes boundary `variant`/`side` through (previously dropped) and
returns `{ entityId, segmentCount, width, warnings? }`.

## Notes / future

- The relay is the fallback for headless or out-of-browser clients (Claude
  Desktop/Code, Cursor); WebMCP is the primary path for in-browser agents.
  Both can be live at once — they don't conflict. See the retirement
  trigger at the top of this doc.
- The read-only gate currently blocks `takeSnapshot` too (registry tools are
  all treated as mutating); pre-existing, tracked in `dispatch.js`.
- Growing the tool surface = adding `static llmTool` to a command class or an
  entry to `nonCommandTools.js`; both transports pick it up automatically.
