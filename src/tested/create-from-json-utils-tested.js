// given an object such as { mixin: "SM3D_Bld_Mixed_Corner_4fl", position: "0 0 0", tag: "a-entity" } return an HTML Element with matching attributes
function createElementFromObject (object = {}) { // eslint-disable-line no-unused-vars
  // assumes each object has a "tag" key/value pair TODO: "a-entity" is default tag if none is present
  const el = document.createElement(object.tag);
  delete object.tag;
  for (const [key, value] of Object.entries(object)) {
    if (value == 'SM_Bld_House_Preset_08_1809'){
      var driveway = document.createElement('a-plane');
      driveway.setAttribute('position', 'x', -6.25);
      driveway.setAttribute('position', 'y', 0.6);
      driveway.setAttribute('position', 'z', -8.75);
      driveway.setAttribute('rotation', '-90 0 0');
      driveway.setAttribute('src', '#asphalt-texture');
      driveway.setAttribute('width', 4);
      driveway.setAttribute('height', 4.6);
      el.appendChild(driveway);
    } else if (value == 'SM_Bld_House_Preset_09_1845') {
      var driveway = document.createElement('a-plane');
      driveway.setAttribute('position', 'x', -2.5);
      driveway.setAttribute('position', 'y', 0.6);
      driveway.setAttribute('position', 'z', -7);
      driveway.setAttribute('rotation', '-90 0 0');
      driveway.setAttribute('src', '#asphalt-texture');
      driveway.setAttribute('width', 4);
      driveway.setAttribute('height', 8);
      el.appendChild(driveway);
    }
    el.setAttribute(key, value);
  }
  return el;
}
module.exports.createElementFromObject = createElementFromObject;

// return a parent element with children appended from the array of objects
function appendChildElementsFromArray (array = [], parentEl) { // eslint-disable-line no-unused-vars
  // for each object that represents an "a-entity" element to be created
  array.forEach(function (object, index) {
    parentEl.appendChild(createElementFromObject(object));
  });
  return parentEl;
}
module.exports.appendChildElementsFromArray = appendChildElementsFromArray;
