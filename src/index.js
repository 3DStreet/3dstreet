/* global AFRAME, XMLHttpRequest, VERSION */

if (typeof VERSION !== 'undefined') {
  console.log(`3DStreet Version: ${VERSION}`);
}

var streetmixParsers = require('./aframe-streetmix-parsers');
var streetmixUtils = require('./tested/streetmix-utils');
require('./json-utils_1.1.js');
require('./components/gltf-part');
require('./components/ocean');
require('./components/svg-extruder.js');
require('./lib/aframe-cursor-teleport-component.min.js');
require('./lib/animation-mixer.js');
require('./assets.js');
require('./components/notify.js');
require('./components/create-from-json');
require('./components/screentock.js');
require('aframe-atlas-uvs-component');
require('./components/streetplan-loader');
require('./components/street-geo.js');
require('./components/intersection.js');

AFRAME.registerComponent('street', {
  schema: {
    JSON: { type: 'string' },
    type: { default: 'streetmixSegmentsMetric' }, // alt: sharedRowMeters, streetmixJSONResponse
    left: { default: '' },
    right: { default: '' },
    showGround: { default: true },
    showStriping: { default: true },
    showVehicles: { default: true },
    globalAnimated: { default: false },
    length: { default: 60 } // new default of 60 from 0.4.4
  },
  update: function (oldData) {
    // fired once at start and at each subsequent change of a schema value
    var data = this.data;

    if (data.JSON.length === 0) {
      if (oldData.JSON !== undefined && oldData.JSON.length === 0) {
        return;
      } // this has happened before, surpress console log
      console.log(
        '[street]',
        'No JSON provided yet, but it might be set at runtime'
      );
      return;
    }

    const streetmixSegments = JSON.parse(data.JSON);

    // remove .street-parent and .buildings-parent elements, if they exists, with old scene elements.
    // Because they will be created next in the processSegments and processBuildings functions
    const streetParent = this.el.querySelector('.street-parent');
    if (streetParent) {
      streetParent.remove();
    }
    const buildingParent = this.el.querySelector('.buildings-parent');
    if (buildingParent) {
      buildingParent.remove();
    }

    const streetEl = streetmixParsers.processSegments(
      streetmixSegments.streetmixSegmentsMetric,
      data.showStriping,
      data.length,
      data.globalAnimated,
      data.showVehicles
    );
    this.el.append(streetEl);

    if (data.left || data.right) {
      const streetWidth = streetmixSegments.streetmixSegmentsMetric.reduce(
        (streetWidth, segmentData) => streetWidth + segmentData.width,
        0
      );
      const buildingsEl = streetmixParsers.processBuildings(
        data.left,
        data.right,
        streetWidth,
        data.showGround,
        data.length
      );
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
  update: function (oldData) {
    // fired at start and at each subsequent change of any schema value
    // This method may fire a few times when viewing a streetmix street in 3dstreet:
    // First to find the proper path, once to actually load the street, and then subsequent updates such as street name
    var data = this.data;
    var el = this.el;

    // if the loader has run once already, and upon update neither URL has changed, do not take action
    if (
      oldData.streetmixStreetURL === data.streetmixStreetURL &&
      oldData.streetmixAPIURL === data.streetmixAPIURL
    ) {
      // console.log('[streetmix-loader]', 'Neither streetmixStreetURL nor streetmixAPIURL have changed in this component data update, not reloading street.')
      return;
    }

    // if no value for 'streetmixAPIURL' then let's see if there's a streetmixURL
    if (data.streetmixAPIURL.length === 0) {
      if (data.streetmixStreetURL.length > 0) {
        const streetmixAPIURL = streetmixUtils.streetmixUserToAPI(
          data.streetmixStreetURL
        );
        console.log(
          '[streetmix-loader]',
          'setting `streetmixAPIURL` to',
          streetmixAPIURL
        );
        el.setAttribute('streetmix-loader', 'streetmixAPIURL', streetmixAPIURL);
        return;
      }
      console.log(
        '[streetmix-loader]',
        'Neither `streetmixAPIURL` nor `streetmixStreetURL` properties provided, please provide at least one.'
      );
      return;
    }

    var request = new XMLHttpRequest();
    console.log('[streetmix-loader]', 'GET ' + data.streetmixAPIURL);

    request.open('GET', data.streetmixAPIURL, true);
    request.onload = function () {
      if (this.status >= 200 && this.status < 400) {
        // Connection success
        const streetmixResponseObject = JSON.parse(this.response);
        // convert units of measurement if necessary
        const streetData = streetmixUtils.convertStreetValues(
          streetmixResponseObject.data.street
        );
        const streetmixSegments = streetData.segments;

        const streetmixName = streetmixResponseObject.name;
        console.log('streetmixName', streetmixName);
        el.setAttribute('streetmix-loader', 'name', streetmixName);

        let currentSceneTitle;
        if (AFRAME.scenes[0] && AFRAME.scenes[0].getAttribute('metadata')) {
          currentSceneTitle =
            AFRAME.scenes[0].getAttribute('metadata').sceneTitle;
        }
        if (!currentSceneTitle) {
          // only set title from streetmix if none exists
          AFRAME.scenes[0].setAttribute(
            'metadata',
            'sceneTitle',
            streetmixName
          );
          console.log(
            'therefore setting metadata sceneTitle as streetmixName',
            streetmixName
          );
        }

        el.setAttribute('data-layer-name', 'Streetmix • ' + streetmixName);

        if (data.showBuildings) {
          el.setAttribute('street', 'right', streetData.rightBuildingVariant);
          el.setAttribute('street', 'left', streetData.leftBuildingVariant);
        }
        el.setAttribute('street', 'type', 'streetmixSegmentsMetric');
        // set JSON attribute last or it messes things up
        el.setAttribute(
          'street',
          'JSON',
          JSON.stringify({ streetmixSegmentsMetric: streetmixSegments })
        );
        el.emit('streetmix-loader-street-loaded');
      } else {
        // We reached our target server, but it returned an error
        console.log(
          '[streetmix-loader]',
          'Loading Error: We reached the target server, but it returned an error'
        );
      }
    };
    request.onerror = function () {
      // There was a connection error of some sort
      console.log(
        '[streetmix-loader]',
        'Loading Error: There was a connection error of some sort'
      );
    };
    request.send();
  }
});

AFRAME.registerComponent('street-environment', {
  schema: {
    preset: {
      type: 'string',
      default: 'day',
      oneOf: [
        'day',
        'night',
        'color',
        'sunny-morning',
        'cloudy-afternoon',
        'sunny-afternoon',
        'sunny-noon',
        'foggy',
        'cloudy'
      ]
    },
    backgroundColor: { type: 'color', default: '#FFF' }
  },
  setEnvOption: function () {
    const sky = this.sky;
    const light1 = this.light1;
    const light2 = this.light2;
    const assetsPathRoot = '//assets.3dstreet.app/';

    sky.setAttribute('hide-on-enter-ar', '');

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
      light2.setAttribute(
        'light',
        'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048'
      );
      light2.setAttribute('position', '-40 56 -16');
    } else if (this.data.preset === 'sunny-morning') {
      light1.setAttribute('light', 'intensity', 0.8);
      light2.setAttribute(
        'light',
        'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048'
      );
      light2.setAttribute('position', '-60 56 -16');
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute(
        'src',
        `url(${assetsPathRoot}images/skies/2048-polyhaven-qwantani_puresky-sdr.jpeg)`
      );
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'cloudy-afternoon') {
      light1.setAttribute('light', 'intensity', 2);
      light2.setAttribute('light', 'intensity', 0.6);
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute(
        'src',
        `url(${assetsPathRoot}images/skies/2048-mud_road_puresky-sdr.jpeg)`
      );
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'sunny-afternoon') {
      light1.setAttribute('light', 'intensity', 2);
      light2.setAttribute(
        'light',
        'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048'
      );
      light2.setAttribute('position', '60 56 -16');
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute(
        'src',
        `url(${assetsPathRoot}images/skies/2048-kloofendal_43d_clear_puresky-sdr.jpeg)`
      );
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'sunny-noon') {
      light1.setAttribute('light', 'intensity', 2);
      light2.setAttribute(
        'light',
        'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048'
      );
      light2.setAttribute('position', '5 56 -16');
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute(
        'src',
        `url(${assetsPathRoot}images/skies/2048-kloppenheim_05_puresky-sdr.jpeg)`
      );
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'foggy') {
      light1.setAttribute('light', 'intensity', 2);
      light2.setAttribute('light', 'intensity: 0.6; castShadow: false;');
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute(
        'src',
        `url(${assetsPathRoot}images/skies/2048-kloofendal_misty_morning_puresky-sdr.jpeg)`
      );
      sky.setAttribute('rotation', '0 0 0');
    } else if (this.data.preset === 'cloudy') {
      light1.setAttribute('light', 'intensity', 2);
      light2.setAttribute('light', 'intensity', 0.6);
      sky.setAttribute('visible', true);
      sky.setAttribute('color', '#FFF');
      sky.setAttribute(
        'src',
        `url(${assetsPathRoot}images/skies/2048-kloofendal_48d_partly_cloudy_puresky-sdr.jpeg)`
      );
      sky.setAttribute('rotation', '0 0 0');
    } else {
      // color
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
    light2.setAttribute(
      'light',
      'intensity: 2.2; castShadow: true; shadowCameraBottom: -20; shadowCameraLeft: -30; shadowCameraRight: 40; shadowCameraTop: 30; shadowMapHeight: 2048; shadowMapWidth: 2048'
    );
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

    const rateOfRotation = 2 * (speed / wheelDiameter) * dt;

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
