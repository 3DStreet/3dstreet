// @ts-check
const { test, expect } = require('@playwright/test');
const {
  waitForSceneLoaded,
  waitForStreetLoaded,
  setCameraPosition,
  logPerfMetrics
} = require('./helpers');

const CAMERA_BIRDSEYE = {
  pos: { x: 0, y: 20, z: 0 },
  rot: { x: -90, y: 0, z: 0 }
};

const CAMERA_STREET_LEVEL = {
  pos: { x: -10, y: 1.6, z: 0 },
  rot: { x: 0, y: 90, z: 0 }
};

const SCENES = [
  {
    name: 'streetmix-kfarr-3',
    url: '/?importer=managed#https://streetmix.net/kfarr/3/example-street',
    cameras: [
      { name: 'birdseye', ...CAMERA_BIRDSEYE },
      { name: 'street-level', ...CAMERA_STREET_LEVEL }
    ]
  }
];

test.describe('Baseline visual regression', () => {
  for (const scene of SCENES) {
    for (const camera of scene.cameras) {
      test(`${scene.name} — ${camera.name}`, async ({ page }) => {
        await page.goto(scene.url, { waitUntil: 'domcontentloaded' });
        await waitForSceneLoaded(page);
        await waitForStreetLoaded(page);
        await setCameraPosition(page, camera.pos, camera.rot);

        await logPerfMetrics(page);

        await expect(page).toHaveScreenshot(
          `${scene.name}-${camera.name}.png`,
          { timeout: 10000 }
        );
      });
    }
  }
});
