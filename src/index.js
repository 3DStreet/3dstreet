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
    position: { type: 'string', default: '20 20' },
    scale: { type: 'string', default: '20 20' },
    crosswalk: { type: 'string', default: 'false' },
    sidewalk: { type: 'string', default: '0 0 0 0' }
  },
  init: function() {
    var data = this.data;
    var el = this.el;
    const scaleArray = data.scale.split(' ').map((i) => Number(i));
    const positionArray = data.position.split(' ').map((i) => Number(i));
    const sidewalkArray = data.sidewalk.split(' ').map((i) => Number(i));

    this.geometry = new THREE.PlaneGeometry(scaleArray[0],scaleArray[1],1,1);
    this.material = new THREE.MeshStandardMaterial({color: '#FF0000'});
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    el.setObject3D('mesh', this.mesh);

    this.el.setAttribute('position', {x: positionArray[0], y: positionArray[1], z: positionArray[2]});
    this.el.setAttribute('rotation', '-90 0 0');
    if (data.crosswalk === 'true'){
      this.el.setAttribute('material', "src: ../assets/objects/intersection.jpeg");
    } else {
      this.el.setAttribute('material', "src: https://github.3dstreet.org/assets/materials/TexturesCom_AsphaltDamaged0057_1_seamless_S.jpg");
    }

    const sd1 = document.createElement('a-entity');
    sd1.setAttribute('position', {x: positionArray[0] + scaleArray[0]/2 - sidewalkArray[0]/2, y: positionArray[1], z: 0.04});
    sd1.setAttribute('scale', 'x', sidewalkArray[0] * 0.3048);
    sd1.setAttribute('scale', 'y', scaleArray[1] / 150);
    sd1.setAttribute('rotation', {x: 0, y: 0, z: 0});
    sd1.setAttribute('mixin', 'sidewalk');
    el.appendChild(sd1)
    const sd2 = document.createElement('a-entity');
    sd2.setAttribute('position', {x: positionArray[0] - scaleArray[0]/2 + sidewalkArray[1]/2, y: positionArray[1], z: 0.05});
    sd2.setAttribute('scale', 'x', data.sidewalk.split(' ')[1] * 0.3048);
    sd2.setAttribute('scale', 'y', scaleArray[1] / 150);
    sd2.setAttribute('rotation', {x: 0, y: 0, z: 0});
    sd2.setAttribute('mixin', 'sidewalk');
    el.appendChild(sd2)
    const sd3 = document.createElement('a-entity');
    sd3.setAttribute('position', {x: positionArray[0], y: positionArray[1]  - scaleArray[1]/2 + sidewalkArray[2]/2, z: 0.03});
    sd3.setAttribute('scale', 'x', sidewalkArray[2] * 0.3048);
    sd3.setAttribute('scale', 'y', scaleArray[0] / 150);
    sd3.setAttribute('rotation', {x: 0, y: 0, z: -90});
    sd3.setAttribute('mixin', 'sidewalk');
    el.appendChild(sd3)
    const sd4 = document.createElement('a-entity');
    sd4.setAttribute('position', {x: positionArray[0], y: positionArray[1]  + scaleArray[1]/2 - sidewalkArray[3]/2, z: 0.03});
    sd4.setAttribute('scale', 'x', sidewalkArray[2] * 0.3048);
    sd4.setAttribute('scale', 'y', scaleArray[0] / 150);
    sd4.setAttribute('rotation', {x: 0, y: 0, z: -90});
    sd4.setAttribute('mixin', 'sidewalk');
    el.appendChild(sd4)

  },
  update: function (oldData) {
    //TODO: live updating of intersection asset
    var data = this.data;
    var el = this.el;
  }
});