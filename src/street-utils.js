/* global AFRAME */
/* 3DStreet utils functions */

/*
 * create element with provided Id, clear old element data and replace with new HTML string
 */
function checkOrCreateEntity(elementId, parentEl, layerName = null) {
  let newElement = parentEl.querySelector(`#${elementId}`);
  if (!newElement) {
    // create element
    newElement = document.createElement('a-entity');
    newElement.id = elementId;
    parentEl.appendChild(newElement);
  } else {
    // or remove all childs
    while (newElement.firstChild) {
      newElement.removeChild(newElement.lastChild);
    }
  }
  if (layerName) {
    newElement.setAttribute('data-layer-name', layerName);
  }
  return newElement;
}

/*
 * clear old scene elements and data. Create blank scene
 */
function newScene(
  clearMetaData = true,
  clearUrlHash = true,
  addDefaultStreet = true
) {
  const environmentEl = checkOrCreateEntity(
    'environment',
    AFRAME.scenes[0],
    'Environment'
  );
  environmentEl.removeAttribute('street-environment');
  environmentEl.setAttribute('street-environment', 'preset', 'day');
  const geoLayer = checkOrCreateEntity(
    'reference-layers',
    AFRAME.scenes[0],
    'Geospatial Layers'
  );
  geoLayer.removeAttribute('street-geo');
  const streetContainerEl = checkOrCreateEntity(
    'street-container',
    AFRAME.scenes[0],
    'User Layers'
  );

  if (addDefaultStreet) {
    // create default-street element
    const defaultStreetEl = checkOrCreateEntity(
      'default-street',
      streetContainerEl
    );
    // clear data from previous scene
    defaultStreetEl.removeAttribute('data-layer-name');
    defaultStreetEl.removeAttribute('street');
    defaultStreetEl.removeAttribute('streetmix-loader');
  }

  // clear metadata
  if (clearMetaData) {
    AFRAME.scenes[0].setAttribute('metadata', 'sceneId', '');
    AFRAME.scenes[0].setAttribute('metadata', 'sceneTitle', '');
  }

  // clear url hash
  if (clearUrlHash) {
    setTimeout(function () {
      window.location.hash = '';
    });
  }

  AFRAME.scenes[0].emit('newScene');
}

STREET.utils.newScene = newScene;

function getVehicleEntities() {
  return getEntitiesByCategories([
    'vehicles',
    'vehicles-rigged',
    'vehicles-transit',
    'cyclists'
  ]);
}

module.exports.getVehicleEntities = getVehicleEntities;

function getStripingEntities() {
  return getEntitiesByCategories(['lane-separator']);
}

module.exports.getStripingEntities = getStripingEntities;

function getEntitiesByCategories(categoriesArray) {
  // get entity Nodes by array of their mixin categories
  const queryForCategoriesMixins = categoriesArray
    .map((categoryName) => `a-mixin[category="${categoryName}"]`)
    .join(',');
  const allCategoriesMixins = document.querySelectorAll(
    queryForCategoriesMixins
  );
  const categoriesMixinIds = Array.from(allCategoriesMixins).map((el) => el.id);
  const queryForAllElements = categoriesMixinIds
    .map((mixinId) => `a-entity[mixin~="${mixinId}"]`)
    .join(',');
  return document.querySelectorAll(queryForAllElements);
}
