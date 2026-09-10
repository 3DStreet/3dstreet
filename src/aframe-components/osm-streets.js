/* global AFRAME */
import { tilesWithinRadius, EQUATOR_M } from '../tested/osm-tile-math.js';
import { decodeTransportation } from '../tested/vector-tile-buildings.js';
import { cacheGet, cachePut } from '../osm/overpass-cache.js';
import {
  localPolylineFromLatLon,
  nearestWay,
  splitWayIntoChords,
  streetJsonForClass
} from '../tested/osm-street-import.js';
import { EXCLUDED_ROAD_CLASSES } from '../tested/osm-street-style.js';

const THREE = AFRAME.THREE;

// Camera-following scan cadence (same rationale as osm-buildings).
const SCAN_INTERVAL_MS = 500;
const RETRY_DELAYS_MS = [5000, 20000, 60000];
const LONG_RETRY_MS = 5 * 60 * 1000;
const MAX_FOCUS_DISTANCE_M = 5000;
const FETCH_TIMEOUT_MS = 15000;
// Bump when the cached record shape changes.
const CACHE_PREFIX = 'streets/v1/';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// How close (meters) a queried ground point must pass to a way centerline
// to count as "clicking that street".
const DEFAULT_PICK_DISTANCE_M = 25;

// Upgraded streets sit slightly above the ground street layer
// (ROADS_SURFACE_LIFT_M in tiled-basemap) so their surfaces are not
// painted over by the translucent street tint beneath them.
const UPGRADED_STREET_Y = 0.5;

// A click upgrades only the stretch of the way near the click, not the
// whole way — an OSM way can run for kilometers.
const UPGRADE_WINDOW_M = 200;
const MAX_CHORDS_PER_UPGRADE = 6;

/**
 * OSM street data streaming + click-to-upgrade (#1930 demo path).
 *
 * The VISUAL street layer is the MVT ground overlay rendered by
 * `tiled-basemap` (vectorUrlTemplate); this component is the DATA half: it
 * follows the camera like `osm-buildings` and keeps the decoded
 * `transportation` way records (class + centerline polylines, converted to
 * scene-local meters) for tiles near the focus point. That cache backs:
 *
 * - `wayAtPoint(worldPoint)` — which street is under a clicked ground
 *   point (editor "Upgrade to 3DStreet street" affordance), and
 * - `upgradeWayAt(worldPoint)` — mint real managed streets for that way
 *   (straight chords, class-preset cross sections, `playable: true` so
 *   street-traffic animates them in play mode).
 *
 * Same tile fetch (browser cache + IndexedDB via overpass-cache) as the
 * buildings worker, but on the main thread: transportation decode is a
 * few hundred lines per tile, far lighter than building extrusion.
 */
