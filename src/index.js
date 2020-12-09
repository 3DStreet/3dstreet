/* global AFRAME */
var streetmixParsers = require('./aframe-streetmix-parsers');
require('./assets.js');
require('./aframe-streetmix-loaders'); // TODO: don't include this here
require('./components/create-from-json');
require('./lib/aframe-alongpath-component');
require('aframe-curve-component');
require('aframe-atlas-uvs-component');
require('aframe-gltf-helpers');

AFRAME.registerComponent('street', {
  schema: {
    JSON: { type: 'string' },
    type: { default: 'streetmixSegmentsFeet' }, // alt: sharedRowMeters, streetmixJSONResponse
    right: { default: '' },
    left: { default: '' }
  },
  update: function (oldData) {
    // fired once at start and at each subsequent change of a schema value
    var data = this.data;
    var el = this.el;

    // clear whatever is there
    el.innerHTML = '';

    // TODO: create new a-entity for buildings

    // if (data.buildings) {
    //   var buildingsEl = document.getElementById('buildings');
    //   buildingsEl.innerHTML = '';
    // }

    var streetmixSegments = JSON.parse(data.JSON);
    console.log(streetmixSegments);
    // var streetObject = streetmixObject.data.street;
    // var streetmixSegments = JSON.parse(data.JSON);
    // TODO: return (and document) `streetmixObject` for more general usage, remove processSegments/Buildings from this function
    var streetEl = streetmixParsers.processSegments(streetmixSegments.streetmixSegmentsFeet);
    this.el.append(streetEl);

    if (data.buildings) {
      var buildingsEl = streetmixParsers.processBuildings(streetObject);
    }
  }
});

// assumes street is loaded as well
// AFRAME.registerComponent('street-loader', {
//   dependencies: ['street'],
//   schema: {
//     streetmixURL: { type: 'string' }
//   },
//   update: function (oldData) {
//     // fired once at start and at each subsequent change of a schema value
//     var data = this.data;
//     var el = this.el;

//     // getjson replacement from http://youmightnotneedjquery.com/#json
//     var request = new XMLHttpRequest();
//     request.open('GET', data.streetmixURL, true);
//     request.onload = function () {
//       if (this.status >= 200 && this.status < 400) {
//         // Connection success
//         var streetmixObject = JSON.parse(this.response);
//         console.log(streetmixObject);
//         var streetObject = streetmixObject.data.street;
//         var streetmixSegments = streetmixObject.data.street.segments;
//         console.log(streetmixSegments);
//       } else {
//         // We reached our target server, but it returned an error
//         console.log('Streetmix Loading Error: We reached our target server, but it returned an error');
//       }
//     };
//     request.onerror = function () {
//       // There was a connection error of some sort
//       console.log('Streetmix Loading Error: There was a connection error of some sort');
//     };
//     request.send();
//   }
// });
