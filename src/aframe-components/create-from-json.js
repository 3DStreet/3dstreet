/* global AFRAME */
var createFromJSONUtilsTested = require('../tested/create-from-json-utils-tested');

// create elements from a JSON string
AFRAME.registerComponent('create-from-json', {
  schema: {
    jsonString: { type: 'string', default: '' }
  },
  update: function (oldData) {
    var data = this.data;
    var el = this.el;
    var parsed;
    if (!data.jsonString || data.jsonString === oldData.jsonString) {
      return;
    }
    try {
      parsed = JSON.parse(data.jsonString);
    } catch (e) {
      console.error('create-from-json: Invalid JSON string', e);
      return;
    }
    if (!Array.isArray(parsed)) {
      console.error('create-from-json: Parsed JSON must be an array');
      return;
    }
    while (el.firstChild) {
      el.removeChild(el.lastChild);
    }
    createFromJSONUtilsTested.appendChildElementsFromArray(parsed, el);
  }
});