AFRAME.registerComponent('osm-streets', {
  schema: {
    latitude: { type: 'number', default: 0 },
    longitude: { type: 'number', default: 0 },
    radiusM: { type: 'number', default: 1000 },
    zoom: { type: 'number', default: 14 },
    urlTemplate: { type: 'string', default: '' },
    transportationLayer: { type: 'string', default: 'transportation' },
    maxConcurrent: { type: 'number', default: 4 },
    // street-geo passes the layer opacity through; at 0 scanning stops
    // (same contract as osm-buildings even though this layer draws
    // nothing itself).
    opacity: { type: 'number', default: 1, min: 0, max: 1 }
  },

  init: function () {
    this.loadedTiles = new Map(); // key → { ways }
    this.inFlight = new Set();
    this.failures = new Map();
    this.upgradedWayIds = new Set();
    this._camWorld = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._focus = new THREE.Vector3();
    this._local = new THREE.Vector3();
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
      this.reset();
    }
  },

  reset: function () {
    this.loadedTiles.clear();
    this.inFlight.clear();
    this.failures.clear();
  },

  // Ground point the camera is looking at — same focus logic as
  // osm-buildings (see the rationale there).
  focusPoint: function () {
    const camera = this.el.sceneEl.camera;
    if (!camera) return null;
    const pos = camera.getWorldPosition(this._camWorld);
    const dir = camera.getWorldDirection(this._camDir);
    this._focus.copy(pos).add(dir);
    this.el.object3D.worldToLocal(pos);
    this.el.object3D.worldToLocal(this._focus);
    dir.copy(this._focus).sub(pos);
    const t = dir.y < 0 ? -pos.y / dir.y : Infinity;
    if (Number.isFinite(t) && t * dir.length() <= MAX_FOCUS_DISTANCE_M) {
      return this._focus.copy(pos).addScaledVector(dir, t);
    }
    return this._focus.set(pos.x, 0, pos.z);
  },

  cameraLatLon: function () {
    const focus = this.focusPoint();
    if (!focus) return null;
    const lat = this.data.latitude + (focus.x / EQUATOR_M) * 360;
    const cosLat = Math.cos((this.data.latitude * Math.PI) / 180);
    const lon = this.data.longitude + (focus.z / (EQUATOR_M * cosLat)) * 360;
    return { lat, lon };
  },

  tick: function () {
    if (this.data.opacity <= 0 || !this.data.urlTemplate) return;
    const here = this.cameraLatLon();
    if (!here) return;
    const { radiusM, zoom } = this.data;

    const wanted = tilesWithinRadius(here.lat, here.lon, zoom, radiusM);
    const keepKeys = new Set(
      tilesWithinRadius(here.lat, here.lon, zoom, radiusM * 1.5).map(
        (t) => t.key
      )
    );
    for (const key of this.loadedTiles.keys()) {
      if (!keepKeys.has(key)) this.loadedTiles.delete(key);
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

  tileUrl: function (tile) {
    return this.data.urlTemplate
      .replace(/{\s*z\s*}/g, this.data.zoom)
      .replace(/{\s*x\s*}/g, tile.x)
      .replace(/{\s*y\s*}/g, tile.y);
  },

  loadTile: function (tile) {
    const { key } = tile;
    this.inFlight.add(key);
    this.fetchWays(tile)
      .then((ways) => {
        this.inFlight.delete(key);
        this.failures.delete(key);
        if (!this.el.isConnected) return;
        this.addTileWays(key, ways);
      })
      .catch((err) => {
        this.inFlight.delete(key);
        this.recordFailure(key, err);
      });
  },

  // Raw (lat/lon) way records for a tile: IndexedDB cache, else network.
  fetchWays: async function (tile) {
    const cacheKey = CACHE_PREFIX + tile.key;
    const cached = await cacheGet(cacheKey, CACHE_TTL_MS);
    if (cached) return cached;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let buffer;
    try {
      const res = await fetch(this.tileUrl(tile), {
        signal: controller.signal
      });
      if (res.status === 204 || res.status === 404) {
        buffer = new ArrayBuffer(0);
      } else if (!res.ok) {
        throw new Error(`street tile HTTP ${res.status}`);
      } else {
        buffer = await res.arrayBuffer();
      }
    } finally {
      clearTimeout(timer);
    }
    const ways =
      buffer.byteLength === 0
        ? []
        : decodeTransportation(
            buffer,
            { x: tile.x, y: tile.y, zoom: this.data.zoom },
            { transportationLayer: this.data.transportationLayer }
          ).filter(
            (way) =>
              !EXCLUDED_ROAD_CLASSES.has(way.class) && way.brunnel !== 'tunnel'
          );
    cachePut(cacheKey, ways);
    return ways;
  },

  addTileWays: function (key, rawWays) {
    const origin = { lat: this.data.latitude, lon: this.data.longitude };
    const ways = rawWays.map((way) => ({
      ...way,
      polylines: way.polylines.map((line) =>
        localPolylineFromLatLon(origin, line)
      )
    }));
    this.loadedTiles.set(key, { ways });
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
    if (failure.attempts === RETRY_DELAYS_MS.length) {
      console.warn('osm-streets: tile loads failing', key, err?.message);
    }
  },

  // --- lookups + upgrade ---------------------------------------------------

  // World-space point (THREE.Vector3 or {x, y?, z}) → entity-local {x, z}.
  toLocalGround: function (worldPoint) {
    this._local.set(worldPoint.x, worldPoint.y || 0, worldPoint.z);
    this.el.object3D.worldToLocal(this._local);
    return { x: this._local.x, z: this._local.z };
  },

  allWays: function () {
    const all = [];
    for (const entry of this.loadedTiles.values()) {
      for (const way of entry.ways) all.push(way);
    }
    return all;
  },

  /**
   * The street way passing nearest a world-space ground point, or null.
   * Adds `alreadyUpgraded` so UI can disable the action.
   */
  wayAtPoint: function (worldPoint, maxDistM = DEFAULT_PICK_DISTANCE_M) {
    const hit = nearestWay(
      this.allWays(),
      this.toLocalGround(worldPoint),
      maxDistM
    );
    if (!hit) return null;
    hit.alreadyUpgraded = this.upgradedWayIds.has(hit.way.wayId);
    return hit;
  },

  /**
   * Upgrade the way nearest `worldPoint` into real managed streets — one
   * straight street per chord of its centerline, `playable: true` so
   * street-traffic animates them in play mode. Idempotent per way id.
   *
   * Only the stretch near the click upgrades: a single OSM way can run for
   * kilometers (an early bug upgraded one 8 km path into 419 entities), so
   * chords are kept only within `UPGRADE_WINDOW_M` of the clicked point,
   * capped at `MAX_CHORDS_PER_UPGRADE`.
   *
   * @returns {number} how many street entities were created.
   */
  upgradeWayAt: function (worldPoint, maxDistM = DEFAULT_PICK_DISTANCE_M) {
    const hit = this.wayAtPoint(worldPoint, maxDistM);
    if (!hit || hit.alreadyUpgraded) return 0;
    return this.upgradeWay(hit.way, this.toLocalGround(worldPoint));
  },

  /**
   * @param {Object} way decoded way record (local polylines).
   * @param {Object|null} nearPoint local {x, z} the upgrade is anchored to;
   *   null upgrades from the way's start, still capped.
   * @returns {number} how many street entities were created (chords).
   *   Creation through the editor command stack finishes on the entities'
   *   `loaded` events; the count is known synchronously.
   */
  upgradeWay: function (way, nearPoint = null) {
    if (this.upgradedWayIds.has(way.wayId)) return 0;
    this.upgradedWayIds.add(way.wayId);
    let chords = [];
    for (const line of way.polylines) {
      chords = chords.concat(splitWayIntoChords(line));
    }
    if (nearPoint) {
      for (const chord of chords) {
        chord._pickDist = Math.sqrt(
          (chord.midpoint.x - nearPoint.x) ** 2 +
            (chord.midpoint.z - nearPoint.z) ** 2
        );
      }
      chords = chords
        .filter((c) => c._pickDist <= UPGRADE_WINDOW_M)
        .sort((a, b) => a._pickDist - b._pickDist);
    }
    chords = chords.slice(0, MAX_CHORDS_PER_UPGRADE);
    for (const chord of chords) {
      this.createStreetForChord(way, chord);
    }
    return chords.length;
  },

  createStreetForChord: function (way, chord) {
    const streetJson = streetJsonForClass(
      way.class,
      chord.length,
      `OSM ${way.class || 'street'}`
    );
    const components = {
      position: `${chord.midpoint.x.toFixed(2)} ${UPGRADED_STREET_Y} ${chord.midpoint.z.toFixed(2)}`,
      rotation: `0 ${chord.bearingDeg.toFixed(2)} 0`,
      'managed-street': {
        sourceType: 'json-blob',
        sourceValue: JSON.stringify(streetJson),
        showVehicles: true,
        showStriping: true,
        synchronize: true,
        playable: true,
        importSource: 'osm-upgrade'
      }
    };
    const stampWayId = (entity) =>
      entity.setAttribute('data-osm-way-id', way.wayId);
    const inspector = AFRAME.INSPECTOR;
    if (inspector && inspector.execute) {
      // Through the command stack so the upgrade is a single undoable step
      // per chord; the callback fires on the entity's `loaded`.
      inspector.execute('entitycreate', { components }, undefined, stampWayId);
      return;
    }
    // Viewer (no inspector): plain entity creation.
    const entity = document.createElement('a-entity');
    entity.setAttribute('position', components.position);
    entity.setAttribute('rotation', components.rotation);
    entity.setAttribute('managed-street', components['managed-street']);
    stampWayId(entity);
    const container =
      document.querySelector('#street-container') || this.el.sceneEl;
    container.appendChild(entity);
  },

  /**
   * Demo convenience (console-callable): upgrade every way within
   * `radiusM` of the camera focus point, nearest first, capped.
   */
  upgradeNearFocus: function (radiusM = 150, cap = 12) {
    const focus = this.focusPoint();
    if (!focus) return [];
    const point = { x: focus.x, z: focus.z };
    const candidates = [];
    for (const way of this.allWays()) {
      if (this.upgradedWayIds.has(way.wayId)) continue;
      const hit = nearestWay([way], point, radiusM);
      if (hit) candidates.push(hit);
    }
    candidates.sort((a, b) => a.distance - b.distance);
    let createdStreets = 0;
    let upgradedWays = 0;
    for (const hit of candidates) {
      if (upgradedWays >= cap) break;
      const created = this.upgradeWay(hit.way, point);
      if (created > 0) {
        createdStreets += created;
        upgradedWays++;
      }
    }
    return { upgradedWays, createdStreets };
  },

  remove: function () {
    this.reset();
  }
});
