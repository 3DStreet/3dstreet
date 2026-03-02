/* global describe, it */

const assert = require('assert');
const {
  calculateHeight,
  CURB_HEIGHT,
  BASE_SURFACE_DEPTH
} = require('../../src/tested/street-segment-utils');

describe('StreetSegmentUtils', function () {
  describe('#calculateHeight()', function () {
    it('should return 0.15m for level 0 (base depth only)', function () {
      assert.strictEqual(calculateHeight(0), 0.15);
    });
    it('should return 0.30m for level 1', function () {
      assert.strictEqual(calculateHeight(1), 0.3);
    });
    it('should return ~0.45m for level 2', function () {
      assert.ok(Math.abs(calculateHeight(2) - 0.45) < 1e-10);
    });
    it('should clamp negative levels to BASE_SURFACE_DEPTH', function () {
      assert.strictEqual(calculateHeight(-1), BASE_SURFACE_DEPTH);
      assert.strictEqual(calculateHeight(-2), BASE_SURFACE_DEPTH);
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
});
