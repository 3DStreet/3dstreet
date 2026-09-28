/* global describe, it */

import assert from 'assert';
import {
  HUGE_SCAN_SPLATS,
  HUGE_SCAN_BUDGET_SCALE,
  budgetScaleForSplatCount,
  resolveStreamingSettings,
  shouldFetchForVisibility
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
});
