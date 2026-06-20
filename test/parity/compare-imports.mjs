/**
 * Streetmix import parity check: legacy (`street` + `streetmix-loader`) vs
 * managed (`managed-street` with sourceType: streetmix-url).
 *
 * Test streets come from test/parity/fixtures/*.streetmix.json — local
 * snapshots in the Streetmix API response shape that together cover every
 * supported segment type/variant (regenerate with generate-fixtures.mjs).
 * Requests to the streetmix.net API are intercepted in the browser and
 * answered from these fixtures, so runs are hermetic: no Streetmix server,
 * no drift when someone edits a street online.
 *
 * For each fixture, the script loads the 3DStreet app in headless Chrome
 * twice (once per import path), screenshots the WebGL canvas from an
 * identical camera pose, then compares the two renders pixel-by-pixel after
 * reducing both to 256x256 (mirroring three.js test/e2e/image.js).
 *
 * Usage:
 *   npm start                  # dev server must be running on :3333
 *   npm run test:parity        # all fixture streets
 *
 * Options:
 *   --filter=<substr>       Only run fixtures whose slug contains <substr>.
 *   --threshold=<f>         Exit 1 if any street's mismatch ratio exceeds <f>
 *                           (0..1). Default: report only, always exit 0.
 *   --base=<url>            App base URL (default http://localhost:3333).
 *   --headful               Show the browser (debugging).
 *
 * Output: test/parity/output/<slug>-{legacy,managed,diff}.png + report.json
 *
 * Normalizations applied so the diff measures street content, not chrome:
 *   - legacy import runs with showBuildings: false (managed has no building
 *     support yet)
 *   - managed entity gets street-align "width: center; length: middle" to
 *     match the legacy parser, which centers the street on both axes
 *   - managed-only street-label component is removed before capture (legacy
 *     without buildings renders no label); street-ground is kept so both
 *     paths render a ground plane
 *   - viewer-mode camera-path / look-controls are stripped and the camera is
 *     pinned to a fixed pose; Math.random is seeded before each import
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

const PARITY_DIR = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(PARITY_DIR, 'fixtures');
// creatorId in the fake streetmix.net URLs; marks requests to intercept
const FIXTURE_CREATOR_ID = 'parity-fixtures';

// Fixed camera pose (meters / degrees). Streets are centered at the origin,
// up to ~40m wide (x) and 60m long (z), so this is a 3/4 overhead view that
// keeps the whole street in frame with the default 80deg fov.
const CAMERA = { position: { x: 0, y: 28, z: 40 }, rotationXDeg: -38 };

const VIEWPORT = { width: 1024, height: 768 };
const COMPARE_SIZE = 256; // reduction size for pixel comparison
const PIXEL_THRESHOLD = 0.1; // normalized color distance for a pixel to "differ"
const LOAD_TIMEOUT = 120000;

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};
const FILTER = opt('filter', '');
const FAIL_THRESHOLD = opt('threshold', null);
const BASE_URL = opt('base', 'http://localhost:3333');
const HEADFUL = argv.includes('--headful');

const OUT_DIR = join(PARITY_DIR, 'output');

// ---------------------------------------------------------------------------
// Fixtures: each gets a fake streetmix.net user URL. Both importers convert
// it to https://streetmix.net/api/v1/streets?namespacedId=N&creatorId=...,
// which the request interceptor answers from the local file.
// ---------------------------------------------------------------------------
async function loadFixtures() {
  const files = (await readdir(FIXTURES_DIR))
    .filter((f) => f.endsWith('.streetmix.json'))
    .sort();
  return Promise.all(
    files.map(async (file, i) => {
      const slug = basename(file, '.streetmix.json');
      return {
        slug,
        url: `https://streetmix.net/${FIXTURE_CREATOR_ID}/${i + 1}/${slug}`,
        namespacedId: String(i + 1),
        body: await readFile(join(FIXTURES_DIR, file), 'utf8')
      };
    })
  );
}

async function interceptStreetmixAPI(page, fixturesById) {
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const reqUrl = req.url();
    if (reqUrl.startsWith('https://streetmix.net/api/v1/streets')) {
      const params = new URL(reqUrl).searchParams;
      const fixture =
        params.get('creatorId') === FIXTURE_CREATOR_ID &&
        fixturesById.get(params.get('namespacedId'));
      if (fixture) {
        req.respond({
          status: 200,
          contentType: 'application/json',
          headers: { 'access-control-allow-origin': '*' },
          body: fixture.body
        });
        return;
      }
    }
    req.continue();
  });
}

// ---------------------------------------------------------------------------
// Page helpers (run in browser context)
// ---------------------------------------------------------------------------
async function openScene(browser, fixturesById) {
  const page = await browser.newPage();
  await page.setViewport({ ...VIEWPORT, deviceScaleFactor: 1 });
  page.on('pageerror', (err) => console.log('    [pageerror]', err.message));
  await interceptStreetmixAPI(page, fixturesById);
  // ?viewer=true closes the inspector after init so the scene camera renders
  await page.goto(`${BASE_URL}/?viewer=true`, {
    waitUntil: 'domcontentloaded',
    timeout: LOAD_TIMEOUT
  });
  await page.waitForFunction(
    () => window.AFRAME && AFRAME.scenes[0] && AFRAME.scenes[0].hasLoaded,
    { timeout: LOAD_TIMEOUT }
  );
  // Seed Math.random (mulberry32) so random placement (pedestrians etc.) is
  // reproducible across runs.
  await page.evaluate(() => {
    let s = 42;
    Math.random = () => {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  });
  return page;
}

async function triggerLegacy(page, url) {
  // #default-street was removed in #1699; the legacy import now creates a
  // fresh street entity (see inputStreetmix). Mirror that here by appending
  // our own entity to #street-container instead of mutating a fixed element.
  await page.evaluate((streetURL) => {
    const el = document.createElement('a-entity');
    el.id = 'parity-legacy-street';
    window.__parityLoaded = false;
    el.addEventListener(
      'streetmix-loader-street-loaded',
      () => {
        window.__parityLoaded = true;
      },
      { once: true }
    );
    el.setAttribute('streetmix-loader', {
      streetmixStreetURL: streetURL,
      showBuildings: false
    });
    document.getElementById('street-container').appendChild(el);
  }, url);
  await page.waitForFunction(() => window.__parityLoaded, {
    timeout: LOAD_TIMEOUT
  });
}

async function triggerManaged(page, url) {
  await page.evaluate((streetURL) => {
    const el = document.createElement('a-entity');
    el.id = 'parity-managed-street';
    el.setAttribute('street-align', 'width: center; length: middle');
    el.setAttribute('managed-street', {
      sourceType: 'streetmix-url',
      sourceValue: streetURL,
      synchronize: true // required: update() only calls refreshFromSource when true
    });
    document.getElementById('street-container').appendChild(el);
  }, url);
  await page.waitForFunction(
    () => {
      const el = document.getElementById('parity-managed-street');
      const c = el && el.components['managed-street'];
      return !!(
        c &&
        c.managedEntities.length > 0 &&
        c.pendingEntities.length === 0
      );
    },
    { timeout: LOAD_TIMEOUT }
  );
  await page.evaluate(() => {
    const el = document.getElementById('parity-managed-street');
    el.removeAttribute('street-label');
    AFRAME.INSPECTOR?.selectEntity(null);
  });
}

async function settleAndCapture(page, outPath) {
  // Let gltf-model loads kicked off by the import finish. Analytics keep the
  // network from ever being fully quiet, so treat idle-timeout as soft.
  await page
    .waitForNetworkIdle({ idleTime: 2000, timeout: 60000 })
    .catch(() => console.log('    (network never idled, continuing)'));
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll('a-entity')].every(
          (el) => !el.components?.['gltf-model'] || el.getObject3D('mesh')
        ),
      { timeout: 30000 }
    )
    .catch(() => console.log('    (some models never loaded, continuing)'));

  await page.evaluate((cam) => {
    const rig = document.getElementById('cameraRig');
    ['viewer-mode', 'movement-controls', 'cursor-teleport'].forEach((c) =>
      rig.removeAttribute(c)
    );
    rig.object3D.position.set(0, 0, 0);
    rig.object3D.rotation.set(0, 0, 0);
    const camera = document.getElementById('camera');
    camera.removeAttribute('look-controls');
    camera.object3D.position.set(cam.position.x, cam.position.y, cam.position.z);
    camera.object3D.rotation.set((cam.rotationXDeg * Math.PI) / 180, 0, 0);
    AFRAME.scenes[0].pause(); // freeze ticks/animations; render loop continues
    // element screenshots composite everything above the canvas (modals,
    // viewer UI), so hide all DOM siblings of the canvas
    const style = document.createElement('style');
    style.textContent =
      'body > *:not(canvas.a-canvas) { visibility: hidden !important; }';
    document.head.appendChild(style);
  }, CAMERA);
  await new Promise((r) => setTimeout(r, 1000)); // let final frames render

  const canvas = await page.$('canvas.a-canvas');
  await canvas.screenshot({ path: outPath });
}

// ---------------------------------------------------------------------------
// Comparison (mirrors three.js test/e2e/image.js: downsize + mismatch ratio)
// ---------------------------------------------------------------------------
async function decodeNormalized(path) {
  const { data } = await sharp(path)
    .resize(COMPARE_SIZE, COMPARE_SIZE, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

async function compare(legacyPath, managedPath, diffPath) {
  const [a, b] = await Promise.all([
    decodeNormalized(legacyPath),
    decodeNormalized(managedPath)
  ]);
  const diff = Buffer.alloc(a.length);
  let differing = 0;
  for (let i = 0; i < a.length; i += 3) {
    const d =
      (Math.abs(a[i] - b[i]) +
        Math.abs(a[i + 1] - b[i + 1]) +
        Math.abs(a[i + 2] - b[i + 2])) /
      (3 * 255);
    if (d > PIXEL_THRESHOLD) {
      differing++;
      diff[i] = 255;
      diff[i + 1] = 0;
      diff[i + 2] = 0;
    } else {
      // matching pixels shown as dimmed grayscale of the legacy render
      const gray = Math.round((a[i] + a[i + 1] + a[i + 2]) / 6);
      diff[i] = diff[i + 1] = diff[i + 2] = gray;
    }
  }
  await sharp(diff, {
    raw: { width: COMPARE_SIZE, height: COMPARE_SIZE, channels: 3 }
  })
    .png()
    .toFile(diffPath);
  return differing / (a.length / 3);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
try {
  await fetch(BASE_URL, { signal: AbortSignal.timeout(3000) });
} catch {
  console.error(`Dev server not reachable at ${BASE_URL} — run \`npm start\` first.`);
  process.exit(1);
}

await mkdir(OUT_DIR, { recursive: true });
const fixtures = await loadFixtures();
const fixturesById = new Map(fixtures.map((f) => [f.namespacedId, f]));
const streets = fixtures.filter((f) => f.slug.includes(FILTER));
if (streets.length === 0) {
  console.error(`No fixtures match --filter=${FILTER}`);
  process.exit(1);
}

const browser = await puppeteer.launch({
  headless: !HEADFUL,
  args: ['--window-size=1200,900']
});

const results = [];
for (const { slug, url } of streets) {
  console.log(`\n${slug}`);
  const paths = {
    legacy: join(OUT_DIR, `${slug}-legacy.png`),
    managed: join(OUT_DIR, `${slug}-managed.png`),
    diff: join(OUT_DIR, `${slug}-diff.png`)
  };
  try {
    for (const mode of ['legacy', 'managed']) {
      console.log(`  ${mode}: importing...`);
      const page = await openScene(browser, fixturesById);
      if (mode === 'legacy') await triggerLegacy(page, url);
      else await triggerManaged(page, url);
      await settleAndCapture(page, paths[mode]);
      await page.close();
    }
    const ratio = await compare(paths.legacy, paths.managed, paths.diff);
    console.log(`  mismatch: ${(ratio * 100).toFixed(2)}%`);
    results.push({ url, slug, mismatchRatio: ratio });
  } catch (err) {
    console.log(`  FAILED: ${err.message}`);
    results.push({ url, slug, error: String(err.message) });
  }
}

await browser.close();

results.sort((x, y) => (y.mismatchRatio ?? 2) - (x.mismatchRatio ?? 2));
console.log('\n' + '─'.repeat(64));
console.log('STREETMIX IMPORT PARITY — legacy vs managed-street');
console.log(`compare ${COMPARE_SIZE}², pixel threshold ${PIXEL_THRESHOLD}`);
console.log('─'.repeat(64));
for (const r of results) {
  const status = r.error
    ? `ERROR ${r.error}`
    : `${(r.mismatchRatio * 100).toFixed(2).padStart(6)}% pixels differ`;
  console.log(`  ${r.slug.padEnd(46)} ${status}`);
}
console.log(`\nImages: ${OUT_DIR}`);

await writeFile(
  join(OUT_DIR, 'report.json'),
  JSON.stringify(
    { baseUrl: BASE_URL, compareSize: COMPARE_SIZE, pixelThreshold: PIXEL_THRESHOLD, results },
    null,
    2
  )
);

if (FAIL_THRESHOLD !== null) {
  const limit = Number(FAIL_THRESHOLD);
  const over = results.filter((r) => r.error || r.mismatchRatio > limit);
  if (over.length) {
    console.log(`\n${over.length} street(s) exceed threshold ${limit}`);
    process.exit(1);
  }
}
