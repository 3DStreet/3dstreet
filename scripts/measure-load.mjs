// measure-load.mjs — measure scene "all models loaded" time, network-independent.
//
// Reproduces the load-time measurement: injects a probe BEFORE any page script
// (so nothing is missed), waits for `newScene`, and in a batching build waits for
// `batch-grouping-done` (so deferred batch slots are finalized) before timing
// `waitForAllModelsLoaded(#street-container)`. Auto-detects batching on/off.
//
// Usage (from the repo root, with `npm start` already running):
//   node scripts/measure-load.mjs            # launches REAL google-chrome (GPU), measures BOTH modes
//   TRIALS=8 node scripts/measure-load.mjs
//   TRIALS=5 FPS_SECONDS=8 node scripts/measure-load.mjs             # more stable FPS
//   BATCHING=off node scripts/measure-load.mjs                       # measure only one mode
//   URL='http://localhost:3333/#/scenes/XXXX' node scripts/measure-load.mjs
//   HEADLESS=1 node scripts/measure-load.mjs                         # SwiftShader (no display; timings inflated)
//   CDP=http://127.0.0.1:9222 node scripts/measure-load.mjs          # attach to a Chrome you launched yourself
//
// By default it spawns real Chrome with remote debugging (real GPU → realistic
// timings), sets window.BATCHING_ENABLED before the bundle loads for each mode, and
// prints a side-by-side comparison table. No rebuild needed between modes.

import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const URL =
  process.env.URL ||
  'http://localhost:3333/#/scenes/92902ed5-e256-4c0c-bbf3-a9c1fa183897';
const TRIALS = Number(process.env.TRIALS || 5);
const HEADLESS = process.env.HEADLESS === '1';
const CDP = process.env.CDP || ''; // attach to an already-running Chrome
const CHROME_BIN = process.env.CHROME || '/usr/bin/google-chrome-stable';
const PORT = Number(process.env.PORT || 9222);
const NAV_TIMEOUT = 90000;

// BATCHING=off|on forces window.BATCHING_ENABLED before the bundle loads. Unset =
// whatever the build defaults to (on).
const B = (process.env.BATCHING || '').toLowerCase();
const forceBatching =
  B === 'off' || B === 'false' || B === '0'
    ? 'off'
    : B === 'on' || B === 'true' || B === '1'
      ? 'on'
      : undefined;

