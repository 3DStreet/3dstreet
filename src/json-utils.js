/* global AFRAME, Node */

/*
Takes one or more elements (from a DOM queryselector call)
and returns a Javascript object
*/
function convertDOMElToObject (entity) {
  const data = [];
  if (entity.length) {
    for (const entry of entity) {
      data.push(getElementData(entry));
    }
  } else {
    data.push(getElementData(entity));
  }
  return { data: data };
}

function getElementData (entity) {
  const elementTree = getAttributes(entity);
  const children = entity.childNodes;
  if (children.length) {
    elementTree['children'] = [];
    for (const child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        elementTree['children'].push(getElementData(child));
      }
    }
  }
  return elementTree;
}

function getAttributes (entity) {
  const elemObj = {};
  elemObj['element'] = entity.tagName.toLowerCase();

  if (entity.id) {
    elemObj['id'] = entity.id;
  }
  if (entity.className) {
    // convert from DOMTokenList to Array
    elemObj['class'] = Array.from(entity.classList);
  }

  const entityComponents = entity.components;

  if (entityComponents) {
    elemObj['components'] = {};
    for (const componentName in entityComponents) {
      const modifiedProperty = getModifiedProperty(entity, componentName);
      if (modifiedProperty && !isEmpty(modifiedProperty)) {
        elemObj['components'][componentName] = toPropString(modifiedProperty);
      }
    }
  }
  return elemObj;
}

function toPropString(propData) {
  if (typeof propData == 'string' || typeof propData == 'number' || typeof propData == 'boolean') {
    return (propData).toString();
  }
  if (propData.isVector3 || propData.isVector2 || propData.isVector4 || 
    propData.hasOwnProperty('x') && propData.hasOwnProperty('y')) {
    return AFRAME.utils.coordinates.stringify(propData);
  }
  if (typeof propData == 'object') {
    return Object.entries(propData).map(
        ([key, value]) => {
          if (key == 'src') {
            if (value.id) {
              return `${key}: #${value.id}`;
            } else {
              return `${key}: ${value}`;
            }
          } else {
            return `${key}: ${toPropString(value)}`;
          }
        }
      ).join("; ");
  }
} 

function isSingleProperty (schema) {
  return AFRAME.schema.isSingleProperty(schema);
}

function isEmpty (object) {
  return Object.keys(object).length === 0;
}

// a list of component:value pairs to exclude from the JSON string.
// * - remove component with any value
// "propName": {"attribute": "..."} - remove attribute from component
const removeProps = {
  src: {},
  normalMap: {},
  'create-from-json': '*',
  street: { JSON: '*' }
};
// a list of component_name:new_component_name pairs to rename in JSON string
const renameProps = {
  'streetmix-loader': 'not-streetmix-loader',
  street: 'not-street'
};

function filterJSONstreet (removeProps, renameProps, streetJSON) {
  function removeValueCheck (removeVal, value) {
    // console.error(removeVal, value, AFRAME.utils.deepEqual(removeVal, value))
    if (AFRAME.utils.deepEqual(removeVal, value) || removeVal === '*') {
      return true;
    }
    return undefined;
  }

  let stringJSON = JSON.stringify(streetJSON, function replacer (key, value) {
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
            if (Object.prototype.hasOwnProperty.call(compAttributes, attrName) &&
              removeValueCheck(attrVal, compAttributes[attrName])) {
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
    // console.log(renameKey)
    const reKey = new RegExp(`"${renameKey}":`);
    stringJSON = stringJSON.replace(reKey, `"${renameProps[renameKey]}":`);
  }
  return stringJSON;
}

function getModifiedProperty (entity, componentName) {
  //const data = entity.components[componentName].data;
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

  // If its single-property like position, rotation, etc
  if (isSingleProperty(defaultData)) {
    const defaultValue = defaultData.default;
    const currentValue = data;
    if ((currentValue || defaultValue) && currentValue !== defaultValue) {
      return data;
    }
  }

  const diff = {};
  for (const key in data) {
    const defaultValue = defaultData[key].default;
    const currentValue = data[key];

    // Some parameters could be null and '' like mergeTo
    if ((currentValue || defaultValue) && !AFRAME.utils.deepEqual(currentValue, defaultValue)) {
      diff[key] = data[key];
    }
  }
  return diff;
}

function createEntities (entitiesData, parentEl) {
  for (const entityData of entitiesData) {   
    createEntityFromObj(entityData, parentEl);
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
function createEntityFromObj (entityData, parentEl) {

  const entity = document.createElement(entityData.element);

  // load attributes
  for (const attr in entityData.components) {
    entity.setAttribute(attr, entityData.components[attr]);
  }
  if (entityData.id) {
    entity.setAttribute('id', entityData.id);
  }

  if (entityData.class) {
    entity.classList.add(...entityData.class);
  }

  if (parentEl) {
    parentEl.appendChild(entity);
  }

  // Ensure the components are loaded before update the UI
  entity.addEventListener('loaded', () => {
    entity.emit('entitycreated', {}, false);
  });

  if (entityData.children) {
    for (const childEntityData of entityData.children) {
      createEntityFromObj(childEntityData, entity);
    }
  }
}
