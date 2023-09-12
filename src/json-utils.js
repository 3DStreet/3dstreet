/* global AFRAME, Node */
/* version: 1.0 */
/*
Takes one or more elements (from a DOM queryselector call)
and returns a Javascript object
*/
function convertDOMElToObject(entity) {
  const data = [];
  const environmentElement = document.querySelector('#environment');
  const referenceEntities = document.querySelector('#reference-layers');
  const sceneEntities = [entity, environmentElement, referenceEntities];

  for (const entry of sceneEntities) {
    const entityData = getElementData(entry);
    if (entityData) {
      data.push(entityData);
    }
  }
  return {
    title: 'scene',
    version: '1.0',
    data: data
  };
}

function getElementData(entity) {
  if (!entity.isEntity) {
    return;
  }
  // node id's that should save without child nodes
  const skipChildrenNodes = ['environment'];
  const elementTree = getAttributes(entity);
  const children = entity.childNodes;
  if (children.length && !skipChildrenNodes.includes(elementTree.id)) {
    elementTree['children'] = [];
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        elementTree['children'].push(getElementData(child));
      }
    }
  }
  return elementTree;
}

function getAttributes(entity) {
  const elemObj = {};

  elemObj['element'] = entity.tagName.toLowerCase();

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
      if (modifiedProperty) {
        if (isEmpty(modifiedProperty)) {
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
    (propData.hasOwnProperty('x') && propData.hasOwnProperty('y'))
  ) {
    return AFRAME.utils.coordinates.stringify(propData);
  }
  if (typeof propData === 'object') {
    return Object.entries(propData)
      .map(([key, value]) => {
        if (key == 'src') {
          if (value.id) {
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

function isEmpty(object) {
  return Object.keys(object).length === 0;
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
const renameProps = {
  'streetmix-loader': 'not-streetmix-loader',
  street: 'not-street',
  intersection: 'not-intersection'
};

function filterJSONstreet(removeProps, renameProps, streetJSON) {
  function removeValueCheck(removeVal, value) {
    if (AFRAME.utils.deepEqual(removeVal, value) || removeVal === '*') {
      return true;
    }
    return undefined;
  }

  let stringJSON = JSON.stringify(streetJSON, function replacer(key, value) {
    for (var removeKey in removeProps) {
      // check for removing components
      if (key === removeKey) {
        const removeVal = removeProps[removeKey];
        // check for deleting component's attribute
        if (typeof removeVal === 'object' && !isEmpty(removeVal)) {
          // remove attribute in component
          const compAttributes = value;

          const attrNames = Object.keys(removeVal);
          for (var attrName of attrNames) {
            const attrVal = removeVal[attrName];
            if (
              Object.prototype.hasOwnProperty.call(compAttributes, attrName) &&
              removeValueCheck(attrVal, compAttributes[attrName])
            ) {
              delete value[attrName];
            }
          }
        }
        // for other cases
        if (removeValueCheck(removeVal, value)) {
          return undefined;
        }
      }
    }

    return value;
  });
  // rename components
  for (var renameKey in renameProps) {
    const reKey = new RegExp(`"${renameKey}":`, 'g');
    stringJSON = stringJSON.replaceAll(reKey, `"${renameProps[renameKey]}":`);
  }
  return stringJSON;
}

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

  const mixinSkipProps = ['src', 'atlas-uvs', 'gltf-model', 'gltf-part'];
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
    const defaultValue = defaultData[key].default;
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
      entityData.children[0].components.hasOwnProperty('set-loader-from-hash')
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
  const entity =
    entityData.entityElement || document.createElement(entityData.element);

  if (!entity.parentEl && parentEl) {
    parentEl.appendChild(entity);
  }

  if (entityData['primitive']) {
    // define a primitive in advance to apply other primitive-specific geometry properties
    entity.setAttribute('geometry', 'primitive', entityData['primitive']);
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
    // Ensure the components are loaded before update the UI

    entity.emit('entitycreated', {}, false);
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
    sceneTitle: { default: '' },
    sceneId: { default: '' }
  },
  init: function () {}
});

AFRAME.registerComponent('set-loader-from-hash', {
  dependencies: ['streetmix-loader'],
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
      } else {
        // try to load JSON file from remote resource
        console.log(
          '[set-loader-from-hash]',
          'Load 3DStreet scene with fetchJSON from',
          streetURL
        );
        this.fetchJSON(streetURL);
      }
      // else {
      //   console.log('[set-loader-from-hash]','Using default URL', this.data.defaultURL)
      //   this.el.setAttribute('streetmix-loader', 'streetmixStreetURL', this.data.defaultURL);
      // }
    }
  },
  fetchJSON: function (requestURL) {
    const request = new XMLHttpRequest();
    request.open('GET', requestURL, true);
    request.onload = function () {
      if (this.status >= 200 && this.status < 400) {
        // Connection success
        // remove 'set-loader-from-hash' component from json data
        const jsonData = JSON.parse(this.response, (key, value) =>
          key === 'set-loader-from-hash' ? undefined : value
        );

        console.log(
          '[set-loader-from-hash]',
          '200 response received and JSON parsed, now createElementsFromJSON'
        );
        createElementsFromJSON(jsonData);
        let sceneId = getUUIDFromPath(requestURL);
        if (sceneId) {
          console.log('sceneId from fetchJSON from url hash loader', sceneId);
          AFRAME.scenes[0].setAttribute('metadata', 'sceneId', sceneId);
        }
      } else if (this.status === 404) {
        console.error(
          '[set-loader-from-hash] Error trying to load scene: Resource not found.'
        );
        AFRAME.scenes[0].components['notify'].message(
          'Error trying to load scene: Resource not found.',
          'error'
        );
      }
    };
    request.onerror = function () {
      // There was a connection error of some sort
      console.error(
        'Loading Error: There was a connection error during JSON loading'
      );
      AFRAME.scenes[0].components['notify'].message(
        'Could not fetch scene.',
        'error'
      );
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
  streetmixURL = prompt(
    'Please enter a Streetmix URL',
    'https://streetmix.net/kfarr/3/example-street'
  );
  setTimeout(function () {
    window.location.hash = streetmixURL;
  });
  streetContainerEl = document.getElementById('street-container');
  while (streetContainerEl.firstChild) {
    streetContainerEl.removeChild(streetContainerEl.lastChild);
  }
  AFRAME.scenes[0].setAttribute('metadata', 'sceneId', '');
  AFRAME.scenes[0].setAttribute('metadata', 'sceneTitle', '');
  streetContainerEl.innerHTML =
    '<a-entity street streetmix-loader="streetmixStreetURL: ' +
    streetmixURL +
    '""></a-entity>';
}

// JSON loading starts here
function getValidJSON(stringJSON) {
  // Preserve newlines, etc. - use valid JSON
  // Remove non-printable and other non-valid JSON characters
  return stringJSON
    .replace(/\'/g, '')
    .replace(/\n/g, '')
    .replace(/[\u0000-\u0019]+/g, '');
}

function createElementsFromJSON(streetJSON) {
  let streetObject = {};
  if (typeof streetJSON == 'string') {
    const validJSONString = getValidJSON(streetJSON);
    streetObject = JSON.parse(validJSONString);
  } else if (typeof streetJSON == 'object') {
    streetObject = streetJSON;
  }

  let sceneTitle = streetObject.title;
  if (sceneTitle) {
    console.log('sceneTitle from createElementsFromJSON', sceneTitle);
    AFRAME.scenes[0].setAttribute('metadata', 'sceneTitle', sceneTitle);
  }

  streetContainerEl = document.getElementById('street-container');
  while (streetContainerEl.firstChild) {
    streetContainerEl.removeChild(streetContainerEl.lastChild);
  }

  createEntities(streetObject.data, streetContainerEl);
  AFRAME.scenes[0].components['notify'].message(
    'Scene loaded from JSON',
    'success'
  );
}

// viewer widget click to paste json string of 3dstreet scene
function inputJSON() {
  const stringJSON = prompt('Please paste 3DStreet JSON string');
  if (stringJSON) {
    createElementsFromJSON(stringJSON);
  }
}

// handle viewer widget click to open 3dstreet json scene
function fileJSON() {
  let reader = new FileReader();
  reader.onload = function () {
    AFRAME.scenes[0].setAttribute('metadata', 'sceneId', '');
    AFRAME.scenes[0].setAttribute('metadata', 'sceneTitle', '');
    createElementsFromJSON(reader.result);
  };
  reader.readAsText(this.files[0]);
}
