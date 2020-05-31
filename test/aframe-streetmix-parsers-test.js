/* global describe, it */

const rewire = require('rewire');
const assert = require('assert');

const app = rewire('../src/tested/aframe-streetmix-parsers-tested');

const isSidewalk = app.__get__('isSidewalk');
const createBuildingsArray = app.__get__('createBuildingsArray');
const createElementFromObject = app.__get__('createElementFromObject');
const appendChildElementsFromArray = app.__get__('appendChildElementsFromArray');

describe('A-Frame Streetmix Parsers', function () {
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

  describe('#createBuildingsArray()', function () {
    it('createBuildingsArray(maxLength = 5) should return array with one dictionary for a-entity with mixin SM3D_Bld_Mixed_Corner_4fl', function () {
      assert.deepStrictEqual(
        createBuildingsArray(5),
        [{ tag: 'a-entity', mixin: 'SM3D_Bld_Mixed_Corner_4fl', position: '0 0 0' }]
      );
    });
    it('createBuildingsArray(maxLength = 10) should return array with 2 dictionaries of a-entities', function () {
      assert.deepStrictEqual(
        createBuildingsArray(10),
        [{ mixin: 'SM3D_Bld_Mixed_Corner_4fl', position: '0 0 0', tag: 'a-entity' }, { mixin: 'SM3D_Bld_Mixed_Double_5fl', position: '0 0 5', tag: 'a-entity' }]
      );
    });
  });

  describe('#createElementFromObject()', function () {
    it('should return object that is instanceof Element', function () {
      const outputEl = createElementFromObject({ mixin: 'SM3D_Bld_Mixed_Corner_4fl', position: '0 0 0', tag: 'a-entity' });
      assert.ok(
        outputEl instanceof Element // eslint-disable-line no-undef
      );
    });
    it('should return element with outerHTML === \'<a-entity mixin="SM3D_Bld_Mixed_Corner_4fl" position="0 0 0"></a-entity>\'', function () {
      const outputEl = createElementFromObject({ mixin: 'SM3D_Bld_Mixed_Corner_4fl', position: '0 0 0', tag: 'a-entity' });
      assert.strictEqual(
        outputEl.outerHTML,
        '<a-entity mixin="SM3D_Bld_Mixed_Corner_4fl" position="0 0 0"></a-entity>'
      );
    });
  });

  describe('#appendChildElementsFromArray()', function () {
    it('should return element with outerHTML matching 2 child building elements inside parent element', function () {
      const array = [{ mixin: 'SM3D_Bld_Mixed_Corner_4fl', position: '0 0 0', tag: 'a-entity' }, { mixin: 'SM3D_Bld_Mixed_Double_5fl', position: '0 0 5', tag: 'a-entity' }];
      const parentEl = document.createElement('a-entity');
      assert.strictEqual(
        appendChildElementsFromArray(array, parentEl).outerHTML,
        '<a-entity><a-entity mixin="SM3D_Bld_Mixed_Corner_4fl" position="0 0 0"></a-entity><a-entity mixin="SM3D_Bld_Mixed_Double_5fl" position="0 0 5"></a-entity></a-entity>'
      );
    });
  });
});
