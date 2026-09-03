/**
 * Scene ↔ geographic conversion for LLM tools.
 *
 * Authoritative, not approximate: every conversion goes through the live
 * `google-maps-aerial` TilesRenderer — its WGS84 `ellipsoid` plus the world
 * matrix of `tiles.group` (which the ReorientationPlugin places from the
 * scene's lat/lon/height/azimuth). This is the same transform the terrain-
 * flattening code uses to move shapes into the tileset frame, so what a tool
 * reports is exactly where the tiles render.
 *
 * Everything throws `GeoFrameError` with a distinct `reason` while the
 * geospatial layer is off or not yet loaded, so an agent gets "call setLatLon"
 * or "retry shortly" instead of a silent guess.
 *
 * Pure math (bearing normalization) is kept in exported helpers for tests.
 */
import * as THREE from 'three';

export class GeoFrameError extends Error {
  constructor(reason, message) {
    super(message);
    this.name = 'GeoFrameError';
    this.reason = reason;
  }
}

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/** Compass bearing (0..360, clockwise from north) of an east/north pair. */
export function bearingFromEastNorth(east, north) {
  const deg = Math.atan2(east, north) * RAD2DEG;
  return ((deg % 360) + 360) % 360;
}

function round(v, places = 7) {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

/**
 * Resolve the live geo frame or throw a GeoFrameError explaining what is
 * missing. Returns { ellipsoid, groupMatrixWorld, groupMatrixWorldInverse,
 * origin: { latitude, longitude, ellipsoidalHeight } }.
 */
export function getGeoFrame() {
  const geoEl = document.querySelector('#reference-layers[street-geo]');
  const geo = geoEl?.getAttribute('street-geo');
  if (!geo) {
    throw new GeoFrameError(
      'no-location',
      'The scene has no geographic location. Call setLatLon first.'
    );
  }
  if (geo.maps !== 'google3d') {
    throw new GeoFrameError(
      'not-google3d',
      `Geographic conversion needs the Google 3D Tiles layer (street-geo.maps is '${geo.maps}').`
    );
  }
  if (!Number.isFinite(geo.ellipsoidalHeight)) {
    throw new GeoFrameError(
      'not-activated',
      'Geospatial layer is not activated (elevation lookup has not completed). Call setLatLon and retry.'
    );
  }
  const aerialEl = geoEl.querySelector('[google-maps-aerial]');
  const aerial = aerialEl?.components?.['google-maps-aerial'];
  const tiles = aerial?.tiles;
  if (!tiles) {
    throw new GeoFrameError(
      'no-tiles',
      'Google 3D Tiles layer is not mounted yet. Retry shortly.'
    );
  }
  if (!tiles.root) {
    throw new GeoFrameError(
      'tiles-loading',
      'Google 3D Tiles root has not loaded yet, so the tileset is not positioned. Retry shortly.'
    );
  }
  tiles.group.updateMatrixWorld(true);
  const groupMatrixWorld = tiles.group.matrixWorld.clone();
  return {
    ellipsoid: tiles.ellipsoid,
    groupMatrixWorld,
    groupMatrixWorldInverse: groupMatrixWorld.clone().invert(),
    origin: {
      latitude: geo.latitude,
      longitude: geo.longitude,
      ellipsoidalHeight: geo.ellipsoidalHeight
    }
  };
}

/** World-space THREE.Vector3 → { latitude, longitude, height } in degrees/m. */
export function worldToLatLon(worldPos, frame = getGeoFrame()) {
  const local = worldPos.clone().applyMatrix4(frame.groupMatrixWorldInverse);
  const carto = {};
  frame.ellipsoid.getPositionToCartographic(local, carto);
  return {
    latitude: round(carto.lat * RAD2DEG),
    longitude: round(carto.lon * RAD2DEG),
    height: round(carto.height, 2)
  };
}

/** { latitude, longitude, height? } → world-space THREE.Vector3. */
export function latLonToWorld(
  latitude,
  longitude,
  height = null,
  frame = getGeoFrame()
) {
  // Default height = the scene ground plane's ellipsoidal height at the origin,
  // so a returned point sits on y≈0 instead of on the ellipsoid surface.
  const h = Number.isFinite(height) ? height : frame.origin.ellipsoidalHeight;
  const local = new THREE.Vector3();
  frame.ellipsoid.getCartographicToPosition(
    latitude * DEG2RAD,
    longitude * DEG2RAD,
    h,
    local
  );
  return local.applyMatrix4(frame.groupMatrixWorld);
}

/**
 * Compass bearing of a world-space direction at a world-space position.
 * Projects the direction onto the ellipsoid's east/north axes at that point.
 */
export function bearingOfWorldDirection(
  worldPos,
  worldDir,
  frame = getGeoFrame()
) {
  const local = worldPos.clone().applyMatrix4(frame.groupMatrixWorldInverse);
  const carto = {};
  frame.ellipsoid.getPositionToCartographic(local, carto);
  const east = new THREE.Vector3();
  const north = new THREE.Vector3();
  const up = new THREE.Vector3();
  frame.ellipsoid.getEastNorthUpAxes(carto.lat, carto.lon, east, north, up);
  const dir = worldDir
    .clone()
    .transformDirection(frame.groupMatrixWorldInverse)
    .normalize();
  return round(bearingFromEastNorth(dir.dot(east), dir.dot(north)), 2);
}

/**
 * Bearing of each scene axis at the origin, so an agent can confirm the
 * local frame (+X north, +Z east, +Y up by construction) from the data.
 */
export function sceneAxisBearings(frame = getGeoFrame()) {
  const o = new THREE.Vector3(0, 0, 0);
  return {
    '+x': bearingOfWorldDirection(o, new THREE.Vector3(1, 0, 0), frame),
    '+z': bearingOfWorldDirection(o, new THREE.Vector3(0, 0, 1), frame)
  };
}

/**
 * Geographic description of one entity: world position → lat/lon, and the
 * bearing of its local +Z axis (the axis a managed street runs along). For a
 * managed street, also both endpoints of its centerline from the same
 * length-alignment math the component uses (`computeZStart`).
 */
export function describeEntityGeo(el, frame = getGeoFrame()) {
  const obj = el.object3D;
  obj.updateMatrixWorld(true);
  const worldPos = new THREE.Vector3();
  obj.getWorldPosition(worldPos);
  const forward = new THREE.Vector3(0, 0, 1).transformDirection(
    obj.matrixWorld
  );
  const out = {
    entityId: el.id,
    worldPosition: {
      x: round(worldPos.x, 3),
      y: round(worldPos.y, 3),
      z: round(worldPos.z, 3)
    },
    ...worldToLatLon(worldPos, frame),
    headingDeg: bearingOfWorldDirection(worldPos, forward, frame)
  };
  const street = el.components?.['managed-street'];
  if (street) {
    const length = street.data.length;
    const zStart = street.computeZStart(length);
    const toWorld = (z) =>
      new THREE.Vector3(0, 0, z).applyMatrix4(obj.matrixWorld);
    const start = toWorld(zStart);
    const end = toWorld(zStart + length);
    const axis = new THREE.Vector3().subVectors(end, start).normalize();
    const bearing = bearingOfWorldDirection(start, axis, frame);
    out.managedStreet = {
      length,
      width: street.data.width,
      // A road axis is undirected: both bearings describe the same line.
      centerlineBearingDeg: bearing,
      reverseBearingDeg: round((bearing + 180) % 360, 2),
      start: worldToLatLon(start, frame),
      end: worldToLatLon(end, frame)
    };
  }
  return out;
}
