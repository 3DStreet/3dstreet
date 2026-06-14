/* global AFRAME, THREE */

// shiny-app
// ---------
// Hosts an R/Python "Shiny" reactive web app inside a 3DStreet scene.
//
// Design (see docs/shiny-app-hosting.md):
//  * The Shiny app itself runs in an <iframe> rendered by the React side panel
//    (src/editor/components/scenegraph/ShinyPanel.jsx). The iframe is expected
//    to be same-origin (e.g. a `shinylive` static export hosted by us, which is
//    what makes script-level cooperation possible) and to include the bridge
//    shim at /shiny/bridge.js.
//  * This component is the *scene side* of the bridge. It plays the role of the
//    Leaflet map output: it receives the map's render instructions over
//    postMessage and draws the geographic features in the 3D scene, and it
//    sends Leaflet-shaped input events (`<mapId>_click`, ...) back so the
//    canonical Shiny `server` reactive logic is unchanged.
//
// The two identity attributes that matter for serialization are plain schema
// values (`src`, `mapOutputId`, `lat`, `lon`) so a saved scene re-hydrates the
// hosted app and its map anchor.
//
// postMessage protocol (both directions tagged with `__shiny3dstreet`):
//   app  -> host : { dir:'app->host', type:'ready'|'features'|'clear', mapId, geojson? }
//   host -> app  : { dir:'host->app', type:'set-input', mapId, name, value }

const EQUATOR_M = 40075017; // equatorial circumference in meters
const POLES_M = 40007863; // polar circumference in meters

