/* global AFRAME */
import { tilesWithinRadius, EQUATOR_M } from '../tested/osm-tile-math.js';
import { BuildingTileClient } from '../osm/building-tile-client.js';
import { VECTOR_TILE_SOURCES } from '../tested/basemap-providers.js';

const THREE = AFRAME.THREE;

// Camera-following scan cadence. Tiles are ~2 km at z14 — twice a second
// is plenty to stay ahead of any editor navigation.
const SCAN_INTERVAL_MS = 500;

// Per-tile retry backoff after a failed load, then a long-cycle retry so a
// recovered tile service eventually heals the scene without a reload
// (#1861).
const RETRY_DELAYS_MS = [5000, 20000, 60000];
const LONG_RETRY_MS = 5 * 60 * 1000;

// The load radius is centered on where the camera is LOOKING on the
// ground, not the point beneath it: a high, tilted editor camera sits
// kilometers from the street it frames, and centering on the nadir
// unloaded the very neighborhood on screen. Beyond this ray distance (or
// when looking at the sky) fall back to the nadir.
const MAX_FOCUS_DISTANCE_M = 5000;

// Roof/wall colors ride in as vertex colors (set in the geometry module);
// the material itself stays white so the scene's ambient + directional
// lights (street-environment) do the shading. Lambert, not Standard: matte
// massing, no env-map speculars, cheaper on 100k-triangle tiles.

/**
 * OSM 2.5D extruded buildings (#1962 step F) — the in-repo replacement for
 * osm4vr's `osm-geojson`.
 *
 * A Web Worker (src/osm/building-tiles.worker.js) does the whole per-tile
 * pipeline off the main thread: IndexedDB-cached vector-tile fetch from a
 * commercial tileset (`urlTemplate`, resolved by street-geo from the
 * basemap provider registry), protobuf decode, footprint extraction,
 * earcut triangulation. This component only tracks the camera, decides which
 * tiles to want (nearest-first within `radiusM`, unloaded beyond 1.5×),
 * and wraps returned arrays into one merged mesh per tile via
 * setObject3D — which `bvh-geometry` on the same entity picks up for
 * accelerated raycasts (#1853).
 *
 * Failure handling (#1861): a failed tile retries with backoff and, once
 * retries are exhausted, surfaces ONE user-facing notice per session
 * ("buildings unavailable") instead of an unhandled rejection — then keeps
 * retrying on a long cycle so an Overpass recovery heals the scene.
 *
 * Geometry arrives in the scene frame (x = north, y = up, z = east), so
 * the entity needs no rotation.
 */
