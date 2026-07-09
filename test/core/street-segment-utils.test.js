/* global describe, it */

import assert from 'assert';
import {
  calculateHeight,
  calculateSlopedHeights,
  levelToElevation,
  migrateSegmentLevelToElevation,
  migrateSegmentBuildingType,
  migrateShowBuildingsFlag,
  CURB_HEIGHT,
  BASE_SURFACE_DEPTH
} from '../../src/tested/street-segment-utils.js';

describe('StreetSegmentUtils', function () {
  describe('#calculateHeight()', function () {
    it('should return 0.15m for elevation 0 (base depth only)', function () {
      assert.strictEqual(calculateHeight(0), 0.15);
    });
    it('should return 0.30m for elevation 0.15m (curb height)', function () {
      assert.strictEqual(calculateHeight(0.15), 0.3);
    });
    it('should return ~0.45m for elevation 0.30m', function () {
      assert.ok(Math.abs(calculateHeight(0.3) - 0.45) < 1e-10);
    });
    it('should return 0.90m for elevation 0.75m (light rail platform)', function () {
      assert.ok(Math.abs(calculateHeight(0.75) - 0.9) < 1e-10);
    });
    it('should clamp negative elevations to BASE_SURFACE_DEPTH (negatives are intentionally unsupported)', function () {
      assert.strictEqual(calculateHeight(-0.15), BASE_SURFACE_DEPTH);
      assert.strictEqual(calculateHeight(-0.3), BASE_SURFACE_DEPTH);
    });
    it('should return BASE_SURFACE_DEPTH for undefined', function () {
      assert.strictEqual(calculateHeight(undefined), BASE_SURFACE_DEPTH);
    });
    it('should return BASE_SURFACE_DEPTH for null', function () {
      assert.strictEqual(calculateHeight(null), BASE_SURFACE_DEPTH);
    });
    it('should use CURB_HEIGHT of 0.15m', function () {
      assert.strictEqual(CURB_HEIGHT, 0.15);
    });
    it('should use BASE_SURFACE_DEPTH of 0.15m', function () {
      assert.strictEqual(BASE_SURFACE_DEPTH, 0.15);
    });
  });

  describe('#calculateSlopedHeights()', function () {
    it('should tilt between curb height and road level', function () {
      // 0.15m -> surface height 0.30, 0m -> 0.15; mean 0.225, deltas ±0.075
      const { height, startDelta, endDelta } = calculateSlopedHeights(0.15, 0);
      assert.ok(Math.abs(height - 0.225) < 1e-10);
      assert.ok(Math.abs(startDelta - 0.075) < 1e-10);
      assert.ok(Math.abs(endDelta + 0.075) < 1e-10);
    });
    it('should degenerate to a flat surface when both elevations match', function () {
      const { height, startDelta, endDelta } = calculateSlopedHeights(
        0.15,
        0.15
      );
      assert.strictEqual(height, calculateHeight(0.15));
      assert.strictEqual(startDelta, 0);
      assert.strictEqual(endDelta, 0);
    });
    it('should respect the base-depth clamp at each edge', function () {
      // a negative edge elevation clamps to BASE_SURFACE_DEPTH before averaging
      const { height, startDelta, endDelta } = calculateSlopedHeights(
        -0.3,
        0.15
      );
      assert.ok(Math.abs(height - (0.15 + 0.3) / 2) < 1e-10);
      assert.ok(Math.abs(startDelta - (0.15 - height)) < 1e-10);
      assert.ok(Math.abs(endDelta - (0.3 - height)) < 1e-10);
    });
  });

  describe('#levelToElevation()', function () {
    it('should convert level 0 to 0m', function () {
      assert.strictEqual(levelToElevation(0), 0);
    });
    it('should convert level 1 to 0.15m', function () {
      assert.strictEqual(levelToElevation(1), 0.15);
    });
    it('should convert level 2 to 0.30m', function () {
      assert.ok(Math.abs(levelToElevation(2) - 0.3) < 1e-10);
    });
    it('should clamp negative levels to 0m (negatives are intentionally unsupported)', function () {
      assert.strictEqual(levelToElevation(-1), 0);
      assert.strictEqual(levelToElevation(-2), 0);
    });
    it('should convert undefined/null/NaN to 0m', function () {
      assert.strictEqual(levelToElevation(undefined), 0);
      assert.strictEqual(levelToElevation(null), 0);
      assert.strictEqual(levelToElevation(NaN), 0);
    });
  });

  describe('#migrateSegmentLevelToElevation()', function () {
    it('should convert level to elevation in a prop string', function () {
      assert.strictEqual(
        migrateSegmentLevelToElevation(
          'type: sidewalk; width: 3; level: 1; direction: none'
        ),
        'type: sidewalk; width: 3; elevation: 0.15; direction: none'
      );
    });
    it('should convert level 0 to elevation 0 in a prop string', function () {
      assert.strictEqual(
        migrateSegmentLevelToElevation('level: 0; surface: asphalt'),
        'elevation: 0; surface: asphalt'
      );
    });
    it('should clamp negative levels to elevation 0 in a prop string', function () {
      assert.strictEqual(
        migrateSegmentLevelToElevation('type: divider; level: -1'),
        'type: divider; elevation: 0'
      );
    });
    it('should leave prop strings without level untouched', function () {
      const value = 'type: drive-lane; width: 3';
      assert.strictEqual(migrateSegmentLevelToElevation(value), value);
    });
    it('should leave prop strings that already carry elevation untouched', function () {
      const value = 'type: sidewalk; elevation: 0.15';
      assert.strictEqual(migrateSegmentLevelToElevation(value), value);
    });
    it('should convert level to elevation in an object value', function () {
      const migrated = migrateSegmentLevelToElevation({
        type: 'sidewalk',
        width: 3,
        level: 2
      });
      assert.deepStrictEqual(migrated, {
        type: 'sidewalk',
        width: 3,
        elevation: 0.3
      });
    });
    it('should drop level but keep existing elevation in an object value', function () {
      const migrated = migrateSegmentLevelToElevation({
        level: 1,
        elevation: 0.75
      });
      assert.deepStrictEqual(migrated, { elevation: 0.75 });
    });
    it('should pass through non-segment values unchanged', function () {
      assert.strictEqual(migrateSegmentLevelToElevation(undefined), undefined);
      assert.strictEqual(migrateSegmentLevelToElevation(null), null);
    });
  });

  describe('#migrateSegmentBuildingType()', function () {
    it('should rename type building to boundary in a prop string', function () {
      assert.strictEqual(
        migrateSegmentBuildingType(
          'type: building; width: 10; variant: water; side: left'
        ),
        'type: boundary; width: 10; variant: water; side: left'
      );
    });
    it('should handle type at the end of a prop string', function () {
      assert.strictEqual(
        migrateSegmentBuildingType('width: 10; type: building'),
        'width: 10; type: boundary'
      );
    });
    it('should not touch other types or building-ish values', function () {
      const lane = 'type: drive-lane; width: 3';
      assert.strictEqual(migrateSegmentBuildingType(lane), lane);
      // model names containing "building" in other props must survive
      const models = 'type: boundary; modelsArray: arched-building-01';
      assert.strictEqual(migrateSegmentBuildingType(models), models);
    });
    it('should rename type in an object value', function () {
      assert.deepStrictEqual(
        migrateSegmentBuildingType({ type: 'building', width: 10 }),
        { type: 'boundary', width: 10 }
      );
    });
  });

  describe('#migrateShowBuildingsFlag()', function () {
    it('should rename showBuildings to showBoundaries in a prop string', function () {
      assert.strictEqual(
        migrateShowBuildingsFlag(
          'sourceType: streetmix-url; showBuildings: false'
        ),
        'sourceType: streetmix-url; showBoundaries: false'
      );
    });
    it('should rename the flag in an object value', function () {
      assert.deepStrictEqual(
        migrateShowBuildingsFlag({ length: 60, showBuildings: false }),
        { length: 60, showBoundaries: false }
      );
    });
    it('should leave values without the flag untouched', function () {
      const value = 'sourceType: streetmix-url; showBoundaries: true';
      assert.strictEqual(migrateShowBuildingsFlag(value), value);
    });
  });
});
