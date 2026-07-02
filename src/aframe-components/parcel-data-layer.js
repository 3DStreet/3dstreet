/* global AFRAME, THREE */

// parcel-data-layer — hackathon POC of a hover/inspect "data layer".
//
// Simulates per-parcel interactivity without creating a mesh per parcel:
// parcel polygons + metadata are fetched from a local ZoningViz server
// (https://github.com/kfarr/zoningviz, `uvicorn server:app --port 8081`) for
// a radius around the scene's street-geo anchor. On mousemove we raycast the
// mouse onto the ground plane, convert the hit point to lat/lon by inverting
// the same equirectangular projection the `geojson` component uses, and do a
// point-in-polygon lookup against the fetched parcels. The hovered parcel
// gets a highlight mesh + tooltip; click pins a metadata card.
//
// The entity is expected to have rotation "0 -90 0" (the same "X+ north"
// convention as imported geojson buildings); all math uses worldToLocal so
// any parent transform works.

const EQUATOR_M = 40075017;
const POLES_M = 40007863;
const M_TO_FT = 3.28084;

AFRAME.registerComponent('parcel-data-layer', {
  schema: {
    serverUrl: { type: 'string', default: 'http://localhost:8081' },
    jurisdiction: { type: 'string', default: 'sf' },
    radiusM: { type: 'number', default: 600 }, // half-size of fetch bbox around anchor
    showFootprints: { type: 'boolean', default: true },
    enabled: { type: 'boolean', default: true }
  },

  init: function () {
    this.parcels = []; // {props, rings: [[{x,z}...]], bbox: {minX,maxX,minZ,maxZ}}
    this.anchor = null; // {lat, lon}
    this.hovered = null;
    this.pinned = null;

    this.raycaster = new THREE.Raycaster();
    this.groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.mouseNdc = new THREE.Vector2();
    this.hitWorld = new THREE.Vector3();
    this.hitLocal = new THREE.Vector3();
    this.lastMove = 0;

    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.downXY = { x: 0, y: 0 };

    this.tooltipEl = this.createOverlay({
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: 10000,
      background: 'rgba(20, 20, 28, 0.92)',
      color: '#fff',
      font: '12px/1.5 monospace',
      padding: '6px 10px',
      borderRadius: '6px',
      border: '1px solid #444',
      display: 'none',
      maxWidth: '300px'
    });
    const canvas = this.el.sceneEl.canvas;
    if (canvas) {
      this.attachListeners(canvas);
    } else {
      this.el.sceneEl.addEventListener(
        'render-target-loaded',
        () => this.attachListeners(this.el.sceneEl.canvas),
        { once: true }
      );
    }

    // If the layer was added before the scene had a location (or the location
    // changes), reload once street-geo announces new coordinates.
    this.onNewGeo = (evt) => {
      const lat = Number(evt.detail?.latitude);
      const lon = Number(evt.detail?.longitude);
      if (!lat && !lon) return;
      if (this.anchor && lat === this.anchor.lat && lon === this.anchor.lon) {
        return;
      }
      this.el.removeObject3D('footprints');
      this.loadParcels();
    };
    this.el.sceneEl.addEventListener('newGeo', this.onNewGeo);

    this.loadParcels();
  },

  attachListeners: function (canvas) {
    this.canvas = canvas;
    canvas.addEventListener('mousemove', this.onMouseMove);
    canvas.addEventListener('mousedown', this.onMouseDown);
    canvas.addEventListener('mouseup', this.onMouseUp);
  },

  remove: function () {
    if (this.canvas) {
      this.canvas.removeEventListener('mousemove', this.onMouseMove);
      this.canvas.removeEventListener('mousedown', this.onMouseDown);
      this.canvas.removeEventListener('mouseup', this.onMouseUp);
    }
    this.el.sceneEl.removeEventListener('newGeo', this.onNewGeo);
    this.tooltipEl.remove();
  },

  // Overlays are owned per component instance (no shared ids) so removing one
  // parcel-data-layer entity never pulls the DOM out from under another.
  createOverlay: function (styles) {
    const el = document.createElement('div');
    Object.assign(el.style, styles);
    document.body.appendChild(el);
    return el;
  },

  getAnchor: function () {
    const geoEl = document.querySelector('[street-geo]');
    if (!geoEl) return null;
    const geo = geoEl.getAttribute('street-geo');
    if (!geo || (Number(geo.latitude) === 0 && Number(geo.longitude) === 0)) {
      return null;
    }
    return { lat: Number(geo.latitude), lon: Number(geo.longitude) };
  },

  // lat/lon -> local meters, matching the geojson component's projection:
  // x = east, -z = north (extruded shapes get rotateX(-PI/2)).
  lonLatToLocal: function (lon, lat) {
    const circumference =
      EQUATOR_M * Math.cos((this.anchor.lat * Math.PI) / 180);
    return {
      x: ((lon - this.anchor.lon) / 360) * circumference,
      z: -((lat - this.anchor.lat) / 360) * POLES_M
    };
  },

  localToLonLat: function (x, z) {
    const circumference =
      EQUATOR_M * Math.cos((this.anchor.lat * Math.PI) / 180);
    return {
      lon: this.anchor.lon + (x / circumference) * 360,
      lat: this.anchor.lat + (-z / POLES_M) * 360
    };
  },

  loadParcels: async function () {
    this.anchor = this.getAnchor();
    if (!this.anchor) {
      console.warn(
        '[parcel-data-layer] No street-geo location set — add a geospatial location first.'
      );
      if (window.STREET?.notify) {
        STREET.notify.warningMessage(
          'Parcel layer needs a scene location. Set one via Geospatial first.'
        );
      }
      return;
    }

    const dLat = (this.data.radiusM / POLES_M) * 360;
    const dLon =
      (this.data.radiusM /
        (EQUATOR_M * Math.cos((this.anchor.lat * Math.PI) / 180))) *
      360;
    const bbox = [
      this.anchor.lon - dLon,
      this.anchor.lat - dLat,
      this.anchor.lon + dLon,
      this.anchor.lat + dLat
    ].join(',');

    const url = `${this.data.serverUrl}/parcels?bbox=${bbox}&jurisdiction=${this.data.jurisdiction}`;
    console.log('[parcel-data-layer] fetching', url);
    let json;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      json = await res.json();
    } catch (err) {
      console.error('[parcel-data-layer] fetch failed:', err);
      if (window.STREET?.notify) {
        STREET.notify.errorMessage(
          `Parcel layer: could not reach ZoningViz server at ${this.data.serverUrl} — is it running?`
        );
      }
      return;
    }

    this.parcels = json.features
      .filter((f) => f.geometry && f.geometry.type === 'Polygon')
      .map((f) => {
        const rings = f.geometry.coordinates.map((ring) =>
          ring.map(([lon, lat]) => this.lonLatToLocal(lon, lat))
        );
        const outer = rings[0];
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const p of outer) {
          if (p.x < minX) minX = p.x;
          if (p.x > maxX) maxX = p.x;
          if (p.z < minZ) minZ = p.z;
          if (p.z > maxZ) maxZ = p.z;
        }
        return { props: f.properties, rings, bbox: { minX, maxX, minZ, maxZ } };
      });

    console.log(`[parcel-data-layer] loaded ${this.parcels.length} parcels`);
    if (window.STREET?.notify) {
      STREET.notify.successMessage(
        `Parcel data layer: ${this.parcels.length} parcels loaded (hover map to inspect)`
      );
    }

    if (this.data.showFootprints) this.buildFootprintLines();
    this.buildHighlightMesh();
  },

  // Merged line segments of every parcel outline, drawn just above the ground
  // so the user can see where the (invisible) interactive parcels are.
  buildFootprintLines: function () {
    const positions = [];
    const Y = 0.15;
    for (const parcel of this.parcels) {
      const ring = parcel.rings[0];
      for (let i = 0; i < ring.length - 1; i++) {
        positions.push(ring[i].x, Y, ring[i].z);
        positions.push(ring[i + 1].x, Y, ring[i + 1].z);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(positions, 3)
    );
    const mat = new THREE.LineBasicMaterial({
      color: 0x33ccff,
      transparent: true,
      opacity: 0.55,
      // Draw on top of the 3D tiles so the grid stays visible on sloped
      // terrain (the lines sit at y≈0 which hills would otherwise bury).
      depthTest: false
    });
    const lines = new THREE.LineSegments(geom, mat);
    lines.renderOrder = 1;
    this.el.setObject3D('footprints', lines);
  },

  buildHighlightMesh: function () {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe14d,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide,
      depthWrite: false,
      // Render through the 3D tiles so highlights on sloped terrain (where
      // the ground sits above y=0) stay visible instead of being buried.
      depthTest: false
    });
    this.highlightMesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.highlightMesh.visible = false;
    this.highlightMesh.renderOrder = 2;
    this.el.setObject3D('highlight', this.highlightMesh);

    const pinnedMat = mat.clone();
    pinnedMat.color.set(0xff7a33);
    this.pinnedMesh = new THREE.Mesh(new THREE.BufferGeometry(), pinnedMat);
    this.pinnedMesh.visible = false;
    this.pinnedMesh.renderOrder = 2;
    this.el.setObject3D('pinned', this.pinnedMesh);
  },

  // Extruded volume of the parcel's zoned height envelope, so the highlight
  // reads clearly even when Google 3D tiles terrain/buildings are rendered
  // (a flat plane at y=0 gets buried under the photogrammetry).
  parcelToVolumeGeometry: function (parcel) {
    // Shape is built in XY, then rotateX(-PI/2) maps y -> -z (north), like the
    // geojson component's extrusions.
    const shape = new THREE.Shape(
      parcel.rings[0].map((p) => new THREE.Vector2(p.x, -p.z))
    );
    for (let i = 1; i < parcel.rings.length; i++) {
      shape.holes.push(
        new THREE.Path(parcel.rings[i].map((p) => new THREE.Vector2(p.x, -p.z)))
      );
    }
    const p = parcel.props;
    const heightFt = p.current_height_limit || p.current_height || 0;
    // Floor at 6m so parcels with no (or 0) recorded height limit still read
    // as a volume instead of a flat plane lost under the 3D tiles terrain.
    const heightM = Math.max(heightFt / M_TO_FT || 0, 6);
    const geom = new THREE.ExtrudeGeometry(shape, {
      depth: heightM,
      bevelEnabled: false
    });
    geom.rotateX(-Math.PI / 2);
    return geom;
  },

  pointInRing: function (x, z, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i].x;
      const zi = ring[i].z;
      const xj = ring[j].x;
      const zj = ring[j].z;
      const intersect =
        zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  },

  findParcelAt: function (x, z) {
    for (const parcel of this.parcels) {
      const b = parcel.bbox;
      if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
      if (!this.pointInRing(x, z, parcel.rings[0])) continue;
      // Points inside a hole ring are outside the parcel.
      let inHole = false;
      for (let i = 1; i < parcel.rings.length; i++) {
        if (this.pointInRing(x, z, parcel.rings[i])) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return parcel;
    }
    return null;
  },

  // Cross-layer lookup: any geojson entity in the scene whose features carry
  // a parcel_id (e.g. entities created by the Zoning Simulation wizard) can be
  // matched to a hovered/pinned parcel. Parsed feature indexes are cached on
  // the geojson entity and rebuilt if its data string changes.
  getSimulationsForParcel: function (parcelId) {
    const results = [];
    for (const el of document.querySelectorAll('[geojson]')) {
      const dataStr = el.components?.geojson?.data?.data;
      if (!dataStr) continue;
      if (!el.__parcelIndex || el.__parcelIndexSize !== dataStr.length) {
        const index = new Map();
        try {
          for (const f of JSON.parse(dataStr).features) {
            const pid = f.properties?.parcel_id || f.properties?.mapblklot;
            if (pid && !index.has(String(pid))) {
              index.set(String(pid), f.properties);
            }
          }
        } catch (err) {
          continue;
        }
        el.__parcelIndex = index;
        el.__parcelIndexSize = dataStr.length;
      }
      const props = el.__parcelIndex.get(String(parcelId));
      if (props) {
        results.push({
          layerName: el.getAttribute('data-layer-name') || 'GeoJSON layer',
          props
        });
      }
    }
    return results;
  },

  getActiveCamera: function () {
    // In the editor the inspector swaps in its own camera.
    if (window.AFRAME?.INSPECTOR?.opened && AFRAME.INSPECTOR.camera) {
      return AFRAME.INSPECTOR.camera;
    }
    return this.el.sceneEl.camera;
  },

  pickGroundPoint: function (event) {
    const rect = this.canvas.getBoundingClientRect();
    this.mouseNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1)
    );
    const camera = this.getActiveCamera();
    if (!camera) return null;
    this.raycaster.setFromCamera(this.mouseNdc, camera);
    const hit = this.raycaster.ray.intersectPlane(
      this.groundPlane,
      this.hitWorld
    );
    if (!hit) return null;
    this.hitLocal.copy(this.hitWorld);
    this.el.object3D.worldToLocal(this.hitLocal);
    return this.hitLocal;
  },

  onMouseMove: function (event) {
    if (!this.data.enabled || !this.parcels.length || !this.anchor) return;
    const now = performance.now();
    if (now - this.lastMove < 40) return; // ~25 Hz is plenty
    this.lastMove = now;

    const local = this.pickGroundPoint(event);
    const parcel = local ? this.findParcelAt(local.x, local.z) : null;

    if (parcel !== this.hovered) {
      this.hovered = parcel;
      if (parcel && this.highlightMesh) {
        this.highlightMesh.geometry.dispose();
        this.highlightMesh.geometry = this.parcelToVolumeGeometry(parcel);
        this.highlightMesh.visible = true;
      } else if (this.highlightMesh) {
        this.highlightMesh.visible = false;
      }
    }

    if (parcel) {
      const p = parcel.props;
      const geo = this.localToLonLat(local.x, local.z);
      const simLines = this.getSimulationsForParcel(p.parcel_id)
        .filter((s) => s.props.developed)
        .map(
          (s) =>
            `<span style="color:#ffb366">▲ ${s.props.scenario ?? 'simulation'}: ` +
            `builds year ${s.props.year_built} @ ${s.props.height_feet} ft</span>`
        )
        .join('<br>');
      this.tooltipEl.innerHTML =
        `<b>parcel ${p.parcel_id}</b><br>` +
        `zoning: ${p.current_zoning ?? '—'}<br>` +
        `height limit: ${p.current_height_limit ?? '—'} ft<br>` +
        `current: ${p.current_height ?? '—'} ft • ${p.current_use ?? '—'}<br>` +
        (simLines ? simLines + '<br>' : '') +
        `<span style="color:#9ad">${geo.lat.toFixed(6)}, ${geo.lon.toFixed(6)}</span>`;
      this.tooltipEl.style.display = 'block';
      this.tooltipEl.style.left = `${event.clientX + 14}px`;
      this.tooltipEl.style.top = `${event.clientY + 14}px`;
    } else {
      this.tooltipEl.style.display = 'none';
    }
  },

  onMouseDown: function (event) {
    this.downXY = { x: event.clientX, y: event.clientY };
  },

  onMouseUp: function (event) {
    if (!this.data.enabled || !this.anchor) return;
    // Ignore drags (camera orbit).
    const dx = event.clientX - this.downXY.x;
    const dy = event.clientY - this.downXY.y;
    if (dx * dx + dy * dy > 9) return;

    const local = this.pickGroundPoint(event);
    const parcel = local ? this.findParcelAt(local.x, local.z) : null;
    this.setPinned(parcel, local);
  },

  setPinned: function (parcel, local) {
    this.pinned = parcel;
    this.pinnedLatLon =
      parcel && local ? this.localToLonLat(local.x, local.z) : null;
    this.pinnedSims = parcel
      ? this.getSimulationsForParcel(parcel.props.parcel_id)
      : [];

    if (this.pinnedMesh) {
      if (parcel) {
        this.pinnedMesh.geometry.dispose();
        this.pinnedMesh.geometry = this.parcelToVolumeGeometry(parcel);
        this.pinnedMesh.visible = true;
      } else {
        this.pinnedMesh.visible = false;
      }
    }

    // The pinned parcel is a pseudo entity: surface its details in the editor
    // sidebar by selecting this layer entity (ParcelLayerSidebar renders the
    // parcel rows; Show Advanced still exposes the layer's own settings).
    // Deferred so it wins over the editor raycaster's click handler, which
    // fires after mouseup and would otherwise deselect (tiles ignore rays).
    if (parcel && window.AFRAME?.INSPECTOR?.opened) {
      setTimeout(() => {
        if (AFRAME.INSPECTOR.selectedEntity !== this.el) {
          AFRAME.INSPECTOR.selectEntity(this.el);
        }
        this.el.emit('parcelpinnedchanged');
      }, 0);
    } else {
      this.el.emit('parcelpinnedchanged');
    }
  },

  update: function (oldData) {
    if (
      oldData.serverUrl !== undefined &&
      (oldData.serverUrl !== this.data.serverUrl ||
        oldData.jurisdiction !== this.data.jurisdiction ||
        oldData.radiusM !== this.data.radiusM)
    ) {
      this.el.removeObject3D('footprints');
      this.loadParcels();
    }
    // Show/hide the cyan lot outlines. The merged LineSegments is kept and
    // toggled via visibility; built lazily if the layer loaded with it off.
    if (this.parcels.length && oldData.showFootprints !== undefined) {
      const footprints = this.el.getObject3D('footprints');
      if (this.data.showFootprints) {
        if (footprints) {
          footprints.visible = true;
        } else {
          this.buildFootprintLines();
        }
      } else if (footprints) {
        footprints.visible = false;
      }
    }
    if (this.tooltipEl && !this.data.enabled) {
      this.tooltipEl.style.display = 'none';
      if (this.highlightMesh) this.highlightMesh.visible = false;
    }
  }
});
