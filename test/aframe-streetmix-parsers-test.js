/* global describe, it */

const streetmixParsersTested = require('../src/tested/aframe-streetmix-parsers-tested');
const assert = require('assert');

describe('A-Frame Streetmix Parsers', function () {
  describe('#isSidewalk()', function () {
    it('should return true when provided a string that is exactly sidewalk', function () {
      assert.ok(
        streetmixParsersTested.isSidewalk('sidewalk'));
    });
    it('should return true when provided a string starting with sidewalk', function () {
      assert.ok(
        streetmixParsersTested.isSidewalk('sidewalkgibberish'));
    });
    it('should return true when provided a long string like scooter-drop-zone', function () {
      assert.ok(
        streetmixParsersTested.isSidewalk('scooter-drop-zone'));
    });
  });

  describe('#createBuildingsArray()', function () {
    it('createBuildingsArray(maxLength = 5) should return empty array', function () {
      assert.deepStrictEqual(
        streetmixParsersTested.createBuildingsArray(5),
        []
      );
    });
    it('createBuildingsArray(maxLength = 10) should return array with 1 dictionary of a-entities', function () {
      assert.deepStrictEqual(
        streetmixParsersTested.createBuildingsArray(10),
        [{ mixin: 'SM3D_Bld_Mixed_Corner_4fl', position: '2.822 0 0', tag: 'a-entity' }]
      );
    });
  });

  describe('#filterBuildingsArrayByMixin()', function () {
    it('filterBuildingsArrayByMixin with createBuildingsArray(maxLength = 100) and mixinId = "SM3D_Bld_Mixed_Corner_4fl" should return dictionary with 4 items', function () {
      var buildingsArray = streetmixParsersTested.createBuildingsArray(100);
      assert.strictEqual(streetmixParsersTested.filterBuildingsArrayByMixin(buildingsArray, 'SM3D_Bld_Mixed_Corner_4fl').length, 5);
    });
    it('filterBuildingsArrayByMixin with createBuildingsArray(maxLength = 100) and mixinId = "asdfdsafwefqewf" should return dictionary with 0 items', function () {
      var buildingsArray = streetmixParsersTested.createBuildingsArray(100);
      assert.strictEqual(streetmixParsersTested.filterBuildingsArrayByMixin(buildingsArray, 'asdfdsafwefqewf').length, 0);
    });
  });

  describe('#removePropertyFromArray()', function () {
    it('removePropertyFromArray should result in hasOwnProperty false for the removed property', function () {
      var htmlArray = [{ tag: 'a-entity', mixin: 'test' }, { tag: 'a-entity', mixin: 'toast' }];
      var updatedArray = streetmixParsersTested.removePropertyFromArray(htmlArray, 'mixin');
      assert(!(Object.prototype.hasOwnProperty.call(updatedArray[0], 'mixin')));
    });
  });

  describe('#getAmbientSoundJSON()', function () {
    it('getAmbientSoundJSON(["narrow", "wide"]) should return array with one dictionary for a-entity with sound src #ambientmp3', function () {
      assert.deepStrictEqual(
        streetmixParsersTested.getAmbientSoundJSON(['narrow', 'wide']),
        [
          {
            tag: 'a-entity',
            class: 'playme',
            sound: 'src: #ambientmp3; positional: false; loop: true'
          }
        ]
      );
    });
    it('getAmbientSoundJSON(["narrow", "residential"]) should return array with 2 dictionaries of a-entities with sound component', function () {
      assert.deepStrictEqual(
        streetmixParsersTested.getAmbientSoundJSON(['narrow', 'residential']),
        [
          {
            tag: 'a-entity',
            class: 'playme',
            sound: 'src: #ambientmp3; positional: false; loop: true'
          },
          {
            tag: 'a-entity',
            class: 'playme',
            sound: 'src: #suburbs2-mp3; positional: false; loop: true'
          }
        ]
      );
    });
  });

  describe('#createClonedEntitiesArray()', function () {
    it('get default output of 9 entities spaced 15m apart', function () {
      assert.deepStrictEqual(
        streetmixParsersTested.createClonedEntitiesArray({}),
        [
          { tag: 'a-entity', position: '0 0 -60', rotation: '0 0 0' },
          { tag: 'a-entity', position: '0 0 -45', rotation: '0 0 0' },
          { tag: 'a-entity', position: '0 0 -30', rotation: '0 0 0' },
          { tag: 'a-entity', position: '0 0 -15', rotation: '0 0 0' },
          { tag: 'a-entity', position: '0 0 0', rotation: '0 0 0' },
          { tag: 'a-entity', position: '0 0 15', rotation: '0 0 0' },
          { tag: 'a-entity', position: '0 0 30', rotation: '0 0 0' },
          { tag: 'a-entity', position: '0 0 45', rotation: '0 0 0' },
          { tag: 'a-entity', position: '0 0 60', rotation: '0 0 0' }
        ]
      );
    });
    it('create clone output for actual fence use case', function () {
      var rotationCloneY = -90;
      assert.deepStrictEqual(
        streetmixParsersTested.createClonedEntitiesArray({ mixin: 'fence', rotation: '0 ' + rotationCloneY + ' 0', step: 9.25, radius: 70 }),
        [
          { tag: 'a-entity', position: '0 0 -70', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 -60.75', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 -51.5', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 -42.25', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 -33', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 -23.75', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 -14.5', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 -5.25', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 4', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 13.25', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 22.5', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 31.75', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 41', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 50.25', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 59.5', class: 'fence', mixin: 'fence', rotation: '0 -90 0' },
          { tag: 'a-entity', position: '0 0 68.75', class: 'fence', mixin: 'fence', rotation: '0 -90 0' }
        ]
      );
    });
  });
});
