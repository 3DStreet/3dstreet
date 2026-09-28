/* global describe, it */

import assert from 'assert';
import {
  STREAMING_PROFILES,
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
    it("defaults to Spark's own values so applying it is a no-op", function () {
      assert.deepStrictEqual(resolveStreamingSettings(), {
        lodSplatScale: 1,
        numFetchers: 3,
        fetchPauseMs: 0
      });
      assert.deepStrictEqual(
        resolveStreamingSettings(),
        resolveStreamingSettings({ dataSaver: false, largestRadSplats: 0 })
      );
    });
    it('data saver halves the budget, serializes fetches and paces them', function () {
      const s = resolveStreamingSettings({ dataSaver: true });
      assert.strictEqual(s.lodSplatScale, 0.5);
      assert.strictEqual(s.numFetchers, 1);
      assert.ok(s.fetchPauseMs > 0);
      assert.deepStrictEqual(s, {
        lodSplatScale: STREAMING_PROFILES.dataSaver.lodSplatScale,
        numFetchers: STREAMING_PROFILES.dataSaver.numFetchers,
        fetchPauseMs: STREAMING_PROFILES.dataSaver.fetchPauseMs
      });
    });
    it('huge scan and data saver compound on the budget only', function () {
      const s = resolveStreamingSettings({
        dataSaver: true,
        largestRadSplats: 9_060_000
      });
      assert.strictEqual(s.lodSplatScale, 0.25);
      assert.strictEqual(s.numFetchers, 1);
      const standardHuge = resolveStreamingSettings({
        largestRadSplats: 9_060_000
      });
      assert.strictEqual(standardHuge.lodSplatScale, 0.5);
      assert.strictEqual(standardHuge.numFetchers, 3);
      assert.strictEqual(standardHuge.fetchPauseMs, 0);
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
