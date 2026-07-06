/* Entity-category query helpers, split out of street-utils.js so modules that
 * only need them (e.g. managed-street.js, and its browser-mode component
 * tests) don't transitively import the Zustand store and its Firebase/PostHog
 * dependencies. street-utils.js re-exports these for existing callers. */

export function getVehicleEntities(root = document) {
  return getEntitiesByCategories(
    ['vehicles', 'vehicles-rigged', 'vehicles-transit', 'cyclists'],
    root
  );
}

export function getStripingEntities(root = document) {
  return getEntitiesByCategories(['lane-separator'], root);
}

function getEntitiesByCategories(categoriesArray, root = document) {
  // get entity Nodes by array of their mixin categories, scoped to `root`
  // (mixin definitions always live at the document level via street-assets)
  const queryForCategoriesMixins = categoriesArray
    .map((categoryName) => `a-mixin[category="${categoryName}"]`)
    .join(',');
  if (!queryForCategoriesMixins) return [];
  const allCategoriesMixins = document.querySelectorAll(
    queryForCategoriesMixins
  );
  const categoriesMixinIds = Array.from(allCategoriesMixins).map((el) => el.id);
  const queryForAllElements = categoriesMixinIds
    .map((mixinId) => `a-entity[mixin~="${mixinId}"]`)
    .join(',');
  if (!queryForAllElements) return [];
  return root.querySelectorAll(queryForAllElements);
}
