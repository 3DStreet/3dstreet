/* global describe, it */

import assert from 'assert';
import * as streetmixUtils from '../../src/tested/streetmix-utils.js';
import jsdomGlobal from 'jsdom-global';
jsdomGlobal();

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
    it('should keep metric elevation in meters for schemaVersion >= 33', function () {
      const streetData = {
        schemaVersion: 33,
        segments: [
          { elevation: 0, width: 3 },
          { elevation: 0.15, width: 2 },
          { elevation: 0.3, width: 4 }
        ]
      };
      const result = streetmixUtils.convertStreetValues(streetData);
      assert.strictEqual(result.segments[0].elevation, 0);
      assert.strictEqual(result.segments[1].elevation, 0.15);
      assert.strictEqual(result.segments[2].elevation, 0.3);
    });
    it('should convert integer elevation levels to meters for schemaVersion < 33', function () {
      const streetData = {
        schemaVersion: 32,
        segments: [
          { elevation: 0, width: 3 },
          { elevation: 1, width: 2 },
          { elevation: 2, width: 4 }
        ]
      };
      const result = streetmixUtils.convertStreetValues(streetData);
      assert.strictEqual(result.segments[0].elevation, 0); // level 0 -> 0m
      assert.strictEqual(result.segments[1].elevation, 0.15); // level 1 -> 0.15m
      assert.strictEqual(result.segments[2].elevation, 0.3); // level 2 -> 0.30m
    });
  });

  describe('#getSegmentSlope()', function () {
    it('should return start/end for an active slope', function () {
      assert.deepStrictEqual(
        streetmixUtils.getSegmentSlope({
          slope: { on: true, values: [0.15, 0] }
        }),
        { start: 0.15, end: 0 }
      );
    });
    it('should return null for the seeded v34 default (off, empty values)', function () {
      assert.strictEqual(
        streetmixUtils.getSegmentSlope({ slope: { on: false, values: [] } }),
        null
      );
    });
    it('should return null when slope is on but values are malformed', function () {
      assert.strictEqual(
        streetmixUtils.getSegmentSlope({ slope: { on: true, values: [0.15] } }),
        null
      );
      assert.strictEqual(
        streetmixUtils.getSegmentSlope({
          slope: { on: true, values: ['a', 'b'] }
        }),
        null
      );
    });
    it('should return null for pre-v34 segments without slope', function () {
      assert.strictEqual(streetmixUtils.getSegmentSlope({}), null);
      assert.strictEqual(streetmixUtils.getSegmentSlope(undefined), null);
    });
  });

  describe('#getBoundaryFromStreetData()', function () {
    it('should read the canonical boundary object (schemaVersion 34+)', function () {
      const streetData = {
        schemaVersion: 34,
        boundary: {
          left: {
            id: 'abc123',
            variant: 'waterfront',
            floors: 2,
            elevation: 0.15
          },
          right: { id: 'def456', variant: 'fence', floors: 3, elevation: 0.15 }
        },
        // deprecated flat fields still emitted for back-compat — must lose
        leftBuildingVariant: 'narrow',
        leftBuildingHeight: 9,
        rightBuildingVariant: 'wide',
        rightBuildingHeight: 9
      };
      const left = streetmixUtils.getBoundaryFromStreetData(streetData, 'left');
      assert.strictEqual(left.variant, 'waterfront');
      assert.strictEqual(left.floors, 2);
      assert.strictEqual(left.elevation, 0.15);
      const right = streetmixUtils.getBoundaryFromStreetData(
        streetData,
        'right'
      );
      assert.strictEqual(right.variant, 'fence');
      assert.strictEqual(right.floors, 3);
      assert.strictEqual(right.elevation, 0.15);
    });
    it('should fall back to deprecated flat fields when boundary is absent', function () {
      const streetData = {
        schemaVersion: 33,
        leftBuildingVariant: 'narrow',
        leftBuildingHeight: 4,
        rightBuildingVariant: 'wide',
        rightBuildingHeight: 3
      };
      const left = streetmixUtils.getBoundaryFromStreetData(streetData, 'left');
      assert.strictEqual(left.variant, 'narrow');
      assert.strictEqual(left.floors, 4);
      assert.strictEqual(left.elevation, undefined);
      const right = streetmixUtils.getBoundaryFromStreetData(
        streetData,
        'right'
      );
      assert.strictEqual(right.variant, 'wide');
      assert.strictEqual(right.floors, 3);
    });
    it('should return null when the street has no boundary data', function () {
      assert.strictEqual(
        streetmixUtils.getBoundaryFromStreetData({ schemaVersion: 33 }, 'left'),
        null
      );
      assert.strictEqual(
        streetmixUtils.getBoundaryFromStreetData(undefined, 'right'),
        null
      );
    });
  });
});
