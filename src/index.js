/* global AFRAME, THREE, XMLHttpRequest */
require("babel-polyfill");
if (typeof VERSION !== 'undefined') { console.log(`3DStreet Version: ${VERSION} (Date: ${new Date(COMMIT_DATE).toISOString().split('T')[0]}, Commit Hash: #${COMMIT_HASH})`); }
var streetmixParsers = require('./aframe-streetmix-parsers');
var streetmixUtils = require('./tested/streetmix-utils');
require('./components/gltf-part');
require('./components/ocean');
require('./lib/aframe-cursor-teleport-component.min.js');
require('./lib/animation-mixer.js');
require('./assets.js');
require('./components/notify.js');
require('./components/create-from-json');
require('./components/screentock.js');
require('aframe-atlas-uvs-component');

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
    length: { default: 60 } // new default of 60 from 0.4.4
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
        console.log('streetmixName', streetmixName);
        el.setAttribute('streetmix-loader', 'name', streetmixName);

        let currentSceneTitle;
        if (AFRAME.scenes[0] && AFRAME.scenes[0].getAttribute('metadata')) {
            currentSceneTitle = AFRAME.scenes[0].getAttribute('metadata').sceneTitle;
        }
        if (!currentSceneTitle) { // only set title from streetmix if none exists
          AFRAME.scenes[0].setAttribute('metadata', 'sceneTitle', streetmixName);
          console.log('therefore setting metadata sceneTitle as streetmixName', streetmixName);
        }

        el.setAttribute('data-layer-name', 'Streetmix • ' + streetmixName);

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

    // remove all child nodes if exists
    while (el.firstChild) {
      el.removeChild(el.lastChild);
    }
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

    const intersectWidth = dimensionsArray[0];
    const intersectDepth = dimensionsArray[1];

    this.el.setAttribute('geometry', `primitive:box; width: ${intersectWidth}; height: ${intersectDepth}; depth:0.2`);
    this.el.setAttribute('position', { x: positionArray[0], y: -0.1, z: positionArray[2] });
    this.el.setAttribute('rotation', '-90 0 0');
    this.el.setAttribute('material', 'src: #asphalt-texture; repeat:5 5; roughness:1');

    function createSidewalkElem ({ length, width, positionVec, scaleVec = { x: 1, y: 1, z: 1 }, rotationVec }) {
      const sd = document.createElement('a-entity');
      const repeatCountInter = [];
      repeatCountInter[0] = width / 2;
      // every 2 meters repeat sidewalk texture
      repeatCountInter[1] = parseInt(length / 2);

      sd.setAttribute('geometry', 'primitive', 'box');
      sd.setAttribute('geometry', 'height: 0.4');
      sd.setAttribute('position', positionVec);
      sd.setAttribute('scale', scaleVec);
      sd.setAttribute('geometry', 'depth', length);
      sd.setAttribute('geometry', 'width', width);
      sd.setAttribute('rotation', rotationVec);
      sd.setAttribute('mixin', 'sidewalk');
      sd.setAttribute('material', `repeat: ${repeatCountInter[0]} ${repeatCountInter[1]}`);
      el.appendChild(sd);
    }

    // describe sidewalk parameters
    const sidewalkParams = {
      west: {
        positionVec: { x: intersectWidth / 2 - sidewalkArray[0] / 2, z: 0.1 },
        rotationVec: { x: 90, y: 0, z: 0 },
        length: intersectDepth,
        width: sidewalkArray[0]
      },
      east: {
        positionVec: { x: -intersectWidth / 2 + sidewalkArray[1] / 2, z: 0.1 },
        rotationVec: { x: 90, y: 0, z: 0 },
        length: intersectDepth,
        width: sidewalkArray[1]
      },
      north: {
        positionVec: {
          y: -intersectDepth / 2 + sidewalkArray[2] / 2,
          // add x offset to avoid sidewalk's element overlap
          x: sidewalkArray[1] / 2 - sidewalkArray[0] / 2,
          z: 0.1
        },
        rotationVec: { x: 0, y: 90, z: -90 },
        // minus the width of the crossing sidewalk
        length: intersectWidth - sidewalkArray[1] - sidewalkArray[0],
        width: sidewalkArray[2]
      },
      south: {
        positionVec: {
          y: intersectDepth / 2 - sidewalkArray[3] / 2,
          // add x offset to avoid sidewalk's element overlap
          x: sidewalkArray[1] / 2 - sidewalkArray[0] / 2,
          z: 0.1
        },
        rotationVec: { x: 0, y: 90, z: -90 },
        // minus the width of the crossing sidewalk
        length: intersectWidth - sidewalkArray[1] - sidewalkArray[0],
        width: sidewalkArray[3]
      }
    };

    // create sidewalks if they are given in sidewalkArray
    const selectedSidewalks = Object.keys(sidewalkParams)
      .filter((el, ind) => sidewalkArray[ind]);

    selectedSidewalks.forEach((sidewalkName, ind) => {
      const params = sidewalkParams[sidewalkName];
      createSidewalkElem(params);
    });

    // describe curb parameters
    const curbParams = {
      northeast: {
        positionVec: { x: intersectWidth / 2 - northeastcurbArray[0] / 2, y: intersectDepth / 2 - northeastcurbArray[1] / 2, z: 0.1 },
        rotationVec: { x: 0, y: 90, z: -90 },
        length: northeastcurbArray[0],
        width: northeastcurbArray[1]
      },
      southwest: {
        positionVec: { x: -intersectWidth / 2 + southwestcurbArray[0] / 2, y: -intersectDepth / 2 + southwestcurbArray[1] / 2, z: 0.1 },
        rotationVec: { x: 0, y: 90, z: -90 },
        length: southwestcurbArray[0],
        width: southwestcurbArray[1]
      },
      southeast: {
        positionVec: { x: intersectWidth / 2 - southeastcurbArray[0] / 2, y: -intersectDepth / 2 + southeastcurbArray[1] / 2, z: 0.1 },
        rotationVec: { x: 0, y: 90, z: -90 },
        length: southeastcurbArray[0],
        width: southeastcurbArray[1]
      },
      northwest: {
        positionVec: { x: -intersectWidth / 2 + northwestcurbArray[0] / 2, y: intersectDepth / 2 - northwestcurbArray[1] / 2, z: 0.1 },
        rotationVec: { x: 0, y: 90, z: -90 },
        length: northwestcurbArray[0],
        width: northwestcurbArray[1]
      }
    };

    // create curbs if they are given
    for (const [curbName, params] of Object.entries(curbParams)) {
      if (data[`${curbName}curb`] !== '0 0') {
        createSidewalkElem(params);
      }
    }

    if (stopsignArray[0]) {
      const ss1 = document.createElement('a-entity');
      ss1.setAttribute('position', { x: intersectWidth / 2, y: intersectDepth / 3, z: 0.1 });
      ss1.setAttribute('rotation', { x: 0, y: 90, z: 90 });
      ss1.setAttribute('mixin', 'stop_sign');
      el.appendChild(ss1);
    }
    if (stopsignArray[1]) {
      const ss2 = document.createElement('a-entity');
      ss2.setAttribute('position', { x: -intersectWidth / 2, y: -intersectDepth / 3, z: 0.1 });
      ss2.setAttribute('rotation', { x: 0, y: -90, z: -90 });
      ss2.setAttribute('mixin', 'stop_sign');
      el.appendChild(ss2);
    }
    if (stopsignArray[2]) {
      const ss3 = document.createElement('a-entity');
      ss3.setAttribute('position', { x: -intersectWidth / 3, y: intersectDepth / 2, z: 0.1 });
      ss3.setAttribute('rotation', { x: -90, y: 90, z: 90 });
      ss3.setAttribute('mixin', 'stop_sign');
      el.appendChild(ss3);
    }
    if (stopsignArray[3]) {
      const ss4 = document.createElement('a-entity');
      ss4.setAttribute('position', { x: intersectWidth / 3, y: -intersectDepth / 2, z: 0.1 });
      ss4.setAttribute('rotation', { x: 90, y: -90, z: -90 });
      ss4.setAttribute('mixin', 'stop_sign');
      el.appendChild(ss4);
    }

    if (trafficsignalArray[0]) {
      const ts1 = document.createElement('a-entity');
      ts1.setAttribute('position', { x: intersectWidth / 2, y: intersectDepth / 3, z: 0.3 });
      ts1.setAttribute('rotation', { x: 210, y: 90, z: 90 });
      ts1.setAttribute('mixin', 'signal_left');
      el.appendChild(ts1);
      const ts2 = document.createElement('a-entity');
      ts2.setAttribute('position', { x: intersectWidth / 2, y: -intersectDepth / 3, z: 0.3 });
      ts2.setAttribute('rotation', { x: 180, y: 90, z: 90 });
      ts2.setAttribute('mixin', 'signal_right');
      el.appendChild(ts2);
    }
    if (trafficsignalArray[1]) {
      const ts3 = document.createElement('a-entity');
      ts3.setAttribute('position', { x: -intersectWidth / 2, y: -intersectDepth / 3, z: 0.3 });
      ts3.setAttribute('rotation', { x: 30, y: 90, z: 90 });
      ts3.setAttribute('mixin', 'signal_left');
      el.appendChild(ts3);
      const ts4 = document.createElement('a-entity');
      ts4.setAttribute('position', { x: -intersectWidth / 2, y: intersectDepth / 3, z: 0.3 });
      ts4.setAttribute('rotation', { x: 0, y: 90, z: 90 });
      ts4.setAttribute('mixin', 'signal_right');
      el.appendChild(ts4);
    }
    if (trafficsignalArray[2]) {
      const ts5 = document.createElement('a-entity');
      ts5.setAttribute('position', { x: -intersectWidth / 3, y: intersectDepth / 2, z: 0.1 });
      ts5.setAttribute('rotation', { x: 120, y: 90, z: 90 });
      ts5.setAttribute('mixin', 'signal_left');
      el.appendChild(ts5);
      const ts6 = document.createElement('a-entity');
      ts6.setAttribute('position', { x: intersectWidth / 3, y: intersectDepth / 2, z: 0.1 });
      ts6.setAttribute('rotation', { x: 90, y: 90, z: 90 });
      ts6.setAttribute('mixin', 'signal_right');
      el.appendChild(ts6);
    }
    if (trafficsignalArray[3]) {
      const ts7 = document.createElement('a-entity');
      ts7.setAttribute('position', { x: intersectWidth / 3, y: -intersectDepth / 2, z: 0.1 });
      ts7.setAttribute('rotation', { x: -60, y: 90, z: 90 });
      ts7.setAttribute('mixin', 'signal_left');
      el.appendChild(ts7);
      const ts8 = document.createElement('a-entity');
      ts8.setAttribute('position', { x: -intersectWidth / 3, y: -intersectDepth / 2, z: 0.1 });
      ts8.setAttribute('rotation', { x: -90, y: 90, z: 90 });
      ts8.setAttribute('mixin', 'signal_right');
      el.appendChild(ts8);
    }

    if (crosswalklArray[0]) {
      const cw1 = document.createElement('a-entity');
      cw1.setAttribute('position', { x: intersectWidth / 2 - 2, z: 0.11 });
      cw1.setAttribute('rotation', { x: 0, y: 0, z: 180 });
      cw1.setAttribute('scale', { y: intersectDepth / 12 });
      cw1.setAttribute('mixin', 'markings crosswalk-zebra');
      el.appendChild(cw1);
    }
    if (crosswalklArray[1]) {
      const cw2 = document.createElement('a-entity');
      cw2.setAttribute('position', { x: -intersectWidth / 2 + 2, z: 0.11 });
      cw2.setAttribute('rotation', { x: 0, y: 0, z: 180 });
      cw2.setAttribute('scale', { y: intersectDepth / 12 });
      cw2.setAttribute('mixin', 'markings crosswalk-zebra');
      el.appendChild(cw2);
    }
    if (crosswalklArray[2]) {
      const cw3 = document.createElement('a-entity');
      cw3.setAttribute('position', { y: -intersectDepth / 2 + 2, z: 0.11 });
      cw3.setAttribute('rotation', { x: 0, y: 0, z: 90 });
      cw3.setAttribute('scale', { y: intersectWidth / 12 });
      cw3.setAttribute('mixin', 'markings crosswalk-zebra');
      el.appendChild(cw3);
    }
    if (crosswalklArray[3]) {
      const cw4 = document.createElement('a-entity');
      cw4.setAttribute('position', { y: intersectDepth / 2 - 2, z: 0.11 });
      cw4.setAttribute('rotation', { x: 0, y: 0, z: 90 });
      cw4.setAttribute('scale', { y: intersectWidth / 12 });
      cw4.setAttribute('mixin', 'markings crosswalk-zebra');
      el.appendChild(cw4);
    }
  }
});

