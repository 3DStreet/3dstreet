# WebMCP integration

3DStreet's editor exposes its AI tool surface over two transports that share
one implementation:

1. **MCP relay** (existing, [#1582](https://github.com/3DStreet/3dstreet/issues/1582)):
   the browser tab is the MCP server; the external
   [`3dstreet-mcp`](https://github.com/3DStreet/3dstreet-mcp) npm relay bridges
   a stdio MCP client (Claude Desktop / Claude Code) to the tab over
   `ws://127.0.0.1:51735`.
2. **WebMCP** (this doc): the page registers the same tools directly with the
   _browser_ via [`document.modelContext`](https://github.com/webmachinelearning/webmcp),
   and an agent driving that browser (ChatGPT's desktop browser, Chrome with
   the WebMCP flag, eventually Gemini in Chrome) calls them in-process. No
   relay, no pairing, no port — the agent operates the user's own signed-in
   tab, so there is nothing to install and no server-side rendering.

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

Registration prefers bulk `provideContext({ tools })` when the browser
implements it (replacing the whole set is idempotent across re-mounts) and
falls back to per-tool `registerTool(tool, { signal })` per the current
explainer. Tool handler failures return
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

## Notes / future

- The relay remains the path for headless or out-of-browser clients (Claude
  Desktop/Code); WebMCP covers attended, in-browser agents. Both can be
  live at once — they don't conflict.
- The read-only gate currently blocks `takeSnapshot` too (registry tools are
  all treated as mutating); pre-existing, tracked in `dispatch.js`.
- Growing the tool surface = adding `static llmTool` to a command class or an
  entry to `nonCommandTools.js`; both transports pick it up automatically.
