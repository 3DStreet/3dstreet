/**
 * Test helpers for A-Frame component tests, adapted from A-Frame's
 * tests/helpers.js: https://github.com/aframevr/aframe/blob/master/tests/helpers.js
 */

/**
 * Create a scene, create an entity, add entity to scene, add scene to document.
 * @param {object} [opts]
 * @param {HTMLElement[]} [opts.assets] - elements appended to <a-assets>.
 * @returns {Element} the created (not-yet-loaded) entity.
 */
export function entityFactory(opts = {}) {
  const scene = document.createElement('a-scene');
  const assets = document.createElement('a-assets');
  const entity = document.createElement('a-entity');

  scene.appendChild(assets);
  scene.appendChild(entity);

  if (opts.assets) {
    opts.assets.forEach((asset) => assets.appendChild(asset));
  }

  document.body.appendChild(scene);
  return entity;
}

/**
 * Create an entity within a scene and resolve once the scene has loaded.
 * @param {object} [opts] - forwarded to entityFactory.
 * @returns {Promise<Element>} the loaded entity.
 */
export function elFactory(opts = {}) {
  const entity = entityFactory(opts);
  return new Promise((resolve) => {
    if (entity.sceneEl) {
      if (entity.sceneEl.hasLoaded) {
        return resolve(entity);
      }
      entity.sceneEl.addEventListener('loaded', () => resolve(entity));
      return;
    }
    entity.addEventListener('nodeready', () => {
      if (entity.sceneEl.hasLoaded) {
        return resolve(entity);
      }
      entity.sceneEl.addEventListener('loaded', () => resolve(entity));
    });
  });
}