AFRAME.registerComponent('street-environment', {
  schema: {
    preset: { type: 'string', default: 'day', oneOf: ['day', 'night', 'color', 'sunny-morning', 'cloudy-afternoon', 'sunny-afternoon', 'sunny-noon', 'foggy', 'cloudy'] },
    backgroundColor: { type: 'color', default: '#FFF' }
  },
  setEnvOption: function () {
    const sky = this.sky;
    const light1 = this.light1;
    const light2 = this.light2;
    const assetsPathRoot = '//assets.3dstreet.app/';

    if (this.data.preset === 'night') {
      light1.setAttribute('light', 'intensity', 0.5);
      light2.setAttribute('light', 'intensity', 0.15);
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#444');
      sky.setAttribute('src', '#sky-night');
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'day') {
      // TODO: create a parent with children
      light1.setAttribute('light', 'intensity', 0.8);
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute('src', '#sky');
      sky.setAttribute('rotation', '0 20 0');
      light2.setAttribute('light', 'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048');
      light2.setAttribute('position', '-40 56 -16');
    } else if (this.data.preset === 'sunny-morning') {
      light1.setAttribute('light', 'intensity', 0.8);
      light2.setAttribute('light', 'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048');
      light2.setAttribute('position', '-60 56 -16');
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute('src', `url(${assetsPathRoot}images/skies/2048-polyhaven-qwantani_puresky-sdr.jpeg)`);
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'cloudy-afternoon') {
      light1.setAttribute('light', 'intensity', 2);
      light2.setAttribute('light', 'intensity', 0.6);
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute('src', `url(${assetsPathRoot}images/skies/2048-mud_road_puresky-sdr.jpeg)`);
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'sunny-afternoon') {
       light1.setAttribute('light', 'intensity', 2);
       light2.setAttribute('light', 'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048');
       light2.setAttribute('position', '60 56 -16');
       sky.setAttribute('visible', true);
       sky.setAttribute('color', '#FFF');
       sky.setAttribute('src', `url(${assetsPathRoot}images/skies/2048-kloofendal_43d_clear_puresky-sdr.jpeg)`);
       sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'sunny-noon') {
      light1.setAttribute('light', 'intensity', 2);
      light2.setAttribute('light', 'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048');
      light2.setAttribute('position', '5 56 -16');
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute('src', `url(${assetsPathRoot}images/skies/2048-kloppenheim_05_puresky-sdr.jpeg)`);
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'foggy') {
      light1.setAttribute('light', 'intensity', 2);
      light2.setAttribute('light', 'intensity: 0.6; castShadow: false;');
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute('src', `url(${assetsPathRoot}images/skies/2048-kloofendal_misty_morning_puresky-sdr.jpeg)`);
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'cloudy') {
      light1.setAttribute('light', 'intensity', 2);
      light2.setAttribute('light', 'intensity', 0.6);
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute('src', `url(${assetsPathRoot}images/skies/2048-kloofendal_48d_partly_cloudy_puresky-sdr.jpeg)`);
      sky.setAttribute('rotation', '0 0 0');      
    } else { // color
      sky.setAttribute('visible', false);
      this.scene.setAttribute('background', 'color', this.data.backgroundColor);
    }
  },
  init: function () {
    const el = this.el;
    this.scene = document.querySelector('a-scene');
    this.light1 = document.createElement('a-entity');
    const light1 = this.light1;
    light1.setAttribute('id', 'env-light1');
    light1.setAttribute('light', { type: 'ambient', color: '#FFF' });
    el.appendChild(light1);

    this.light2 = document.createElement('a-entity');
    const light2 = this.light2;
    light2.setAttribute('id', 'env-light2');
    light2.setAttribute('position', '-60 56 -16');
    light2.setAttribute('light', 'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048');
    el.appendChild(light2);

    this.sky = document.createElement('a-sky');
    const sky = this.sky;
    sky.setAttribute('id', 'env-sky');
    sky.setAttribute('data-ignore-raycaster', '');
    el.appendChild(sky);
  },
  update: function (oldData) {
    this.setEnvOption();
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
