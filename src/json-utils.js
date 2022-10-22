/*
Takes one or more elements (from a DOM queryselector call) 
and returns a Javascript object
*/
function convertToObject(entity) {
  let data = [];
  if (entity.length) {
    for (let entry of entity) {
      data.push(getElementData(entry));
    }
  } else {
    data.push(getElementData(entity));
  }
  return {data: data}
}

function getElementData(entity) {
  let elementTree = getAttributes(entity);
  var children = entity.childNodes;
  if (children.length) {
    elementTree['children'] = [];
    for (let child of children) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        elementTree['children'].push(getElementData(child));       
      }
    }        
  }
  return elementTree;
}

function getAttributes(entity) {
  let elemObj = {};

  if (entity.id) {
    elemObj['id'] = entity.id;
  }
  if (entity.className) {
    // convert from DOMTokenList to Array
    elemObj['class'] = Array.from(entity.classList);
  }

  elemObj['element'] = entity.tagName.toLowerCase();

  const entityComponents = entity.components;
  if (entityComponents) {
    elemObj['components'] = {};
    for (let componentName in entityComponents) {
      const component = entityComponents[componentName];
      const modifiedProperty = getModifiedProperties(entity, componentName);
      if (!isEmpty(modifiedProperty)) {
        elemObj['components'][componentName] = modifiedProperty;     
      }

    }
  }
  return elemObj;
}

function isEmpty(object) {
  return Object.keys(object).length === 0;
}

function isSingleProperty(schema) {
  return AFRAME.schema.isSingleProperty(schema);
}

function getModifiedProperties(entity, componentName) {
  let data = entity.components[componentName].data;
  let defaultData = entity.components[componentName].schema;

  // If its single-property like position, rotation, etc
  if (isSingleProperty(defaultData)) {
    let defaultValue = defaultData.default;
    let currentValue = data;
    if ((currentValue || defaultValue) && currentValue !== defaultValue) {
      return data;
    }
  }

  let diff = {};
  for (let key in data) {

    let defaultValue = defaultData[key].default;
    let currentValue = data[key];

    // Some parameters could be null and '' like mergeTo
    if ((currentValue || defaultValue) && !AFRAME.utils.deepEqual(currentValue, defaultValue)) {
      diff[key] = data[key];
    }
  }
  return diff;
}

function createEntities(entitiesData, parentEl) {
  for (let entityData of entitiesData) {
    createEntity(entityData, parentEl);
  }
}

/*
Add a new entity with a list of components and children (if exists)
 * @param {object} entityData Entity definition to add:
 *   {
 *    element: 'a-entity', 
 *    id: 'id', 
 *    class: {Array} of element classes,
 *    children: {Array} of entities, 
 *    components: {geometry: 'primitive:box', ...}
 *   }
 * @param {Element} parentEl the parent element to which the Entity will be added
 * @return {Element} Entity created
*/
function createEntity(entityData, parentEl) {
  const entity = document.createElement(entityData.element);

  // load default attributes
  for (let attr in entityData.components) {
    entity.setAttribute(attr, entityData.components[attr]);
  }

  if (entityData.id) {
    entity.setAttribute("id", entityData.id);
  }
  if (entityData.class) {
    entity.classList.add(...entityData.class);
  }

  if (parentEl) {
    parentEl.appendChild(entity);
  }

  // Ensure the components are loaded before update the UI
  /* ***add this later with Events.js***

  entity.addEventListener('loaded', () => {
    Events.emit('entitycreated', entity);
  });
  */

  if (entityData.children) {
    let childrenEntities = entityData.children;
    for (childEntityData of childrenEntities) {
      createEntity(childEntityData, entity);
    }
  }

  return entity;
}
