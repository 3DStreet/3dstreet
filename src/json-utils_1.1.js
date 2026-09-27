import useStore from './store';
import { registerEntityBounds } from './model-bounds.js';
import { resolveSavedCameraStates } from './tested/scene-camera-pose';
import { createUniqueId } from './editor/lib/entity';
import { beginBatching, BATCHING_ENABLED } from './batch-models';
import { decodeCameraStateFromParam } from './editor/lib/cameraUtils';
import JSONCrush from 'jsoncrush';
import { migrateSceneJSON } from './scene/migrations/index.js';

/* global AFRAME, Node */
window.STREET = {};
var assetsUrl;
STREET.utils = {};
STREET.store = useStore;
function getSceneUuidFromURLHash() {
  const currentHash = window.location.hash;
  const match = currentHash.match(/#\/scenes\/([a-zA-Z0-9-]+)/);
  return match && match[1] ? match[1] : null;
}

function getCurrentSceneId() {
  // AFRAME.scenes[0] can be undefined when this runs before the scene attaches
  // or after it's torn down (e.g. the beforeunload handler on fast nav-away).
  const scene = AFRAME.scenes[0];
  let currentSceneId = scene?.getAttribute('metadata')?.sceneId;
  // console.log('currentSceneId from scene metadata', currentSceneId);
  const urlSceneId = getSceneUuidFromURLHash();
  // console.log('urlSceneId', urlSceneId);
  if (!currentSceneId) {
    // console.log('no currentSceneId from state');
    if (urlSceneId) {
      currentSceneId = urlSceneId;
      // console.log('setting currentSceneId to urlSceneId');
    }
  }
  return currentSceneId;
}
STREET.utils.getCurrentSceneId = getCurrentSceneId;

function getAuthorId() {
  // Same guard as getCurrentSceneId: AFRAME.scenes[0] can be undefined during
  // teardown/before attach, and this runs right after it in the beforeunload handler.
  return AFRAME.scenes[0]?.getAttribute('metadata')?.authorId;
}
STREET.utils.getAuthorId = getAuthorId;

/*
Takes one or more elements (from a DOM queryselector call)
and returns a Javascript object
*/
function convertDOMElToObject(entity) {
  const data = [];
  const environmentElement = document.querySelector('#environment');
  const referenceEntities = document.querySelector('#reference-layers');
  const sceneEntities = [entity, environmentElement, referenceEntities];

  // get assets url address
  assetsUrl = document.querySelector('street-assets').getAttribute('url');

  // First process the main entities
  for (const entry of sceneEntities) {
    const entityData = getElementData(entry);
    if (entityData) {
      // visible is never persisted for the User Layers root: a saved
      // visible:false blanks every scene load (stripped on load too, see
      // src/scene/migrations/index.js).
      if (entityData.id === 'street-container' && entityData.components) {
        delete entityData.components.visible;
      }
      data.push(entityData);
    }
  }

  const storeState = useStore.getState();

  return {
    title: storeState.sceneTitle,
    version: '0.5.6',
    data: data,
    memory: {}
  };
}
STREET.utils.convertDOMElToObject = convertDOMElToObject;

function getElementData(entity, options = {}) {
  if (
    !entity.isEntity ||
    (entity.classList.contains('autocreated') && !options.includeAutocreated) ||
    entity.hasAttribute('data-temporary-file')
  ) {
    // autocreated entities are procedural output (regenerated on load from
    // their generator component's config) and are skipped on save. Callers
    // that need the rendered output itself — like convert-to-shapes, which
    // bakes a managed street into plain entities — pass includeAutocreated.
    // data-temporary-file marks an in-flight or local-only asset upload
    // (a gltf-model/src pointing at a transient blob: URL). Skipping these
    // honors the design brief's "Local only — will not persist" guarantee.
    // The marker is removed by uploadAndPlaceAsset.js once the cloud URL
    // is wired up.
    return;
  }
  // node id's that should save without child nodes
  const skipChildrenNodes = ['environment', 'reference-layers'];
  const elementTree = getAttributes(entity, options);
  const children = entity.childNodes;
  if (children.length && !skipChildrenNodes.includes(elementTree.id)) {
    const savedChildren = [];
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const elementData = getElementData(child, options);
        if (elementData) savedChildren.push(elementData);
      }
    }
    if (savedChildren.length > 0) elementTree['children'] = savedChildren;
  }
  return elementTree;
}
STREET.utils.getElementData = getElementData;

