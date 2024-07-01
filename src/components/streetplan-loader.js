/* global AFRAME, XMLHttpRequest */
var streetplanUtils = require('../streetplan/streetplan-utils.js');

AFRAME.registerComponent('streetplan-loader', {
  dependencies: ['street'],
  schema: {
    streetplanStreetURL: { type: 'string' },
    streetplanAPIURL: { type: 'string' },
    streetplanEncJSON: { type: 'string' },
    showBuildings: { default: true },
    name: { default: '' },
    synchronize: { default: false }
  },
  streetplanResponseParse: function (streetplanResponseObject) {
    const el = this.el;
    const data = this.data;
    const streetplanProject = streetplanResponseObject.project;

    // convert Streetplan structure to Streetmix-like structure
    const streetData = streetplanUtils.convertStreetStruct(streetplanProject);

    const streetplanSegments = streetData.segments;

    const streetplanName = streetData.name;
    // streetplan alternative name
    // const streetplanAltName = streetData.altName;

    console.log('streetplanName', streetplanName);

    let currentSceneTitle;
    const sceneEl = this.el.sceneEl;
    if (sceneEl && sceneEl.getAttribute('metadata')) {
      currentSceneTitle = sceneEl.getAttribute('metadata').sceneTitle;
    }
    if (!currentSceneTitle) {
      // only set title from streetplan if none exists
      sceneEl.setAttribute('metadata', 'sceneTitle', streetplanName);
      console.log(
        'therefore setting metadata sceneTitle as streetplanName',
        streetplanName
      );
    }

    el.setAttribute('data-layer-name', 'StreetPlan • ' + streetplanName);

    if (data.showBuildings) {
      el.setAttribute('street', 'right', streetData.rightBuildingVariant);
      el.setAttribute('street', 'left', streetData.leftBuildingVariant);
    }
    el.setAttribute('street', 'type', 'streetmixSegmentsMetric');
    // set JSON attribute last or it messes things up
    el.setAttribute(
      'street',
      'JSON',
      JSON.stringify({ streetmixSegmentsMetric: streetplanSegments })
    );
    el.emit('streetplan-loader-street-loaded');
  },
  update: function (oldData) {
    // fired at start and at each subsequent change of any schema value
    // This method may fire a few times when viewing a streetmix street in 3dstreet:
    // First to find the proper path, once to actually load the street, and then subsequent updates such as street name
    const that = this;
    const data = this.data;

    // do not call the update function when the data.synchronize is set to false
    if (!data.synchronize) return;

    // load from URL encoded Streetplan JSON
    if (data.streetplanEncJSON) {
      const streetplanJSON = decodeURIComponent(data.streetplanEncJSON);
      this.streetplanResponseParse(JSON.parse(streetplanJSON));
      return;
    }

    // if the loader has run once already, and upon update neither URL has changed, do not take action
    if (
      oldData.streetplanStreetURL === data.streetplanStreetURL &&
      oldData.streetplanAPIURL === data.streetplanAPIURL
    ) {
      // console.log('[streetmix-loader]', 'Neither streetplanStreetURL nor streetplanAPIURL have changed in this component data update, not reloading street.')
      return;
    }

    var request = new XMLHttpRequest();
    console.log('[streetplan-loader]', 'GET ' + data.streetplanAPIURL);

    request.open('GET', data.streetplanAPIURL, true);
    request.onload = function () {
      if (this.status >= 200 && this.status < 400) {
        // Connection success
        const streetplanResponseObject = JSON.parse(this.response);
        that.streetplanResponseParse(streetplanResponseObject);
        // the streetplan data has been loaded, set the synchronize flag to false
        that.el.setAttribute('streetplan-loader', 'synchronize', false);
      } else {
        // We reached our target server, but it returned an error
        console.log(
          '[streetplan-loader]',
          'Loading Error: We reached the target server, but it returned an error'
        );
      }
    };
    request.onerror = function () {
      // There was a connection error of some sort
      console.log(
        '[streetplan-loader]',
        'Loading Error: There was a connection error of some sort'
      );
    };
    request.send();
  }
});
