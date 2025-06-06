import useStore from './store';
import { createUniqueId } from './editor/lib/entity';
import JSONCrush from 'jsoncrush';

/* global AFRAME, Node */
window.STREET = {};
var assetsUrl;
STREET.utils = {};
function getSceneUuidFromURLHash() {
  const currentHash = window.location.hash;
  const match = currentHash.match(/#\/scenes\/([a-zA-Z0-9-]+)/);
  return match && match[1] ? match[1] : null;
}

function getCurrentSceneId() {
  let currentSceneId = AFRAME.scenes[0].getAttribute('metadata').sceneId;
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
  const authorId = AFRAME.scenes[0].getAttribute('metadata').authorId;
  return authorId;
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
      data.push(entityData);
    }
  }

  // Save viewer-mode component data separately
  const cameraRig = document.querySelector('#cameraRig');
  if (cameraRig && cameraRig.hasAttribute('viewer-mode')) {
    // Create a minimal entity with just the viewer-mode component
    const viewerModeData = {
      id: 'cameraRig',
      components: {}
    };

    // Get the viewer-mode component data
    const viewerModeComponent = cameraRig.getAttribute('viewer-mode');
    if (viewerModeComponent) {
      viewerModeData.components['viewer-mode'] =
        toPropString(viewerModeComponent);
      data.push(viewerModeData);
    }
  }

  // Get project info from Zustand store
  const storeState = useStore.getState();
  const memory = {
    projectInfo: storeState.projectInfo
  };

  return {
    title: storeState.sceneTitle,
    version: '0.5.6',
    data: data,
    memory: memory
  };
}
STREET.utils.convertDOMElToObject = convertDOMElToObject;

function getElementData(entity) {
  if (!entity.isEntity || entity.classList.contains('autocreated')) {
    return;
  }
  // node id's that should save without child nodes
  const skipChildrenNodes = ['environment', 'reference-layers'];
  const elementTree = getAttributes(entity);
  const children = entity.childNodes;
  if (children.length && !skipChildrenNodes.includes(elementTree.id)) {
    const savedChildren = [];
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const elementData = getElementData(child);
        if (elementData) savedChildren.push(elementData);
      }
    }
    if (savedChildren.length > 0) elementTree['children'] = savedChildren;
  }
  return elementTree;
}
STREET.utils.getElementData = getElementData;