AFRAME.registerComponent('osm-buildings', {
  schema: {
    latitude: { type: 'number', default: 0 },
    longitude: { type: 'number', default: 0 },
    radiusM: { type: 'number', default: 1000 },
    // MapTiler Planet vector tiles end at z14 (~1.9 km at mid-latitudes):
    // a 1 km radius is a handful of requests instead of ~55 at z17.
    zoom: { type: 'number', default: 14 },
    // Vector tile URL template ({z}/{x}/{y}, key already substituted) and
    // the provider's building-layer conventions; see VECTOR_TILE_SOURCES.
    urlTemplate: { type: 'string', default: '' },
    buildingLayer: { type: 'string', default: 'building' },
    heightKeys: {
      type: 'array',
      default: VECTOR_TILE_SOURCES.maptiler.heightKeys
    },
    minHeightKeys: {
      type: 'array',
      default: VECTOR_TILE_SOURCES.maptiler.minHeightKeys
    },
    // Parallel tile loads against a CDN-backed tileset.
    maxConcurrent: { type: 'number', default: 4 },
    // Layer opacity (street-geo passes its map opacity through so the
    // buildings dim with the 2.5D ground). At 0 the host also hides the
    // entity and tick() stops scanning, so no tile downloads while
    // invisible — same contract as tiled-basemap.
    opacity: { type: 'number', default: 1, min: 0, max: 1 }
  },

  init: function () {
    this.client = null;
    this.loadedTiles = new Map(); // key → { mesh | null }
    this.inFlight = new Set(); // keys
    this.failures = new Map(); // key → { attempts, nextRetryAt }
    this.notifiedFailure = false;
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this._camWorld = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._focus = new THREE.Vector3();
    this.tick = AFRAME.utils.throttleTick(this.tick, SCAN_INTERVAL_MS, this);
  },

  update: function (oldData) {
    if (
      oldData.latitude !== undefined &&
      (oldData.latitude !== this.data.latitude ||
        oldData.longitude !== this.data.longitude ||
        oldData.zoom !== this.data.zoom ||
        oldData.urlTemplate !== this.data.urlTemplate)
    ) {
      // New origin, tiling or source invalidates every loaded tile.
      this.reset();
    }
    this.applyOpacity();
  },

  // One shared material for every tile mesh, so opacity is a single write
  // (same transparent-flag handling as tiled-basemap's materials).
  applyOpacity: function () {
    const opacity = this.data.opacity;
    const transparent = opacity < 1;
    if (this.material.transparent !== transparent) {
      this.material.transparent = transparent;
      this.material.needsUpdate = true;
    }
    this.material.opacity = opacity;
  },

  reset: function () {
    for (const [key, entry] of this.loadedTiles) {
      this.removeTileMesh(key, entry);
    }
    this.loadedTiles.clear();
    this.inFlight.clear();
    this.failures.clear();
    if (this.client) {
      this.client.dispose();
      this.client = null;
    }
  },

  removeTileMesh: function (key, entry) {
    if (entry.mesh) {
      this.el.removeObject3D('tile-' + key);
      entry.mesh.geometry.dispose();
    }
  },

  ensureClient: function () {
    if (!this.client) {
      const { urlTemplate, buildingLayer, heightKeys, minHeightKeys } =
        this.data;
      this.client = new BuildingTileClient({
        originLat: this.data.latitude,
        originLon: this.data.longitude,
        source: { urlTemplate, buildingLayer, heightKeys, minHeightKeys }
      });
    }
    return this.client;
  },

  // Ground point the camera is looking at (its view ray hitting the
  // entity-local y = 0 plane), or the point beneath it when the ray misses
  // or lands beyond MAX_FOCUS_DISTANCE_M. Entity-local meters.
  focusPoint: function () {
    const camera = this.el.sceneEl.camera;
    if (!camera) return null;
    const pos = camera.getWorldPosition(this._camWorld);
    const dir = camera.getWorldDirection(this._camDir);
    this._focus.copy(pos).add(dir);
    // Transform both ray points into the entity frame, then re-derive the
    // direction (worldToLocal handles the matrix inversion for us).
    this.el.object3D.worldToLocal(pos);
    this.el.object3D.worldToLocal(this._focus);
    dir.copy(this._focus).sub(pos);
    const t = dir.y < 0 ? -pos.y / dir.y : Infinity;
    if (Number.isFinite(t) && t * dir.length() <= MAX_FOCUS_DISTANCE_M) {
      return this._focus.copy(pos).addScaledVector(dir, t);
    }
    return this._focus.set(pos.x, 0, pos.z);
  },

  // Focus point → geographic position, via this entity's local frame
  // (x = north meters, z = east meters at the configured origin). The
  // inverse of the buildings projection, so EQUATOR_M-based on both axes
  // (Web Mercator local scale — see projectRing in osm-building-geometry).
  cameraLatLon: function () {
    const focus = this.focusPoint();
    if (!focus) return null;
    const northM = focus.x;
    const eastM = focus.z;
    const lat = this.data.latitude + (northM / EQUATOR_M) * 360;
    const cosLat = Math.cos((this.data.latitude * Math.PI) / 180);
    const lon = this.data.longitude + (eastM / (EQUATOR_M * cosLat)) * 360;
    return { lat, lon };
  },

  tick: function () {
    // At opacity 0 the layer is fully hidden (street-geo sets visible:false
    // on this entity), so stop scanning — no tile downloads while
    // invisible. Resumes on the first tick after opacity returns.
    if (this.data.opacity <= 0) return;
    const here = this.cameraLatLon();
    if (!here) return;
    const { radiusM, zoom } = this.data;

    const wanted = tilesWithinRadius(here.lat, here.lon, zoom, radiusM);
    // Hysteresis band: only unload beyond 1.5× the load radius so orbiting
    // a boundary doesn't thrash load/unload.
    const keepKeys = new Set(
      tilesWithinRadius(here.lat, here.lon, zoom, radiusM * 1.5).map(
        (t) => t.key
      )
    );

    for (const [key, entry] of this.loadedTiles) {
      if (!keepKeys.has(key)) {
        this.removeTileMesh(key, entry);
        this.loadedTiles.delete(key);
      }
    }

    const now = Date.now();
    for (const tile of wanted) {
      if (this.inFlight.size >= this.data.maxConcurrent) break;
      if (this.loadedTiles.has(tile.key) || this.inFlight.has(tile.key)) {
        continue;
      }
      const failure = this.failures.get(tile.key);
      if (failure && now < failure.nextRetryAt) continue;
      this.loadTile(tile);
    }
  },

  loadTile: function (tile) {
    const { key } = tile;
    this.inFlight.add(key);
    this.ensureClient()
      .loadTile({ key, zoom: this.data.zoom, x: tile.x, y: tile.y })
      .then((result) => {
        this.inFlight.delete(key);
        this.failures.delete(key);
        // The component may have been removed or reset mid-flight.
        if (!this.el.isConnected || this.client === null) return;
        this.addTileMesh(key, result);
      })
      .catch((err) => {
        this.inFlight.delete(key);
        if (err?.message === 'disposed') return;
        this.recordFailure(key, err);
      });
  },

  addTileMesh: function (key, { positions, normals, colors, indices }) {
    if (positions.length === 0) {
      // Empty tile (water, park): remember it so we don't refetch.
      this.loadedTiles.set(key, { mesh: null });
      return;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    // The environment's directional light shadow frustum only spans the
    // street area near the origin, so this is cheap and lands exactly
    // where it matters: buildings shade the street and each other.
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // setObject3D fires object3dset, which bvh-geometry listens for.
    this.el.setObject3D('tile-' + key, mesh);
    this.loadedTiles.set(key, { mesh });
  },

  recordFailure: function (key, err) {
    const failure = this.failures.get(key) || { attempts: 0, nextRetryAt: 0 };
    failure.attempts++;
    const delay =
      RETRY_DELAYS_MS[failure.attempts - 1] !== undefined
        ? RETRY_DELAYS_MS[failure.attempts - 1]
        : LONG_RETRY_MS;
    failure.nextRetryAt = Date.now() + delay;
    this.failures.set(key, failure);

    if (failure.attempts >= RETRY_DELAYS_MS.length && !this.notifiedFailure) {
      this.notifiedFailure = true;
      console.warn('osm-buildings: tile loads failing', key, err?.message);
      window.STREET?.notify?.warningMessage?.(
        '3D buildings are unavailable right now (building tile service ' +
          'error). The rest of the scene still works; buildings will ' +
          'appear automatically if the service recovers.'
      );
    }
  },

  remove: function () {
    this.reset();
    this.material.dispose();
  }
});
