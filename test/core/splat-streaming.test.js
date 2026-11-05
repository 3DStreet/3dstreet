/* global describe, it */

import assert from 'assert';
import {
  HUGE_SCAN_SPLATS,
  HUGE_SCAN_BUDGET_SCALE,
  budgetScaleForSplatCount,
  resolveStreamingSettings,
  shouldFetchForVisibility,
  MOTION_SETTLE_MS,
  MOTION_MAX_STD_DEV,
  MOTION_MIN_SORT_INTERVAL_MS,
  isCameraMoving,
  isMotionProfileEligible,
  resolveMotionSettings
} from '../../src/tested/splat-streaming.js';

describe('splat-streaming', function () {
  describe('#budgetScaleForSplatCount()', function () {
    it('keeps the full budget for a typical single-object splat', function () {
      assert.strictEqual(budgetScaleForSplatCount(750_000), 1);
      assert.strictEqual(budgetScaleForSplatCount(HUGE_SCAN_SPLATS), 1);
    });
    it('halves the budget for a huge scan (the 9M-splat #2047 file)', function () {
      assert.strictEqual(
        budgetScaleForSplatCount(9_060_000),
        HUGE_SCAN_BUDGET_SCALE
      );
    });
    it('treats an unknown count as not huge', function () {
      assert.strictEqual(budgetScaleForSplatCount(undefined), 1);
      assert.strictEqual(budgetScaleForSplatCount(NaN), 1);
      assert.strictEqual(budgetScaleForSplatCount(0), 1);
    });
  });

  describe('#resolveStreamingSettings()', function () {
    it("defaults to Spark's own budget so applying it is a no-op", function () {
      assert.deepStrictEqual(resolveStreamingSettings(), { lodSplatScale: 1 });
      assert.deepStrictEqual(
        resolveStreamingSettings(),
        resolveStreamingSettings({ largestRadSplats: 0 })
      );
    });
    it('halves the budget when the largest .rad is a huge scan', function () {
      assert.deepStrictEqual(
        resolveStreamingSettings({ largestRadSplats: 9_060_000 }),
        { lodSplatScale: 0.5 }
      );
    });
  });

  describe('#shouldFetchForVisibility()', function () {
    it('pauses only while the document is hidden', function () {
      assert.strictEqual(shouldFetchForVisibility('hidden'), false);
      assert.strictEqual(shouldFetchForVisibility('visible'), true);
      assert.strictEqual(shouldFetchForVisibility(undefined), true);
    });
  });

  describe('#isCameraMoving()', function () {
    it('stays moving until the camera has been still MOTION_SETTLE_MS', function () {
      assert.strictEqual(isCameraMoving(1000, 1000), true);
      assert.strictEqual(
        isCameraMoving(1000 + MOTION_SETTLE_MS - 1, 1000),
        true
      );
      assert.strictEqual(isCameraMoving(1000 + MOTION_SETTLE_MS, 1000), false);
    });
    it('is not moving before the camera ever moved', function () {
      assert.strictEqual(isCameraMoving(5, -Infinity), false);
    });
  });

  describe('#isMotionProfileEligible()', function () {
    const base = { hasSplats: true, playing: false, xrPresenting: false };
    it('applies with a splat, outside Play and WebXR', function () {
      assert.strictEqual(isMotionProfileEligible(base), true);
    });
    it('needs a splat and stays out of Play and WebXR', function () {
      assert.strictEqual(
        isMotionProfileEligible({ ...base, hasSplats: false }),
        false
      );
      assert.strictEqual(
        isMotionProfileEligible({ ...base, playing: true }),
        false
      );
      assert.strictEqual(
        isMotionProfileEligible({ ...base, xrPresenting: true }),
        false
      );
    });
  });

  describe('#resolveMotionSettings()', function () {
    const sparkDefaults = {
      pixelRatio: 2,
      maxStdDev: Math.sqrt(8),
      minSortIntervalMs: 0
    };
    it('drops a retina ratio to 1, narrows quads and throttles sorts', function () {
      assert.deepStrictEqual(resolveMotionSettings(sparkDefaults), {
        pixelRatio: 1,
        maxStdDev: MOTION_MAX_STD_DEV,
        minSortIntervalMs: MOTION_MIN_SORT_INTERVAL_MS
      });
    });
    it('never raises a value that is already cheaper', function () {
      assert.deepStrictEqual(
        resolveMotionSettings({
          pixelRatio: 1,
          maxStdDev: 2,
          minSortIntervalMs: 200
        }),
        { pixelRatio: 1, maxStdDev: 2, minSortIntervalMs: 200 }
      );
    });
  });
});
