/* global describe, it */

const rewire = require('rewire');
const assert = require('assert');

const app = rewire('../src/tested/aframe-streetmix-parsers-tested');

const isSidewalk = app.__get__('isSidewalk');
const createBuildingsArray = app.__get__('createBuildingsArray');
const createClonedEntitiesArray = app.__get__('createClonedEntitiesArray');
const getAmbientSoundJSON = app.__get__('getAmbientSoundJSON');
const createGroundArray = app.__get__('createGroundArray');

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
        [{ tag: 'a-entity', mixin: 'SM3D_Bld_Mixed_Corner_4fl', position: '3.474045 0 0' }]
      );
    });
    it('createBuildingsArray(maxLength = 10) should return array with 2 dictionaries of a-entities', function () {
      assert.deepStrictEqual(
        createBuildingsArray(10),
        [{ mixin: 'SM3D_Bld_Mixed_Corner_4fl', position: '3.474045 0 0', tag: 'a-entity' }, { mixin: 'SM3D_Bld_Mixed_Double_5fl', position: '12.40014 0 0', tag: 'a-entity' }]
      );
    });
  });

  describe('#createGroundArray()', function () {
    it('createGroundArray("grass") should return array with one dictionary for a-entity with mixin ground-grass', function () {
      assert.deepStrictEqual(
        createGroundArray('grass'),
        [{ tag: 'a-entity', mixin: 'ground-grass', position: '0 -0.2 0' }]
      );
    });
    it('createGroundArray("parking-lot") should return array with one dictionary for a-entity with mixin ground-parking-lot', function () {
      assert.deepStrictEqual(
        createGroundArray('parking-lot'),
        [{ mixin: 'ground-parking-lot', position: '0 -0.2 0', tag: 'a-entity' }]
      );
    });
    it('createGroundArray("jiberish") should return array with one dictionary for a-entity with mixin ground-grass', function () {
      assert.deepStrictEqual(
        createGroundArray('jiberish'),
        [{ mixin: 'ground-grass', position: '0 -0.2 0', tag: 'a-entity' }]
      );
    });
    it('createGroundArray("narrow") should return array with one dictionary for a-entity with mixin ground-asphalt', function () {
      assert.deepStrictEqual(
        createGroundArray('narrow'),
        [{ mixin: 'ground-asphalt', position: '0 -0.2 0', tag: 'a-entity' }]
      );
    });
  });

  describe('#getAmbientSoundJSON()', function () {
    it('getAmbientSoundJSON(["narrow", "wide"]) should return array with one dictionary for a-entity with sound URL assets/audio/SSL_16_11_AMB_EXT_SF_ALAMO_SQ.mp3', function () {
      assert.deepStrictEqual(
        getAmbientSoundJSON(['narrow', 'wide']),
        [
          {
            tag: 'a-entity',
            class: 'playme',
            sound: 'src: url(assets/audio/SSL_16_11_AMB_EXT_SF_ALAMO_SQ.mp3); positional: false; loop: true'
          }
        ]
      );
    });
    it('getAmbientSoundJSON(["narrow", "residential"]) should return array with 2 dictionaries of a-entities with sound component', function () {
      assert.deepStrictEqual(
        getAmbientSoundJSON(['narrow', 'residential']),
        [
          {
            tag: 'a-entity',
            class: 'playme',
            sound: 'src: url(assets/audio/SSL_16_11_AMB_EXT_SF_ALAMO_SQ.mp3); positional: false; loop: true'
          },
          {
            tag: 'a-entity',
            class: 'playme',
            sound: 'src: url(assets/audio/AMB_Suburbs_Spring_Day_Lawnmowers_Birds_MS_ST_MKH8050-30shortened.mp3); positional: false; loop: true'
          }
        ]
      );
    });
  });

  describe('#createClonedEntitiesArray()', function () {
    it('get default output of 9 entities spaced 15m apart', function () {
      assert.deepStrictEqual(
        createClonedEntitiesArray({}),
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
        createClonedEntitiesArray({ mixin: 'fence', rotation: '0 ' + rotationCloneY + ' 0', step: 9.25, radius: 70 }),
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
