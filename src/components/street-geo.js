/* global AFRAME */
import { firebaseConfig } from '../editor/services/firebase.js';
import { loadScript } from '../utils.js';

const MAPBOX_ACCESS_TOKEN_VALUE =
  'pk.eyJ1Ijoia2llcmFuZmFyciIsImEiOiJjazB0NWh2YncwOW9rM25sd2p0YTlxemk2In0.mLl4sNGDFbz_QXk0GIK02Q';

AFRAME.registerComponent('street-geo', {
  schema: {
    longitude: { type: 'number', default: 0 },
    latitude: { type: 'number', default: 0 },
    elevation: { type: 'number', default: null }, // deprecated
    orthometricHeight: { type: 'number', default: null },
    geoidHeight: { type: 'number', default: null },
    ellipsoidalHeight: { type: 'number', default: null },
    maps: {
      type: 'string',
      default: 'google3d',
      oneOf: ['google3d', 'mapbox2d']
    }
  },
  init: function () {
    /*
      Function names for the given function types must have the following format:
      create function: <mapType>Create,
      update function: <mapType>Update,
    */
    this.mapTypes = this.el.components['street-geo'].schema.maps.oneOf;
    this.elevationHeightConstant = 32.49158; // deprecated

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
  update: function (oldData) {
    const data = this.data;
    this.el.sceneEl.emit('newGeo', data);

    const updatedData = AFRAME.utils.diff(oldData, data);

    for (const mapType of this.mapTypes) {
      if (data.maps === mapType && !this[mapType]) {
        // create Map element and save a link to it in this[mapType]
        if (!this.isAR) {
          this[mapType + 'Create']();
        }
      } else if (
        data.maps === mapType &&
        (updatedData.longitude ||
          updatedData.latitude ||
          updatedData.ellipsoidalHeight)
      ) {
        // call update map function with name: <mapType>Update
        this[mapType + 'Update']();
      } else if (this[mapType] && data.maps !== mapType) {
        // remove element from DOM and from this object
        this.el.removeChild(this[mapType]);
        this[mapType] = null;
        if (mapType === 'google3d') {
          document.getElementById('map-data-attribution').style.visibility =
            'hidden';
        }
      }
    }
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
    el.appendChild(mapbox2dElement);
    this['mapbox2d'] = mapbox2dElement;
    document.getElementById('map-data-attribution').style.visibility = 'hidden';
  },
  google3dCreate: function () {
    const data = this.data;
    const el = this.el;
    const self = this;
    // if data.ellipsoidalHeight, use it, otherwise use data.elevation less constant (deprecated)
    const height = data.ellipsoidalHeight
      ? data.ellipsoidalHeight
      : data.elevation - this.elevationHeightConstant;

    const create3DtilesElement = () => {
      const google3dElement = document.createElement('a-entity');
      google3dElement.setAttribute('data-no-pause', '');
      google3dElement.setAttribute('data-layer-name', 'Google 3D Tiles');
      google3dElement.setAttribute('loader-3dtiles', {
        url: 'https://tile.googleapis.com/v1/3dtiles/root.json',
        long: data.longitude,
        lat: data.latitude,
        // set this to ellipsoidalHeight
        height: height,
        googleApiKey: firebaseConfig.apiKey,
        maximumSSE: 16,
        maximumMem: 400,
        cameraEl: '#camera',
        copyrightEl: '#map-copyright',
        distanceScale: 0.5
      });
      google3dElement.classList.add('autocreated');

      if (AFRAME.INSPECTOR && AFRAME.INSPECTOR.opened) {
        // emit play event to start loading tiles in Editor mode
        google3dElement.addEventListener(
          'loaded',
          () => {
            google3dElement.play();
          },
          { once: true }
        );
      }
      google3dElement.setAttribute('data-ignore-raycaster', '');
      el.appendChild(google3dElement);
      self['google3d'] = google3dElement;
      document.getElementById('map-data-attribution').style.visibility =
        'visible';
    };

    // check whether the library has been imported. Download if not
    if (AFRAME.components['loader-3dtiles']) {
      create3DtilesElement();
    } else {
      loadScript(
        new URL(
          '/src/lib/aframe-loader-3dtiles-component.min.js',
          import.meta.url
        ),
        create3DtilesElement
      );
    }
  },
  google3dUpdate: function () {
    const data = this.data;
    // if data.ellipsoidalHeight, use it, otherwise use data.elevation less constant (deprecated)
    const height = data.ellipsoidalHeight
      ? data.ellipsoidalHeight
      : data.elevation - this.elevationHeightConstant;

    this.google3d.setAttribute('loader-3dtiles', {
      lat: data.latitude,
      long: data.longitude,
      height: height
    });
  },
  mapbox2dUpdate: function () {
    const data = this.data;
    this.mapbox2d.setAttribute('mapbox', {
      center: `${data.longitude}, ${data.latitude}`
    });
  }
});
