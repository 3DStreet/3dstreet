const { test, expect } = require('@playwright/test');
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');

const TEST_STREET = 'https://streetmix.net/kfarr/3/';
const SCREENSHOT_DIR = path.join(__dirname, 'screenshots');

// Camera position for consistent comparison (bird's eye view)
const CAMERA_POSITION = { x: 0, y: 20, z: 0 };
const CAMERA_ROTATION = { x: -90, y: 0, z: 0 };

// How long to wait for assets to load after scene is ready
const ASSET_LOAD_DELAY = 3000;

// Dynamic import for ESM pixelmatch
let pixelmatch;

test.describe('Legacy vs Managed Street Visual Parity', () => {
  test.beforeAll(async () => {
    // Import ESM module
    const pixelmatchModule = await import('pixelmatch');
    pixelmatch = pixelmatchModule.default;

    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
  });

  test('streetmix kfarr/3 renders identically', async ({ page }) => {
    // Increase timeout for this test since we're loading 3D scenes
    test.setTimeout(120000);

    // 1. Capture legacy version
    console.log('Loading legacy importer...');
    await page.goto(`/#${TEST_STREET}`);
    await waitForSceneLoaded(page);
    await setCameraPosition(page, CAMERA_POSITION, CAMERA_ROTATION);
    await page.waitForTimeout(ASSET_LOAD_DELAY);

    const legacyPath = path.join(SCREENSHOT_DIR, 'legacy.png');
    await page.screenshot({ path: legacyPath });
    console.log('Legacy screenshot saved');

    // 2. Capture managed version
    console.log('Loading managed importer...');
    await page.goto(`/?importer=managed#${TEST_STREET}`);
    await waitForSceneLoaded(page);
    await setCameraPosition(page, CAMERA_POSITION, CAMERA_ROTATION);
    await page.waitForTimeout(ASSET_LOAD_DELAY);

    const managedPath = path.join(SCREENSHOT_DIR, 'managed.png');
    await page.screenshot({ path: managedPath });
    console.log('Managed screenshot saved');

    // 3. Compare screenshots
    const legacy = PNG.sync.read(fs.readFileSync(legacyPath));
    const managed = PNG.sync.read(fs.readFileSync(managedPath));
    const { width, height } = legacy;
    const diff = new PNG({ width, height });

    const numDiffPixels = pixelmatch(
      legacy.data,
      managed.data,
      diff.data,
      width,
      height,
      { threshold: 0.1 }
    );

    // Save diff image
    const diffPath = path.join(SCREENSHOT_DIR, 'diff.png');
    fs.writeFileSync(diffPath, PNG.sync.write(diff));

    // Calculate percentage
    const totalPixels = width * height;
    const diffPercent = (numDiffPixels / totalPixels) * 100;

    console.log(`
╔════════════════════════════════════════════════════╗
║         VISUAL PARITY TEST RESULTS                 ║
╠════════════════════════════════════════════════════╣
║ Street: ${TEST_STREET.padEnd(39)}║
║ Total pixels:     ${totalPixels.toString().padEnd(28)}║
║ Different pixels: ${numDiffPixels.toString().padEnd(28)}║
║ Difference:       ${(diffPercent.toFixed(2) + '%').padEnd(28)}║
╠════════════════════════════════════════════════════╣
║ Screenshots saved to: test/parity/screenshots/     ║
║   - legacy.png                                     ║
║   - managed.png                                    ║
║   - diff.png (red pixels = differences)            ║
╚════════════════════════════════════════════════════╝
    `);

    // Fail if more than 5% different
    expect(
      diffPercent,
      `Visual difference of ${diffPercent.toFixed(2)}% exceeds 5% threshold. Check diff.png for details.`
    ).toBeLessThan(5);
  });
});

async function waitForSceneLoaded(page) {
  // Wait for A-Frame scene to be loaded
  await page.waitForFunction(
    () => {
      const scene = document.querySelector('a-scene');
      return scene && scene.hasLoaded;
    },
    { timeout: 30000 }
  );

  // Also wait for street to be loaded (either legacy or managed)
  await page.waitForFunction(
    () => {
      // Check for legacy street entities
      const legacyStreet = document.querySelector('.street-parent');
      // Check for managed street entities
      const managedStreet = document.querySelector('[managed-street]');
      const segments = document.querySelectorAll('[street-segment]');

      return legacyStreet || (managedStreet && segments.length > 0);
    },
    { timeout: 30000 }
  );
}

async function setCameraPosition(page, position, rotation) {
  await page.evaluate(
    ({ pos, rot }) => {
      // Find the camera rig or camera element
      const cameraRig = document.querySelector('#cameraRig');
      const camera = document.querySelector('[camera]');

      if (cameraRig) {
        cameraRig.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
        cameraRig.setAttribute('rotation', `${rot.x} ${rot.y} ${rot.z}`);
      }
      if (camera) {
        // Reset camera's local transform if it's a child of the rig
        camera.setAttribute('position', '0 0 0');
        camera.setAttribute('rotation', '0 0 0');
      }
    },
    { pos: position, rot: rotation }
  );

  // Wait a frame for the camera change to take effect
  await page.waitForTimeout(100);
}
