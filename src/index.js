/* global AFRAME, VERSION */
import * as streetUtils from './street-utils.js';
require('./json-utils_1.1.js'); // this defines STREET.utils
STREET.utils.newScene = streetUtils.newScene;

require('./three-bvh.js'); // patch THREE prototypes with three-mesh-bvh (accelerated raycast + BVH)
require('./batch-models.js');
require('./aframe-components/gltf-model.js');
require('./aframe-components/gltf-part');
require('./aframe-components/batch-member.js');
require('./aframe-components/ocean');
require('./aframe-components/svg-extruder.js');
require('./lib/animation-mixer.js');
require('./aframe-components/splat.js');
require('./aframe-components/splat-debug.js'); // STREET.splatDebug console diagnostic
require('./assets.js');
require('./aframe-components/notify.js');
require('./aframe-components/create-from-json');
require('./aframe-components/screentock.js');
require('./aframe-components/focus-animation');
require('./aframe-components/focus-hotspot.js');
require('aframe-atlas-uvs-component');
require('./aframe-components/bvh-geometry.js');
require('./aframe-components/street-geo.js');
require('./aframe-components/geo-flatten.js');
require('./aframe-components/street-environment.js');
require('./aframe-components/flat-shadow.js'); // unlit material that shows received shadows (#2123)
require('./aframe-components/intersection.js');
require('./aframe-components/group-center.js'); // a user-set group center; nothing in the editor writes it yet
require('./aframe-components/managed-intersection.js');
require('./aframe-components/obb-clipping.js');
require('./aframe-components/street-path.js');
require('./aframe-components/street-segment.js');
require('./aframe-components/managed-street.js');
require('./aframe-components/street-generated-stencil.js');
require('./aframe-components/street-generated-striping.js');
require('./aframe-components/street-generated-pedestrians.js');
require('./aframe-components/street-generated-rail.js');
require('./aframe-components/street-generated-clones.js');
require('./aframe-components/street-generated-grass.js');
require('./aframe-components/polygon-offset.js');
require('./aframe-components/street-align.js');
require('./aframe-components/street-ground.js');
require('./aframe-components/street-label.js');
require('./aframe-components/shape-vertex.js');
require('./aframe-components/shape.js');
require('./aframe-components/css2d-renderer.js');
require('./aframe-components/google-maps-aerial.js');
require('./aframe-components/tiled-basemap.js');
require('./aframe-components/osm-buildings.js');
require('./aframe-components/osm-streets.js');
require('./aframe-components/mode-manager.js');
require('./aframe-components/play/play-mode.js');
require('./aframe-components/play/viewer-start.js');
require('./aframe-components/play/build-area.js');
require('./aframe-components/play/play-mode-vehicle.js');
require('./aframe-components/play/race-target.js');
require('./aframe-components/play/collision-marker.js');
require('./aframe-components/play/delivery-bot-mesh.js');
require('./aframe-components/play/helicopter-mesh.js');
require('./aframe-components/play/fly-mode.js');
require('./aframe-components/play/street-traffic.js');
require('./aframe-components/play/street-traffic-replay.js');
if (process.env.NODE_ENV === 'development') {
  // Dev-only ?replay=... demo bootstrap (see replay-demo.js header). The
  // compile-time gate also keeps the bundled sample manifests out of
  // production builds.
  require('./aframe-components/play/replay-demo.js');
}
require('./aframe-components/scene-timer.js');
require('./aframe-components/geojson.js');
require('./aframe-components/asset-fallback-system.js');
require('./aframe-components/asset-load-status.js');
require('./aframe-components/model-placeholder.js');
require('./editor/index.jsx');
require('./shared/services/firebase.js');

if (typeof VERSION !== 'undefined') {
  console.log(`3DStreet Version: ${VERSION}`);
}

// Legacy (classic) street root, kept so saved classic streets load and their
// toggles work. Its street is saved as children; the parser that used to
// build it from `JSON` is retired (#1720), so JSON/type/left/right/
// globalAnimated/synchronize are kept only so saved attributes parse.
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
  }
});

AFRAME.registerComponent('streetmix-loader', {
  dependencies: ['street'],
  schema: {
    streetmixStreetURL: { type: 'string' },
    streetmixAPIURL: { type: 'string' },
    showBuildings: { default: true },
    name: { default: '' },
    synchronize: { default: true },
    // Import-telemetry source (#1874), from when this loader imported.
    importSource: { type: 'string', default: '' }
  }
  // Inert: the legacy Streetmix parser is retired (#1720). Saved classic
  // streets carry their full expanded street as children and load without
  // it; a loader that would still rebuild on load is migrated before the
  // scene is created (migrate-legacy-streetmix-loader.js). The component
  // stays registered so those scenes keep its data (Convert to managed
  // street reads the Streetmix URL from it).
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