function getAttributes(entity, options = {}) {
  const elemObj = {};

  const tagName = entity.tagName.toLowerCase();
  if (tagName !== 'a-entity') {
    elemObj['element'] = tagName;
  }

  if (entity.id) {
    elemObj['id'] = entity.id;
  }
  if (entity.className) {
    // convert from DOMTokenList to Array
    elemObj['class'] = Array.from(entity.classList);
  }
  if (entity.getAttribute('mixin')) {
    elemObj['mixin'] = entity.getAttribute('mixin');
  }
  if (entity.getAttribute('data-layer-name')) {
    elemObj['data-layer-name'] = entity.getAttribute('data-layer-name');
  }
  // Persistent cloud-asset identity. Other asset metadata (size, original
  // filename, etc.) lives in Firestore at users/{ownerUid}/assets/{assetId}
  // and is fetched on demand — only the identity pair is persisted in the scene.
  if (entity.getAttribute('data-asset-id')) {
    elemObj['data-asset-id'] = entity.getAttribute('data-asset-id');
  }
  if (entity.getAttribute('data-asset-owner-uid')) {
    elemObj['data-asset-owner-uid'] = entity.getAttribute(
      'data-asset-owner-uid'
    );
  }
  const entityComponents = entity.components;

  if (entityComponents) {
    // A street-segment's geometry and material are derived output: the
    // component regenerates both from its own data on every init/update, and
    // a pathed street's segments carry the `street-ribbon` primitive, which
    // only exists in builds that register it. Persisting them would freeze a
    // recomputed schema into the saved contract and make any bundle without
    // the ribbon geometry throw at load (A-Frame's geometry component throws
    // on an unknown primitive). Skip them on save: the segment rebuilds
    // either way. Convert-to-shapes is the one caller that wants the rendered
    // surface itself, and it already asks for that via includeAutocreated.
    const ownsMesh =
      Boolean(entityComponents['street-segment']) &&
      !options.includeAutocreated;
    const skipComponents = ownsMesh ? ['geometry', 'material'] : [];

    const geometryAttr = !ownsMesh && entity.getAttribute('geometry');
    if (geometryAttr && geometryAttr.primitive) {
      elemObj['primitive'] = geometryAttr.primitive;
    }

    elemObj['components'] = {};
    for (const componentName in entityComponents) {
      if (skipComponents.includes(componentName)) continue;
      const modifiedProperty = getModifiedProperty(entity, componentName);
      if (
        componentName === 'street-align' &&
        entityComponents['managed-street']
      ) {
        // Always explicit (#1863): alignment decides where a street sits
        // relative to its origin, and the length default has already changed
        // once. Writing every value keeps the file self-describing, and lets
        // migrateImplicitStreetAlign read "no length" as a pre-flip file.
        elemObj['components'][componentName] = toPropString({
          ...entityComponents[componentName].data
        });
        continue;
      }
      if (modifiedProperty !== null) {
        if (isEmptyObject(modifiedProperty)) {
          elemObj['components'][componentName] = '';
        } else {
          elemObj['components'][componentName] = toPropString(modifiedProperty);
        }
      }
    }
  }
  return elemObj;
}

function toPropString(propData) {
  if (
    typeof propData === 'string' ||
    typeof propData === 'number' ||
    typeof propData === 'boolean' ||
    Array.isArray(propData)
  ) {
    return propData.toString();
  }
  if (
    propData.isVector3 ||
    propData.isVector2 ||
    propData.isVector4 ||
    (propData.hasOwnProperty('x') && propData.hasOwnProperty('y')) // eslint-disable-line
  ) {
    return AFRAME.utils.coordinates.stringify(propData);
  }
  if (typeof propData === 'object') {
    return Object.entries(propData)
      .map(([key, value]) => {
        if (key === 'src') {
          // checking to ensure the object's src value is correctly stored
          if (value.src && !value.src.includes(assetsUrl)) {
            // asset came from external sources. So need to save it src value if it has
            return `${key}: ${value.src}`;
          } else if (value.id) {
            // asset came from 3dstreet. So it has id for link to it
            return `${key}: #${value.id}`;
          } else {
            return `${key}: ${value}`;
          }
        } else {
          return `${key}: ${toPropString(value)}`;
        }
      })
      .join('; ');
  }
}

function isSingleProperty(schema) {
  return AFRAME.schema.isSingleProperty(schema);
}

function isEmptyObject(object) {
  return (
    typeof object === 'object' &&
    !Array.isArray(object) &&
    object !== null &&
    Object.keys(object).length === 0
  );
}

