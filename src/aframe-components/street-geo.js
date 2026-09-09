/* global AFRAME */
import { firebaseConfig } from '@shared/services/firebase.js';
import useStore from '../store.js';
import {
  resolveBasemapSource,
  resolveVectorTileSource,
  DEFAULT_BASEMAP_STYLE,
  BASEMAP_STYLES
} from '../tested/basemap-providers.js';

// Basemap API keys come from the committed per-environment config
// (config/.env.*, injected by dotenv-webpack — same convention as the
// Firebase client keys) and must be origin-restricted in the provider
// dashboard. Property accesses must stay literal: dotenv-webpack does
// textual replacement, so a dynamic process.env[name] lookup would not be
// substituted at build time.
const BASEMAP_KEYS = {
  maptiler: process.env.MAPTILER_API_KEY,
  mapbox: process.env.MAPBOX_ACCESS_TOKEN
};

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
      // tiles2d replaced the legacy single-plane mapbox2d layer (#1962 step
      // C). 'mapbox2d' stays in the list only so stray legacy values parse
      // without warnings: saved scenes are migrated at load (createEntities
      // in json-utils_1.1.js) and a live mapbox2d value is treated as
      // tiles2d by activeMapType().
      oneOf: ['google3d', 'mapbox2d', 'osm3d', 'tiles2d', 'none']
    },
    // Style for the tiles2d basemap: hybrid = satellite + street labels
    // (the legacy mapbox2d look), satellite = imagery only, streets =
    // cartography. The 2.5D ground shares the tiled-basemap component but
    // pins the 'streets' style (see osm3dCreate).
    basemapStyle: {
      type: 'string',
      default: DEFAULT_BASEMAP_STYLE,
      oneOf: BASEMAP_STYLES
    },
    // Master switch for terrain flattening (#1476). Default on: any entity
    // carrying a geo-flatten component (managed streets attach one
    // automatically, mode: auto) flattens the google3d tiles under it as soon
    // as the geo layer renders. Volumes are managed per-entity by geo-flatten;
    // this only gates whether they take effect.
    enableFlattening: { type: 'boolean', default: true },
    // Deprecated (#1476): the single flattening shape reference, replaced by
    // per-entity geo-flatten components. Kept in the schema only so stray
    // legacy attribute strings parse without warnings. Saved scenes are
    // migrated at load time (createEntities in json-utils_1.1.js) and this is
    // never written by the UI.
    flatteningShape: {
      type: 'string'
    },
    // Map layer opacity in percent (0 = invisible, 100 = fully opaque).
    // Applies to the active map layer (google3d tiles, tiles2d basemap).
    opacity: { type: 'number', default: 100, min: 0, max: 100 },
    // Deprecated (#1738/#1236/#1235): kept in the schema only so stray
    // legacy attribute strings parse without warnings. Saved scenes are
    // migrated to `opacity` at load time (createEntities in
    // json-utils_1.1.js) and these are never written by the UI.
    blendMode: { type: 'string', default: '30% Opacity' },
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
      Every renderable map type has a pair of methods on this component:
      create function: <mapType>Create,
      update function: <mapType>Update.
      'mapbox2d' is a deprecated alias handled by activeMapType(), so it has
      no create/update pair and is excluded from the dispatch list.
    */
    this.mapTypes = this.el.components['street-geo'].schema.maps.oneOf.filter(
      (mapType) => mapType !== 'mapbox2d'
    );

    const urlParams = new URLSearchParams(window.location.search);
    this.isAR = urlParams.get('viewer') === 'ar';
  },
  // The map type to render for the current data. Live 'mapbox2d' values
  // (e.g. an old URL param or tool call setting the attribute directly,
  // bypassing the load-time migration) render as the tiled 2D basemap.
  activeMapType: function () {
    return this.data.maps === 'mapbox2d' ? 'tiles2d' : this.data.maps;
  },
  remove: function () {
    document.getElementById('map-data-attribution').style.visibility = 'hidden';
  },
  // Single percent→fraction boundary for every map layer's opacity.
  opacityFraction: function () {
    return this.data.opacity / 100;
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

    const updatedData = AFRAME.utils.diff(oldData, data);
    const activeMap = this.activeMapType();

    for (const mapType of this.mapTypes) {
      if (activeMap === mapType && !this[mapType]) {
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
        activeMap === mapType &&
        (updatedData.longitude !== undefined ||
          updatedData.latitude !== undefined ||
          updatedData.ellipsoidalHeight !== undefined ||
          updatedData.enableFlattening !== undefined ||
          updatedData.opacity !== undefined ||
          updatedData.basemapStyle !== undefined)
      ) {
        // call update map function with name: <mapType>Update
        this[mapType + 'Update']();
      } else if (
        activeMap !== mapType &&
        (this[mapType] || (mapType === 'osm3d' && this.osm3dBuilding))
      ) {
        // remove element(s) from DOM and from this object. osm3d is two
        // elements (tiled ground + extruded buildings) that can exist
        // independently: the ground is skipped without a provider key.
        if (this[mapType]) {
          this.el.removeChild(this[mapType]);
          this[mapType] = null;
        }
        if (mapType === 'osm3d' && this.osm3dBuilding) {
          this.el.removeChild(this.osm3dBuilding);
          this.osm3dBuilding = null;
        }
      }
    }
  },
  noneCreate: function () {
    // do nothing
    document.getElementById('map-data-attribution').style.visibility = 'hidden';
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
      opacity: this.opacityFraction(),
      apiToken: firebaseConfig.apiKey,
      copyrightEl: '#map-copyright'
    });
    // At opacity 0 hide the layer outright — google-maps-aerial's tick also
    // stops tile updates so no metered tile data downloads while invisible.
    // setAttribute (not raw object3D.visible) per the mesh-batching rule.
    google3dElement.setAttribute('visible', data.opacity > 0);
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
      opacity: this.opacityFraction()
    });
    this.google3d.setAttribute('visible', data.opacity > 0);
  },
  // Resolve a tiled raster source from the provider registry. Dev builds
  // without a provider key fall back to OSM dev tiles (with a console note);
  // production builds without a key render nothing rather than pointing
  // traffic at the OSMF server against its usage policy.
  resolveTiledSource: function (style) {
    const source = resolveBasemapSource({
      style,
      keys: BASEMAP_KEYS,
      allowDevFallback: process.env.NODE_ENV === 'development'
    });
    if (!source) {
      console.warn(
        'street-geo: no basemap provider key configured ' +
          '(set MAPTILER_API_KEY in config/.env.*) — tiles2d layer disabled.'
      );
    } else if (source.isDevFallback) {
      console.warn(
        'street-geo: MAPTILER_API_KEY not set — using OSM dev-only tiles ' +
          'for tiles2d (never shipped to production).'
      );
    }
    return source;
  },
  // Buildings come from the basemap provider's vector tiles (no dev
  // fallback: without a key the 2.5D layer renders ground only).
  resolveBuildingSource: function () {
    const source = resolveVectorTileSource({ keys: BASEMAP_KEYS });
    if (!source) {
      console.warn(
        'street-geo: no basemap provider key configured ' +
          '(set MAPTILER_API_KEY in config/.env.*) — 2.5D buildings disabled.'
      );
    }
    return source;
  },
  tiles2dCreate: function () {
    const data = this.data;
    const el = this.el;

    const source = this.resolveTiledSource(this.data.basemapStyle);
    if (!source) {
      return;
    }

    const tiles2dElement = document.createElement('a-entity');
    tiles2dElement.setAttribute('data-layer-name', '2D Satellite Map Tiles');
    // Lay the generated XY-plane surface flat: with A-Frame's YXZ rotation
    // order this maps plane east → +Z world and plane north → +X world,
    // matching google3d's legacy frame (same rotation as the other 2D maps).
    tiles2dElement.setAttribute('rotation', '-90 -90 0');
    tiles2dElement.setAttribute('tiled-basemap', {
      urlTemplate: source.urlTemplate,
      maxLevel: source.maxLevel,
      latitude: data.latitude,
      longitude: data.longitude,
      opacity: this.opacityFraction()
    });
    // At opacity 0 hide the layer outright — tiled-basemap's tick also stops
    // tile updates so nothing downloads while invisible.
    tiles2dElement.setAttribute('visible', data.opacity > 0);
    tiles2dElement.setAttribute('data-no-pause', '');
    tiles2dElement.classList.add('autocreated');
    tiles2dElement.setAttribute('data-ignore-raycaster', '');
    tiles2dElement.setAttribute('data-no-transform', '');

    if (AFRAME.INSPECTOR?.opened) {
      tiles2dElement.addEventListener(
        'loaded',
        () => {
          // emit play event to start loading tiles in Editor mode
          tiles2dElement.play();
        },
        { once: true }
      );
    }
    el.appendChild(tiles2dElement);
    this['tiles2d'] = tiles2dElement;
    document.getElementById('map-copyright').textContent = source.attribution;
  },
  tiles2dUpdate: function () {
    const data = this.data;
    // Style switches resolve a new source; tiled-basemap rebuilds its
    // tileset when urlTemplate/maxLevel change and no-ops when they do not.
    const source = this.resolveTiledSource(this.data.basemapStyle);
    if (!source) {
      return;
    }
    this.tiles2d.setAttribute('tiled-basemap', {
      urlTemplate: source.urlTemplate,
      maxLevel: source.maxLevel,
      latitude: data.latitude,
      longitude: data.longitude,
      opacity: this.opacityFraction()
    });
    this.tiles2d.setAttribute('visible', data.opacity > 0);
    document.getElementById('map-copyright').textContent = source.attribution;
  },
  osm3dCreate: function () {
    const data = this.data;
    const el = this.el;
    const self = this;

    // Ground: the same tiled basemap as tiles2d (#1962 step D), replacing
    // osm4vr's fixed-zoom `osm-tiles` planes (no LOD, unbounded tile growth,
    // OSMF tile-server traffic — #787). Style is pinned to 'streets'
    // cartography to keep the classic 2.5D look under the extruded
    // buildings; `basemapStyle` remains the 2D satellite layer's choice.
    const source = this.resolveTiledSource('streets');
    if (source) {
      const groundElement = document.createElement('a-entity');
      groundElement.setAttribute('data-layer-name', '2.5D Ground Map Tiles');
      // Same flat orientation as tiles2d (plane east → +Z, north → +X).
      groundElement.setAttribute('rotation', '-90 -90 0');
      groundElement.setAttribute('tiled-basemap', {
        urlTemplate: source.urlTemplate,
        maxLevel: source.maxLevel,
        latitude: data.latitude,
        longitude: data.longitude,
        opacity: this.opacityFraction()
      });
      groundElement.setAttribute('visible', data.opacity > 0);
      groundElement.setAttribute('data-no-pause', '');
      groundElement.classList.add('autocreated');
      groundElement.setAttribute('data-ignore-raycaster', '');
      groundElement.setAttribute('data-no-transform', '');
      if (AFRAME.INSPECTOR?.opened) {
        groundElement.addEventListener(
          'loaded',
          () => {
            // emit play event to start loading tiles in Editor mode
            groundElement.play();
          },
          { once: true }
        );
      }
      el.appendChild(groundElement);
      this['osm3d'] = groundElement;
      document.getElementById('map-copyright').textContent = source.attribution;
    }

    // Buildings: worker-driven extrusion of the provider's vector-tile
    // building layer (`osm-buildings`, #1962 step F) — replaces osm4vr's
    // main-thread `osm-geojson`. The component generates geometry directly
    // in the scene frame, so no element rotation, and it handles tile
    // failures itself (#1861).
    const buildingSource = this.resolveBuildingSource();
    if (!buildingSource) return;
    const osm3dBuildingElement = document.createElement('a-entity');
    osm3dBuildingElement.setAttribute(
      'data-layer-name',
      'OpenStreetMap 3D Buildings'
    );
    osm3dBuildingElement.setAttribute('osm-buildings', {
      latitude: data.latitude,
      longitude: data.longitude,
      radiusM: 1000,
      zoom: buildingSource.maxLevel,
      urlTemplate: buildingSource.urlTemplate,
      buildingLayer: buildingSource.buildingLayer,
      heightKeys: buildingSource.heightKeys,
      minHeightKeys: buildingSource.minHeightKeys,
      opacity: this.opacityFraction()
    });
    // At opacity 0 hide the buildings outright — osm-buildings' tick also
    // stops scanning so no vector tiles download while invisible.
    osm3dBuildingElement.setAttribute('visible', data.opacity > 0);
    osm3dBuildingElement.setAttribute('data-no-pause', '');
    osm3dBuildingElement.classList.add('autocreated');
    osm3dBuildingElement.setAttribute('data-ignore-raycaster', '');
    osm3dBuildingElement.setAttribute('data-no-transform', '');
    // BVH bounds trees for the merged per-tile building meshes so editor
    // raycasts (cursor anchor, any probe reaching this subtree) stay
    // O(log n) instead of scanning every building triangle (#1853).
    osm3dBuildingElement.setAttribute('bvh-geometry', '');
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
    el.appendChild(osm3dBuildingElement);
    self['osm3dBuilding'] = osm3dBuildingElement;
  },
  osm3dUpdate: function () {
    const data = this.data;
    if (this.osm3d) {
      const source = this.resolveTiledSource('streets');
      if (source) {
        this.osm3d.setAttribute('tiled-basemap', {
          latitude: data.latitude,
          longitude: data.longitude,
          opacity: this.opacityFraction()
        });
        this.osm3d.setAttribute('visible', data.opacity > 0);
        document.getElementById('map-copyright').textContent =
          source.attribution;
      }
    }
    if (this.osm3dBuilding) {
      this.osm3dBuilding.setAttribute('osm-buildings', {
        latitude: data.latitude,
        longitude: data.longitude,
        opacity: this.opacityFraction()
      });
      this.osm3dBuilding.setAttribute('visible', data.opacity > 0);
    }
  }
});
