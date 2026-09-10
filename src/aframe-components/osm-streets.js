/* global AFRAME */
import { tilesWithinRadius, EQUATOR_M } from '../tested/osm-tile-math.js';
import { decodeTransportation } from '../tested/vector-tile-buildings.js';
import { cacheGet, cachePut } from '../osm/overpass-cache.js';
import { fetchOverpass } from '../osm/overpass-fetch.js';
import {
  bboxAroundLocalPoints,
  overpassStreetQuery,
  pickOverpassWay,
  streetJsonFromTags
} from '../tested/osm-way-tags.js';
import {
  junctionsAlongStretch,
  localPolylineFromLatLon,
  nearestWay,
  splitStretchAtJunctions,
  stretchForWindow,
  streetJsonForWay
} from '../tested/osm-street-import.js';
import {
  EXCLUDED_ROAD_CLASSES,
  roadWidthMeters
} from '../tested/osm-street-style.js';
import { buildWayRibbons } from '../tested/osm-street-ribbon.js';

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

// Ribbons float above the raster ground (clears z-fighting at
// streaming-camera distances, still reads as "on the ground"); the class
// order steps stack on top of this (see osm-street-ribbon.js).
const RIBBON_BASE_Y = 0.3;

// Upgraded streets sit above the ribbons so their surfaces are not painted
// over by the street tint beneath them.
const UPGRADED_STREET_Y = 0.5;

// Highlight of the stretch about to be generated: above every class
// ribbon, below the generated street.
const HIGHLIGHT_Y = 0.46;
const HIGHLIGHT_COLOR = '#ffd166';
const HIGHLIGHT_WIDTH_PAD_M = 1.5;

// A click upgrades only the stretch of the way near the click, not the
// whole way — an OSM way can run for kilometers. The stretch is clipped
// by arc length (±window around the click's projection), so a generated
// street never exceeds 2×window.
const UPGRADE_WINDOW_M = 200;

// The generated street's path shape (the editable centerline polyline):
// understated next to the drawn-shape default (#ffe600 / 0.15) — it is
// scaffolding under a street, not a drawing of its own — but visible and
// vertex-editable so users can refine the OSM geometry.
const PATH_LINE_COLOR = '#7d8aa0';
const PATH_LINE_WIDTH = 0.06;

let pathIdCounter = 0;
// Way ids can carry '/' and '#' (tile-key fallback ids), unusable in a
// `path: #id` selector — mint clean ids instead.
function uniquePathId() {
  return `osm-path-${Date.now().toString(36)}-${pathIdCounter++}`;
}

// Overpass hydration (phase 6, first slice): one small bbox query per
// clicked way, interactive budget — one attempt per endpoint, short
// timeouts — the chip generates from the class rules if it hasn't
// answered by the time the user clicks.
const HYDRATE_CACHE_PREFIX = 'overpass-streets/v1/';
const HYDRATE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HYDRATE_TIMEOUT_MS = 8000;
const HYDRATE_BBOX_PAD_M = 20;

