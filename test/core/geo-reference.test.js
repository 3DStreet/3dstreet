/* global describe, it */

/**
 * Geo-reference math for geospatial data layers (#2090). Reference values
 * come from PROJ (pyproj 3.8) so the hand-written projections are checked
 * against the canonical implementation, not against themselves.
 */

import assert from 'assert';
import {
  getProjection,
  geodeticToEcef,
  createSceneFrame,
  orthometricToEllipsoidal,
  projectedToScene
} from '../../src/tested/geo-reference.js';

// 1e-8° is about 1 mm of latitude.
const DEG_TOL = 1e-8;

function near(actual, expected, tol, label) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: expected ${expected}, got ${actual} (tol ${tol})`
  );
}

describe('geo-reference', () => {
  describe('getProjection', () => {
    it('UTM 10N inverse matches PROJ in San Francisco', () => {
      const utm = getProjection('EPSG:32610');
      const cases = [
        [550209.35, 4180449.38, -122.429900438, 37.769998538],
        // Yelamu's grid corners (meta.json west/north and east/south).
        [541354.3531576656, 4188274.3845005874, -122.529993857, 37.840967992],
        [559064.3531576656, 4172624.3845005874, -122.329998431, 37.698945],
        // On the central meridian.
        [500000, 4000000, -123, 36.144718099]
      ];
      for (const [x, y, lon, lat] of cases) {
        const [gotLon, gotLat] = utm.toLonLat(x, y);
        near(gotLon, lon, DEG_TOL, `lon of ${x},${y}`);
        near(gotLat, lat, DEG_TOL, `lat of ${x},${y}`);
      }
    });

    it('UTM 10N forward matches PROJ and round-trips', () => {
      const utm = getProjection('epsg:32610');
      const [x, y] = utm.fromLonLat(-122.4193, 37.7793);
      near(x, 551136.5441, 1e-3, 'easting');
      near(y, 4181487.1131, 1e-3, 'northing');
      const [lon, lat] = utm.toLonLat(x, y);
      near(lon, -122.4193, 2e-9, 'round-trip lon');
      near(lat, 37.7793, 2e-9, 'round-trip lat');
    });

    it('southern-hemisphere UTM uses the 10,000 km false northing', () => {
      const [lon, lat] = getProjection('EPSG:32755').toLonLat(334786, 6252080);
      near(lon, 145.214022861, DEG_TOL, 'lon');
      near(lat, -33.858663917, DEG_TOL, 'lat');
    });

    it('Web Mercator and lon/lat', () => {
      const [lon, lat] = getProjection('EPSG:3857').toLonLat(
        -13627361.0,
        4548863.0
      );
      near(lon, -122.416666685, DEG_TOL, 'lon');
      near(lat, 37.783332391, DEG_TOL, 'lat');
      assert.deepStrictEqual(
        getProjection('EPSG:4326').toLonLat(-122.4, 37.7),
        [-122.4, 37.7]
      );
    });

    it('rejects a CRS it cannot convert instead of guessing', () => {
      assert.throws(() => getProjection('EPSG:2227'), /Unsupported CRS/);
      assert.throws(() => getProjection('EPSG:32661'), /Unsupported CRS/);
    });
  });

  describe('scene frame', () => {
    it('geodeticToEcef matches PROJ (EPSG:4326 → 4978)', () => {
      const [x, y, z] = geodeticToEcef(-122.4193, 37.7793, 10);
      near(x, -2706011.2593, 1e-3, 'x');
      near(y, -4260818.3419, 1e-3, 'y');
      near(z, 3886117.6207, 1e-3, 'z');
    });

    it('origin maps to y = 0 at its ellipsoidal height', () => {
      const frame = createSceneFrame({
        longitude: -122.4193,
        latitude: 37.7793,
        ellipsoidalHeight: -20
      });
      const [x, y, z] = frame.toScene(-122.4193, 37.7793, -20);
      near(x, 0, 1e-6, 'x');
      near(y, 0, 1e-6, 'y');
      near(z, 0, 1e-6, 'z');
      // A point 15 m above the origin is 15 m up.
      near(frame.toScene(-122.4193, 37.7793, -5)[1], 15, 1e-6, 'up');
    });

    it('+X is north and +Z is east (the google3d legacy frame)', () => {
      const frame = createSceneFrame({ longitude: -122.42, latitude: 37.78 });
      const [nx, , nz] = frame.toScene(-122.42, 37.79, 0);
      assert.ok(nx > 1100 && nx < 1112, `north point x=${nx}`);
      near(nz, 0, 1e-6, 'north point stays on the meridian');
      const [ex, , ez] = frame.toScene(-122.41, 37.78, 0);
      assert.ok(ez > 875 && ez < 885, `east point z=${ez}`);
      // A parallel curves away from the tangent plane's east axis toward
      // the pole: a few centimetres north at 880 m.
      assert.ok(ex > 0 && ex < 0.1, `east point x=${ex}`);
    });

    it('includes earth curvature: the ground drops away from the origin', () => {
      const frame = createSceneFrame({ longitude: -122.42, latitude: 37.78 });
      // ~10 km north at height 0: drop ≈ d² / 2R ≈ 7.8 m.
      const [x, y] = frame.toScene(-122.42, 37.87, 0);
      assert.ok(x > 9900 && x < 10100, `x=${x}`);
      assert.ok(y < -7 && y > -9, `y=${y}`);
    });

    it('projectedToScene removes UTM grid convergence', () => {
      // Grid north in UTM 10N at San Francisco is rotated about 0.35° from
      // true north, so a point 1 km due grid-north is ~6 m east in the scene.
      const utm = getProjection('EPSG:32610');
      const [ox, oy] = utm.fromLonLat(-122.42, 37.78);
      const frame = createSceneFrame({ longitude: -122.42, latitude: 37.78 });
      const [x, , z] = projectedToScene(frame, 'EPSG:32610', ox, oy + 1000, 0);
      assert.ok(x > 999 && x < 1001, `x=${x}`);
      assert.ok(z > 5 && z < 7, `z=${z} (convergence)`);
    });

    it('orthometricToEllipsoidal adds the geoid undulation', () => {
      assert.strictEqual(orthometricToEllipsoidal(10, -32.5), -22.5);
      assert.strictEqual(orthometricToEllipsoidal(10, null), 10);
    });
  });
});
