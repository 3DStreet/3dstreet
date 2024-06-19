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
    defaultStreetEl.setAttribute('set-loader-from-hash', '');
    defaultStreetEl.setAttribute('street', '');
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
}

STREET.utils.newScene = newScene;