/**
 * OSM streets on the 2.5D ground + click-to-upgrade (#1930 demo path).
 *
 * Follows the camera like `osm-buildings` and keeps the decoded
 * `transportation` way records (class + centerline polylines, converted to
 * scene-local meters) for tiles near the focus point. Each tile is drawn
 * as one merged, vertex-colored ribbon mesh (`osm-street-ribbon.js`) —
 * flat strips at class widths, floated just above the raster ground. The
 * same record cache backs:
 *
 * - `wayAtPoint(worldPoint)` — which street is under a clicked ground
 *   point (editor "Generate 3D street" affordance), and
 * - `upgradeWayAt(worldPoint)` — mint real managed streets for the
 *   clicked stretch of that way: the stretch splits where other ways
 *   cross or terminate on it, each piece becomes ONE path-following
 *   street bent along the way's centerline (its path shape stays
 *   vertex-editable; straight when the piece simplifies to a single
 *   chord), and a `managed-intersection` is minted at each junction
 *   where ≥2 generated street ends meet — later generates of crossing
 *   ways connect to it automatically (proximity snap radius).
 *   Class-preset cross sections, `playable: true` so street-traffic
 *   animates them in play mode.
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
    // (same contract as osm-buildings).
    opacity: { type: 'number', default: 1, min: 0, max: 1 }
  },

  init: function () {
    this.loadedTiles = new Map(); // key → { ways, mesh | null }
    // Unlit: the tint is flat cartography, not a lit surface. Depth writes
    // stay on so the class-ordered heights resolve junctions.
    this.material = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.applyOpacity();
    this.inFlight = new Set();
    this.failures = new Map();
    this.upgradedWayIds = new Set();
    this.hydrated = new Map(); // wayId → Promise<{tags, facts}|null>
    this._camWorld = new THREE.Vector3();
    this._camDir = new THREE.Vector3();
    this._focus = new THREE.Vector3();
    this._local = new THREE.Vector3();
    this.tick = AFRAME.utils.throttleTick(this.tick, SCAN_INTERVAL_MS, this);
  },

  update: function (oldData) {
    if (
      oldData.opacity !== undefined &&
      oldData.opacity !== this.data.opacity
    ) {
      this.applyOpacity();
    }
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
    this.clearHighlight();
    for (const [key, entry] of this.loadedTiles) {
      this.removeTileMesh(key, entry);
    }
    this.loadedTiles.clear();
    this.inFlight.clear();
    this.failures.clear();
  },

  applyOpacity: function () {
    const opacity = this.data.opacity;
    this.material.opacity = opacity;
    this.material.transparent = opacity < 1;
    this.material.needsUpdate = true;
  },

  /**
   * Show which stretch of a way `upgradeWayAt(worldPoint)` would turn
   * into a street — the exact clipped centerline, drawn as a bright
   * ribbon above the class tint. `clearHighlight()` removes it. Null /
   * unknown way clears too.
   */
  highlightWayAt: function (worldPoint, maxDistM = DEFAULT_PICK_DISTANCE_M) {
    this.clearHighlight();
    if (!worldPoint) return;
    const hit = this.wayAtPoint(worldPoint, maxDistM);
    if (!hit) return;
    const stretch = this.stretchToUpgrade(
      hit.way,
      this.toLocalGround(worldPoint)
    );
    if (!stretch) return;
    const { positions, colors, indices } = buildWayRibbons(
      [
        {
          class: hit.way.class,
          polylines: [stretch.points]
        }
      ],
      {
        y: HIGHLIGHT_Y,
        color: HIGHLIGHT_COLOR,
        width: roadWidthMeters(hit.way.class) + HIGHLIGHT_WIDTH_PAD_M
      }
    );
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    this.highlightMesh = new THREE.Mesh(geometry, this.material);
    this.el.setObject3D('highlight', this.highlightMesh);
  },

  clearHighlight: function () {
    if (!this.highlightMesh) return;
    this.el.removeObject3D('highlight');
    this.highlightMesh.geometry.dispose();
    this.highlightMesh = null;
  },

  removeTileMesh: function (key, entry) {
    if (entry.mesh) {
      this.el.removeObject3D('tile-' + key);
      entry.mesh.geometry.dispose();
      entry.mesh = null;
    }
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
    const mesh = this.buildTileMesh(ways);
    if (mesh) {
      // setObject3D (rather than object3D.add) so the editor's mesh
      // batching and scene-graph tooling see the tile.
      this.el.setObject3D('tile-' + key, mesh);
    }
    this.loadedTiles.set(key, { ways, mesh });
  },

  // One merged ribbon mesh per tile: a single draw call regardless of way
  // count, frustum-culled by its bounding sphere. Null for empty tiles.
  buildTileMesh: function (ways) {
    const { positions, colors, indices } = buildWayRibbons(ways, {
      baseY: RIBBON_BASE_Y
    });
    if (positions.length === 0) return null;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.computeBoundingSphere();
    return new THREE.Mesh(geometry, this.material);
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
   * Upgrade the way nearest `worldPoint` into real managed streets —
   * the clicked stretch of its centerline, split at junctions with other
   * ways, one path-following street per piece (straight when a piece is
   * a single chord) plus a managed intersection per junction where two
   * generated ends meet; `playable: true` so street-traffic animates
   * them in play mode. Idempotent per way id.
   *
   * Only the stretch near the click upgrades: a single OSM way can run
   * for kilometers (an early bug upgraded one 8 km path into 419
   * entities), so the centerline is clipped to ±`UPGRADE_WINDOW_M` of the
   * click by arc length.
   *
   * @returns {number} how many street entities were created.
   */
  upgradeWayAt: function (
    worldPoint,
    { maxDistM = DEFAULT_PICK_DISTANCE_M, tags = null } = {}
  ) {
    const hit = this.wayAtPoint(worldPoint, maxDistM);
    if (!hit || hit.alreadyUpgraded) return 0;
    return this.upgradeWay(hit.way, this.toLocalGround(worldPoint), tags);
  },

  /**
   * Fetch the OSM tags of the way under `worldPoint` from Overpass
   * (IndexedDB-cached per bbox, memoized per way id so the chip's preview
   * and the later generate share one request). Resolves
   * `{ tags, facts }` — `facts` from crossSectionFromTags, for the chip
   * summary — or null when Overpass has no matching highway / failed.
   */
  hydrateWayAt: function (worldPoint, maxDistM = DEFAULT_PICK_DISTANCE_M) {
    const hit = this.wayAtPoint(worldPoint, maxDistM);
    if (!hit) return Promise.resolve(null);
    const { way } = hit;
    if (this.hydrated.has(way.wayId)) return this.hydrated.get(way.wayId);
    const nearPoint = this.toLocalGround(worldPoint);
    const promise = this.fetchTagsForWay(way, nearPoint).catch((err) => {
      console.warn('osm-streets: hydration failed', err?.message);
      this.hydrated.delete(way.wayId); // let a later click retry
      return null;
    });
    this.hydrated.set(way.wayId, promise);
    return promise;
  },

  fetchTagsForWay: async function (way, nearPoint) {
    const origin = { lat: this.data.latitude, lon: this.data.longitude };
    const stretch = this.stretchToUpgrade(way, nearPoint);
    if (!stretch) return null;
    const bbox = bboxAroundLocalPoints(
      origin,
      stretch.points,
      HYDRATE_BBOX_PAD_M
    );
    const cacheKey =
      HYDRATE_CACHE_PREFIX +
      [bbox.south, bbox.west, bbox.north, bbox.east]
        .map((v) => v.toFixed(5))
        .join(',');
    let elements = await cacheGet(cacheKey, HYDRATE_CACHE_TTL_MS);
    if (!elements) {
      const res = await fetchOverpass(overpassStreetQuery(bbox), {
        timeoutMs: HYDRATE_TIMEOUT_MS,
        attemptsPerEndpoint: 1
      });
      elements = res?.elements || [];
      cachePut(cacheKey, elements);
    }
    const match = pickOverpassWay(elements, origin, nearPoint);
    if (!match) return null;
    const { facts } = streetJsonFromTags(match.tags, way, 1);
    return { tags: match.tags, facts, osmId: match.id };
  },

  /**
   * @param {Object} way decoded way record (local polylines).
   * @param {Object|null} nearPoint local {x, z} the upgrade is anchored to;
   *   null upgrades from the way's start, still capped.
   * @param {Object|null} tags OSM tags from hydrateWayAt — make the
   *   cross-section exact where OSM has data; without them the class
   *   rules apply.
   * @returns {number} how many street entities were created (0 for an
   *   already-upgraded way / a stretch too short to generate).
   *   Creation through the editor command stack finishes on the entities'
   *   `loaded` events; the count is known synchronously.
   */
  upgradeWay: function (way, nearPoint = null, tags = null) {
    if (this.upgradedWayIds.has(way.wayId)) return 0;
    const stretch = this.stretchToUpgrade(way, nearPoint);
    if (!stretch) return 0;
    const { pieces, junctions } = this.planUpgrade(way, stretch);
    if (pieces.length === 0) return 0; // all pieces below minimum

    this.upgradedWayIds.add(way.wayId);
    this.clearHighlight();
    const commands = [];
    for (const piece of pieces) {
      if (piece.points.length === 2) {
        // Degenerate straight piece: a plain street, no path shape.
        commands.push(this.straightStreetCommand(way, piece, tags));
      } else {
        commands.push(...this.pathStreetCommands(way, piece, tags));
      }
    }
    for (const junction of junctions) {
      // Mint only where ≥2 generated street ends actually meet, and
      // reuse an intersection an earlier generate already placed there
      // (its snap radius picks the new streets up by itself).
      if (
        junction.adjacentPieces >= 2 &&
        !this.intersectionNear(junction.point)
      ) {
        commands.push(this.intersectionCommand(junction));
      }
    }
    this.executeCommands(commands);
    return pieces.length;
  },

  // The clipped, simplified centerline stretch `upgradeWay` would turn
  // into streets for `way` anchored at `nearPoint` (see
  // stretchForWindow), or null.
  stretchToUpgrade: function (way, nearPoint = null) {
    return stretchForWindow(way.polylines, nearPoint, {
      windowM: UPGRADE_WINDOW_M
    });
  },

  /**
   * Junction-split plan for a stretch: where other ways cross or
   * terminate on it, split into inset pieces (one street each) and mark
   * the junctions to mint intersections at. Other-way candidates come
   * from every loaded tile (the same way appears clipped in several
   * tiles — junction dedupe absorbs the doubles); bridges are
   * grade-separated, not junctions.
   */
  planUpgrade: function (way, stretch) {
    const others = this.allWays().filter(
      (w) => w.wayId !== way.wayId && w.brunnel !== 'bridge'
    );
    const junctions = junctionsAlongStretch(stretch.points, others);
    return splitStretchAtJunctions(stretch.points, junctions);
  },

  // Is a managed intersection already within `withinM` of this local
  // ground point? (Proximity, not identity: the junction is shared by
  // every way that crosses it.)
  intersectionNear: function (point, withinM = 10) {
    this._local.set(point.x, 0, point.z);
    this.el.object3D.localToWorld(this._local);
    const wx = this._local.x;
    const wz = this._local.z;
    const existing = this.el.sceneEl.querySelectorAll(
      'a-entity[managed-intersection]'
    );
    for (const el of existing) {
      el.object3D.getWorldPosition(this._local);
      if (Math.hypot(this._local.x - wx, this._local.z - wz) <= withinM) {
        return true;
      }
    }
    return false;
  },

  // The managed-street component config + the `loaded` stamp callback
  // shared by both creation shapes.
  streetDefinitionFor: function (way, stretch, tags) {
    const hydrated = tags
      ? streetJsonFromTags(tags, way, stretch.lengthM)
      : null;
    const streetJson = hydrated
      ? hydrated.json
      : streetJsonForWay(way, stretch.lengthM, `OSM ${way.class || 'street'}`);
    const managedStreet = {
      sourceType: 'json-blob',
      sourceValue: JSON.stringify(streetJson),
      showVehicles: true,
      showStriping: true,
      synchronize: true,
      playable: true,
      importSource: 'osm-upgrade'
    };
    const stampWayId = (entity) => {
      entity.setAttribute('data-osm-way-id', way.wayId);
      // Read by the sidebar's source card ("Generated from OpenStreetMap").
      entity.setAttribute('data-osm-class', way.class || 'street');
      entity.setAttribute('data-osm-source', hydrated ? 'overpass' : 'tiles');
      if (hydrated?.facts?.name) {
        entity.setAttribute('data-osm-name', hydrated.facts.name);
      }
    };
    return { managedStreet, stampWayId };
  },

  /**
   * One ['entitycreate', definition, callback] tuple for a straight
   * piece — the format MultiCommand takes, so a whole generate (streets
   * + intersections) executes as ONE undoable step; the viewer fallback
   * builds the same definitions directly (see executeCommands).
   */
  straightStreetCommand: function (way, stretch, tags = null) {
    const [start, end] = stretch.points;
    const midpoint = { x: (start.x + end.x) / 2, z: (start.z + end.z) / 2 };
    // A-Frame yaw pointing street-local +Z along the chord (same
    // convention as StreetNodeControls: atan2(dir.x, dir.z)).
    const bearingDeg =
      (Math.atan2(end.x - start.x, end.z - start.z) * 180) / Math.PI;
    const { managedStreet, stampWayId } = this.streetDefinitionFor(
      way,
      stretch,
      tags
    );
    const components = {
      position: `${midpoint.x.toFixed(2)} ${UPGRADED_STREET_Y} ${midpoint.z.toFixed(2)}`,
      rotation: `0 ${bearingDeg.toFixed(2)} 0`,
      'managed-street': managedStreet
    };
    return ['entitycreate', { components }, stampWayId];
  },

  /**
   * One path-following street for a curved stretch: a `shape` polyline
   * (control points at the stretch's simplified vertices, smooth
   * catmull-rom — the same assignment-gesture bump the street sidebar
   * applies) plus a managed street following it via `managed-street.path`.
   * Same commit conventions as the editor's shape draw tool: entity at
   * the vertices' centroid, vertices stored relative, `shape-vertex`
   * children hidden from the scene graph — so the generated centerline is
   * vertex-editable exactly like a hand-drawn path.
   *
   * The shape sits at the street's Y so the curve carries the height (a
   * pathed street renders at the path's world position; path vertex
   * elevation is followed).
   */
  pathStreetCommands: function (way, stretch, tags = null) {
    const points = stretch.points;
    const centroid = { x: 0, z: 0 };
    for (const p of points) {
      centroid.x += p.x;
      centroid.z += p.z;
    }
    centroid.x /= points.length;
    centroid.z /= points.length;

    const shapeId = uniquePathId();
    const shapeDefinition = {
      id: shapeId,
      element: 'a-entity',
      components: {
        shape: {
          lineColor: PATH_LINE_COLOR,
          lineWidth: PATH_LINE_WIDTH,
          curveType: 'smooth'
        },
        position: `${centroid.x.toFixed(2)} ${UPGRADED_STREET_Y} ${centroid.z.toFixed(2)}`,
        'data-layer-name': `Path • OSM ${way.class || 'street'}`,
        'data-osm-way-id': way.wayId
      },
      children: points.map((p) => ({
        element: 'a-entity',
        class: 'hideFromSceneGraph',
        components: {
          'shape-vertex': '',
          position: `${(p.x - centroid.x).toFixed(2)} 0 ${(p.z - centroid.z).toFixed(2)}`
        }
      }))
    };

    const { managedStreet, stampWayId } = this.streetDefinitionFor(
      way,
      stretch,
      tags
    );
    managedStreet.path = `#${shapeId}`;
    const streetDefinition = {
      components: {
        position: `${centroid.x.toFixed(2)} ${UPGRADED_STREET_Y} ${centroid.z.toFixed(2)}`,
        'managed-street': managedStreet
      }
    };

    // Shape first: the street create fires from its `loaded` callback in
    // the multi, so the path resolves immediately; undo removes street
    // then shape.
    return [
      ['entitycreate', shapeDefinition],
      ['entitycreate', streetDefinition, stampWayId]
    ];
  },

  // A managed intersection at a junction (schema defaults: zebra
  // crosswalks) — generated street ends land within its snap radius and
  // auto-connect, including streets minted by LATER generates. A merged
  // cut (offset crossings sharing one junction) can span wider than the
  // default radius, so the radius grows to cover the cut's boundary
  // nodes plus slack.
  intersectionCommand: function (junction) {
    const point = junction.point;
    const snapRadius = Math.max(20, Math.ceil((junction.cutHalfM || 0) + 8));
    return [
      'entitycreate',
      {
        components: {
          position: `${point.x.toFixed(2)} ${UPGRADED_STREET_Y} ${point.z.toFixed(2)}`,
          'managed-intersection': snapRadius > 20 ? { snapRadius } : {},
          'data-layer-name': 'OSM Intersection'
        }
      }
    ];
  },

  /**
   * Run ['entitycreate', definition, callback?] tuples: through the
   * editor command stack as ONE undoable 'multi' step, or in the viewer
   * (no inspector, no undo stack) by building the same definitions into
   * DOM directly — managed-street retries path resolution, so creation
   * order is not load-bearing there.
   */
  executeCommands: function (commands) {
    if (commands.length === 0) return;
    const inspector = AFRAME.INSPECTOR;
    if (inspector && inspector.execute) {
      inspector.execute('multi', commands);
      return;
    }
    const container =
      document.querySelector('#street-container') || this.el.sceneEl;
    const build = (definition) => {
      const el = document.createElement(definition.element || 'a-entity');
      if (definition.id) el.id = definition.id;
      if (definition.class) el.setAttribute('class', definition.class);
      for (const name in definition.components || {}) {
        el.setAttribute(name, definition.components[name]);
      }
      for (const child of definition.children || []) {
        el.appendChild(build(child));
      }
      return el;
    };
    for (const [, definition, callback] of commands) {
      const el = build(definition);
      if (callback) callback(el);
      container.appendChild(el);
    }
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
    this.material.dispose();
  }
});
