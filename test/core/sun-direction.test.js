/* global describe, it */
import assert from 'assert';
import {
  MIN_SUN_ELEVATION,
  dialPointFromSun,
  sunAnglesFromPosition,
  sunFromDialPoint,
  sunPositionFromAngles
} from '../../src/tested/sun-direction.js';

const close = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

describe('sun angles (+X north, +Z east)', () => {
  it('measures azimuth clockwise from north', () => {
    close(sunAnglesFromPosition(1, 1, 0).azimuth, 0); // north
    close(sunAnglesFromPosition(0, 1, 1).azimuth, 90); // east
    close(sunAnglesFromPosition(-1, 1, 0).azimuth, 180); // south
    close(sunAnglesFromPosition(0, 1, -1).azimuth, 270); // west
    close(sunAnglesFromPosition(1, 1, 0).elevation, 45);
  });

  it('round-trips a position through angles', () => {
    const { azimuth, elevation } = sunAnglesFromPosition(-40, 56, -43);
    const p = sunPositionFromAngles(azimuth, elevation, Math.hypot(40, 56, 43));
    close(p.x, -40, 1e-9);
    close(p.y, 56, 1e-9);
    close(p.z, -43, 1e-9);
  });
});

describe('sun dial', () => {
  it('puts overhead at the centre and the lowest sun on the rim', () => {
    const centre = dialPointFromSun(123, 90);
    close(centre.x, 0);
    close(centre.y, 0);
    const west = dialPointFromSun(270, MIN_SUN_ELEVATION);
    close(west.x, -1); // far left
    close(west.y, 0);
    const north = dialPointFromSun(0, MIN_SUN_ELEVATION);
    close(north.y, -1); // top
  });

  it('round-trips dial points to whole degrees', () => {
    for (const [az, el] of [
      [0, 90],
      [90, 45],
      [227, 44],
      [270, 10],
      [359, 30]
    ]) {
      const p = dialPointFromSun(az, el);
      const sun = sunFromDialPoint(p.x, p.y);
      if (el < 90) assert.strictEqual(sun.azimuth, az);
      assert.strictEqual(sun.elevation, el);
    }
  });

  it('clamps points past the rim and suns below the minimum', () => {
    assert.deepStrictEqual(sunFromDialPoint(-3, 0), {
      azimuth: 270,
      elevation: MIN_SUN_ELEVATION
    });
    const low = dialPointFromSun(90, 0);
    close(Math.hypot(low.x, low.y), 1);
  });
});
