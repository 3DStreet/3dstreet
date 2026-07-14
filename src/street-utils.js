/* global AFRAME */
/* 3DStreet utils functions */
import useStore from '@/store.js';

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
export function newScene(clearMetaData = true, clearUrlHash = true) {
  AFRAME.INSPECTOR?.selectEntity(null);
  let environmentEl = document.getElementById('environment');
  if (environmentEl) environmentEl.removeAttribute('street-environment');
  environmentEl = checkOrCreateEntity(
    'environment',
    AFRAME.scenes[0],
    'Environment'
  );
  environmentEl.setAttribute('street-environment', '');
  environmentEl.setAttribute('data-no-transform', '');

  let geoLayer = document.getElementById('reference-layers');
  if (geoLayer) geoLayer.removeAttribute('street-geo');
  geoLayer = checkOrCreateEntity(
    'reference-layers',
    AFRAME.scenes[0],
    'Geospatial Layers'
  );
  geoLayer.setAttribute('data-no-transform', '');

  const streetContainer = checkOrCreateEntity(
    'street-container',
    AFRAME.scenes[0],
    'User Layers'
  );
  // Heal a hidden User Layers root (e.g. stamped by a legacy scene saved
  // with visible:false before load-side stripping existed): the singleton
  // element is reused across scene loads, so a stale false would blank
  // every scene loaded for the rest of the session.
  if (streetContainer.object3D && !streetContainer.object3D.visible) {
    streetContainer.setAttribute('visible', true);
  }

  // clear metadata
  if (clearMetaData) {
    useStore.getState().newScene();
    AFRAME.scenes[0].setAttribute('metadata', 'sceneId', '');
    AFRAME.scenes[0].setAttribute('metadata', 'authorId', '');
  }

  // clear url hash
  if (clearUrlHash) {
    setTimeout(function () {
      window.location.hash = '';
    });
  }
}

// Moved to street-entity-utils.js (store-free); re-exported here for callers
// that import them from street-utils.
export {
  getVehicleEntities,
  getStripingEntities
} from './street-entity-utils.js';
