/* global describe, it */

import assert from 'assert';
import {
  isSeededGenerator,
  reseededGeneratorAttributes,
  withoutSeed
} from '../../src/tested/generator-seeds.js';

describe('generator-seeds', () => {
  describe('isSeededGenerator', () => {
    it('matches the seeded generators with and without instance suffix', () => {
      assert.strictEqual(isSeededGenerator('street-generated-clones'), true);
      assert.strictEqual(isSeededGenerator('street-generated-clones__3'), true);
      assert.strictEqual(
        isSeededGenerator('street-generated-pedestrians__1'),
        true
      );
      assert.strictEqual(isSeededGenerator('street-generated-grass'), true);
    });

    it('ignores unseeded generators and other attributes', () => {
      assert.strictEqual(
        isSeededGenerator('street-generated-striping__1'),
        false
      );
      assert.strictEqual(
        isSeededGenerator('street-generated-stencil__1'),
        false
      );
      assert.strictEqual(isSeededGenerator('street-segment'), false);
      assert.strictEqual(isSeededGenerator('id'), false);
      assert.strictEqual(isSeededGenerator(undefined), false);
    });
  });

  describe('withoutSeed', () => {
    it('drops the seed and keeps every other property verbatim', () => {
      assert.strictEqual(
        withoutSeed('mode: random; seed: 4242; spacing: 20; skip: 1.5 2, 3 4'),
        'mode: random; spacing: 20; skip: 1.5 2, 3 4'
      );
    });

    it('handles the seed at either end of the string', () => {
      assert.strictEqual(
        withoutSeed('seed: 7; modelsArray: car, truck'),
        'modelsArray: car, truck'
      );
      assert.strictEqual(
        withoutSeed('modelsArray: car, truck; seed: 7'),
        'modelsArray: car, truck'
      );
      assert.strictEqual(withoutSeed('seed: 7'), '');
    });

    it('returns the value unchanged when there is no seed', () => {
      const value = 'mode: fixed; spacing: 15';
      assert.strictEqual(withoutSeed(value), value);
      assert.strictEqual(withoutSeed(''), '');
    });

    it('does not mistake a property containing "seed" for the seed', () => {
      const value = 'modelsArray: seedling; useSeed: 3';
      assert.strictEqual(withoutSeed(value), value);
    });
  });

  describe('reseededGeneratorAttributes', () => {
    it('lists only seeded generator attributes whose value changes', () => {
      const attributes = [
        { name: 'id', value: 'lane-2' },
        { name: 'street-segment', value: 'type: drive-lane; length: 60' },
        { name: 'street-generated-striping__1', value: 'striping: solid' },
        {
          name: 'street-generated-clones__1',
          value: 'mode: random; seed: 4242; modelsArray: car'
        },
        {
          name: 'street-generated-clones__2',
          value: 'mode: fixed; spacing: 5'
        },
        {
          name: 'street-generated-pedestrians__1',
          value: 'density: normal; seed: 9'
        }
      ];
      assert.deepStrictEqual(reseededGeneratorAttributes(attributes), [
        {
          name: 'street-generated-clones__1',
          value: 'mode: random; modelsArray: car'
        },
        { name: 'street-generated-pedestrians__1', value: 'density: normal' }
      ]);
    });
  });
});