// a list of component:value pairs to exclude from the JSON string.
// * - remove component with any value
// "propName": {"attribute": "..."} - remove attribute from component
const removeProps = {
  src: {},
  normalMap: {},
  'set-loader-from-hash': '*',
  'create-from-json': '*',
  street: { JSON: '*' }
};
function filterJSONstreet(streetJSON) {
  function removeValueCheck(removeVal, value) {
    if (AFRAME.utils.deepEqual(removeVal, value) || removeVal === '*') {
      return true;
    }
    return undefined;
  }

  const stringJSON = JSON.stringify(streetJSON, function replacer(key, value) {
    // Preserve memory data
    if (key === 'memory') {
      return value;
    }

    let compAttributes;
    for (var removeKey in removeProps) {
      // check for removing components
      if (key === removeKey) {
        compAttributes = AFRAME.utils.styleParser.parse(value);
        const removeVal = removeProps[removeKey];
        // check for deleting component's attribute
        if (!isEmptyObject(removeVal)) {
          // remove attribute in component
          const attrNames = Object.keys(removeVal);
          for (var attrName of attrNames) {
            const attrVal = removeVal[attrName];
            if (
              Object.prototype.hasOwnProperty.call(compAttributes, attrName) &&
              removeValueCheck(attrVal, compAttributes[attrName])
            ) {
              delete compAttributes[attrName];
            }
          }
        }
        // for other cases
        if (removeValueCheck(removeVal, value)) {
          return undefined;
        }
      }
    }

    return compAttributes || value;
  });
  return stringJSON;
}

STREET.utils.filterJSONstreet = filterJSONstreet;

/**
 * function from 3dstreet-editor/src/lib/entity.js
 * Gets the value for a component or component's property coming from mixins of
 * an element.
 *
 * If the component or component's property is not provided by mixins, the
 * functions will return `undefined`.
 *
 * @param {Component} component      Component to be found.
 * @param {string}    [propertyName] If provided, component's property to be
 *                                   found.
 * @param {Element}   source         Element owning the component.
 * @return                           The value of the component or components'
 *                                   property coming from mixins of the source.
 */
function getMixedValue(component, propertyName, source) {
  var value;
  // toReversed: `reverse()` would flip the entity's own mixin list in place
  // on every serialized component (mixin precedence alternating per call).
  var reversedMixins = source.mixinEls.toReversed();
  for (var i = 0; value === undefined && i < reversedMixins.length; i++) {
    var mixin = reversedMixins[i];
    /* eslint-disable-next-line no-prototype-builtins */
    if (mixin.attributes.hasOwnProperty(component.name)) {
      if (!propertyName) {
        value = mixin.getAttribute(component.name);
      } else {
        value = mixin.getAttribute(component.name)[propertyName];
      }
    }
  }
  return [component.name, value];
}

function shallowEqual(object1, object2) {
  if (
    (typeof object1 === 'string' && typeof object2 === 'string') ||
    (typeof object1 === 'number' && typeof object2 === 'number')
  ) {
    return object1 === object2;
  }
  const keys1 = Object.keys(object1);
  const keys2 = Object.keys(object2);

  if (keys1.length !== keys2.length) {
    return false;
  }

  for (const key of keys1) {
    if (object1[key] !== object2[key]) {
      return false;
    }
  }

  return true;
}

function getModifiedProperty(entity, componentName) {
  const data = AFRAME.utils.entity.getComponentProperty(entity, componentName);

  // if it is element's attribute
  if (!entity.components[componentName]) {
    if (!['id', 'class', 'tag', 'mixin'].includes(componentName)) {
      return data;
    } else {
      return null;
    }
  }

  const defaultData = entity.components[componentName].schema;

  // component's data, that exists in the element's mixin
  const [mixinCompName, mixinsData] = getMixedValue(
    entity.components[componentName],
    null,
    entity
  );

  const mixinSkipProps = [
    'src',
    'atlas-uvs',
    'gltf-model',
    'gltf-part',
    'shadow'
  ];
  if (mixinsData && mixinSkipProps.includes(mixinCompName)) {
    // skip properties, if they exists in element's mixin
    return null;
  }
  // If its single-property like position, rotation, etc
  if (isSingleProperty(defaultData)) {
    const defaultValue = defaultData.default;
    const currentValue = data;
    if (mixinsData && shallowEqual(mixinsData, currentValue)) {
      // property will be get from mixin
      return null;
    }

    if ((currentValue || defaultValue) && currentValue !== defaultValue) {
      return data;
    }
  }
  const diff = {};
  for (const key in data) {
    // in case the property value is not in schema, but needs to be saved
    const defaultValue = defaultData[key] ? defaultData[key].default : '';
    const currentValue = data[key];

    if (
      mixinsData &&
      mixinsData[key] &&
      shallowEqual(mixinsData[key], data[key])
    ) {
      continue;
    }
    // Some parameters could be null and '' like mergeTo
    if (
      (currentValue || defaultValue) &&
      !AFRAME.utils.deepEqual(currentValue, defaultValue)
    ) {
      diff[key] = data[key];
    }
  }
  return diff;
}

/**
 * Mint the scene's top-level entities from saved data. Expects migrated data:
 * every load path runs migrateSceneJSON (src/scene/migrations) first, so no
 * legacy-format handling lives here or in createEntityFromObj.
 */