AFRAME.registerComponent('shiny-app', {
  schema: {
    // URL of the hosted Shiny app (shinylive static export or a same-origin
    // page that includes /shiny/bridge.js). Read by the React panel iframe.
    src: { type: 'string', default: '/shiny/mock-streets.html' },
    // The Shiny output id of the leaflet map we hijack. Determines the input
    // event names we emit, e.g. mapOutputId 'map' -> input$map_click.
    mapOutputId: { type: 'string', default: 'map' },
    // Reference position for projecting feature lng/lat to scene meters.
    // When left at 0,0 the centroid of the first feature batch is used.
    lat: { type: 'number', default: 0 },
    lon: { type: 'number', default: 0 },
    enabled: { type: 'boolean', default: true }
  },

  init: function () {
    this.base = null; // { lat, lon } resolved projection anchor
    this.featuresEl = null;

    this.onMessage = this.onMessage.bind(this);
    this.onCanvasPointerDown = this.onCanvasPointerDown.bind(this);

    this.raycaster = new THREE.Raycaster();
    // Lines are thin; give the picker a generous threshold (meters).
    this.raycaster.params.Line.threshold = 2;
    this.pointer = new THREE.Vector2();

    window.addEventListener('message', this.onMessage);

    const canvas = this.el.sceneEl && this.el.sceneEl.canvas;
    if (canvas) {
      canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    } else {
      this.el.sceneEl.addEventListener('render-target-loaded', () => {
        this.el.sceneEl.canvas.addEventListener(
          'pointerdown',
          this.onCanvasPointerDown
        );
      });
    }

    // Let the React panel know an app entity exists / changed.
    window.dispatchEvent(new CustomEvent('shiny-app-registered'));
  },

  update: function () {
    if (this.data.lat !== 0 || this.data.lon !== 0) {
      this.base = { lat: this.data.lat, lon: this.data.lon };
    }
    window.dispatchEvent(new CustomEvent('shiny-app-registered'));
  },

  remove: function () {
    window.removeEventListener('message', this.onMessage);
    const canvas = this.el.sceneEl && this.el.sceneEl.canvas;
    if (canvas) {
      canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
    }
    this.clearFeatures();
    window.dispatchEvent(new CustomEvent('shiny-app-registered'));
  },

  // --- postMessage: app -> host -------------------------------------------

  onMessage: function (event) {
    const msg = event.data;
    if (!msg || msg.__shiny3dstreet !== true || msg.dir !== 'app->host') {
      return;
    }
    // Only react to the map output this entity is bound to.
    if (msg.mapId && msg.mapId !== this.data.mapOutputId) {
      return;
    }
    if (!this.data.enabled) {
      return;
    }

    if (msg.type === 'ready') {
      // App announced it is wired up; nothing to draw yet.
      return;
    }
    if (msg.type === 'clear') {
      this.clearFeatures();
      return;
    }
    if (msg.type === 'features' && msg.geojson) {
      this.renderFeatures(msg.geojson);
    }
  },

  // --- postMessage: host -> app -------------------------------------------

  // Send a Leaflet-shaped Shiny input back into the hosted app, e.g.
  // sendInput('click', { lat, lng }) -> input$<mapOutputId>_click
  sendInput: function (suffix, value) {
    const frame = document.getElementById('shiny-app-frame');
    if (!frame || !frame.contentWindow) {
      return;
    }
    frame.contentWindow.postMessage(
      {
        __shiny3dstreet: true,
        dir: 'host->app',
        type: 'set-input',
        mapId: this.data.mapOutputId,
        name: `${this.data.mapOutputId}_${suffix}`,
        value
      },
      '*'
    );
  },

  // --- feature rendering ---------------------------------------------------

  resolveBase: function (geojson) {
    if (this.base) {
      return this.base;
    }
    let lat = 0;
    let lon = 0;
    let count = 0;
    const visit = (coords) => {
      // coords is a position [lon, lat] or a nested array of them
      if (typeof coords[0] === 'number') {
        lon += coords[0];
        lat += coords[1];
        count += 1;
        return;
      }
      coords.forEach(visit);
    };
    (geojson.features || []).forEach((f) => {
      if (f.geometry && f.geometry.coordinates) {
        visit(f.geometry.coordinates);
      }
    });
    this.base = count
      ? { lat: lat / count, lon: lon / count }
      : { lat: 0, lon: 0 };
    return this.base;
  },

  // inverse of the geojson component's lng/lat -> scene projection, for input
  // events (scene meters x/-z back to lon/lat around the resolved anchor)
  localToLngLat: function (point, base) {
    const circumferenceM = EQUATOR_M * Math.cos((base.lat * Math.PI) / 180);
    const lon = base.lon + (point.x / circumferenceM) * 360;
    const lat = base.lat + (-point.z / POLES_M) * 360;
    return { lng: lon, lat };
  },

  clearFeatures: function () {
    if (this.featuresEl && this.featuresEl.parentNode) {
      this.featuresEl.parentNode.removeChild(this.featuresEl);
    }
    this.featuresEl = null;
  },

  // The hijacked map's render payload is plain GeoJSON, so we hand it to the
  // canonical `geojson` component (the shared GIS interpreter) rather than
  // drawing it ourselves. We only resolve the projection anchor here so it
  // matches the inverse projection used for click -> input events.
  renderFeatures: function (geojson) {
    this.clearFeatures();
    const base = this.resolveBase(geojson);

    const container = document.createElement('a-entity');
    container.classList.add('shiny-map-features');
    container.setAttribute('geojson', {
      data: JSON.stringify(geojson),
      lat: base.lat,
      lon: base.lon
    });
    this.el.appendChild(container);
    this.featuresEl = container;

    console.log(
      `[shiny-app] rendered map "${this.data.mapOutputId}" via geojson: ` +
        `${(geojson.features || []).length} features`
    );
  },

  // Collect Line/LineSegments meshes rendered by the geojson child, for picking.
  collectLineMeshes: function () {
    const meshes = [];
    if (this.featuresEl && this.featuresEl.object3D) {
      this.featuresEl.object3D.traverse((o) => {
        if (o.isLine || o.isLineSegments) {
          meshes.push(o);
        }
      });
    }
    return meshes;
  },

  // --- 3D click -> Shiny input --------------------------------------------

  onCanvasPointerDown: function (event) {
    if (!this.data.enabled || !this.base) {
      return;
    }
    const meshes = this.collectLineMeshes();
    if (!meshes.length) {
      return;
    }
    const sceneEl = this.el.sceneEl;
    const camera = sceneEl && sceneEl.camera;
    const canvas = sceneEl && sceneEl.canvas;
    if (!camera || !canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, camera);

    const hits = this.raycaster.intersectObjects(meshes, false);
    if (!hits.length) {
      return;
    }
    const lngLat = this.localToLngLat(hits[0].point, this.base);

    // Leaflet's canonical map-click input. Per-feature `_shape_click` (with a
    // feature id) needs the shared interpreter to retain ids through the merge;
    // tracked as a follow-up in docs/shiny-app-hosting.md.
    this.sendInput('click', { lat: lngLat.lat, lng: lngLat.lng });
    console.log('[shiny-app] 3D map click ->', this.data.mapOutputId, lngLat);
  }
});
