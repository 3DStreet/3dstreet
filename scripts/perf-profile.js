#!/usr/bin/env node
'use strict';

const { chromium } = require('playwright');

const DEFAULT_SCENES = [
  {
    name: 'Basic scene (1 managed street)',
    url: 'https://3dstreet.app/#/scenes/e4f46f6f-11de-4220-9822-f8b0fb115b2a'
  },
  {
    name: 'Complicated scene (multiple managed streets)',
    url: 'https://3dstreet.app/#/scenes/83ef6419-bfc1-4b67-9572-367d173406d7'
  },
  {
    name: 'Complicated scene (freezes ~0 FPS)',
    url: 'https://3dstreet.app/#/scenes/cb4ac0a0-be44-4da4-88cb-07d78240f027'
  }
];

const SAMPLE_DURATION_S = 10;
const ASSET_WAIT_S = 5;

function formatNumber(n) {
  return typeof n === 'number' ? n.toLocaleString() : String(n);
}

function percentile(sortedArr, p) {
  const idx = Math.ceil((p / 100) * sortedArr.length) - 1;
  return sortedArr[Math.max(0, idx)];
}

async function profileScene(browser, url) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  const page = await context.newPage();

  console.log(`\nNavigating to: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for A-Frame scene to load
  console.log('Waiting for A-Frame scene to load...');
  await page.waitForFunction(
    () => {
      const scene = document.querySelector('a-scene');
      if (!scene) throw new Error('No <a-scene> found');
      return scene.hasLoaded;
    },
    { timeout: 60000 }
  );
  console.log('Scene loaded. Waiting for assets to finish loading...');

  // Wait for assets (models, textures) to settle
  await page.waitForTimeout(ASSET_WAIT_S * 1000);

  // Measure FPS over sample duration
  console.log(`Measuring FPS over ${SAMPLE_DURATION_S}s...`);
  const frameTimes = await page.evaluate((durationMs) => {
    return new Promise((resolve) => {
      const times = [];
      let lastTime = performance.now();
      const end = lastTime + durationMs;

      function tick() {
        const now = performance.now();
        times.push(now - lastTime);
        lastTime = now;
        if (now < end) {
          requestAnimationFrame(tick);
        } else {
          resolve(times);
        }
      }
      requestAnimationFrame(tick);
    });
  }, SAMPLE_DURATION_S * 1000);

  // Calculate FPS stats from frame times
  const fpsValues = frameTimes.map((dt) => 1000 / dt);
  fpsValues.sort((a, b) => a - b);

  const avgFps = fpsValues.reduce((sum, v) => sum + v, 0) / fpsValues.length;
  const minFps = fpsValues[0];
  const maxFps = fpsValues[fpsValues.length - 1];
  const medianFps = percentile(fpsValues, 50);
  const p5Fps = percentile(fpsValues, 5);
  const p95Fps = percentile(fpsValues, 95);

  // Collect renderer stats
  const rendererStats = await page.evaluate(() => {
    const scene = document.querySelector('a-scene');
    if (!scene || !scene.renderer) return null;
    const info = scene.renderer.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures
    };
  });

  // Collect scene entity stats
  const sceneStats = await page.evaluate(() => {
    const scene = document.querySelector('a-scene');
    if (!scene) return null;
    const entities = scene.querySelectorAll('[class]').length;
    const threeObjects = scene.object3D
      ? (() => {
          let count = 0;
          scene.object3D.traverse(() => count++);
          return count;
        })()
      : 0;
    return { entities, threeObjects };
  });

  // Collect memory stats (Chromium only)
  const memoryStats = await page.evaluate(() => {
    if (performance.memory) {
      return {
        jsHeapMB: Math.round(performance.memory.usedJSHeapSize / 1024 / 1024),
        totalMB: Math.round(performance.memory.totalJSHeapSize / 1024 / 1024)
      };
    }
    return null;
  });

  await context.close();

  return {
    url,
    fps: {
      average: Math.round(avgFps * 10) / 10,
      min: Math.round(minFps * 10) / 10,
      max: Math.round(maxFps * 10) / 10,
      p5: Math.round(p5Fps * 10) / 10,
      median: Math.round(medianFps * 10) / 10,
      p95: Math.round(p95Fps * 10) / 10,
      frameCount: fpsValues.length
    },
    renderer: rendererStats,
    scene: sceneStats,
    memory: memoryStats
  };
}

function printReport(result) {
  console.log('\n' + '='.repeat(50));
  console.log('  3DStreet Performance Report');
  console.log('='.repeat(50));
  console.log(`Scene: ${result.url}`);
  console.log(`Date:  ${new Date().toISOString()}`);

  console.log('\nFPS (' + SAMPLE_DURATION_S + 's sample):');
  console.log(`  Average:  ${result.fps.average}`);
  console.log(`  Min:      ${result.fps.min}`);
  console.log(`  Max:      ${result.fps.max}`);
  console.log(`  P5:       ${result.fps.p5}`);
  console.log(`  Median:   ${result.fps.median}`);
  console.log(`  P95:      ${result.fps.p95}`);
  console.log(`  Frames:   ${result.fps.frameCount}`);

  if (result.renderer) {
    console.log('\nRenderer Stats:');
    console.log(`  Draw calls: ${formatNumber(result.renderer.drawCalls)}`);
    console.log(`  Triangles:  ${formatNumber(result.renderer.triangles)}`);
    console.log(`  Geometries: ${formatNumber(result.renderer.geometries)}`);
    console.log(`  Textures:   ${formatNumber(result.renderer.textures)}`);
  }

  if (result.scene) {
    console.log('\nScene Stats:');
    console.log(`  Entities:        ${formatNumber(result.scene.entities)}`);
    console.log(
      `  Three.js Objects: ${formatNumber(result.scene.threeObjects)}`
    );
  }

  if (result.memory) {
    console.log('\nMemory:');
    console.log(`  JS Heap: ${result.memory.jsHeapMB} MB`);
    console.log(`  Total:   ${result.memory.totalMB} MB`);
  } else {
    console.log('\nMemory: (not available — requires Chrome flags)');
  }

  console.log('='.repeat(50));
}

async function main() {
  const args = process.argv.slice(2);
  const scenes =
    args.length > 0 ? args.map((url) => ({ name: url, url })) : DEFAULT_SCENES;

  console.log('Launching Chrome (headful for GPU rendering)...');
  const browser = await chromium.launch({
    headless: false,
    args: [
      '--enable-gpu-rasterization',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--enable-precise-memory-info'
    ]
  });

  const results = [];
  for (const scene of scenes) {
    console.log(`\n--- Profiling: ${scene.name} ---`);
    try {
      const result = await profileScene(browser, scene.url);
      results.push(result);
      printReport(result);
    } catch (err) {
      console.error(`Error profiling ${scene.url}: ${err.message}`);
    }
  }

  await browser.close();

  if (results.length > 1) {
    console.log('\n\n' + '='.repeat(50));
    console.log('  Summary');
    console.log('='.repeat(50));
    for (const r of results) {
      const shortUrl =
        r.url.length > 60 ? r.url.substring(0, 57) + '...' : r.url;
      console.log(
        `  ${shortUrl}  →  avg ${r.fps.average} FPS, ${r.renderer ? formatNumber(r.renderer.drawCalls) + ' draw calls' : 'no renderer stats'}`
      );
    }
    console.log('='.repeat(50));
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
