/**
 * Geo-reference math for geospatial data layers (#2090).
 *
 * One path from a data source's coordinate reference system (CRS) into the
 * 3DStreet scene frame, so every data layer lands where the Google 3D Tiles
 * render:
 *
 *   source CRS (x, y)  →  WGS84 lon/lat  →  ECEF  →  local ENU  →  scene
 *
 * **Scene frame.** `google-maps-aerial` places the tileset with
 * ReorientationPlugin at (street-geo latitude, longitude, height 0) and a 90°
 * azimuth, then shifts it down by `ellipsoidalHeight`. The result is a plane
 * tangent to the WGS84 ellipsoid at the origin with **+X north, +Y up,
 * +Z east** (see `sceneAxisBearings` in src/editor/lib/geo/geoFrame.js), and
 * y = 0 at the origin's ellipsoidal height. `createSceneFrame` reproduces that
 * transform exactly with plain doubles, including earth curvature (about 8 m
 * of drop 10 km out), without needing the tiles to be loaded.
 *
 * The 2.5D / 2D map path (`osm-*`, `tiled-basemap`) uses a Mercator-conformal
 * approximation (`latLonToLocal` in osm-street-import.js). The two agree to
 * well under a metre within a couple of kilometres of the origin; new layers
 * should use this module.
 *
 * **Why reproject per vertex.** A projected CRS is not the scene frame: UTM's
 * grid north is rotated from true north by the meridian convergence (about
 * 0.35° over San Francisco in zone 10N, so about 6 m of drift 1 km from the
 * origin) and scaled by up to 0.04%. Rotating a whole layer once cannot fix
 * that; converting each vertex does.
 *
 * Pure module: no three, no DOM. Safe to import from workers.
 */

// WGS84 ellipsoid.
export const WGS84_A = 6378137;
export const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

// ---------------------------------------------------------------------------
// Projections: each one maps projected (x, y) metres <-> [lon, lat] degrees.
// ---------------------------------------------------------------------------

/**
 * Transverse Mercator on WGS84 using Krüger's series to third order in n
 * (accurate to well under a millimetre within a UTM zone).
 */
function transverseMercator({ lon0Deg, k0, falseEasting, falseNorthing }) {
  const n = WGS84_F / (2 - WGS84_F);
  const n2 = n * n;
  const n3 = n2 * n;
  const A = (WGS84_A / (1 + n)) * (1 + n2 / 4 + (n2 * n2) / 64);
  const alpha = [
    n / 2 - (2 * n2) / 3 + (5 * n3) / 16,
    (13 * n2) / 48 - (3 * n3) / 5,
    (61 * n3) / 240
  ];
  const beta = [
    n / 2 - (2 * n2) / 3 + (37 * n3) / 96,
    n2 / 48 + n3 / 15,
    (17 * n3) / 480
  ];
  const delta = [
    2 * n - (2 * n2) / 3 - 2 * n3,
    (7 * n2) / 3 - (8 * n3) / 5,
    (56 * n3) / 15
  ];
  const lon0 = lon0Deg * DEG2RAD;
  const c = (2 * Math.sqrt(n)) / (1 + n);

  return {
    toLonLat(x, y) {
      const xi = (y - falseNorthing) / (k0 * A);
      const eta = (x - falseEasting) / (k0 * A);
      let xiP = xi;
      let etaP = eta;
      for (let j = 1; j <= 3; j++) {
        const b = beta[j - 1];
        xiP -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
        etaP -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
      }
      const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
      let lat = chi;
      for (let j = 1; j <= 3; j++) {
        lat += delta[j - 1] * Math.sin(2 * j * chi);
      }
      const lon = lon0 + Math.atan2(Math.sinh(etaP), Math.cos(xiP));
      return [lon * RAD2DEG, lat * RAD2DEG];
    },
    fromLonLat(lonDeg, latDeg) {
      const lat = latDeg * DEG2RAD;
      const dLon = lonDeg * DEG2RAD - lon0;
      const sinLat = Math.sin(lat);
      const t = Math.sinh(Math.atanh(sinLat) - c * Math.atanh(c * sinLat));
      const xiP = Math.atan2(t, Math.cos(dLon));
      const etaP = Math.atanh(Math.sin(dLon) / Math.sqrt(1 + t * t));
      let xi = xiP;
      let eta = etaP;
      for (let j = 1; j <= 3; j++) {
        const a = alpha[j - 1];
        xi += a * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
        eta += a * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
      }
      return [falseEasting + k0 * A * eta, falseNorthing + k0 * A * xi];
    }
  };
}

const LON_LAT = {
  toLonLat: (x, y) => [x, y],
  fromLonLat: (lon, lat) => [lon, lat]
};