// Injected into every navigation (before page scripts). Sets window.__ml and
// flips __ml.done when the measurement finishes (or errors).
// arg.forceBatching: 'off' | 'on' | undefined — set window.BATCHING_ENABLED
// before the bundle loads.
function probe(arg) {
  const start = performance.now();
  const forceBatching = arg && arg.forceBatching;
  const M = (window.__ml = {
    start,
    tNewScene: null,
    tGroupingDone: null,
    tModels: null,
    mode: 'none',
    forced: forceBatching || null,
    rootEntities: 0,
    memory: null, // renderer.info.memory { geometries, textures } — GPU-resident (rendered) only
    render: null, // renderer.info.render { calls, triangles, points, lines, frame }
    scene: null, // view-independent counts from the scene graph
    sampleFrames: 0,
    err: null,
    done: false
  });

  // Set the static batching flag before any page script runs. batch-models reads
  // `window.BATCHING_ENABLED ?? true` once at module-eval to decide whether to swap
  // in the defer-and-clone gltf-model component, so it must be set here (this init
  // script runs before the bundle) and cannot be flipped at runtime.
  if (forceBatching === 'off' || forceBatching === 'on') {
    window.BATCHING_ENABLED = forceBatching === 'on';
  }

  function getRoot() {
    return document.querySelector('#street-container') || AFRAME.scenes[0];
  }

  // View-independent: every geometry that exists in the scene graph, whether or
  // not it has been rendered/uploaded yet. Counts BatchedMesh too.
  function countScene() {
    const geos = new Set();
    let meshes = 0;
    let batched = 0;
    // Internal data-textures BatchedMesh allocates (matrices / colors / indirect).
    let bMatrices = 0;
    let bColors = 0;
    let bIndirect = 0;
    const materialTex = new Set(); // unique textures referenced by materials
    AFRAME.scenes[0].object3D.traverse((o) => {
      if (o.isBatchedMesh) {
        batched++;
        if (o._matricesTexture) bMatrices++;
        if (o._colorsTexture) bColors++;
        if (o._indirectTexture) bIndirect++;
      }
      if (o.isMesh) {
        meshes++;
        if (o.geometry) geos.add(o.geometry.uuid);
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          for (const k in m) {
            const v = m[k];
            if (v && v.isTexture) materialTex.add(v.uuid);
          }
        }
      }
    });
    return {
      meshes,
      batchedMeshes: batched,
      uniqueGeometries: geos.size,
      materialTextures: materialTex.size,
      batchMatricesTex: bMatrices,
      batchColorsTex: bColors,
      batchIndirectTex: bIndirect
    };
  }

  // renderer.info.memory.geometries counts only GPU-resident (rendered) geometries
  // and render.* counters reset each frame. We drive rendering ourselves with
  // setTimeout (rAF is throttled/paused for a backgrounded or headless page, which
  // would both hang and under-count), forcing a full render each step so geometries
  // upload, until the count stops growing. Hard-capped so it can never hang.
  function sampleRendererInfo() {
    return new Promise((res) => {
      const scene = AFRAME.scenes[0];
      const renderer = scene.renderer;
      let last = -1;
      let stable = 0;
      let iters = 0;
      const STABLE = 5; // 5 * 100ms of no change
      const MAX_ITERS = 40; // 4s hard cap
      const step = () => {
        try {
          if (scene.camera) renderer.render(scene.object3D, scene.camera);
        } catch (e) {
          /* ignore transient render errors */
        }
        const info = renderer.info;
        const g = info.memory.geometries;
        iters++;
        if (g === last) stable++;
        else {
          stable = 0;
          last = g;
        }
        if (stable >= STABLE || iters >= MAX_ITERS) {
          M.memory = { ...info.memory };
          M.render = { ...info.render };
          M.scene = countScene();
          M.sampleFrames = iters;
          res();
          return;
        }
        setTimeout(step, 100);
      };
      step();
    });
  }

  let attached = false;
  const iv = setInterval(() => {
    const s = window.AFRAME && AFRAME.scenes && AFRAME.scenes[0];
    if (!s || attached) return;
    attached = true;
    clearInterval(iv);
    s.addEventListener('newScene', () => {
      M.tNewScene = performance.now() - start;
      let gate;
      if (s._batchingEnabled) {
        M.mode = 'batching';
        if (s._batchGroupingDone) {
          M.tGroupingDone = performance.now() - start;
          gate = Promise.resolve();
        } else {
          gate = new Promise((res) => {
            s.addEventListener(
              'batch-grouping-done',
              () => {
                M.tGroupingDone = performance.now() - start;
                res();
              },
              { once: true }
            );
          });
        }
      } else {
        M.mode = 'no-batching';
        gate = Promise.resolve();
      }
      gate
        .then(() => {
          const root = getRoot();
          M.rootEntities = root.querySelectorAll('[gltf-model], [gltf-part]').length;
          // Use the app-provided global (set by the user), not a local reimpl.
          return Promise.resolve(globalThis.waitForAllModelsLoaded(root));
        })
        .then(() => {
          M.tModels = performance.now() - start;
          return sampleRendererInfo();
        })
        .then(() => {
          M.done = true;
        })
        .catch((e) => {
          M.err = String((e && e.message) || e);
          M.done = true;
        });
    });
  }, 10);
}

const waitDone = async (page) => {
  try {
    await page.waitForFunction(() => window.__ml && window.__ml.done, null, {
      timeout: NAV_TIMEOUT
    });
  } catch (e) {
    const st = await page
      .evaluate(() => window.__ml && JSON.parse(JSON.stringify(window.__ml)))
      .catch(() => null);
    console.error('waitDone timed out. __ml =', st);
    throw e;
  }
};

const r0 = (x) => (x == null ? null : Math.round(x));
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const meanOf = (rows, f) => Math.round(mean(rows.map(f)));
const FPS_SECONDS = Number(process.env.FPS_SECONDS || 5);

const percentile = (sorted, p) => {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
};