function createEntities(entitiesData, parentEl) {
  const sceneElement = document.querySelector('a-scene');
  const removeEntities = ['environment', 'reference-layers'];
  // Arm batching before any entity is minted below; batchModels runs on the "newScene"
  // event emitted after this createEntities pass. See beginBatching for the state model.
  if (BATCHING_ENABLED) {
    beginBatching(sceneElement);
  }
  for (const entityData of entitiesData) {
    const sceneChildElement = document.getElementById(entityData.id);
    if (sceneChildElement) {
      if (removeEntities.includes(entityData.id)) {
        // remove existing elements from scene
        sceneChildElement.remove();
      } else {
        // or save link to the element
        entityData.entityElement = sceneChildElement;
      }
    }

    createEntityFromObj(entityData, sceneElement);
  }
}

STREET.utils.createEntities = createEntities;

/*
Add a new entity with a list of components and children (if exists)
 * @param {object} entityData Entity definition to add:
 *   {
 *    element: String ('a-entity' for Example),
 *    id: String,
 *    class: {Array} of element classes,
 *    mixin: String,
 *    children: {Array} of entities,
 *    components: {geometry: 'primitive:box', ...}
 *   }
 * @param {Element} parentEl the parent element to which the Entity will be added
 * @return {Element} Entity created
*/
function createEntityFromObj(entityData, parentEl, beforeEl) {
  // A saved cameraRig entry (legacy scenes stored one, typically carrying
  // only the now-stripped viewer-mode/controls) must never spawn a second
  // element: index.html already ships a static #cameraRig, and a duplicate id
  // would make querySelector('#cameraRig') — used by mode-manager for the
  // drive/WebXR camera handoff — bind to the wrong node. Reuse the existing
  // rig, applying any surviving components onto it rather than creating a
  // sibling.
  if (entityData.id === 'cameraRig') {
    const existingRig = document.querySelector('#cameraRig');
    if (existingRig) {
      if (entityData.components) {
        for (const [name, value] of Object.entries(entityData.components)) {
          existingRig.setAttribute(name, value);
        }
      }
      return existingRig;
    }
  }

  const tagName = entityData.element || 'a-entity';
  const entity = entityData.entityElement || document.createElement(tagName);

  if (!entity.parentEl && parentEl) {
    if (beforeEl) {
      parentEl.insertBefore(entity, beforeEl);
    } else {
      parentEl.appendChild(entity);
    }
  }

  if (entityData['primitive']) {
    // define a primitive in advance to apply other primitive-specific geometry properties
    entity.setAttribute('geometry', 'primitive', entityData['primitive']);
  }

  // load this attributes in advance in right order to correctly apply other specific components
  for (const attr of ['geometry', 'material']) {
    if (entityData.components?.[attr]) {
      entity.setAttribute(attr, entityData.components[attr]);
      delete entityData.components[attr];
    }
  }

  if (entityData.id) {
    entity.setAttribute('id', entityData.id);
  }

  if (entityData.class) {
    entity.classList.add(...entityData.class);
  }

  if (entityData['data-layer-name']) {
    entity.setAttribute('data-layer-name', entityData['data-layer-name']);
  }

  if (entityData['data-asset-id']) {
    entity.setAttribute('data-asset-id', entityData['data-asset-id']);
  }
  if (entityData['data-asset-owner-uid']) {
    entity.setAttribute(
      'data-asset-owner-uid',
      entityData['data-asset-owner-uid']
    );
  }

  for (const attr in entityData.components) {
    entity.setAttribute(attr, entityData.components[attr]);
  }

  if (entityData.mixin) {
    entity.setAttribute('mixin', entityData.mixin);
  }

  if (entityData.children) {
    for (const childEntityData of entityData.children) {
      createEntityFromObj(childEntityData, entity);
    }
  }

  return entity;
}

STREET.utils.createEntityFromObj = createEntityFromObj;

/*
  Code imported from index.html, mix of save load utils and some ui functions
*/

AFRAME.registerComponent('metadata', {
  schema: {
    sceneId: { default: '' },
    authorId: { default: '' }
  },
  init: function () {}
});