const WEB_MERCATOR = {
  toLonLat(x, y) {
    return [
      (x / WGS84_A) * RAD2DEG,
      (2 * Math.atan(Math.exp(y / WGS84_A)) - Math.PI / 2) * RAD2DEG
    ];
  },
  fromLonLat(lon, lat) {
    return [
      WGS84_A * lon * DEG2RAD,
      WGS84_A * Math.log(Math.tan(Math.PI / 4 + (lat * DEG2RAD) / 2))
    ];
  }
};

const projectionCache = new Map();

/**
 * Resolve a CRS identifier to a projection. Supported:
 * - `EPSG:4326` / `CRS:84` / `OGC:CRS84`: lon/lat degrees (x = lon, y = lat)
 * - `EPSG:3857`: Web Mercator
 * - `EPSG:326zz` / `EPSG:327zz`: WGS84 UTM zone zz north / south
 *
 * Anything else throws; data sources declare their CRS in the registry, so an
 * unsupported one is a registry error, not something to guess around. (Add a
 * proj4 definition path here when a source needs, say, a State Plane CRS.)
 */
export function getProjection(crs) {
  const key = String(crs).trim().toUpperCase();
  if (projectionCache.has(key)) return projectionCache.get(key);
  let projection;
  if (key === 'EPSG:4326' || key === 'CRS:84' || key === 'OGC:CRS84') {
    projection = LON_LAT;
  } else if (key === 'EPSG:3857' || key === 'EPSG:900913') {
    projection = WEB_MERCATOR;
  } else {
    const utm = /^EPSG:32([67])(\d\d)$/.exec(key);
    const zone = utm ? Number(utm[2]) : 0;
    if (!utm || zone < 1 || zone > 60) {
      throw new Error(`Unsupported CRS "${crs}"`);
    }
    projection = transverseMercator({
      lon0Deg: zone * 6 - 183,
      k0: 0.9996,
      falseEasting: 500000,
      falseNorthing: utm[1] === '7' ? 10000000 : 0
    });
  }
  projectionCache.set(key, projection);
  return projection;
}

// ---------------------------------------------------------------------------
// Ellipsoid and the scene frame
// ---------------------------------------------------------------------------

/** Geodetic (degrees, metres above the ellipsoid) → ECEF metres [x, y, z]. */
export function geodeticToEcef(lonDeg, latDeg, height = 0) {
  const lat = latDeg * DEG2RAD;
  const lon = lonDeg * DEG2RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const N = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return [
    (N + height) * cosLat * Math.cos(lon),
    (N + height) * cosLat * Math.sin(lon),
    (N * (1 - WGS84_E2) + height) * sinLat
  ];
}

/**
 * The scene frame for a street-geo origin: the same tangent plane the Google
 * 3D Tiles are placed in (see header).
 *
 * `toScene(lon, lat, ellipsoidalHeight)` returns `[x, y, z]` scene metres
 * (+X north, +Y up, +Z east). Heights are ellipsoidal; convert an orthometric
 * height (a DEM's "above sea level") with `orthometricToEllipsoidal` first.
 */
export function createSceneFrame({
  longitude,
  latitude,
  ellipsoidalHeight = 0
}) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    throw new Error('createSceneFrame needs a finite longitude and latitude');
  }
  const lat = latitude * DEG2RAD;
  const lon = longitude * DEG2RAD;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const [ox, oy, oz] = geodeticToEcef(longitude, latitude, 0);
  const baseHeight = Number.isFinite(ellipsoidalHeight) ? ellipsoidalHeight : 0;

  return {
    longitude,
    latitude,
    ellipsoidalHeight: baseHeight,
    toScene(lonDeg, latDeg, height = baseHeight) {
      const [px, py, pz] = geodeticToEcef(lonDeg, latDeg, height);
      const dx = px - ox;
      const dy = py - oy;
      const dz = pz - oz;
      const east = -sinLon * dx + cosLon * dy;
      const north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
      const up = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;
      return [north, up - baseHeight, east];
    }
  };
}

/**
 * Orthometric height (above the geoid / "sea level", what DEMs such as USGS
 * 3DEP report in NAVD88) → ellipsoidal height, given the geoid undulation N
 * at that place. street-geo stores N for its origin as `geoidHeight`; over a
 * few kilometres N varies by centimetres to decimetres, so using the origin's
 * value for a whole layer is the v1 approximation (#2090 "Heights").
 */
export function orthometricToEllipsoidal(orthometricHeight, geoidHeight) {
  return orthometricHeight + (Number.isFinite(geoidHeight) ? geoidHeight : 0);
}

/** Convert projected coordinates in `crs` to scene metres in `frame`. */
export function projectedToScene(frame, crs, x, y, ellipsoidalHeight) {
  const [lon, lat] = getProjection(crs).toLonLat(x, y);
  return frame.toScene(lon, lat, ellipsoidalHeight);
}
