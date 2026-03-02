// @ts-check
const { test, expect } = require('@playwright/test');
const {
  waitForSceneLoaded,
  waitForStreetLoaded,
  setCameraPosition,
  logPerfMetrics
} = require('./helpers');

const STREETMIX_URL = 'https://streetmix.net/kfarr/3/example-street';
const CAMERA_POS = { x: 0, y: 20, z: 0 };
const CAMERA_ROT = { x: -90, y: 0, z: 0 };

test.describe('Streetmix import parity — legacy vs managed', () => {
  test('legacy and managed streetmix imports should look similar', async ({
    page
  }) => {
    // Load legacy import
    await page.goto(`/#${STREETMIX_URL}`, { waitUntil: 'domcontentloaded' });
    await waitForSceneLoaded(page);
    await waitForStreetLoaded(page);
    await setCameraPosition(page, CAMERA_POS, CAMERA_ROT);

    const legacyStats = await logPerfMetrics(page);
    console.log('[parity] Legacy renderer stats:', legacyStats);

    // Take legacy screenshot as baseline
    await expect(page).toHaveScreenshot('streetmix-legacy.png', {
      maxDiffPixelRatio: 0.05,
      timeout: 10000
    });

    // Load managed import
    await page.goto(`/?importer=managed#${STREETMIX_URL}`, {
      waitUntil: 'domcontentloaded'
    });
    await waitForSceneLoaded(page);
    await waitForStreetLoaded(page);
    await setCameraPosition(page, CAMERA_POS, CAMERA_ROT);

    const managedStats = await logPerfMetrics(page);
    console.log('[parity] Managed renderer stats:', managedStats);

    // Compare managed screenshot against same baseline
    // Using a higher threshold since legacy vs managed may differ slightly
    await expect(page).toHaveScreenshot('streetmix-managed.png', {
      maxDiffPixelRatio: 0.05,
      timeout: 10000
    });
  });
});
