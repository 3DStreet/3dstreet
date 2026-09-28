/* global describe, it */

import assert from 'assert';
import {
  CLONE_INDEX_ATTR,
  CLONE_KEY_ATTR,
  DETACHABLE_GENERATORS,
  HOLE_TOLERANCE,
  createSlotCounter,
  holeMatches,
  isDetachableGenerator,
  parseHole,
  parseSkipHoles,
  placementKey,
  withSkippedHole,
  withoutSkippedHole
} from '../../src/tested/clone-slots.js';

describe('clone-slots (#2011)', function () {
  it('names the stamps and the slot-aware generators', function () {
    assert.strictEqual(CLONE_INDEX_ATTR, 'data-clone-index');
    assert.strictEqual(CLONE_KEY_ATTR, 'data-clone-key');
    assert.deepStrictEqual(DETACHABLE_GENERATORS, [
      'street-generated-clones',
      'street-generated-stencil',
      'street-generated-pedestrians'
    ]);
  });

  describe('#isDetachableGenerator()', function () {
    it('accepts the slot-aware generators, bare or multi-instance', function () {
      assert.strictEqual(
        isDetachableGenerator('street-generated-clones'),
        true
      );
      assert.strictEqual(
        isDetachableGenerator('street-generated-clones__3'),
        true
      );
      assert.strictEqual(
        isDetachableGenerator('street-generated-stencil__1'),
        true
      );
      assert.strictEqual(
        isDetachableGenerator('street-generated-pedestrians__2'),
        true
      );
    });

    it('rejects surface generators and non-generators', function () {
      assert.strictEqual(
        isDetachableGenerator('street-generated-striping__1'),
        false
      );
      assert.strictEqual(isDetachableGenerator('street-generated-rail'), false);
      assert.strictEqual(
        isDetachableGenerator('street-generated-grass'),
        false
      );
      assert.strictEqual(isDetachableGenerator('street-segment'), false);
      assert.strictEqual(isDetachableGenerator(null), false);
      assert.strictEqual(isDetachableGenerator(undefined), false);
    });
  });

  describe('#placementKey() / #parseHole()', function () {
    it('writes "x z" to the millimeter and reads it back', function () {
      assert.strictEqual(placementKey(1.23456, -12), '1.235 -12');
      assert.strictEqual(placementKey(-0.0001, 0), '0 0');
      assert.deepStrictEqual(parseHole('1.235 -12'), { x: 1.235, z: -12 });
      assert.deepStrictEqual(parseHole('  0   20 '), { x: 0, z: 20 });
      assert.deepStrictEqual(parseHole({ x: 2, z: '3' }), { x: 2, z: 3 });
    });

    it('rejects anything that is not a placement', function () {
      assert.strictEqual(parseHole(''), null);
      assert.strictEqual(parseHole('1'), null);
      assert.strictEqual(parseHole('1 2 3'), null);
      assert.strictEqual(parseHole('x z'), null);
      assert.strictEqual(parseHole(3), null);
      assert.strictEqual(parseHole(null), null);
      assert.strictEqual(parseHole(undefined), null);
    });
  });

  describe('#holeMatches()', function () {
    it('matches within the tolerance on both axes', function () {
      const hole = { x: 0, z: 20 };
      assert.strictEqual(holeMatches(hole, 0, 20), true);
      assert.strictEqual(
        holeMatches(hole, HOLE_TOLERANCE / 2, 20 - HOLE_TOLERANCE / 2),
        true
      );
      assert.strictEqual(holeMatches(hole, 0, 20.05), false);
      assert.strictEqual(holeMatches(hole, 0.05, 20), false);
    });
  });

  describe('#parseSkipHoles()', function () {
    it('accepts strings (the attribute form) and objects, keeping duplicates', function () {
      assert.deepStrictEqual(parseSkipHoles(['0 20', { x: 0, z: -20 }]), [
        { x: 0, z: 20 },
        { x: 0, z: -20 }
      ]);
      // two clones on one spot (a zero-padding stencil group) need two holes
      assert.deepStrictEqual(parseSkipHoles(['0 20', '0.001 20.004']), [
        { x: 0, z: 20 },
        { x: 0.001, z: 20.004 }
      ]);
    });

    it('ignores non-placements, including the old index form', function () {
      assert.deepStrictEqual(parseSkipHoles(['', 'x', 1, '3', '0 7']), [
        { x: 0, z: 7 }
      ]);
      assert.deepStrictEqual(parseSkipHoles(undefined), []);
      assert.deepStrictEqual(parseSkipHoles('0 20'), []);
    });
  });

  describe('#withSkippedHole() / #withoutSkippedHole()', function () {
    it('appends a hole per detach, as "x z" strings', function () {
      assert.deepStrictEqual(withSkippedHole([], '0 20'), ['0 20']);
      assert.deepStrictEqual(withSkippedHole(['0 40'], '0 20'), [
        '0 40',
        '0 20'
      ]);
      // a second detach on the same spot is a second hole
      assert.deepStrictEqual(withSkippedHole(['0 20'], '0 20'), [
        '0 20',
        '0 20'
      ]);
      assert.deepStrictEqual(withSkippedHole(['0 20'], 'nope'), ['0 20']);
    });

    it('removes one hole and leaves the rest', function () {
      assert.deepStrictEqual(withoutSkippedHole(['0 20', '0 -20'], '0 -20'), [
        '0 20'
      ]);
      assert.deepStrictEqual(
        withoutSkippedHole(['0 20', '0 20'], '0.004 20.001'),
        ['0 20']
      );
      assert.deepStrictEqual(withoutSkippedHole(['0 20'], '0 9'), ['0 20']);
    });

    it('does not mutate the input', function () {
      const skip = ['0 20', '0 40'];
      withSkippedHole(skip, '0 60');
      withoutSkippedHole(skip, '0 20');
      assert.deepStrictEqual(skip, ['0 20', '0 40']);
    });
  });

  describe('#createSlotCounter()', function () {
    it('numbers placements in order and flags the ones on a hole', function () {
      const slots = createSlotCounter(['0 20', { x: 0, z: -20 }]);
      assert.deepStrictEqual(slots.next(0, 40), {
        index: 0,
        key: '0 40',
        skipped: false
      });
      assert.deepStrictEqual(slots.next(0, 20), {
        index: 1,
        key: '0 20',
        skipped: true
      });
      assert.deepStrictEqual(slots.next(0, 0), {
        index: 2,
        key: '0 0',
        skipped: false
      });
      assert.deepStrictEqual(slots.next(0.004, -20.003), {
        index: 3,
        key: '0.004 -20.003',
        skipped: true
      });
    });

    it('spends each hole on one placement, so stacked clones need one hole each', function () {
      const one = createSlotCounter(['0 20']);
      assert.strictEqual(one.next(0, 20).skipped, true);
      assert.strictEqual(one.next(0, 20).skipped, false);
      const two = createSlotCounter(['0 20', '0 20']);
      assert.strictEqual(two.next(0, 20).skipped, true);
      assert.strictEqual(two.next(0, 20).skipped, true);
      assert.strictEqual(two.next(0, 20).skipped, false);
    });

    it('forgets a hole that the layout no longer lands on', function () {
      // The hole was made at 0 25; a re-spaced layout that never places a
      // clone there creates every clone, and nothing else goes missing.
      const slots = createSlotCounter(['0 25']);
      const placed = [40, 30, 20, 10, 0].map((z) => slots.next(0, z).skipped);
      assert.deepStrictEqual(placed, [false, false, false, false, false]);
    });

    it('skips nothing without a skip list', function () {
      const slots = createSlotCounter(undefined);
      assert.deepStrictEqual(slots.next(1, 2), {
        index: 0,
        key: '1 2',
        skipped: false
      });
      assert.deepStrictEqual(slots.next(1, 3).index, 1);
    });
  });
});
