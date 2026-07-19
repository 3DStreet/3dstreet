/* global AFRAME */
import { firebaseConfig } from '@shared/services/firebase.js';
import { loadScript } from '../utils.js';
import useStore from '../store.js';

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
    enableFlattening: { type: 'boolean', default: false },
    flatteningShape: {
      type: 'string'
    },
    // Map layer opacity in percent (0 = invisible, 100 = fully opaque).
    // Applies to the active map layer (google3d tiles, mapbox2d plane).
    opacity: { type: 'number', default: 100, min: 0, max: 100 },
    // Deprecated (#1738/#1236/#1235): kept in the schema so legacy scenes
    // parse without warnings; migrated to `opacity` in update() and no
    // longer written by the UI.
    blendMode: {
      type: 'string',
      default: '30% Opacity',
      oneOf: ['30% Opacity', '60% Opacity', 'Darker', 'Lighter', 'Normal']
    },
    blendingEnabled: { type: 'boolean', default: false },
    locationString: { type: 'string', default: '' },
    intersectionString: { type: 'string', default: '' },
    // Provenance of the geo location: where the coordinates came from. Values
    // are the GEO_SOURCES enum in @shared/constants/geoSources.js (streetmix,
    // geojson, manual, bollard-buddy = the 3DStreet mobile app, ai-assistant).
    // Empty when unknown (e.g. legacy scenes). Stamped wherever a location is
    // first established; preserved across a later activation so the original
    // origin is retained.
    source: { type: 'string', default: '' }
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
  // One-time migration of the legacy blendingEnabled/blendMode presets to
  // the opacity property. The non-opacity blend modes (Darker/Lighter) are
  // dropped — they were broken in practice (#1738) — so only the opacity
  // presets carry over.
  migrateLegacyBlendMode: function () {
    const legacyOpacity =
      {
        '30% Opacity': 30,
        '60% Opacity': 60
      }[this.data.blendMode] ?? 100;
    this.el.setAttribute('street-geo', {
      opacity: legacyOpacity,
      blendingEnabled: false
    });
  },
  hasSuggestedLocation: function () {
    // A real location to activate, as opposed to the schema default 0,0.
    return this.data.latitude !== 0 || this.data.longitude !== 0;
  },
  isGeospatialActivated: function () {
    // A finite ellipsoidalHeight is only ever written by the elevation
    // service, which is the token-charged (Pro-free) call, so its presence is
    // our proxy for an activated geospatial feature. Once activated the user
    // can freely switch between map providers; until then no map renders.
    // Note: scenes from the mobile app serialize these height keys with no
    // usable value, which A-Frame parses to NaN (a number) rather than null,
    // so we test for a finite number rather than just != null.
    return Number.isFinite(this.data.ellipsoidalHeight);
  },
  offerGeospatialActivation: function () {
    // Open the GeoModal so the user can consciously activate geospatial for
    // the suggested location. The modal's existing fallback prefills the
    // marker from this component's latitude/longitude and charges normally
    // (no fromGeojsonImport flag). We intentionally do not mutate `maps` or
    // the coordinates: declining just leaves the scene "located but not
    // activated", preserving the location for a later activation, and
    // switching a map type on re-runs update() and re-prompts. The modal
    // check avoids reopening if it is already showing.
    const { modal, setModal, setGeoModalFromActivationGate } =
      useStore.getState();
    if (modal !== 'geo') {
      setGeoModalFromActivationGate(true);
      setModal('geo');
    }
  },
  update: function (oldData) {
    this.el.setAttribute('data-no-transform', '');

    const data = this.data;
    this.el.sceneEl.emit('newGeo', data);

    // Legacy scene migration: convert saved blendingEnabled/blendMode
    // presets to the opacity property. Deferred so the setAttribute does
    // not re-enter this update() synchronously.
    if (data.blendingEnabled) {
      setTimeout(() => {
        if (this.el.components['street-geo'] === this) {
          this.migrateLegacyBlendMode();
        }
      }, 0);
    }

    const updatedData = AFRAME.utils.diff(oldData, data);

    for (const mapType of this.mapTypes) {
      if (data.maps === mapType && !this[mapType]) {
        // Geospatial activation gate (editor only). A scene can carry a
        // suggested location (latitude/longitude) without geospatial ever
        // having been activated, e.g. scenes created by the mobile app from
        // phone GPS, which never run the elevation lookup. We treat a present
        // ellipsoidalHeight as the proxy for "activated", since it is only
        // ever written by the elevation service (the same call that charges a
        // geo token, free for Pro). Until activated, suppress every map type
        // so nothing renders at the wrong elevation, and offer the GeoModal so
        // the user can consciously activate.
        if (
          mapType !== 'none' &&
          AFRAME.INSPECTOR?.opened &&
          this.hasSuggestedLocation() &&
          !this.isGeospatialActivated()
        ) {
          this.offerGeospatialActivation();
          continue;
        }
        // create Map element and save a link to it in this[mapType]
        if (!this.isAR) {
          document.getElementById('map-data-attribution').style.visibility =
            'visible';
          this[mapType + 'Create']();
        }
      } else if (
        data.maps === mapType &&
        (updatedData.longitude !== undefined ||
          updatedData.latitude !== undefined ||
          updatedData.ellipsoidalHeight !== undefined ||
          updatedData.enableFlattening !== undefined ||
          updatedData.flatteningShape !== undefined ||
          updatedData.opacity !== undefined)
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
      `color: #ffffff; shader: flat; side: both; transparent: true; opacity: ${data.opacity / 100};`
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
    mapbox2dElement.setAttribute('bvh-geometry', '');
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
    google3dElement.setAttribute('data-layer-name', 'Google 3D Tiles');
    google3dElement.setAttribute('data-no-transform', '');
    google3dElement.setAttribute('google-maps-aerial', {
      longitude: data.longitude,
      latitude: data.latitude,
      ellipsoidalHeight: data.ellipsoidalHeight,
      enableFlattening: data.enableFlattening,
      flatteningShape: data.flatteningShape ? '#' + data.flatteningShape : '',
      opacity: data.opacity / 100,
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
          : '',
      opacity: data.opacity / 100
    });
  },
  mapbox2dUpdate: function () {
    const data = this.data;
    this.mapbox2d.setAttribute('mapbox', {
      center: `${data.longitude}, ${data.latitude}`
    });
    this.mapbox2d.setAttribute('material', 'opacity', data.opacity / 100);
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
      osm3dElement.setAttribute('bvh-geometry', '');

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
      // BVH bounds trees for the merged per-tile building meshes so editor
      // raycasts (cursor anchor, any probe reaching this subtree) stay
      // O(log n) instead of scanning every building triangle (#1853).
      osm3dBuildingElement.setAttribute('bvh-geometry', '');

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
