/* global AFRAME, XMLHttpRequest */
var streetmixParsers = require('./aframe-streetmix-parsers');
var streetmixUtils = require('./tested/streetmix-utils');
require('./assets.js');
require('./components/create-from-json');
require('aframe-atlas-uvs-component');
require('./lib/aframe-gltf-helpers.js');

AFRAME.registerComponent('street', {
  schema: {
    JSON: { type: 'string' },
    type: { default: 'streetmixSegmentsFeet' }, // alt: sharedRowMeters, streetmixJSONResponse
    left: { default: '' },
    right: { default: '' },
    showGround: { default: true },
    showStriping: { default: true },
    length: { default: 150 }
  },
  update: function (oldData) { // fired once at start and at each subsequent change of a schema value
    var data = this.data;

    if (data.JSON.length === 0) {
      if (oldData.JSON !== undefined && oldData.JSON.length === 0) { return; } // this has happened before, surpress console log
      console.log('[street]', 'No JSON provided yet, but it might be set at runtime');
      return;
    }

    const streetmixSegments = JSON.parse(data.JSON);
    const streetEl = streetmixParsers.processSegments(streetmixSegments.streetmixSegmentsFeet, data.showStriping, data.length);
    this.el.append(streetEl);

    if (data.left || data.right) {
      const streetWidth = streetmixUtils.calcStreetWidth(streetmixSegments.streetmixSegmentsFeet, data.autoStriping);
      const buildingsEl = streetmixParsers.processBuildings(data.left, data.right, streetWidth, data.showGround, data.length);
      this.el.append(buildingsEl);
    }
  }
});

AFRAME.registerComponent('streetmix-loader', {
  dependencies: ['street'],
  schema: {
    streetmixStreetURL: { type: 'string' },
    streetmixAPIURL: { type: 'string' },
    showBuildings: { default: true },
    name: { default: '' }
  },
  update: function (oldData) { // fired at start and at each subsequent change of any schema value
    // This method may fire a few times when viewing a streetmix street in 3dstreet:
    // First to find the proper path, once to actually load the street, and then subsequent updates such as street name
    var data = this.data;
    var el = this.el;

    // if the loader has run once already, and upon update neither URL has changed, do not take action
    if ((oldData.streetmixStreetURL === data.streetmixStreetURL) && (oldData.streetmixAPIURL === data.streetmixAPIURL)) {
      // console.log('[streetmix-loader]', 'Neither streetmixStreetURL nor streetmixAPIURL have changed in this component data update, not reloading street.')
      return;
    }

    // if no value for 'streetmixAPIURL' then let's see if there's a streetmixURL
    if (data.streetmixAPIURL.length === 0) {
      if (data.streetmixStreetURL.length > 0) {
        const streetmixAPIURL = streetmixUtils.streetmixUserToAPI(data.streetmixStreetURL);
        console.log('[streetmix-loader]', 'setting `streetmixAPIURL` to', streetmixAPIURL);
        el.setAttribute('streetmix-loader', 'streetmixAPIURL', streetmixAPIURL);
        return;
      }
      console.log('[streetmix-loader]', 'Neither `streetmixAPIURL` nor `streetmixStreetURL` properties provided, please provide at least one.');
      return;
    }

    var request = new XMLHttpRequest();
    console.log('[streetmix-loader]', 'GET ' + data.streetmixAPIURL);

    request.open('GET', data.streetmixAPIURL, true);
    request.onload = function () {
      if (this.status >= 200 && this.status < 400) {
        // Connection success
        const streetmixResponseObject = JSON.parse(this.response);
        const streetmixSegments = streetmixResponseObject.data.street.segments;
        const streetmixName = streetmixResponseObject.name;
        el.setAttribute('streetmix-loader', 'name', streetmixName);
        if (data.showBuildings) {
          el.setAttribute('street', 'right', streetmixResponseObject.data.street.rightBuildingVariant);
          el.setAttribute('street', 'left', streetmixResponseObject.data.street.leftBuildingVariant);
        }
        el.setAttribute('street', 'type', 'streetmixSegmentsFeet');
        // set JSON attribute last or it messes things up
        el.setAttribute('street', 'JSON', JSON.stringify({ streetmixSegmentsFeet: streetmixSegments }));
        el.emit('streetmix-loader-street-loaded');
      } else {
        // We reached our target server, but it returned an error
        console.log('[streetmix-loader]', 'Loading Error: We reached the target server, but it returned an error');
      }
    };
    request.onerror = function () {
      // There was a connection error of some sort
      console.log('[streetmix-loader]', 'Loading Error: There was a connection error of some sort');
    };
    request.send();
  }
});

AFRAME.registerComponent('intersection', {
  schema: {
    position: { type: 'string', default: '0 0 0' },
    scale: { type: 'string', default: '20 20' }
  },
  init: function() {
    //TODO: account for invalid up user input
    //TODO: account for sidewalks 
    var data = this.data;
    var el = this.el;

    this.geometry = new THREE.PlaneGeometry(data.scale.split(' ')[0],data.scale.split(' ')[1],1,1);
    this.material = new THREE.MeshStandardMaterial({color: '#FF0000'});
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    el.setObject3D('mesh', this.mesh);

    this.el.setAttribute('position', {x: data.position.split(' ')[0], y: data.position.split(' ')[1], z: data.position.split(' ')[2]});
    this.el.setAttribute('rotation', '-90 0 0');
    this.el.setAttribute('material', "src: ../assets/objects/intersection.jpeg");
  },
  update: function (oldData) {
    //TODO: live updating of intersection asset
    var data = this.data;
    var el = this.el;
  }
});