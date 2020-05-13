/* global describe, it */

const rewire = require('rewire');
const assert = require('assert');

const app = rewire('../src/tested/aframe-streetmix-tested');

const isSidewalk = app.__get__('isSidewalk');

describe('A-Frame Streetmix', function () {
  describe('#isSidewalk()', function () {
    it('should return true when provided a string that is exactly sidewalk', function () {
      assert.ok(
        isSidewalk('sidewalk'));
    });
    it('should return true when provided a string starting with sidewalk', function () {
      assert.ok(
        isSidewalk('sidewalkgibberish'));
    });
    it('should return true when provided a long string like scooter-drop-zone', function () {
      assert.ok(
        isSidewalk('scooter-drop-zone'));
    });
  });
});
