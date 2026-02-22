/* global describe, it */

const assert = require('assert');
const streetmixUtils = require('../../src/tested/streetmix-utils');
require('jsdom-global')();

describe('StreetmixUtils', function () {
  describe('#streetmixUserToAPI()', function () {
    it('should return API redirect URL when given user facing URL WITH a creator ID', function () {
      assert.strictEqual(
        streetmixUtils.streetmixUserToAPI(
          'https://streetmix.net/kfarr/3/a-frame-city-builder-street-only'
        ),
        'https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr'
      );
    });

    it('should return API redirect URL when given user facing URL WITHOUT a creator ID', function () {
      assert.strictEqual(
        streetmixUtils.streetmixUserToAPI(
          'https://streetmix.net/-/3/a-frame-city-builder-street-only'
        ),
        'https://streetmix.net/api/v1/streets?namespacedId=3'
      );
    });
  });

  describe('#pathStartsWithAPI()', function () {
    it('should return true when provided urlString includes /api/ top level directory', function () {
      assert.ok(
        streetmixUtils.pathStartsWithAPI(
          'https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr'
        )
      );
    });
    it('should return false when provided urlString does NOT include /api/ top level directory', function () {
      assert.ok(
        !streetmixUtils.pathStartsWithAPI(
          'https://streetmix.net/kfarr/3/a-frame-city-builder-street-only'
        )
      );
    });
  });

  describe('#streetmixAPIToUser()', function () {
    it('should return user friendly URL when given API URL WITH a creator ID', function () {
      assert.strictEqual(
        streetmixUtils.streetmixAPIToUser(
          'https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr'
        ),
        'https://streetmix.net/kfarr/3'
      );
    });
    it('should return user friendly URL when given API URL WITHOUT a creator ID', function () {
      assert.strictEqual(
        streetmixUtils.streetmixAPIToUser(
          'https://streetmix.net/api/v1/streets?namespacedId=3'
        ),
        'https://streetmix.net/-/3'
      );
    });
  });

  describe('#metricElevationToLevel()', function () {
    it('should convert 0m to level 0', function () {
      assert.strictEqual(streetmixUtils.metricElevationToLevel(0), 0);
    });
    it('should convert 0.15m (curb height) to level 1', function () {
      assert.strictEqual(streetmixUtils.metricElevationToLevel(0.15), 1);
    });
    it('should convert 0.30m to level 2', function () {
      assert.strictEqual(streetmixUtils.metricElevationToLevel(0.3), 2);
    });
    it('should convert 0.75m (light rail) to level 5', function () {
      assert.strictEqual(streetmixUtils.metricElevationToLevel(0.75), 5);
    });
    it('should handle undefined as level 0', function () {
      assert.strictEqual(streetmixUtils.metricElevationToLevel(undefined), 0);
    });
    it('should handle null as level 0', function () {
      assert.strictEqual(streetmixUtils.metricElevationToLevel(null), 0);
    });
    it('should round 0.14m to level 1 (nearest curb height)', function () {
      assert.strictEqual(streetmixUtils.metricElevationToLevel(0.14), 1);
    });
  });

  describe('#convertStreetValues()', function () {
    it('should convert metric elevation to integer levels for schemaVersion >= 33', function () {
      const streetData = {
        schemaVersion: 33,
        segments: [
          { elevation: 0, width: 3 },
          { elevation: 0.15, width: 2 },
          { elevation: 0.3, width: 4 }
        ]
      };
      const result = streetmixUtils.convertStreetValues(streetData);
      assert.strictEqual(result.segments[0].elevation, 0); // 0m -> level 0
      assert.strictEqual(result.segments[1].elevation, 1); // 0.15m -> level 1
      assert.strictEqual(result.segments[2].elevation, 2); // 0.30m -> level 2
    });
    it('should not convert elevation for schemaVersion < 33', function () {
      const streetData = {
        schemaVersion: 32,
        segments: [
          { elevation: 0, width: 3 },
          { elevation: 1, width: 2 },
          { elevation: 2, width: 4 }
        ]
      };
      const result = streetmixUtils.convertStreetValues(streetData);
      assert.strictEqual(result.segments[0].elevation, 0);
      assert.strictEqual(result.segments[1].elevation, 1);
      assert.strictEqual(result.segments[2].elevation, 2);
    });
  });
});
