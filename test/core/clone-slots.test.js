/* global describe, it */

import assert from 'assert';
import {
  CLONE_INDEX_ATTR,
  DETACHABLE_GENERATORS,
  createSlotCounter,
  isDetachableGenerator,
  parseSkipSlots,
  withSkippedSlot,
  withoutSkippedSlot
} from '../../src/tested/clone-slots.js';

describe('clone-slots (#2011)', function () {
  it('names the stamp and the slot-aware generators', function () {
    assert.strictEqual(CLONE_INDEX_ATTR, 'data-clone-index');
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

  describe('#parseSkipSlots()', function () {
    it('accepts numbers and the strings A-Frame parses from an attribute', function () {
      assert.deepStrictEqual([...parseSkipSlots([0, 3])], [0, 3]);
      assert.deepStrictEqual([...parseSkipSlots(['1', ' 4 '])], [1, 4]);
      assert.deepStrictEqual([...parseSkipSlots([2, '2'])], [2]);
    });

    it('ignores anything that is not a non-negative integer', function () {
      assert.deepStrictEqual([...parseSkipSlots(['', 'x', -1, 1.5, 7])], [7]);
      assert.deepStrictEqual([...parseSkipSlots(undefined)], []);
      assert.deepStrictEqual([...parseSkipSlots('1, 2')], []);
    });
  });

  describe('#withSkippedSlot() / #withoutSkippedSlot()', function () {
    it('appends a slot, sorted and de-duplicated, as numbers', function () {
      assert.deepStrictEqual(withSkippedSlot([], 2), [2]);
      assert.deepStrictEqual(withSkippedSlot(['5', 1], 3), [1, 3, 5]);
      assert.deepStrictEqual(withSkippedSlot([3], '3'), [3]);
    });

    it('removes a slot and leaves the rest', function () {
      assert.deepStrictEqual(withoutSkippedSlot([1, 3, 5], 3), [1, 5]);
      assert.deepStrictEqual(withoutSkippedSlot(['1', '3'], '1'), [3]);
      assert.deepStrictEqual(withoutSkippedSlot([1], 9), [1]);
    });

    it('does not mutate the input', function () {
      const skip = [4, 2];
      withSkippedSlot(skip, 1);
      withoutSkippedSlot(skip, 4);
      assert.deepStrictEqual(skip, [4, 2]);
    });
  });

  describe('#createSlotCounter()', function () {
    it('hands out consecutive slots and flags the skipped ones', function () {
      const slots = createSlotCounter(['1', 3]);
      assert.deepStrictEqual(slots.next(), { index: 0, skipped: false });
      assert.deepStrictEqual(slots.next(), { index: 1, skipped: true });
      assert.deepStrictEqual(slots.next(), { index: 2, skipped: false });
      assert.deepStrictEqual(slots.next(), { index: 3, skipped: true });
      assert.deepStrictEqual(slots.next(), { index: 4, skipped: false });
    });

    it('skips nothing without a skip list', function () {
      const slots = createSlotCounter(undefined);
      assert.deepStrictEqual(slots.next(), { index: 0, skipped: false });
      assert.deepStrictEqual(slots.next(), { index: 1, skipped: false });
    });
  });
});
