---
name: verify
description: Build, launch, and drive the 3DStreet editor to verify changes end-to-end in a real browser.
---

# Verifying 3DStreet editor changes

## Build & launch

- `npm install`, then `npx webpack serve --config webpack.config.js` (don't use
  `npm start` — its `--open` flag needs a display). Editor at
  http://localhost:3333/ once webpack logs "compiled successfully" (~60s).
- `config/.env.development` already exists (dotfile — plain `ls config/` hides it).

## Driving with Playwright (headless env)

- Launch chromium with `executablePath: '/opt/pw-browsers/chromium'` and
  args `['--use-gl=angle', '--use-angle=swiftshader', '--no-sandbox']`.
- **CDN scripts**: index.html loads A-Frame + aframe-blink-controls from CDNs.
  In sandboxed/proxied environments the browser's direct egress may be blocked
  (ERR_CONNECTION_RESET) — download each with curl first, then `page.route()`
  the CDN URLs and `fulfill()` from the local copies.
- Flow gotchas: the editor opens with a **"Create a New Scene" modal** — click
  "Create a basic street" to get a managed street. A **Sign-in modal** then
  pops up; dismiss via its top-right X (Escape does not close it).
- File > Export... opens the Export modal. Downloads: `acceptDownloads: true`
  + `page.waitForEvent('download')`.
- Pro-gated flows: anonymous users get the "Export requires Pro" upgrade modal.
  To exercise a Pro-only path locally, temporarily hardcode the `isPro` flag in
  the component under test and revert after (webpack dev server hot-rebuilds).

## Component tests (vitest browser mode)

`npm run test:components` wants the Playwright-pinned headless shell. If the
pinned revision is missing, symlink the installed one, e.g.
`/opt/pw-browsers/chromium_headless_shell-<pinned>/chrome-headless-shell-linux64/chrome-headless-shell`
→ `/opt/pw-browsers/chromium_headless_shell-<installed>/chrome-linux/headless_shell`.
