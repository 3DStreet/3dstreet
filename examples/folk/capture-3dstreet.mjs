// capture-3dstreet.mjs — render a 3DStreet scene headlessly, save a PNG every few seconds.
//
// Setup:  npm install playwright-core       (uses your installed Chrome — no browser download)
// Run:    node capture-3dstreet.mjs
// Serve:  cd shots && python3 -m http.server 8000
//
// Env:    SCENE_URL   scene to render (default: 3dstreet.app viewer + demo Streetmix street)
//         OUT         output path (default: ./shots/3dstreet.png), written atomically
//         INTERVAL_MS delay between shots (default: 5000)
//         SETTLE_MS   extra wait after a-scene load for models to stream in (default: 20000)
//         CHROME_PATH explicit Chrome/Chromium binary (default: system Chrome via channel)
//         EXTRA_ARGS  extra chromium args, space-separated (e.g. proxy flags)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const SCENE_URL =
  process.env.SCENE_URL ||
  'https://3dstreet.app/?viewer=true#https://streetmix.net/kfarr/3';
const OUT = process.env.OUT || path.join(process.cwd(), 'shots', '3dstreet.png');
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 5000);
const SETTLE_MS = Number(process.env.SETTLE_MS || 20000);

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : { channel: 'chrome' }),
  args: [
    '--use-angle=swiftshader', // WebGL without a GPU; harmless if you have one
    '--enable-unsafe-swiftshader',
    ...(process.env.EXTRA_ARGS ? process.env.EXTRA_ARGS.split(' ') : [])
  ]
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
console.log('loading', SCENE_URL);
await page.goto(SCENE_URL, { waitUntil: 'load', timeout: 120000 });

// Wait for the A-Frame scene, then give street segments/models time to stream in.
await page.waitForFunction(
  () => document.querySelector('a-scene')?.hasLoaded,
  { timeout: 180000 }
);
console.log('a-scene loaded, settling', SETTLE_MS, 'ms…');
await page.waitForTimeout(SETTLE_MS);

// Screenshot loop — atomic rename so the web server never serves a half-written file.
for (;;) {
  const tmp = OUT + '.tmp';
  await page.screenshot({ path: tmp, type: 'png' });
  fs.renameSync(tmp, OUT);
  console.log(new Date().toISOString(), 'wrote', OUT);
  await page.waitForTimeout(INTERVAL_MS);
}