// Count real render-loop frames over a window (rAF frame-time sampling, same as
// PR #1460). Backstopped with a setTimeout so it can't hang if rAF is throttled.
async function sampleFps(page, seconds) {
  await page.bringToFront().catch(() => {});
  const dts = await page.evaluate((ms) => {
    return new Promise((resolve) => {
      const times = [];
      let last = performance.now();
      const end = last + ms;
      const backstop = setTimeout(() => resolve(times), ms + 3000);
      const tick = () => {
        const now = performance.now();
        times.push(now - last);
        last = now;
        if (now < end) requestAnimationFrame(tick);
        else {
          clearTimeout(backstop);
          resolve(times);
        }
      };
      requestAnimationFrame(tick);
    });
  }, seconds * 1000);
  // Drop the first delta (idle→active gap) and compute stats.
  const frames = dts.slice(1);
  if (!frames.length) return { frames: 0 };
  const fps = frames.map((dt) => 1000 / dt).sort((a, b) => a - b);
  return {
    frames: frames.length,
    avgFps: mean(fps),
    medianFps: percentile(fps, 50),
    p5Fps: percentile(fps, 5), // worst 5% of frames (hitches)
    minFps: fps[0],
    meanFrameMs: mean(frames)
  };
}

// Measure one mode in its own fresh context (isolated cache; own warm-up).
async function measureMode(browser, mode) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT);
  await page.addInitScript(probe, { forceBatching: mode });

  console.log(`\n########## batching=${mode} ##########`);

  // Warm-up (cold load; discard so the cache is populated).
  await page.goto(URL, { waitUntil: 'load' });
  await waitDone(page);
  const warm = await page.evaluate(() => window.__ml);
  console.log(`warm-up   detectedMode=${warm.mode}  rootEntities=${warm.rootEntities}`);

  const rows = [];
  for (let i = 1; i <= TRIALS; i++) {
    await page.reload({ waitUntil: 'load' });
    await waitDone(page);
    const m = await page.evaluate(() => window.__ml);
    if (m.err) {
      console.log(`trial ${i}  ERROR: ${m.err}`);
      continue;
    }
    rows.push(m);
    const sc = m.scene || {};
    const ren = m.render || {};
    const mem = m.memory || {};
    console.log(
      `trial ${i}  models@${r0(m.tModels)}ms   ` +
        `newScene→models=${r0(m.tModels - m.tNewScene)}ms   ` +
        `meshes=${sc.meshes}  drawCalls=${ren.calls}\n` +
        `         textures(GPU)=${mem.textures}  materialTex=${sc.materialTextures}  ` +
        `batchTex[matrices=${sc.batchMatricesTex} colors=${sc.batchColorsTex} indirect=${sc.batchIndirectTex}]`
    );
  }
  // FPS on the last-loaded scene (uncapped render loop; see chrome flags).
  let fps = { frames: 0 };
  const ok = rows.filter((m) => m.tModels != null);
  if (ok.length) {
    console.log(`sampling FPS for ${FPS_SECONDS}s...`);
    fps = await sampleFps(page, FPS_SECONDS);
    console.log(
      `         avg=${r0(fps.avgFps)}  median=${r0(fps.medianFps)}  ` +
        `p5(worst)=${r0(fps.p5Fps)}  min=${r0(fps.minFps)}  ` +
        `frameMs=${fps.meanFrameMs ? fps.meanFrameMs.toFixed(2) : 'n/a'}  (${fps.frames} frames)`
    );
  }
  await ctx.close();

  if (!ok.length) return { mode, ok: false };
  return {
    mode,
    ok: true,
    detectedMode: ok[0].mode,
    trials: ok.length,
    navToModels: meanOf(ok, (m) => m.tModels),
    newSceneToModels: meanOf(ok, (m) => m.tModels - m.tNewScene),
    meshes: meanOf(ok, (m) => (m.scene || {}).meshes || 0),
    batchedMeshes: meanOf(ok, (m) => (m.scene || {}).batchedMeshes || 0),
    uniqueGeometries: meanOf(ok, (m) => (m.scene || {}).uniqueGeometries || 0),
    gpuGeometries: meanOf(ok, (m) => (m.memory || {}).geometries || 0),
    textures: meanOf(ok, (m) => (m.memory || {}).textures || 0),
    drawCalls: meanOf(ok, (m) => (m.render || {}).calls || 0),
    triangles: meanOf(ok, (m) => (m.render || {}).triangles || 0),
    avgFps: r0(fps.avgFps),
    medianFps: r0(fps.medianFps),
    p5Fps: r0(fps.p5Fps),
    frameMs: fps.meanFrameMs != null ? Number(fps.meanFrameMs.toFixed(2)) : null
  };
}

