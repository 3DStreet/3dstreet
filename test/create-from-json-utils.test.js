/* global describe, it */

const assert = require('assert');
const createFromJSONUtilsTested = require('../src/tested/create-from-json-utils-tested');

describe('create-from-json component utils unit tests', function () {
  describe('#createElementFromObject()', function () {
    it('should return object that is instanceof Element', function () {
      const outputEl = createFromJSONUtilsTested.createElementFromObject({ mixin: 'SM3D_Bld_Mixed_Corner_4fl', position: '0 0 0', tag: 'a-entity' });
      assert.ok(
        outputEl instanceof Element // eslint-disable-line no-undef
      );
    });
    it('should return element with outerHTML === \'<a-entity mixin="SM3D_Bld_Mixed_Corner_4fl" position="0 0 0"></a-entity>\'', function () {
      const outputEl = createFromJSONUtilsTested.createElementFromObject({ mixin: 'SM3D_Bld_Mixed_Corner_4fl', position: '0 0 0', tag: 'a-entity' });
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
        createFromJSONUtilsTested.appendChildElementsFromArray(array, parentEl).outerHTML,
        '<a-entity><a-entity mixin="SM3D_Bld_Mixed_Corner_4fl" position="0 0 0"></a-entity><a-entity mixin="SM3D_Bld_Mixed_Double_5fl" position="0 0 5"></a-entity></a-entity>'
      );
    });
  });
});
