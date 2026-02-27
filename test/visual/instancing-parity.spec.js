// @ts-check
const { test, expect } = require('@playwright/test');
const {
  waitForSceneLoaded,
  waitForStreetLoaded,
  setCameraPosition,
  logPerfMetrics
} = require('./helpers');

// Use a streetmix URL that generates clones (vehicles, trees, pedestrians)
const STREETMIX_URL = 'https://streetmix.net/kfarr/3/example-street';
const CAMERA_POS = { x: 0, y: 20, z: 0 };
const CAMERA_ROT = { x: -90, y: 0, z: 0 };

test.describe('Instancing parity — instanced vs entity clones', () => {
  test('instanced and non-instanced rendering should look similar', async ({
    page
  }) => {
    // Load with instancing ON (default)
    await page.goto(`/?importer=managed#${STREETMIX_URL}`, {
      waitUntil: 'domcontentloaded'
    });
    await waitForSceneLoaded(page);
    await waitForStreetLoaded(page);
    await setCameraPosition(page, CAMERA_POS, CAMERA_ROT);

    const instancedStats = await logPerfMetrics(page);
    console.log('[instancing] Instanced renderer stats:', instancedStats);

    await expect(page).toHaveScreenshot('instancing-on.png', {
      maxDiffPixelRatio: 0.01,
      timeout: 10000
    });

    // Load with instancing OFF
    await page.goto(`/?importer=managed&instancing=off#${STREETMIX_URL}`, {
      waitUntil: 'domcontentloaded'
    });
    await waitForSceneLoaded(page);
    await waitForStreetLoaded(page);
    await setCameraPosition(page, CAMERA_POS, CAMERA_ROT);

    const entityStats = await logPerfMetrics(page);
    console.log('[instancing] Entity clone renderer stats:', entityStats);

    await expect(page).toHaveScreenshot('instancing-off.png', {
      maxDiffPixelRatio: 0.01,
      timeout: 10000
    });

    // Log the draw call difference
    if (instancedStats && entityStats) {
      const drawCallReduction =
        ((entityStats.drawCalls - instancedStats.drawCalls) /
          entityStats.drawCalls) *
        100;
      console.log(
        `[instancing] Draw call reduction: ${drawCallReduction.toFixed(1)}% ` +
          `(${entityStats.drawCalls} → ${instancedStats.drawCalls})`
      );
    }
  });
});
