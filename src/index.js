/* global AFRAME, THREE, XMLHttpRequest */
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
    showVehicles: { default: true },
    globalAnimated: { default: false },
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
    const streetEl = streetmixParsers.processSegments(streetmixSegments.streetmixSegmentsFeet, data.showStriping, data.length, data.globalAnimated, data.showVehicles);
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
    dimensions: { type: 'string', default: '20 20' },
    sidewalk: { type: 'string', default: '0 0 0 0' },
    northeastcurb: { type: 'string', default: '0 0' },
    southwestcurb: { type: 'string', default: '0 0' },
    southeastcurb: { type: 'string', default: '0 0' },
    northwestcurb: { type: 'string', default: '0 0' },
    stopsign: { type: 'string', default: '0 0 0 0' },
    trafficsignal: { type: 'string', default: '0 0 0 0' },
    crosswalk: { type: 'string', default: '0 0 0 0' }
  },
  init: function () {
    var data = this.data;
    var el = this.el;
    const dimensionsArray = data.dimensions.split(' ').map((i) => Number(i));
    const positionArray = [this.el.getAttribute('position').x, this.el.getAttribute('position').y, this.el.getAttribute('position').z];
    const sidewalkArray = data.sidewalk.split(' ').map((i) => Number(i));
    const northeastcurbArray = data.northeastcurb.split(' ').map((i) => Number(i));
    const southwestcurbArray = data.southwestcurb.split(' ').map((i) => Number(i));
    const southeastcurbArray = data.southeastcurb.split(' ').map((i) => Number(i));
    const northwestcurbArray = data.northwestcurb.split(' ').map((i) => Number(i));
    const stopsignArray = data.stopsign.split(' ').map((i) => Number(i));
    const trafficsignalArray = data.trafficsignal.split(' ').map((i) => Number(i));
    const crosswalklArray = data.crosswalk.split(' ').map((i) => Number(i));

    this.geometry = new THREE.PlaneGeometry(dimensionsArray[0], dimensionsArray[1], 1, 1);
    this.material = new THREE.MeshStandardMaterial({ color: '#FF0000' });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    el.setObject3D('mesh', this.mesh);

    this.el.setAttribute('position', { x: positionArray[0], y: positionArray[1], z: positionArray[2] });
    this.el.setAttribute('rotation', '-90 0 0');
    this.el.setAttribute('material', 'src: #asphalt-texture; repeat:5 5; roughness:1');

    const sd1 = document.createElement('a-entity');
    sd1.setAttribute('position', { x: dimensionsArray[0] / 2 - sidewalkArray[0] / 2, z: 0.04 });
    sd1.setAttribute('scale', 'x', sidewalkArray[0] / 3);
    sd1.setAttribute('scale', 'y', dimensionsArray[1] / 150);
    sd1.setAttribute('rotation', { x: 0, y: 0, z: 0 });
    sd1.setAttribute('mixin', 'sidewalk');
    el.appendChild(sd1);
    const sd2 = document.createElement('a-entity');
    sd2.setAttribute('position', { x: -dimensionsArray[0] / 2 + sidewalkArray[1] / 2, z: 0.05 });
    sd2.setAttribute('scale', 'x', sidewalkArray[1] / 3);
    sd2.setAttribute('scale', 'y', dimensionsArray[1] / 150);
    sd2.setAttribute('rotation', { x: 0, y: 0, z: 0 });
    sd2.setAttribute('mixin', 'sidewalk');
    el.appendChild(sd2);
    const sd3 = document.createElement('a-entity');
    sd3.setAttribute('position', { y: -dimensionsArray[1] / 2 + sidewalkArray[2] / 2, z: 0.03 });
    sd3.setAttribute('scale', 'x', sidewalkArray[2] / 3);
    sd3.setAttribute('scale', 'y', dimensionsArray[0] / 150);
    sd3.setAttribute('rotation', { x: 0, y: 0, z: -90 });
    sd3.setAttribute('mixin', 'sidewalk');
    el.appendChild(sd3);
    const sd4 = document.createElement('a-entity');
    sd4.setAttribute('position', { y: dimensionsArray[1] / 2 - sidewalkArray[3] / 2, z: 0.03 });
    sd4.setAttribute('scale', 'x', sidewalkArray[3] / 3);
    sd4.setAttribute('scale', 'y', dimensionsArray[0] / 150);
    sd4.setAttribute('rotation', { x: 0, y: 0, z: -90 });
    sd4.setAttribute('mixin', 'sidewalk');
    el.appendChild(sd4);

    const c1 = document.createElement('a-entity');
    c1.setAttribute('position', { x: dimensionsArray[0] / 2 - northeastcurbArray[0] / 2, y: dimensionsArray[1] / 2 - northeastcurbArray[1] / 2, z: 0.022 });
    c1.setAttribute('scale', 'x', northeastcurbArray[0] / 3);
    c1.setAttribute('scale', 'y', northeastcurbArray[1] / 150);
    c1.setAttribute('mixin', 'sidewalk');
    el.appendChild(c1);

    const c2 = document.createElement('a-entity');
    c2.setAttribute('position', { x: -dimensionsArray[0] / 2 + southwestcurbArray[0] / 2, y: -dimensionsArray[1] / 2 + southwestcurbArray[1] / 2, z: 0.022 });
    c2.setAttribute('scale', 'x', southwestcurbArray[0] / 3);
    c2.setAttribute('scale', 'y', southwestcurbArray[1] / 150);
    c2.setAttribute('mixin', 'sidewalk');
    el.appendChild(c2);

    const c3 = document.createElement('a-entity');
    c3.setAttribute('position', { x: dimensionsArray[0] / 2 - southeastcurbArray[0] / 2, y: -dimensionsArray[1] / 2 + southeastcurbArray[1] / 2, z: 0.022 });
    c3.setAttribute('scale', 'x', southeastcurbArray[0] / 3);
    c3.setAttribute('scale', 'y', southeastcurbArray[1] / 150);
    c3.setAttribute('mixin', 'sidewalk');
    el.appendChild(c3);

    const c4 = document.createElement('a-entity');
    c4.setAttribute('position', { x: -dimensionsArray[0] / 2 + northwestcurbArray[0] / 2, y: dimensionsArray[1] / 2 - northwestcurbArray[1] / 2, z: 0.022 });
    c4.setAttribute('scale', 'x', northwestcurbArray[0] / 3);
    c4.setAttribute('scale', 'y', northwestcurbArray[1] / 150);
    c4.setAttribute('mixin', 'sidewalk');
    el.appendChild(c4);

    if (stopsignArray[0]) {
      const ss1 = document.createElement('a-entity');
      ss1.setAttribute('position', { x: dimensionsArray[0] / 2, y: dimensionsArray[1] / 3, z: 0.03 });
      ss1.setAttribute('rotation', { x: 0, y: 90, z: 90 });
      ss1.setAttribute('mixin', 'stop_sign');
      el.appendChild(ss1);
    }
    if (stopsignArray[1]) {
      const ss2 = document.createElement('a-entity');
      ss2.setAttribute('position', { x: -dimensionsArray[0] / 2, y: -dimensionsArray[1] / 3, z: 0.03 });
      ss2.setAttribute('rotation', { x: 0, y: -90, z: -90 });
      ss2.setAttribute('mixin', 'stop_sign');
      el.appendChild(ss2);
    }
    if (stopsignArray[2]) {
      const ss3 = document.createElement('a-entity');
      ss3.setAttribute('position', { x: -dimensionsArray[0] / 3, y: dimensionsArray[1] / 2, z: 0.03 });
      ss3.setAttribute('rotation', { x: -90, y: 90, z: 90 });
      ss3.setAttribute('mixin', 'stop_sign');
      el.appendChild(ss3);
    }
    if (stopsignArray[3]) {
      const ss4 = document.createElement('a-entity');
      ss4.setAttribute('position', { x: dimensionsArray[0] / 3, y: -dimensionsArray[1] / 2, z: 0.03 });
      ss4.setAttribute('rotation', { x: 90, y: -90, z: -90 });
      ss4.setAttribute('mixin', 'stop_sign');
      el.appendChild(ss4);
    }

    if (trafficsignalArray[0]) {
      const ts1 = document.createElement('a-entity');
      ts1.setAttribute('position', { x: dimensionsArray[0] / 2, y: dimensionsArray[1] / 3, z: 0.03 });
      ts1.setAttribute('rotation', { x: 210, y: 90, z: 90 });
      ts1.setAttribute('mixin', 'signal_left');
      el.appendChild(ts1);
      const ts2 = document.createElement('a-entity');
      ts2.setAttribute('position', { x: dimensionsArray[0] / 2, y: -dimensionsArray[1] / 3, z: 0.03 });
      ts2.setAttribute('rotation', { x: 180, y: 90, z: 90 });
      ts2.setAttribute('mixin', 'signal_right');
      el.appendChild(ts2);
    }
    if (trafficsignalArray[1]) {
      const ts3 = document.createElement('a-entity');
      ts3.setAttribute('position', { x: -dimensionsArray[0] / 2, y: -dimensionsArray[1] / 3, z: 0.03 });
      ts3.setAttribute('rotation', { x: 30, y: 90, z: 90 });
      ts3.setAttribute('mixin', 'signal_left');
      el.appendChild(ts3);
      const ts4 = document.createElement('a-entity');
      ts4.setAttribute('position', { x: -dimensionsArray[0] / 2, y: dimensionsArray[1] / 3, z: 0.03 });
      ts4.setAttribute('rotation', { x: 0, y: 90, z: 90 });
      ts4.setAttribute('mixin', 'signal_right');
      el.appendChild(ts4);
    }
    if (trafficsignalArray[2]) {
      const ts5 = document.createElement('a-entity');
      ts5.setAttribute('position', { x: -dimensionsArray[0] / 3, y: dimensionsArray[1] / 2, z: 0.03 });
      ts5.setAttribute('rotation', { x: 120, y: 90, z: 90 });
      ts5.setAttribute('mixin', 'signal_left');
      el.appendChild(ts5);
      const ts6 = document.createElement('a-entity');
      ts6.setAttribute('position', { x: dimensionsArray[0] / 3, y: dimensionsArray[1] / 2, z: 0.03 });
      ts6.setAttribute('rotation', { x: 90, y: 90, z: 90 });
      ts6.setAttribute('mixin', 'signal_right');
      el.appendChild(ts6);
    }
    if (trafficsignalArray[3]) {
      const ts7 = document.createElement('a-entity');
      ts7.setAttribute('position', { x: dimensionsArray[0] / 3, y: -dimensionsArray[1] / 2, z: 0.03 });
      ts7.setAttribute('rotation', { x: -60, y: 90, z: 90 });
      ts7.setAttribute('mixin', 'signal_left');
      el.appendChild(ts7);
      const ts8 = document.createElement('a-entity');
      ts8.setAttribute('position', { x: -dimensionsArray[0] / 3, y: -dimensionsArray[1] / 2, z: 0.03 });
      ts8.setAttribute('rotation', { x: -90, y: 90, z: 90 });
      ts8.setAttribute('mixin', 'signal_right');
      el.appendChild(ts8);
    }

    if (crosswalklArray[0]) {
      const cw1 = document.createElement('a-entity');
      cw1.setAttribute('position', { x: dimensionsArray[0] / 2 - 2, z: 0.013 });
      cw1.setAttribute('rotation', { x: 0, y: 0, z: 180 });
      cw1.setAttribute('scale', { y: dimensionsArray[1] / 12 });
      cw1.setAttribute('mixin', 'markings crosswalk-zebra');
      el.appendChild(cw1);
    }
    if (crosswalklArray[1]) {
      const cw2 = document.createElement('a-entity');
      cw2.setAttribute('position', { x: -dimensionsArray[0] / 2 + 2, z: 0.012 });
      cw2.setAttribute('rotation', { x: 0, y: 0, z: 180 });
      cw2.setAttribute('scale', { y: dimensionsArray[1] / 12 });
      cw2.setAttribute('mixin', 'markings crosswalk-zebra');
      el.appendChild(cw2);
    }
    if (crosswalklArray[2]) {
      const cw3 = document.createElement('a-entity');
      cw3.setAttribute('position', { y: -dimensionsArray[1] / 2 + 2, z: 0.011 });
      cw3.setAttribute('rotation', { x: 0, y: 0, z: 90 });
      cw3.setAttribute('scale', { y: dimensionsArray[0] / 12 });
      cw3.setAttribute('mixin', 'markings crosswalk-zebra');
      el.appendChild(cw3);
    }
    if (crosswalklArray[3]) {
      const cw4 = document.createElement('a-entity');
      cw4.setAttribute('position', { y: dimensionsArray[1] / 2 - 2, z: 0.01 });
      cw4.setAttribute('rotation', { x: 0, y: 0, z: 90 });
      cw4.setAttribute('scale', { y: dimensionsArray[0] / 12 });
      cw4.setAttribute('mixin', 'markings crosswalk-zebra');
      el.appendChild(cw4);
    }
  }
});

