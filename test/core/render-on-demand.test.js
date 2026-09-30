/* global describe, it */

import assert from 'assert';
import {
  SETTLE_MS,
  HEARTBEAT_MS,
  isSkipEligible,
  drawReason,
  shouldDrawFrame,
  matrixChanged
} from '../../src/tested/render-on-demand.js';

const EDITOR = {
  enabled: true,
  inspectorOpened: true,
  playing: false,
  xrPresenting: false
};

describe('render-on-demand', function () {
  describe('#isSkipEligible()', function () {
    it('allows skipping only in the idle editor', function () {
      assert.strictEqual(isSkipEligible(EDITOR), true);
    });
    it('draws every frame in viewer mode, Play and WebXR', function () {
      assert.strictEqual(
        isSkipEligible({ ...EDITOR, inspectorOpened: false }),
        false
      );
      assert.strictEqual(isSkipEligible({ ...EDITOR, playing: true }), false);
      assert.strictEqual(
        isSkipEligible({ ...EDITOR, xrPresenting: true }),
        false
      );
    });
    it('honours the master switch', function () {
      assert.strictEqual(isSkipEligible({ ...EDITOR, enabled: false }), false);
    });
  });

  describe('#shouldDrawFrame()', function () {
    const idle = {
      now: 10_000,
      eligible: true,
      lastInvalidation: 10_000 - SETTLE_MS - 1,
      lastDraw: 10_000 - 1
    };
    it('skips an idle, eligible frame', function () {
      assert.strictEqual(shouldDrawFrame(idle), false);
    });
    it('always draws when not eligible', function () {
      assert.strictEqual(shouldDrawFrame({ ...idle, eligible: false }), true);
    });
    it('draws continuously inside the settle window', function () {
      assert.strictEqual(
        shouldDrawFrame({ ...idle, lastInvalidation: idle.now - 1 }),
        true
      );
      assert.strictEqual(
        shouldDrawFrame({
          ...idle,
          lastInvalidation: idle.now - SETTLE_MS + 1
        }),
        true
      );
    });
    it('draws one frame for a Spark onDirty request', function () {
      assert.strictEqual(
        shouldDrawFrame({ ...idle, frameRequested: true }),
        true
      );
    });
    it('keeps a heartbeat so an unsignalled change still shows', function () {
      assert.strictEqual(
        shouldDrawFrame({ ...idle, lastDraw: idle.now - HEARTBEAT_MS }),
        true
      );
    });
    it('draws the first frame (nothing drawn or invalidated yet)', function () {
      assert.strictEqual(
        shouldDrawFrame({
          now: 1,
          eligible: true,
          lastInvalidation: -Infinity,
          lastDraw: -Infinity
        }),
        true
      );
    });
  });

  describe('#drawReason()', function () {
    const now = 10_000;
    const idle = {
      now,
      eligible: true,
      lastInvalidation: now - SETTLE_MS - 1,
      lastDraw: now - 1
    };
    it('names why a frame draws, most specific first', function () {
      assert.strictEqual(drawReason(idle), null);
      assert.strictEqual(
        drawReason({ ...idle, eligible: false, frameRequested: true }),
        'ineligible'
      );
      assert.strictEqual(
        drawReason({ ...idle, frameRequested: true, lastInvalidation: now }),
        'requested'
      );
      assert.strictEqual(
        drawReason({ ...idle, lastInvalidation: now }),
        'settling'
      );
      assert.strictEqual(
        drawReason({ ...idle, lastDraw: now - HEARTBEAT_MS }),
        'heartbeat'
      );
    });
  });

  describe('#matrixChanged()', function () {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    it('is false for an identical matrix', function () {
      assert.strictEqual(matrixChanged(identity, identity.slice()), false);
    });
    it('is true for any moved element', function () {
      const moved = identity.slice();
      moved[12] = 0.0001;
      assert.strictEqual(matrixChanged(identity, moved), true);
    });
    it('is true when there is no previous matrix', function () {
      assert.strictEqual(matrixChanged(identity, null), true);
    });
  });
});
