/* global AFRAME */

AFRAME.registerComponent('street', {
  schema: {
    streetmixUrl: { type: 'string' }
  },
  update: function (oldData) {
    // fired once at start and at each subsequent change of a schema value
    var data = this.data;
    var el = this.el;

    //   function loadStreet (streetURL) {
    // Erase existing street (if any)
    // var myNode = document.getElementById('streets');
    el.innerHTML = '';

    // create new a-entity for buildings
    myNode = document.getElementById('buildings');
    myNode.innerHTML = '';

    // getjson replacement from http://youmightnotneedjquery.com/#json
    var request = new XMLHttpRequest();
    request.open('GET', data.streetmixUrl, true);
    request.onload = function () {
      if (this.status >= 200 && this.status < 400) {
        // Connection success
        var streetmixObject = JSON.parse(this.response);
        var streetObject = streetmixObject.data.street;
        var streetmixSegments = streetmixObject.data.street.segments;
        // TODO: return (and document) `streetmixObject` for more general usage, remove processSegments/Buildings from this function
        processSegments(streetmixSegments, el.id);
        // processBuildings(streetObject, 'buildings');
      } else {
        // We reached our target server, but it returned an error
        console.log('Streetmix Loading Error: We reached our target server, but it returned an error');
      }
    };
    request.onerror = function () {
      // There was a connection error of some sort
      console.log('Streetmix Loading Error: There was a connection error of some sort');
    };
    request.send();
  }
});
