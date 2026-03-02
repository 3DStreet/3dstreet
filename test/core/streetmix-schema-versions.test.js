/* global describe, it */

/**
 * Schema Version Tests for Streetmix Import
 *
 * These tests verify that different Streetmix schema versions are handled correctly.
 * This is critical because Streetmix changes their data format over time:
 * - Schema < 30: widths in feet, elevation as integer levels
 * - Schema 30-32: widths in meters, elevation as integer levels
 * - Schema >= 33: widths in meters, elevation in meters
 *
 * Test fixtures represent real-world Streetmix data structures.
 */

const assert = require('assert');
const streetmixUtils = require('../../src/tested/streetmix-utils');

// Fixture: Schema v22 (legacy - feet, integer elevation)
const SCHEMA_V22_STREET = {
  schemaVersion: 22,
  width: 40, // feet
  segments: [
    {
      type: 'drive-lane',
      width: 10,
      elevation: 0,
      variantString: 'inbound|car'
    },
    { type: 'sidewalk', width: 6, elevation: 1, variantString: 'normal' },
    { type: 'sidewalk', width: 6, elevation: 2, variantString: 'normal' }
  ]
};

// Fixture: Schema v30 (metric widths, integer elevation)
const SCHEMA_V30_STREET = {
  schemaVersion: 30,
  width: 12.192, // meters
  segments: [
    {
      type: 'drive-lane',
      width: 3.048,
      elevation: 0,
      variantString: 'inbound|car'
    },
    { type: 'sidewalk', width: 1.8288, elevation: 1, variantString: 'normal' },
    { type: 'sidewalk', width: 1.8288, elevation: 2, variantString: 'normal' }
  ]
};

// Fixture: Schema v32 (metric widths, integer elevation)
const SCHEMA_V32_STREET = {
  schemaVersion: 32,
  width: 12.192,
  segments: [
    {
      type: 'drive-lane',
      width: 3.048,
      elevation: 0,
      variantString: 'inbound|car'
    },
    { type: 'sidewalk', width: 1.8288, elevation: 1, variantString: 'normal' },
    {
      type: 'light-rail',
      width: 3.6576,
      elevation: 2,
      variantString: 'inbound|colored'
    }
  ]
};

// Fixture: Schema v33 (metric widths, metric elevation in meters)
const SCHEMA_V33_STREET = {
  schemaVersion: 33,
  width: 12.192,
  segments: [
    {
      type: 'drive-lane',
      width: 3.048,
      elevation: 0,
      variantString: 'inbound|car'
    },
    {
      type: 'sidewalk',
      width: 1.8288,
      elevation: 0.15,
      variantString: 'normal'
    }, // curb height
    {
      type: 'light-rail',
      width: 3.6576,
      elevation: 0.75,
      variantString: 'inbound|colored'
    } // raised platform
  ]
};

// Fixture: Schema v33 with edge cases
const SCHEMA_V33_EDGE_CASES = {
  schemaVersion: 33,
  width: 20,
  segments: [
    {
      type: 'drive-lane',
      width: 3,
      elevation: 0,
      variantString: 'inbound|car'
    },
    { type: 'sidewalk', width: 2, elevation: 0.15, variantString: 'normal' },
    { type: 'sidewalk', width: 2, elevation: 0.3, variantString: 'normal' }, // two curb heights
    {
      type: 'sidewalk',
      width: 2,
      elevation: undefined,
      variantString: 'normal'
    }, // undefined elevation
    { type: 'bike-lane', width: 2, variantString: 'inbound|green' } // missing elevation property
  ]
};