AFRAME.registerComponent('street-environment', {
  schema: {
    preset: { type: 'string', default: 'day', oneOf: ['day', 'night'] }
  },
  init: function () {
    var data = this.data;
    var el = this.el;
    if (data.preset === 'night') {
      const light = document.createElement('a-entity');
      light.setAttribute('id', 'light');
      light.setAttribute('light', { type: 'ambient', color: '#FFF', intensity: 0.5 });
      el.appendChild(light);
      const light2 = document.createElement('a-entity');
      light2.setAttribute('id', 'light');
      light2.setAttribute('position', { x: 0.5, y: 1, z: -1 });
      light2.setAttribute('light', { type: 'directional', color: '#FFF', intensity: 0.15 });
      el.appendChild(light2);
      const sky = document.createElement('a-sky');
      sky.setAttribute('id', 'sky');
      sky.setAttribute('color', '#444');
      sky.setAttribute('src', '#sky-night');

      el.appendChild(sky);
    } else { // day
      // TODO: create a parent with children
      const light = document.createElement('a-entity');
      light.setAttribute('id', 'light');
      light.setAttribute('light', { type: 'ambient', color: '#FFF', intensity: 2 });
      el.appendChild(light);
      const light2 = document.createElement('a-entity');
      light2.setAttribute('id', 'light');
      light2.setAttribute('position', { x: 0.5, y: 1, z: -1 });
      light2.setAttribute('light', { type: 'directional', color: '#FFF', intensity: 0.6 });
      el.appendChild(light2);
      const sky = document.createElement('a-sky');
      sky.setAttribute('id', 'sky');
      sky.setAttribute('src', '#sky');
      sky.setAttribute('rotation', '0 255 0');
      el.appendChild(sky);
    }
  }
});

