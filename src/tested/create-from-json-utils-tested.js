// given an object such as { mixin: "SM3D_Bld_Mixed_Corner_4fl", position: "0 0 0", tag: "a-entity" } return an HTML Element with matching attributes
function createElementFromObject(object = {}) {
  // eslint-disable-line no-unused-vars
  // assumes each object has a "tag" key/value pair TODO: "a-entity" is default tag if none is present
  const el = document.createElement(object.tag);
  delete object.tag;
  for (const [key, value] of Object.entries(object)) {
    if (key === 'child') {
      var childEl = document.createElement(value.tag);
      for (const [childKey, childValue] of Object.entries(value)) {
        childEl.setAttribute(childKey, childValue);
      }
      el.appendChild(childEl);
    }
    el.setAttribute(key, value);
  }
  return el;
}
module.exports.createElementFromObject = createElementFromObject;

// return a parent element with children appended from the array of objects
function appendChildElementsFromArray(array = [], parentEl) {
  // eslint-disable-line no-unused-vars
  // for each object that represents an "a-entity" element to be created
  array.forEach(function (object, index) {
    parentEl.appendChild(createElementFromObject(object));
  });
  return parentEl;
}
module.exports.appendChildElementsFromArray = appendChildElementsFromArray;