function printTable(off, on) {
  const rowsDef = [
    ['navigation → models (ms)', 'navToModels'],
    ['newScene → models (ms)', 'newSceneToModels'],
    ['scene meshes', 'meshes'],
    ['batchedMeshes', 'batchedMeshes'],
    ['unique geometries', 'uniqueGeometries'],
    ['GPU-resident geometries', 'gpuGeometries'],
    ['draw calls (frame)', 'drawCalls'],
    ['triangles (frame)', 'triangles'],
    ['textures', 'textures'],
    ['FPS avg (uncapped)', 'avgFps'],
    ['FPS median', 'medianFps'],
    ['FPS p5 (worst)', 'p5Fps'],
    ['frame time (ms)', 'frameMs']
  ];
  const cell = (r, k) => (r && r.ok && r[k] != null ? String(r[k]) : 'n/a');
  const w0 = Math.max(26, ...rowsDef.map(([label]) => label.length));
  const pad = (s, w) => String(s).padEnd(w);
  const padL = (s, w) => String(s).padStart(w);
  const W = 14;
  console.log('\n========================= COMPARISON =========================');
  console.log(`(mean of ${TRIALS} trials, headless=${HEADLESS})\n`);
  console.log(pad('metric', w0) + padL('batching=off', W) + padL('batching=on', W));
  console.log('-'.repeat(w0 + 2 * W));
  for (const [label, key] of rowsDef) {
    console.log(pad(label, w0) + padL(cell(off, key), W) + padL(cell(on, key), W));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Spawn real google-chrome with remote debugging and wait for the CDP endpoint.
async function launchRealChrome() {
  const userDataDir =
    process.env.CHROME_PROFILE ||
    path.join(os.tmpdir(), `measure-chrome-${process.pid}`);
  const args = [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--disable-features=Translate,CalculateNativeWinOcclusion',
    // Uncap the render loop so FPS reflects actual render cost (draw-call load),
    // not the monitor's vsync ceiling — otherwise both modes just read ~60.
    '--disable-gpu-vsync',
    '--disable-frame-rate-limit',
    'about:blank'
  ];
  const child = spawn(CHROME_BIN, args, { stdio: 'ignore' });
  child.on('error', (e) => {
    console.error(`Failed to launch ${CHROME_BIN}:`, e.message);
  });
  const endpoint = `http://127.0.0.1:${PORT}`;
  const deadline = Date.now() + 20000;
  for (;;) {
    try {
      const r = await fetch(`${endpoint}/json/version`);
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`Chrome CDP endpoint ${endpoint} did not come up`);
    }
    await sleep(200);
  }
  const browser = await chromium.connectOverCDP(endpoint);
  return { browser, child, endpoint };
}

async function getBrowser() {
  if (CDP) {
    console.log(`Attaching to Chrome over CDP: ${CDP}`);
    return { browser: await chromium.connectOverCDP(CDP), child: null, own: false };
  }
  if (HEADLESS) {
    console.log('Launching headless Chromium (SwiftShader — timings inflated).');
    return {
      browser: await chromium.launch({ channel: 'chrome', headless: true }),
      child: null,
      own: true
    };
  }
  console.log(`Launching real ${CHROME_BIN} (GPU) with remote debugging on :${PORT}`);
  const { browser, child, endpoint } = await launchRealChrome();
  console.log(`Connected: ${endpoint}`);
  return { browser, child, own: true };
}

async function main() {
  console.log(`URL: ${URL}`);
  console.log(`Trials: ${TRIALS} (+1 warm-up each)`);

  // If BATCHING is set, measure only that mode; otherwise measure both.
  const modes = forceBatching ? [forceBatching] : ['off', 'on'];

  const { browser, child } = await getBrowser();
  const results = {};
  try {
    for (const mode of modes) {
      results[mode] = await measureMode(browser, mode);
    }
  } finally {
    await browser.close().catch(() => {});
    if (child) child.kill('SIGTERM');
  }

  printTable(results.off, results.on);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