function getAttributes(entity) {
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
  const entityComponents = entity.components;

  if (entityComponents) {
    const geometryAttr = entity.getAttribute('geometry');
    if (geometryAttr && geometryAttr.primitive) {
      elemObj['primitive'] = geometryAttr.primitive;
    }

    elemObj['components'] = {};
    for (const componentName in entityComponents) {
      const modifiedProperty = getModifiedProperty(entity, componentName);
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
// a list of component_name:new_component_name pairs to rename in JSON string
const renameProps = {};

function filterJSONstreet(streetJSON) {
  function removeValueCheck(removeVal, value) {
    if (AFRAME.utils.deepEqual(removeVal, value) || removeVal === '*') {
      return true;
    }
    return undefined;
  }

  let stringJSON = JSON.stringify(streetJSON, function replacer(key, value) {
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
  // rename components
  for (var renameKey in renameProps) {
    const reKey = new RegExp(`"${renameKey}":`, 'g');
    stringJSON = stringJSON.replaceAll(reKey, `"${renameProps[renameKey]}":`);
  }
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
  var reversedMixins = source.mixinEls.reverse();
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

function createEntities(entitiesData, parentEl) {
  const sceneElement = document.querySelector('a-scene');
  const removeEntities = ['environment', 'reference-layers'];
  for (const entityData of entitiesData) {
    if (
      entityData.id === 'street-container' &&
      entityData.children &&
      entityData.children[0].id === 'default-street' &&
      entityData.children[0].components['set-loader-from-hash']
    ) {
      delete entityData.children[0].components['set-loader-from-hash'];
    }

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
function createEntityFromObj(entityData, parentEl) {
  // Special handling for cameraRig with viewer-mode component
  if (
    entityData.id === 'cameraRig' &&
    entityData.components &&
    entityData.components['viewer-mode']
  ) {
    // Get the existing cameraRig entity
    const existingCameraRig = document.querySelector('#cameraRig');
    if (existingCameraRig) {
      // Apply the viewer-mode component to the existing cameraRig
      existingCameraRig.setAttribute(
        'viewer-mode',
        entityData.components['viewer-mode']
      );
      return existingCameraRig;
    }
  }

  const tagName = entityData.element || 'a-entity';
  const entity = entityData.entityElement || document.createElement(tagName);

  if (!entity.parentEl && parentEl) {
    parentEl.appendChild(entity);
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

  entity.addEventListener('loaded', () => {
    // load attributes
    for (const attr in entityData.components) {
      entity.setAttribute(attr, entityData.components[attr]);
    }

    if (entityData.mixin) {
      entity.setAttribute('mixin', entityData.mixin);
    }
  });

  if (entityData.children) {
    for (const childEntityData of entityData.children) {
      createEntityFromObj(childEntityData, entity);
    }
  }
}

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
      const streetURL = window.location.hash.substring(1);
      if (!streetURL) {
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
      if (streetURL.includes('//streetmix.net')) {
        console.log(
          '[set-loader-from-hash]',
          'Set streetmix-loader streetmixStreetURL to',
          streetURL
        );

        this.el.setAttribute(
          'streetmix-loader',
          'streetmixStreetURL',
          streetURL
        );

        setTimeout(() => {
          console.log('trigger saveScene from street component');
          useStore.getState().saveScene(true);
        }, 3000);
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
      } else {
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
        // Parse the JSON response
        const responseData = JSON.parse(this.response);
        console.log('[set-loader-from-hash] Full response data:', responseData);

        // Extract memory data if it exists
        const memoryData = responseData.memory;

        // Log the memory data for debugging
        if (memoryData) {
          console.log('[set-loader-from-hash] Memory data found:', memoryData);
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

        STREET.utils.createElementsFromJSON(jsonData, false);
        const sceneId = getUUIDFromPath(requestURL);
        if (sceneId) {
          console.log('sceneId from fetchJSON from url hash loader', sceneId);
          AFRAME.scenes[0].setAttribute('metadata', 'sceneId', sceneId);
        }
        AFRAME.scenes[0].setAttribute('metadata', 'authorId', jsonData.author);
      } else if (this.status === 404) {
        console.error(
          '[set-loader-from-hash] Error trying to load scene: Resource not found.'
        );
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

// this use os text input prompt, delete current scene, then load streetmix file
function inputStreetmix() {
  const streetmixURL = prompt(
    'Please enter a Streetmix URL',
    'https://streetmix.net/kfarr/3/example-street'
  );
  // clear scene data, create new blank scene.
  // clearMetadata = true, clearUrlHash = false
  STREET.utils.newScene(true, false);

  setTimeout(function () {
    window.location.hash = streetmixURL;
  });

  const defaultStreetEl = document.getElementById('default-street');
  defaultStreetEl.setAttribute(
    'streetmix-loader',
    'streetmixStreetURL',
    streetmixURL
  );
  AFRAME.scenes[0].emit('newScene');
}

STREET.utils.inputStreetmix = inputStreetmix;

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
  // clearMetadata = true, clearUrlHash = true, addDefaultStreet = false
  STREET.utils.newScene(true, clearUrlHash, false);

  const sceneTitle = streetObject.title;
  if (sceneTitle) {
    console.log('sceneTitle from createElementsFromJSON', sceneTitle);
    useStore.getState().setSceneTitle(sceneTitle);
  }

  // Load project info from memory if available
  if (streetObject.memory && streetObject.memory.projectInfo) {
    console.log(
      'Loading project info from memory:',
      streetObject.memory.projectInfo
    );
    useStore.getState().setProjectInfo(streetObject.memory.projectInfo);
  }

  const streetContainerEl = document.getElementById('street-container');

  createEntities(streetObject.data, streetContainerEl);
  STREET.notify.successMessage('Scene loaded');
  AFRAME.scenes[0].emit('newScene');
}

STREET.utils.createElementsFromJSON = createElementsFromJSON;
