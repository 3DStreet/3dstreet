/**
 * Shared helpers for visual and performance tests.
 *
 * Provides utilities to wait for A-Frame scene readiness,
 * position the camera, and capture Three.js renderer stats.
 */

/**
 * Wait for the A-Frame scene to emit its 'loaded' event.
 * @param {import('@playwright/test').Page} page
 * @param {number} [timeout=60000]
 */
async function waitForSceneLoaded(page, timeout = 60000) {
  await page.waitForFunction(
    () => {
      const scene = document.querySelector('a-scene');
      return scene && scene.hasLoaded;
    },
    { timeout }
  );
}

/**
 * Wait for street elements (managed-street or streetmix-loader) to finish
 * generating their child geometry. Polls until no new entities are added
 * for a settling period.
 * @param {import('@playwright/test').Page} page
 * @param {number} [settleMs=3000] - ms of no new entities before considering settled
 * @param {number} [timeout=120000]
 */
async function waitForStreetLoaded(page, settleMs = 3000, timeout = 120000) {
  await page.waitForFunction(
    ([settleMs]) => {
      // Attach a mutation observer the first time this runs
      if (!window.__streetSettleState) {
        window.__streetSettleState = {
          lastChangeTime: Date.now(),
          observer: null
        };
        const obs = new MutationObserver(() => {
          window.__streetSettleState.lastChangeTime = Date.now();
        });
        obs.observe(document.querySelector('a-scene') || document.body, {
          childList: true,
          subtree: true,
          attributes: true
        });
        window.__streetSettleState.observer = obs;
      }
      return Date.now() - window.__streetSettleState.lastChangeTime > settleMs;
    },
    [settleMs],
    { timeout }
  );

  // Clean up observer
  await page.evaluate(() => {
    if (window.__streetSettleState?.observer) {
      window.__streetSettleState.observer.disconnect();
      delete window.__streetSettleState;
    }
  });
}

/**
 * Position the editor camera rig.
 * @param {import('@playwright/test').Page} page
 * @param {{x: number, y: number, z: number}} position
 * @param {{x: number, y: number, z: number}} rotation
 */
async function setCameraPosition(page, position, rotation) {
  await page.evaluate(
    ({ pos, rot }) => {
      const camera = document.querySelector('a-scene').camera;
      if (!camera) return;
      camera.position.set(pos.x, pos.y, pos.z);
      camera.rotation.set(
        (rot.x * Math.PI) / 180,
        (rot.y * Math.PI) / 180,
        (rot.z * Math.PI) / 180
      );
      camera.updateMatrixWorld();
    },
    { pos: position, rot: rotation }
  );

  // Give renderer one frame to update
  await page.waitForTimeout(200);
}

/**
 * Capture and log Three.js renderer stats.
 * Returns the stats object for optional assertions.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{drawCalls: number, triangles: number, geometries: number, textures: number}>}
 */
async function logPerfMetrics(page) {
  const stats = await page.evaluate(() => {
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

  if (stats) {
    console.log(
      `[perf] Draw calls: ${stats.drawCalls}, Triangles: ${stats.triangles}, Geometries: ${stats.geometries}, Textures: ${stats.textures}`
    );
  }
  return stats;
}

module.exports = {
  waitForSceneLoaded,
  waitForStreetLoaded,
  setCameraPosition,
  logPerfMetrics
};
