// import { appendChildElementsFromArray } from '../tested/aframe-streetmix-parsers-tested.js';

// create elements from a JSON string
AFRAME.registerComponent('create-from-json', {
  schema: {
    jsonString: { type: 'string', default: '' }
  },
  update: function (oldData) {
    var data = this.data;
    var el = this.el;
    if (oldData.string && data.string !== oldData.string) {
      // erase existing children -- not tested
      while (el.firstChild) {
        el.removeChild(el.lastChild);
      }
    }
    appendChildElementsFromArray(JSON.parse(data.jsonString), el);
  }
});