AFRAME.registerComponent('set-loader-from-hash', {
  schema: {
    defaultURL: { type: 'string' }
  },
  init: function () {
    this.runOnce = false;
  },
  play: function () {
    // using play instead of init method so scene loads before setting its metadata component
    if (!this.runOnce) {
      this.runOnce = true;
      // get hash from window
      let streetURL = window.location.hash.substring(1);
      if (!streetURL) {
        return;
      }
      // Camera vantage deep link: #/scenes/UUID?camera=px,py,pz,rx,ry,rz,fov
      // (e.g. snapshot gallery "open scene at capture pose", #1605). Strip
      // the param before the path is used to build the fetch URL; the decoded
      // pose overrides the scene's default snapshot camera in fetchJSON.
      this.urlCameraState = null;
      if (streetURL.startsWith('/scenes/') && streetURL.includes('?')) {
        const [scenePath, queryString] = streetURL.split('?');
        this.urlCameraState = decodeCameraStateFromParam(
          new URLSearchParams(queryString).get('camera')
        );
        streetURL = scenePath;
      }
      // `#mcp` (with optional `=PORT`) is the MCP relay auto-pair URL —
      // handled by AIChatPanel, not the scene loader. Without this bail,
      // the dispatcher would fall through to fetchJSON('mcp.json') below.
      if (/^mcp(=\d+)?$/.test(streetURL)) {
        return;
      }
      // `#asset:OWNER/ID` is an asset deep-link (e.g. from a "your splat is
      // ready" email), opened by AssetDeepLinkModal in React — NOT a scene to
      // load. Without this bail it falls through to the generic
      // fetchJSON('asset:….json') below and errors with "Could not fetch scene"
      // / "Could not connect to server."
      if (streetURL.startsWith('asset:')) {
        return;
      }
      if (streetURL.startsWith('crushed-3dstreet-json:')) {
        const fragment = window.location.hash;
        const prefix = '#crushed-3dstreet-json:';
        let jsonStr = {};
        try {
          const substring = fragment.substring(prefix.length);
          jsonStr = JSONCrush.uncrush(decodeURIComponent(substring));
          let jsonScene = JSON.parse(jsonStr);
          console.log(
            '[set-loader-from-hash]',
            'crushed-3dstreet-json => jsonScene:',
            jsonScene
          );
          // parse the json string into a scene
          STREET.utils.newScene(true, false);
          STREET.utils.createElementsFromJSON(jsonScene, false);
        } catch (err) {
          console.error('Error parsing fragment:', err);
        }
        return;
      }
      if (streetURL.startsWith('managed-street-json:')) {
        // url.com/page#managed-street-json:{"data":"value"}
        const fragment = window.location.hash;
        const prefix = '#managed-street-json:';

        let jsonStr = {};
        try {
          const encodedJsonStr = fragment.substring(prefix.length);
          jsonStr = decodeURIComponent(encodedJsonStr);
        } catch (err) {
          console.error('Error parsing fragment:', err);
        }
        const definition = {
          components: {
            'managed-street': {
              sourceType: 'json-blob',
              sourceValue: jsonStr,
              synchronize: true
            }
          }
        };
        // use set timeout
        setTimeout(() => {
          AFRAME.INSPECTOR.execute('entitycreate', definition);
          // street notify
          STREET.notify.successMessage('Loading Managed Street JSON from URL');
        }, 1000);
        return;
      }
      if (
        process.env.NODE_ENV === 'development' &&
        streetURL.startsWith('fixture:')
      ) {
        // Dev/test convenience: load a local parity fixture by slug through the
        // managed-street importer, e.g. #fixture:protected-bikeway-parking-couplet
        // The dev server serves test/parity/fixtures/*.streetmix.json from root.
        // Gated to development builds — these fixtures are not deployed to prod.
        const slug = streetURL.substring('fixture:'.length);
        const fixtureURL = `${window.location.origin}/test/parity/fixtures/${slug}.streetmix.json`;
        const definition = {
          id: createUniqueId(),
          components: {
            'managed-street': {
              sourceType: 'streetmix-url',
              sourceValue: fixtureURL,
              synchronize: true
            }
          }
        };
        setTimeout(() => {
          AFRAME.INSPECTOR.execute('entitycreate', definition);
          STREET.notify.successMessage('Loading parity fixture: ' + slug);
        }, 1000);
        return;
      }
      if (streetURL.startsWith('geojson:')) {
        // url.com/page#geojson:{"type":"FeatureCollection","features":[...]}
        const fragment = window.location.hash;
        const prefix = '#geojson:';

        let geoJsonStr = '';
        let geoJsonData = null;
        try {
          const encodedGeoJsonStr = fragment.substring(prefix.length);
          geoJsonStr = decodeURIComponent(encodedGeoJsonStr);
          geoJsonData = JSON.parse(geoJsonStr);
          console.log(
            '[set-loader-from-hash] Loading GeoJSON from URL hash:',
            geoJsonData
          );
        } catch (err) {
          console.error('Error parsing GeoJSON fragment:', err);
          STREET.notify.errorMessage(
            'Error parsing GeoJSON from URL: Invalid JSON format'
          );
          return;
        }

        // Validate GeoJSON structure (similar to AppMenu validation)
        if (
          !geoJsonData.features ||
          !Array.isArray(geoJsonData.features) ||
          geoJsonData.features.length === 0
        ) {
          STREET.notify.errorMessage(
            'Invalid GeoJSON: No valid features found'
          );
          return;
        }

        // Filter for valid polygon features (same logic as AppMenu)
        const buildingFeatures = geoJsonData.features.filter((feature) => {
          if (!feature.properties) return false;
          if (
            !feature.geometry ||
            (feature.geometry.type !== 'Polygon' &&
              feature.geometry.type !== 'MultiPolygon')
          ) {
            return false;
          }
          return true;
        });

        if (buildingFeatures.length === 0) {
          STREET.notify.errorMessage(
            'No valid polygon features found in GeoJSON'
          );
          return;
        }

        // Create cleaned GeoJSON with only valid features
        const cleanedGeoJSON = {
          ...geoJsonData,
          features: buildingFeatures
        };

        // Create GeoJSON entity (same logic as AppMenu)
        setTimeout(() => {
          let osmEntity = document.querySelector('[geojson]');
          if (!osmEntity) {
            osmEntity = document.createElement('a-entity');
            osmEntity.setAttribute('id', 'imported-geojson');
            osmEntity.setAttribute(
              'data-layer-name',
              'Imported GeoJSON Buildings'
            );
            // Rotate -90 degrees on Y axis to align with 3DStreet coordinate system (X+ north)
            osmEntity.setAttribute('rotation', '0 -90 0');
            // Add to user layers (street-container)
            document.querySelector('#street-container').appendChild(osmEntity);
          }

          // Set the geojson component with direct data
          osmEntity.setAttribute('geojson', {
            data: JSON.stringify(cleanedGeoJSON),
            lat: 0,
            lon: 0
          });

          STREET.notify.successMessage(
            `GeoJSON loaded from URL: ${buildingFeatures.length} polygon features.`
          );

          // Wait for GeoJSON component to calculate center, then open Geo Modal
          setTimeout(async () => {
            const geoJsonComponent = osmEntity.components.geojson;
            if (
              geoJsonComponent &&
              geoJsonComponent.data.lat !== 0 &&
              geoJsonComponent.data.lon !== 0
            ) {
              // Import setGeojsonImportData and setModal from store
              const { setGeojsonImportData, setModal } = useStore.getState();

              // Store coordinates for Geo Modal
              setGeojsonImportData({
                lat: geoJsonComponent.data.lat,
                lon: geoJsonComponent.data.lon,
                source: 'geojson-hash'
              });

              // Clear the hash to avoid "URI Too Long" errors in auth
              window.location.hash = '';

              // Open Geo Modal
              setModal('geo');
            }
          }, 200);
        }, 1000);
        return;
      }
      if (streetURL.includes('//streetmix.net')) {
        console.log(
          '[set-loader-from-hash]',
          'Create new street with Streetmix URL',
          streetURL
        );

        const definition = {
          id: createUniqueId(),
          components: {
            'streetmix-loader': {
              streetmixStreetURL: streetURL,
              synchronize: true,
              // Tag as the URL-fragment auto-import path so the loader fires
              // streetmix_import_completed/_failed with source 'url_fragment'
              // (#1874) — the path most Streetmix users actually arrive on.
              importSource: 'url_fragment'
            }
          }
        };

        setTimeout(() => {
          AFRAME.INSPECTOR.execute('entitycreate', definition);
          setTimeout(() => {
            console.log('trigger saveScene from street component');
            useStore.getState().saveScene(true);
          }, 3000);
        }, 1000);
      } else if (streetURL.includes('streetplan.net/')) {
        // instead, load streetplan via managed street the new addlayerpanel
        console.log(
          '[set-loader-from-hash]',
          'Create new Managed Street with StreetPlan URL',
          streetURL
        );
        if (streetURL && streetURL !== '') {
          const definition = {
            id: createUniqueId(),
            components: {
              'managed-street': {
                sourceType: 'streetplan-url',
                sourceValue: streetURL,
                showVehicles: true,
                showStriping: true,
                synchronize: true
              }
            }
          };

          setTimeout(() => {
            AFRAME.INSPECTOR.execute('entitycreate', definition);
            setTimeout(() => {
              console.log('trigger saveScene from street component');
              useStore.getState().saveScene(true);
            }, 3000);
          }, 1000);
        }
      } else if (
        !streetURL.includes('payment') &&
        !streetURL.includes('profile') &&
        !streetURL.includes('modal') &&
        !streetURL.startsWith('admin/')
      ) {
        useStore.getState().startLoadingScene('Loading scene...');
        // try to load JSON file from remote resource
        console.log(
          '[set-loader-from-hash]',
          'Load 3DStreet scene with fetchJSON from',
          streetURL
        );
        const jsonURL = streetURL.endsWith('.json')
          ? streetURL
          : `${streetURL}.json`;
        this.fetchJSON(jsonURL);
      }
      // else {
      //   console.log('[set-loader-from-hash]','Using default URL', this.data.defaultURL)
      //   this.el.setAttribute('streetmix-loader', 'streetmixStreetURL', this.data.defaultURL);
      // }
    }
  },
  fetchJSON: function (requestURL) {
    // Captured for the onload closure (`this` is the XHR in there).
    const urlCameraState = this.urlCameraState || null;
    const request = new XMLHttpRequest();

    // Prepend the base URL to the requestURL
    if (window.location.href.includes('localhost')) {
      const baseURL = 'https://dev-3dstreet.web.app';
      requestURL = baseURL + requestURL;
    }

    request.open('GET', requestURL, true);
    request.onload = function () {
      if (this.status >= 200 && this.status < 400) {
        // Connection success
        // Parse the JSON response. Wrapped so a malformed body (or any failure
        // building the scene) surfaces the error modal explicitly — otherwise
        // it falls through to the optimistic loading-timeout dismiss, which
        // would silently treat a real parse/build failure as success.
        try {
          const responseData = JSON.parse(this.response);
          console.log(
            '[set-loader-from-hash] Full response data:',
            responseData
          );

          // Extract memory data if it exists
          const memoryData = responseData.memory;

          // Log the memory data for debugging
          if (memoryData) {
            console.log(
              '[set-loader-from-hash] Memory data found:',
              memoryData
            );
          } else {
            console.log(
              '[set-loader-from-hash] No memory data found in the JSON'
            );
          }

          // Create a clean JSON object without the set-loader-from-hash component
          const jsonData = JSON.parse(
            JSON.stringify(responseData),
            (key, value) => (key === 'set-loader-from-hash' ? undefined : value)
          );

          console.log(
            '[set-loader-from-hash]',
            '200 response received and JSON parsed, now createElementsFromJSON'
          );

          // Ensure memory data is preserved
          if (memoryData && !jsonData.memory) {
            jsonData.memory = memoryData;
            console.log(
              '[set-loader-from-hash] Restored memory data to jsonData'
            );
          }

          // A ?camera= deep link beats the scene's own start pose; it rides
          // along to createElementsFromJSON, which resolves the load pose.
          AFRAME.scenes[0].pendingSceneLoadCamera = {
            urlCameraState: urlCameraState || null
          };
          useStore.getState().updateLoadingProgress(50, 'Creating scene...');
          STREET.utils.createElementsFromJSON(jsonData, false);
          const sceneId = getUUIDFromPath(requestURL);
          if (sceneId) {
            console.log('sceneId from fetchJSON from url hash loader', sceneId);
            AFRAME.scenes[0].setAttribute('metadata', 'sceneId', sceneId);
          }
          AFRAME.scenes[0].setAttribute(
            'metadata',
            'authorId',
            jsonData.author
          );
        } catch (err) {
          console.error(
            '[set-loader-from-hash] Error parsing/building scene:',
            err
          );
          useStore.getState().errorLoadingScene('Could not read scene data.');
          STREET.notify.errorMessage(
            'Error trying to load scene: invalid scene data.'
          );
        }
      } else if (this.status === 404) {
        console.error(
          '[set-loader-from-hash] Error trying to load scene: Resource not found.'
        );
        useStore.getState().errorLoadingScene('Scene not found.');
        STREET.notify.errorMessage(
          'Error trying to load scene: Resource not found.'
        );
      }
    };
    request.onerror = function () {
      // There was a connection error of some sort
      console.error(
        'Loading Error: There was a connection error during JSON loading'
      );
      useStore.getState().errorLoadingScene('Could not connect to server.');
      STREET.notify.errorMessage('Could not fetch scene.');
    };
    request.send();
  }
});

