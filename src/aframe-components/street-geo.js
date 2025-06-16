/* global AFRAME */
import { firebaseConfig } from '../editor/services/firebase.js';
import { loadScript } from '../utils.js';

const MAPBOX_ACCESS_TOKEN_VALUE =
  'pk.eyJ1Ijoia2llcmFuZmFyciIsImEiOiJjazB0NWh2YncwOW9rM25sd2p0YTlxemk2In0.mLl4sNGDFbz_QXk0GIK02Q';

AFRAME.registerComponent('street-geo', {
  schema: {
    longitude: { type: 'number', default: 0 },
    latitude: { type: 'number', default: 0 },
    orthometricHeight: { type: 'number', default: null },
    geoidHeight: { type: 'number', default: null },
    ellipsoidalHeight: { type: 'number', default: null },
    maps: {
      type: 'string',
      default: 'google3d',
      oneOf: ['google3d', 'mapbox2d', 'osm3d', 'none']
    },
    enableClipping: { type: 'boolean', default: false },
    enableFlattening: { type: 'boolean', default: true },
    flatteningShape: {
      type: 'string'
    },
    blendMode: {
      type: 'string',
      default: '30% Opacity',
      oneOf: ['30% Opacity', '60% Opacity', 'Darker', 'Lighter', 'Normal']
    },
    blendingEnabled: { type: 'boolean', default: false }
  },
  init: function () {
    /*
      Function names for the given function types must have the following format:
      create function: <mapType>Create,
      update function: <mapType>Update,
    */
    this.mapTypes = this.el.components['street-geo'].schema.maps.oneOf;

    const urlParams = new URLSearchParams(window.location.search);
    this.isAR = urlParams.get('viewer') === 'ar';

    for (const mapType of this.mapTypes) {
      // initialize create and update functions
      this[mapType + 'Create'].bind(this);
      this[mapType + 'Update'].bind(this);
    }
  },
  remove: function () {
    document.getElementById('map-data-attribution').style.visibility = 'hidden';
  },
  returnBlendMode: function (blendModePreset) {
    // on the target, such as
    // for each blend mode preset option, create a dictionary of blend modes and their corresponding values
    const blendModes = {
      Normal: { blendMode: 'Normal', opacity: 1.0 },
      '30% Opacity': { blendMode: 'Normal', opacity: 0.3 },
      '60% Opacity': { blendMode: 'Normal', opacity: 0.6 },
      Darker: { blendMode: 'Multiply', opacity: 1.0 },
      Lighter: { blendMode: 'Additive', opacity: 1.0 }
    };
    return blendModes[blendModePreset];
  },
  update: function (oldData) {
    this.el.setAttribute('data-no-transform', '');

    const data = this.data;
    this.el.sceneEl.emit('newGeo', data);

    const updatedData = AFRAME.utils.diff(oldData, data);

    for (const mapType of this.mapTypes) {
      if (data.maps === mapType && !this[mapType]) {
        // create Map element and save a link to it in this[mapType]
        if (!this.isAR) {
          document.getElementById('map-data-attribution').style.visibility =
            'visible';
          this[mapType + 'Create']();
        }
        AFRAME.INSPECTOR.selectEntity(this.el);
      } else if (
        data.maps === mapType &&
        (updatedData.longitude ||
          updatedData.latitude ||
          updatedData.ellipsoidalHeight ||
          updatedData.enableClipping ||
          updatedData.enableFlattening ||
          updatedData.flatteningShape)
      ) {
        // call update map function with name: <mapType>Update
        this[mapType + 'Update']();
      } else if (this[mapType] && data.maps !== mapType) {
        // remove element from DOM and from this object
        this.el.removeChild(this[mapType]);
        this[mapType] = null;
        if (mapType === 'osm3d') {
          this.el.removeChild(this['osm3dBuilding']);
        }
        AFRAME.INSPECTOR.selectEntity(this.el);
      }
    }

    if (this.google3d) {
      // Handle clipping updates
      if (data.enableClipping) {
        this.google3d.setAttribute('obb-clipping', '');
      } else {
        this.google3d.removeAttribute('obb-clipping');
      }

      // Handle blending updates
      if (data.blendingEnabled) {
        if (data.blendMode) {
          this.google3d.setAttribute(
            'blending-opacity',
            this.returnBlendMode(data.blendMode)
          );
          if (oldData.blendingEnabled === false) {
            const currentEl = this.google3d;
            this.el.removeChild(currentEl);
            this.google3d = null;
            this.google3dCreate();
            AFRAME.INSPECTOR.selectEntity(this.el);
          }
        }
      } else {
        this.google3d.removeAttribute('blending-opacity');
        if (oldData.blendingEnabled) {
          // If blending was previously enabled and now disabled, recreate the tiles
          const currentEl = this.google3d;
          this.el.removeChild(currentEl);
          this.google3d = null;
          this.google3dCreate();
          AFRAME.INSPECTOR.selectEntity(this.el);
        }
      }
    }
  },
  noneCreate: function () {
    // do nothing
    document.getElementById('map-data-attribution').style.visibility = 'hidden';
  },
  mapbox2dCreate: function () {
    const data = this.data;
    const el = this.el;

    const mapbox2dElement = document.createElement('a-entity');
    mapbox2dElement.setAttribute('data-layer-name', 'Mapbox Satellite Streets');
    mapbox2dElement.setAttribute(
      'geometry',
      'primitive: plane; width: 512; height: 512;'
    );
    mapbox2dElement.setAttribute(
      'material',
      'color: #ffffff; shader: flat; side: both; transparent: true;'
    );
    mapbox2dElement.setAttribute('rotation', '-90 -90 0');
    mapbox2dElement.setAttribute('anisotropy', '');
    mapbox2dElement.setAttribute('mapbox', {
      accessToken: MAPBOX_ACCESS_TOKEN_VALUE,
      center: `${data.longitude}, ${data.latitude}`,
      zoom: 18,
      style: 'mapbox://styles/mapbox/satellite-streets-v11',
      pxToWorldRatio: 4
    });
    mapbox2dElement.classList.add('autocreated');
    mapbox2dElement.setAttribute('data-ignore-raycaster', '');
    mapbox2dElement.setAttribute('data-no-transform', '');
    el.appendChild(mapbox2dElement);
    this['mapbox2d'] = mapbox2dElement;
    document.getElementById('map-copyright').textContent = 'MapBox';
  },
  google3dCreate: function () {
    const data = this.data;
    const el = this.el;
    const self = this;

    const google3dElement = document.createElement('a-entity');
    google3dElement.setAttribute('data-no-pause', '');
    google3dElement.id = 'google3d';
    if (data.enableClipping) {
      google3dElement.setAttribute('obb-clipping', '');
    }

    google3dElement.setAttribute('data-layer-name', 'Google 3D Tiles');
    google3dElement.setAttribute('data-no-transform', '');
    google3dElement.setAttribute('google-maps-aerial', {
      longitude: data.longitude,
      latitude: data.latitude,
      ellipsoidalHeight: data.ellipsoidalHeight,
      enableFlattening: data.enableFlattening,
      flatteningShape:
        data.flatteningShape && data.flatteningShape !== 'create-default'
          ? '#' + data.flatteningShape
          : '',
      apiToken: firebaseConfig.apiKey,
      copyrightEl: '#map-copyright'
    });
    google3dElement.classList.add('autocreated');

    if (AFRAME.INSPECTOR?.opened) {
      google3dElement.addEventListener(
        'loaded',
        () => {
          // emit play event to start loading tiles in Editor mode
          google3dElement.play();
        },
        { once: true }
      );
    }
    google3dElement.setAttribute('data-ignore-raycaster', '');
    el.appendChild(google3dElement);
    self['google3d'] = google3dElement;

    // if clipping is enabled, add it
    if (data.enableClipping) {
      google3dElement.setAttribute('obb-clipping', '');
    }
    // Only set blending if enabled
    if (data.blendingEnabled) {
      if (data.blendMode) {
        google3dElement.setAttribute(
          'blending-opacity',
          this.returnBlendMode(data.blendMode)
        );
      }
    }
  },
  noneUpdate: function () {
    // do nothing
    document.getElementById('map-data-attribution').style.visibility = 'hidden';
  },
  google3dUpdate: function () {
    const data = this.data;

    this.google3d.setAttribute('google-maps-aerial', {
      latitude: data.latitude,
      longitude: data.longitude,
      ellipsoidalHeight: data.ellipsoidalHeight,
      enableFlattening: data.enableFlattening,
      flatteningShape:
        data.flatteningShape && data.flatteningShape !== 'create-default'
          ? '#' + data.flatteningShape
          : ''
    });

    // if state is not clipping, then disable it
    if (data.enableClipping && !this.google3d.getAttribute('obb-clipping')) {
      this.google3d.setAttribute('obb-clipping', '');
    } else if (
      !data.enableClipping &&
      this.google3d.getAttribute('obb-clipping')
    ) {
      this.google3d.removeAttribute('obb-clipping');
    }

    // Handle blending updates
    if (data.blendingEnabled) {
      if (data.blendMode) {
        this.google3d.setAttribute(
          'blending-opacity',
          this.returnBlendMode(data.blendMode)
        );
      }
    } else {
      this.google3d.removeAttribute('blending-opacity');
    }
  },
  mapbox2dUpdate: function () {
    const data = this.data;
    this.mapbox2d.setAttribute('mapbox', {
      center: `${data.longitude}, ${data.latitude}`
    });
  },
  osm3dCreate: function () {
    const data = this.data;
    const el = this.el;
    const self = this;

    const createOsm3dElement = () => {
      const osm3dElement = document.createElement('a-entity');
      osm3dElement.setAttribute('data-layer-name', 'OpenStreetMap 2D Tiles');
      osm3dElement.setAttribute('osm-tiles', {
        lon: data.longitude,
        lat: data.latitude,
        radius_m: 2000,
        trackId: 'camera',
        url: 'https://tile.openstreetmap.org/'
      });
      osm3dElement.setAttribute('rotation', '-90 -90 0');
      osm3dElement.setAttribute('data-no-pause', '');
      osm3dElement.classList.add('autocreated');
      osm3dElement.setAttribute('data-ignore-raycaster', '');
      osm3dElement.setAttribute('data-no-transform', '');

      const osm3dBuildingElement = document.createElement('a-entity');
      osm3dBuildingElement.setAttribute(
        'data-layer-name',
        'OpenStreetMap 3D Buildings'
      );
      osm3dBuildingElement.setAttribute('osm-geojson', {
        lon: data.longitude,
        lat: data.latitude,
        radius_m: 1000,
        trackId: 'camera'
      });
      osm3dBuildingElement.setAttribute('rotation', '0 -90 0');
      osm3dBuildingElement.setAttribute('data-no-pause', '');
      osm3dBuildingElement.classList.add('autocreated');
      osm3dBuildingElement.setAttribute('data-ignore-raycaster', '');
      osm3dBuildingElement.setAttribute('data-no-transform', '');

      if (AFRAME.INSPECTOR?.opened) {
        osm3dElement.addEventListener(
          'loaded',
          () => {
            // emit play event to start loading tiles in Editor mode
            osm3dElement.play();
          },
          { once: true }
        );
      }
      if (AFRAME.INSPECTOR?.opened) {
        osm3dBuildingElement.addEventListener(
          'loaded',
          () => {
            // emit play event to start loading tiles in Editor mode
            osm3dBuildingElement.play();
          },
          { once: true }
        );
      }
      el.appendChild(osm3dElement);
      el.appendChild(osm3dBuildingElement);

      self['osm3d'] = osm3dElement;
      self['osm3dBuilding'] = osm3dBuildingElement;
      document.getElementById('map-copyright').textContent = 'OpenStreetMap';
    };

    // check whether the library has been imported. Download if not
    if (AFRAME.components['osm-tiles']) {
      createOsm3dElement();
    } else {
      loadScript(
        new URL('/src/lib/osm4vr.min.js', import.meta.url),
        createOsm3dElement
      );
    }
  },
  osm3dUpdate: function () {
    const data = this.data;
    this.osm3d.setAttribute('osm-tiles', {
      lon: data.longitude,
      lat: data.latitude
    });
    this.osm3dBuilding.setAttribute('osm-geojson', {
      lon: data.longitude,
      lat: data.latitude
    });
  }
});
