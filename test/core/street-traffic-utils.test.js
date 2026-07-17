/* global describe, it */

import assert from 'assert';
import {
  varyLaneSpeed,
  directionFromFacing
} from '../../src/tested/street-traffic-utils.js';
import { createRNG } from '../../src/lib/rng.js';

describe('StreetTrafficUtils', function () {
  describe('#varyLaneSpeed()', function () {
    it('stays within ±10% of the base speed', function () {
      const rng = createRNG(42);
      for (let i = 0; i < 100; i++) {
        const speed = varyLaneSpeed(10, rng);
        assert.ok(speed >= 9 && speed <= 11, `speed ${speed} out of range`);
      }
    });
    it('is deterministic for a given seed', function () {
      assert.strictEqual(
        varyLaneSpeed(11.2, createRNG(7)),
        varyLaneSpeed(11.2, createRNG(7))
      );
    });
    it('differs across seeds so parallel lanes decorrelate', function () {
      assert.notStrictEqual(
        varyLaneSpeed(11.2, createRNG(1)),
        varyLaneSpeed(11.2, createRNG(1001))
      );
    });
  });

  describe('#directionFromFacing()', function () {
    // Catalog models are authored forward = +Z; rotation 0 faces +Z.
    it('0° faces +Z and moves +Z', function () {
      assert.strictEqual(directionFromFacing(0), 1);
    });
    it('180° faces -Z and moves -Z', function () {
      assert.strictEqual(directionFromFacing(180), -1);
    });
    it('within 90° of 0 still moves +Z (89°)', function () {
      assert.strictEqual(directionFromFacing(89), 1);
    });
    it('beyond 90° flips to -Z (91°)', function () {
      assert.strictEqual(directionFromFacing(91), -1);
    });
    it('wraps full turns (360° = 0°)', function () {
      assert.strictEqual(directionFromFacing(360), 1);
    });
    it('handles negative angles (-180° moves -Z)', function () {
      assert.strictEqual(directionFromFacing(-180), -1);
    });
  });
});
