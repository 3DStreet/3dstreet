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