// Vehicle wheel Animation
AFRAME.registerComponent('wheel', {
  schema: {
    speed: { type: 'number', default: 1 },
    wheelDiameter: { type: 'number', default: 1 }
  },

  init: function () {
    const el = this.el;
    const self = this;
    el.addEventListener('model-loaded', (e) => {
      const vehicle = el.getObject3D('mesh');
      if (!vehicle) {
        return;
      }

      self.wheel_F_L = vehicle.getObjectByName('wheel_F_L');
      self.wheel_F_R = vehicle.getObjectByName('wheel_F_R');
      self.wheel_B_L = vehicle.getObjectByName('wheel_B_L');
      self.wheel_B_R = vehicle.getObjectByName('wheel_B_R');

      // For Truck extra Wheels
      self.wheel_B_L_2 = vehicle.getObjectByName('wheel_B_L_2');
      self.wheel_B_R_2 = vehicle.getObjectByName('wheel_B_R_2');
    });
  },
  tick: function (t, dt) {
    const speed = this.data.speed / 1000;
    const wheelDiameter = this.data.wheelDiameter;

    const rateOfRotation = (2 * (speed / wheelDiameter)) * dt;

    if (this.wheel_F_L) {
      this.wheel_F_L.rotateY(rateOfRotation);
    }
    if (this.wheel_F_R) {
      this.wheel_F_R.rotateY(rateOfRotation);
    }
    if (this.wheel_B_L) {
      this.wheel_B_L.rotateY(rateOfRotation);
    }

    if (this.wheel_B_L_2) {
      this.wheel_B_L_2.rotateY(rateOfRotation);
    }

    if (this.wheel_B_R_2) {
      this.wheel_B_R_2.rotateY(rateOfRotation);
    }
    if (this.wheel_B_R) {
      this.wheel_B_R.rotateY(rateOfRotation);
    }
  }
});
