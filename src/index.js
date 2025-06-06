/* global AFRAME, XMLHttpRequest, VERSION */
import 'aframe-cursor-teleport-component';
import 'aframe-extras/controls/index.js';
import useStore from './store.js';
import * as streetUtils from './street-utils.js';
require('./json-utils_1.1.js'); // this defines STREET.utils
STREET.utils.newScene = streetUtils.newScene;
var streetmixParsers = require('./aframe-streetmix-parsers');
var streetmixUtils = require('./tested/streetmix-utils');

require('./aframe-components/gltf-part');
require('./aframe-components/ocean');
require('./aframe-components/svg-extruder.js');
require('./lib/animation-mixer.js');
require('./lib/aframe-gaussian-splatting-component.min.js');
require('./assets.js');
require('./aframe-components/notify.js');
require('./aframe-components/create-from-json');
require('./aframe-components/screentock.js');
require('./aframe-components/focus-animation');
require('aframe-atlas-uvs-component');
require('./aframe-components/street-geo.js');
require('./aframe-components/street-environment.js');
require('./aframe-components/intersection.js');
require('./aframe-components/obb-clipping.js');
require('./aframe-components/street-segment.js');
require('./aframe-components/managed-street.js');
require('./aframe-components/street-generated-stencil.js');
require('./aframe-components/street-generated-striping.js');
require('./aframe-components/street-generated-pedestrians.js');
require('./aframe-components/street-generated-rail.js');
require('./aframe-components/street-generated-clones.js');
require('./aframe-components/polygon-offset.js');
require('./aframe-components/street-align.js');
require('./aframe-components/street-ground.js');
require('./aframe-components/street-label.js');
require('./aframe-components/blending-opacity.js');
require('./aframe-components/measure-line.js');
require('./aframe-components/css2d-renderer.js');
require('./aframe-components/google-maps-aerial.js');
require('./aframe-components/viewer-mode.js');
require('./aframe-components/scene-timer.js');
require('./editor/index.js');
var firebase = require('./editor/services/firebase.js');

if (typeof VERSION !== 'undefined') {
  console.log(`3DStreet Version: ${VERSION}`);
}

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
    length: { default: 60 }, // new default of 60 from 0.4.4
    synchronize: { default: true }
  },
  toggleEntitiesVisibillity: function (entitiesArray, visible) {
    entitiesArray.forEach((entity) => entity.setAttribute('visible', visible));
  },
  toggleVehicles: function (showVehicles) {
    const vehicleEntities = streetUtils.getVehicleEntities();
    this.toggleEntitiesVisibillity(vehicleEntities, showVehicles);
  },
  toggleGround: function (showGround) {
    const groundEntities = Array.from(
      document.querySelectorAll('.ground-left, .ground-right')
    );
    this.toggleEntitiesVisibillity(groundEntities, showGround);
  },
  toggleStriping: function (showStriping) {
    const stripingEntities = streetUtils.getStripingEntities();
    this.toggleEntitiesVisibillity(stripingEntities, showStriping);
  },
  update: function (oldData) {
    const data = this.data;

    if (data.showGround !== oldData.showGround) {
      this.toggleGround(data.showGround);
    }

    if (data.showVehicles !== oldData.showVehicles) {
      this.toggleVehicles(data.showVehicles);
    }

    if (data.showStriping !== oldData.showStriping) {
      this.toggleStriping(data.showStriping);
    }

    // do not call the update function when the data.synchronize is set to false
    if (!data.synchronize) {
      return;
    }

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
    // Because they will be created next in the processSegments and processBuildings functions.
    // This is also necessary when changing the parameters of the street component to reload the scene.
    const streetParent = this.el.querySelector('.street-parent');
    if (streetParent) {
      streetParent.remove();
    }
    const buildingParent = this.el.querySelector('.buildings-parent');
    if (buildingParent) {
      buildingParent.remove();
    }
    console.log(firebase.auth.currentUser);

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

    // the scene has been loaded, set the synchronize flag
    this.el.setAttribute('street', 'synchronize', false);
  }
});

AFRAME.registerComponent('streetmix-loader', {
  dependencies: ['street'],
  schema: {
    streetmixStreetURL: { type: 'string' },
    streetmixAPIURL: { type: 'string' },
    showBuildings: { default: true },
    name: { default: '' },
    synchronize: { default: true }
  },
  update: function (oldData) {
    // fired at start and at each subsequent change of any schema value
    // This method may fire a few times when viewing a streetmix street in 3dstreet:
    // First to find the proper path, once to actually load the street, and then subsequent updates such as street name
    const data = this.data;
    const el = this.el;

    // do not call the update function when the data.synchronize is set to false
    if (!data.synchronize) return;

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

    const request = new XMLHttpRequest();
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

        el.setAttribute('streetmix-loader', 'name', streetmixName);

        const state = useStore.getState();
        if (!state.sceneTitle) {
          state.setSceneTitle(streetmixName);
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
        // the streetmix data has been loaded, set the synchronize flag to false
        el.setAttribute('streetmix-loader', 'synchronize', false);
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
