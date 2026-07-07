---
name: verify
description: Build, launch, and drive the 3DStreet editor/viewer in a real browser to verify changes end-to-end.
---

# Verifying 3DStreet changes at runtime

## Launch

```bash
npx webpack serve --config webpack.config.js --no-open --port 3333 &
# ready when: curl -s -o /dev/null -w "%{http_code}" --noproxy localhost http://localhost:3333/  → 200
```

## Drive (Playwright)

Use `playwright-core` from this repo's node_modules with the pre-installed
Chromium (`executablePath: '/opt/pw-browsers/chromium'`, args
`--no-sandbox --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`
for WebGL in headless).

Gotchas that cost time:

- **With network enabled**, Chromium still can't reach external hosts
  out of the box: it doesn't inherit `HTTPS_PROXY`, and the egress MITM
  resets its TLS 1.3 ClientHello. Launch with
  `proxy: { server: process.env.HTTPS_PROXY, bypass: 'localhost' }` and
  args `--ssl-version-max=tls1.2 --ignore-certificate-errors` — then real
  CDN assets, cloud scenes, and Firebase work with no interception.
- **Without network access, external CDNs are blocked** (aframe.io,
  dev-3dstreet.web.app, assets.3dstreet.app). Intercept with
  `context.route()`:
  - `**/aframe.min.js` → fulfill from
    `node_modules/aframe/dist/aframe-v<version>.min.js` (version must match
    the CDN pin in index.html).
  - `**/scenes/<uuid>.json` → fulfill with a fixture scene JSON
    (`{ title, version, author, data: [...], memory: {...} }`) to exercise the
    real `set-loader-from-hash` cloud-scene path without Firebase.
- **Hash-only `page.goto()` does not reload the page** — `set-loader-from-hash`
  only runs at scene init. `goto('about:blank')` first, then the hash URL.
- **An intro modal intercepts clicks on boot.** Dismiss with
  `page.evaluate(() => STREET.store.getState().setModal(null))`.
- **CSS-module class names are hashed** (no local-name prefix) — locate
  buttons by `title` attribute or text, not `[class*=...]`.
- `#toolbar` has `backdrop-filter`, which makes it the containing block for
  `position: fixed` descendants — don't put fixed overlays inside it.
- `element.innerText` reflects CSS `text-transform` — match uppercase-styled
  strings case-insensitively.

Useful in-page handles: `AFRAME.scenes[0]`, `AFRAME.INSPECTOR.opened`,
`STREET.store.getState()`, `scene.systems['mode-manager'].getMode()`,
`scene.systems['play-mode']`, `scene.components['scene-timer'].simulationTime`.

## Flows worth driving

- Editor boot → PrimaryToolbar View/Play → viewer top bar, WASD moves
  `#cameraRig`, Escape returns to editor.
- `#/scenes/<uuid>` as signed-out user → auto viewer-first entry, saved
  vantage applied (check `#camera` world position), Remix opens editor.
- `?viewer=true` boot → viewer with Edit button.
- Play lifecycle: `play-mode.start()/pause()/resume()/stop()` and
  `simulationTime` advance; register a fake capability via
  `mode-manager.registerPlayableCheck('x', () => true)` to surface Play UI.