describe('Streetmix Schema Version Handling', function () {
  describe('Schema v22 (legacy feet + integer elevation)', function () {
    it('should convert width from feet to meters', function () {
      const result = streetmixUtils.convertStreetValues(
        JSON.parse(JSON.stringify(SCHEMA_V22_STREET))
      );
      // 10 feet = 3.048 meters
      assert.strictEqual(
        result.segments[0].width.toFixed(4),
        (10 * 0.3048).toFixed(4)
      );
    });

    it('should preserve integer elevation levels', function () {
      const result = streetmixUtils.convertStreetValues(
        JSON.parse(JSON.stringify(SCHEMA_V22_STREET))
      );
      assert.strictEqual(result.segments[0].elevation, 0);
      assert.strictEqual(result.segments[1].elevation, 1);
      assert.strictEqual(result.segments[2].elevation, 2);
    });
  });

  describe('Schema v30-32 (metric widths + integer elevation)', function () {
    it('should preserve metric widths', function () {
      const result = streetmixUtils.convertStreetValues(
        JSON.parse(JSON.stringify(SCHEMA_V30_STREET))
      );
      assert.strictEqual(result.segments[0].width, 3.048);
    });

    it('should preserve integer elevation levels', function () {
      const result = streetmixUtils.convertStreetValues(
        JSON.parse(JSON.stringify(SCHEMA_V32_STREET))
      );
      assert.strictEqual(result.segments[0].elevation, 0);
      assert.strictEqual(result.segments[1].elevation, 1);
      assert.strictEqual(result.segments[2].elevation, 2);
    });
  });

  describe('Schema v33+ (metric widths + metric elevation)', function () {
    it('should preserve metric widths', function () {
      const result = streetmixUtils.convertStreetValues(
        JSON.parse(JSON.stringify(SCHEMA_V33_STREET))
      );
      assert.strictEqual(result.segments[0].width, 3.048);
    });

    it('should convert metric elevation to integer levels', function () {
      const result = streetmixUtils.convertStreetValues(
        JSON.parse(JSON.stringify(SCHEMA_V33_STREET))
      );
      assert.strictEqual(result.segments[0].elevation, 0); // 0m -> level 0 (road)
      assert.strictEqual(result.segments[1].elevation, 1); // 0.15m -> level 1 (curb)
      assert.strictEqual(result.segments[2].elevation, 5); // 0.75m -> level 5 (raised platform)
    });

    it('should handle edge cases gracefully', function () {
      const result = streetmixUtils.convertStreetValues(
        JSON.parse(JSON.stringify(SCHEMA_V33_EDGE_CASES))
      );
      assert.strictEqual(result.segments[0].elevation, 0); // 0m -> level 0
      assert.strictEqual(result.segments[1].elevation, 1); // 0.15m -> level 1
      assert.strictEqual(result.segments[2].elevation, 2); // 0.30m -> level 2
      // undefined and missing elevation should remain as-is (handled downstream)
      assert.strictEqual(result.segments[3].elevation, undefined);
      assert.strictEqual(result.segments[4].elevation, undefined);
    });
  });

  describe('Cross-schema compatibility', function () {
    it('should produce equivalent elevation levels from v32 and v33 data', function () {
      // Same logical street in v32 (integer) and v33 (metric) formats
      const v32Street = {
        schemaVersion: 32,
        segments: [
          { type: 'drive-lane', width: 3, elevation: 0 },
          { type: 'sidewalk', width: 2, elevation: 1 }
        ]
      };
      const v33Street = {
        schemaVersion: 33,
        segments: [
          { type: 'drive-lane', width: 3, elevation: 0 },
          { type: 'sidewalk', width: 2, elevation: 0.15 }
        ]
      };

      const resultV32 = streetmixUtils.convertStreetValues(
        JSON.parse(JSON.stringify(v32Street))
      );
      const resultV33 = streetmixUtils.convertStreetValues(
        JSON.parse(JSON.stringify(v33Street))
      );

      // Both should have the same elevation levels after conversion
      assert.strictEqual(
        resultV32.segments[0].elevation,
        resultV33.segments[0].elevation
      );
      assert.strictEqual(
        resultV32.segments[1].elevation,
        resultV33.segments[1].elevation
      );
    });
  });
});
