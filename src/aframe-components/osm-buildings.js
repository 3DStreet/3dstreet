/* global AFRAME */
import {
  tilesWithinRadius,
  EQUATOR_M,
  POLES_M
} from '../tested/osm-tile-math.js';
import { BuildingTileClient } from '../osm/building-tile-client.js';

const THREE = AFRAME.THREE;

// Camera-following scan cadence. Tiles are ~300 m at z17 — twice a second
// is plenty to stay ahead of any editor navigation.
const SCAN_INTERVAL_MS = 500;

// Per-tile retry backoff after a failed load, then a long-cycle retry so a
// recovered Overpass eventually heals the scene without a reload (#1861).
const RETRY_DELAYS_MS = [5000, 20000, 60000];
const LONG_RETRY_MS = 5 * 60 * 1000;

// osm4vr's building color, kept for visual continuity.
const BUILDING_COLOR = 0xaabbcc;

/**
 * OSM 2.5D extruded buildings (#1962 step F) — the in-repo replacement for
 * osm4vr's `osm-geojson`.
 *
 * A Web Worker (src/osm/building-tiles.worker.js) does the whole per-tile
 * pipeline off the main thread: IndexedDB-cached Overpass fetch with
 * endpoint rotation and backoff, footprint extraction, earcut
 * triangulation. This component only tracks the camera, decides which
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
    zoom: { type: 'number', default: 17 },
    // Parallel tile loads. Overpass rate-limits aggressively; two slots
    // keeps a full neighborhood load polite but still pipelined.
    maxConcurrent: { type: 'number', default: 2 }
  },

  init: function () {
    this.client = null;
    this.loadedTiles = new Map(); // key → { mesh | null }
    this.inFlight = new Set(); // keys
    this.failures = new Map(); // key → { attempts, nextRetryAt }
    this.notifiedFailure = false;
    this.material = new THREE.MeshBasicMaterial({ color: BUILDING_COLOR });
    this._camWorld = new THREE.Vector3();
    this.tick = AFRAME.utils.throttleTick(this.tick, SCAN_INTERVAL_MS, this);
  },

  update: function (oldData) {
    if (
      oldData.latitude !== undefined &&
      (oldData.latitude !== this.data.latitude ||
        oldData.longitude !== this.data.longitude ||
        oldData.zoom !== this.data.zoom)
    ) {
      // New origin (or tiling) invalidates every loaded tile's geometry.
      this.reset();
    }
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
      this.client = new BuildingTileClient({
        originLat: this.data.latitude,
        originLon: this.data.longitude
      });
    }
    return this.client;
  },

  // Camera world position → geographic position, via this entity's local
  // frame (x = north meters, z = east meters at the configured origin).
  cameraLatLon: function () {
    const camera = this.el.sceneEl.camera;
    if (!camera) return null;
    camera.getWorldPosition(this._camWorld);
    this.el.object3D.worldToLocal(this._camWorld);
    const northM = this._camWorld.x;
    const eastM = this._camWorld.z;
    const lat = this.data.latitude + (northM / POLES_M) * 360;
    const cosLat = Math.cos((this.data.latitude * Math.PI) / 180);
    const lon = this.data.longitude + (eastM / (EQUATOR_M * cosLat)) * 360;
    return { lat, lon };
  },

  tick: function () {
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

  addTileMesh: function (key, { positions, indices }) {
    if (positions.length === 0) {
      // Empty tile (water, park): remember it so we don't refetch.
      this.loadedTiles.set(key, { mesh: null });
      return;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
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
        '3D buildings are unavailable right now (OpenStreetMap data service ' +
          'timeout). The rest of the scene still works; buildings will ' +
          'appear automatically if the service recovers.'
      );
    }
  },

  remove: function () {
    this.reset();
    this.material.dispose();
  }
});
