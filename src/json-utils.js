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
  let attributes = Array.from(entity.attributes).filter(attr =>
      !(attr.name == 'id' || attr.name == 'class')
    );
  if (entity.id) {
    elemObj['id'] = entity.id;
  }
  if (entity.className) {
    elemObj['class'] = entity.className;
  }
  elemObj['element'] = entity.tagName.toLowerCase();

  if (attributes) {
    elemObj['components'] = {};
    for (let attrName in attributes) {
      const attr = attributes[attrName];
      elemObj['components'][attr.name] = entity.getAttribute(attr.name);
    }
  }
  return elemObj;
}

function createEntities(EntitiesJSON) {
  const entitiesData = EntitiesJSON.data;

  // trick to create nodeList with entities to return as result
  const entityElements = document.createElement('a-entity');

  for (let entityData of entitiesData) {
    entityElements.appendChild(createEntity(entityData))
  }

  return entityElements;
}

/*
Add a new entity with a list of components and children (if exists)
 * @param {object} entityData Entity definition to add:
 *   {element: 'a-entity', components: {geometry: 'primitive:box'}}
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
    entity.setAttribute("className", entityData.class);
  }

  if (parentEl) {
    parentEl.appendChild(entity);
  }

  if (entityData.children) {
    let childrenEntities = entityData.children;
    childrenEntities.forEach(childEntityData => {
      createEntity(childEntityData, entity);
    });
  }

  return entity;
}