function getUUIDFromPath(path) {
  // UUID regex pattern: [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}
  const uuidPattern =
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

  const match = path.match(uuidPattern);
  if (match) {
    return match[0];
  }

  return null; // return null or whatever default value you prefer if no UUID found
}

// JSON loading starts here
function getValidJSON(stringJSON) {
  // Preserve newlines, etc. - use valid JSON
  // Remove non-printable and other non-valid JSON characters
  return stringJSON
    .replace(/'/g, '')
    .replace(/\n/g, '')
    .replace(/[\u0000-\u0019]+/g, ''); // eslint-disable-line no-control-regex
}

function createElementsFromJSON(streetJSON, clearUrlHash) {
  let streetObject = {};
  if (typeof streetJSON === 'string') {
    const validJSONString = getValidJSON(streetJSON);
    streetObject = JSON.parse(validJSONString);
  } else if (typeof streetJSON === 'object') {
    streetObject = streetJSON;
  }

  // clear scene data, create new blank scene.
  // clearMetadata = true, clearUrlHash = true
  STREET.utils.newScene(true, clearUrlHash);

  const sceneTitle = streetObject.title;
  if (sceneTitle) {
    console.log('sceneTitle from createElementsFromJSON', sceneTitle);
    useStore.getState().setSceneTitle(sceneTitle);
  }

  const streetContainerEl = document.getElementById('street-container');

  // Start pose: the Starting View entity (migrated here from the legacy
  // default-snapshot pose if needed) wins; the autosaved editor pose is
  // the fallback; a ?camera= deep link (parked by the hash loader) beats
  // both. The viewport's newScene handler picks (scene-camera-pose.js)
  // once the entities exist in the DOM.
  const { viewerStartMigrated } = migrateSceneJSON(streetObject);
  useStore.setState({ viewerStartMigrated });
  createEntities(streetObject.data, streetContainerEl);
  resolveCloudAssetUrls(streetContainerEl);
  useStore.getState().updateLoadingProgress(90, 'Finalizing...');
  STREET.notify.successMessage('Scene loaded');

  const pending = AFRAME.scenes[0].pendingSceneLoadCamera || {};
  delete AFRAME.scenes[0].pendingSceneLoadCamera;
  emitNewScene({
    editorCameraState: resolveSavedCameraStates(streetObject.memory)
      .editorCameraState,
    urlCameraState: pending.urlCameraState || null
  });
}

STREET.utils.createElementsFromJSON = createElementsFromJSON;

/**
 * Emit `newScene` with the saved camera poses the viewport's load fly-in
 * picks from (src/tested/scene-camera-pose.js). The detail is also parked
 * on the scene element for a viewport that initializes after this event
 * (a fast cloud response on a slow editor boot); it replays the fly-in
 * once on init and clears it. Every scene-load route emits through here.
 */
function emitNewScene(detail = {}) {
  AFRAME.scenes[0].lastNewSceneDetail = { ...detail };
  AFRAME.scenes[0].emit('newScene', { ...detail });
}
STREET.utils.emitNewScene = emitNewScene;

/**
 * Re-resolve cloud-asset URLs from the Firestore asset doc after a scene load.
 *
 * A model's URL is baked into the saved scene at placement time, but what the
 * asset serves changes afterwards: a splat's streaming .rad variant is produced
 * async in the cloud AFTER upload, and a GLB's optimized variant changes every
 * time the owner presses Reoptimize or Remove optimized. Here every entity
 * with an asset identity (data-asset-id + data-asset-owner-uid) is repointed
 * at the doc's served URL (optimizedSourceUrl ?? storageUrl), so existing
 * scenes pick up the current variant instead of the one saved months ago.
 * Assets are public-read so anonymous viewers can fetch too. A real swap
 * reloads the model (desired); an unchanged URL is a no-op.
 *
 * Fire-and-forget: deliberately not awaited so it never blocks entity creation.
 */
async function resolveCloudAssetUrls(containerEl) {
  const root = containerEl || document;
  const els = root.querySelectorAll(
    '[splat][data-asset-id][data-asset-owner-uid], ' +
      '[gltf-model][data-asset-id][data-asset-owner-uid]'
  );
  if (!els.length) return;

  const { assetsService, getServedUrl } = await import('@shared/assets');
  for (const el of els) {
    const assetId = el.getAttribute('data-asset-id');
    const ownerUid = el.getAttribute('data-asset-owner-uid');
    try {
      const asset = await assetsService.getAsset(assetId, ownerUid);
      // getAsset returns soft-deleted docs (deleted:true) whose Storage object
      // may already be GC-purged. Re-resolving to that now-404 URL would clobber
      // a src the entity could otherwise still render from cache, so skip it.
      if (asset?.deleted) continue;
      // Bounds stored by the optimizer at upload (or backfilled by the owner)
      // let model-placeholder draw a ghost box before the GLB arrives (#2009).
      // Runtime registry only: bounds never enter the scene JSON.
      if (asset?.bounds && el.hasAttribute('gltf-model')) {
        registerEntityBounds(el, asset.bounds);
      }
      const servedUrl = getServedUrl(asset);
      if (!servedUrl) continue;
      if (el.hasAttribute('splat')) {
        const currentSrc = el.getAttribute('splat')?.src;
        if (servedUrl !== currentSrc) {
          console.log(
            `[splat] re-resolved asset ${assetId} to served URL:`,
            servedUrl
          );
          el.setAttribute('splat', 'src', servedUrl);
        }
      } else {
        // The `model` property type parses `url(...)` away, but be tolerant
        // of a raw string in case the attribute was set before init.
        const currentSrc = String(el.getAttribute('gltf-model') || '').replace(
          /^url\(|\)$/g,
          ''
        );
        if (servedUrl !== currentSrc) {
          console.log(
            `[gltf-model] re-resolved asset ${assetId} to served URL:`,
            servedUrl
          );
          el.setAttribute('gltf-model', `url(${servedUrl})`);
        }
      }
    } catch (err) {
      console.warn(`[asset] could not re-resolve asset ${assetId}:`, err);
    }
  }
}
STREET.utils.resolveCloudAssetUrls = resolveCloudAssetUrls;
