/* global describe, it */

const assert = require('assert');
const streetmixUtils = require('../src/tested/streetmix-utils');
require('jsdom-global')();

const sampleInput = `
{"id":"03923530-96d7-11ea-8f6a-5fbe8747064d","namespacedId":44,"name":"Streetmix3D All Segment Cases Test","clientUpdatedAt":"2020-05-15T18:29:04.491Z","data":{"street":{"schemaVersion":22,"width":232,"id":"03923530-96d7-11ea-8f6a-5fbe8747064d","namespacedId":44,"units":2,"location":null,"userUpdated":true,"environment":"day","leftBuildingHeight":4,"rightBuildingHeight":3,"leftBuildingVariant":"narrow","rightBuildingVariant":"wide","segments":[{"type":"sidewalk","variantString":"dense","width":6,"randSeed":36223137},{"type":"sidewalk-tree","variantString":"big","width":2},{"type":"sidewalk-wayfinding","variantString":"large","width":4},{"type":"sidewalk-bench","variantString":"left","width":4},{"type":"sidewalk-bike-rack","variantString":"right|sidewalk-parallel","width":5},{"type":"bikeshare","variantString":"left|road","width":7},{"type":"transit-shelter","variantString":"left|street-level","width":9},{"type":"sidewalk-lamp","variantString":"right|modern","width":2},{"type":"bus-lane","variantString":"inbound|shared","width":12},{"type":"turn-lane","variantString":"inbound|left","width":10},{"type":"drive-lane","variantString":"inbound|sharrow","width":10,"randSeed":102670651},{"type":"turn-lane","variantString":"inbound|right","width":10},{"type":"divider","variantString":"bush","width":2},{"type":"drive-lane","variantString":"inbound|car","width":10,"randSeed":807672430},{"type":"turn-lane","variantString":"outbound|shared","width":10},{"type":"drive-lane","variantString":"outbound|car","width":10,"randSeed":365422905},{"type":"sidewalk-lamp","variantString":"both|pride","width":4},{"type":"divider","variantString":"bush","width":3},{"type":"sidewalk-lamp","variantString":"both|traditional","width":4},{"type":"streetcar","variantString":"inbound|grass","width":12},{"type":"light-rail","variantString":"outbound|colored","width":12},{"type":"bus-lane","variantString":"outbound|colored","width":12},{"type":"sidewalk-lamp","variantString":"left|pride","width":4},{"type":"divider","variantString":"bollard","width":2},{"type":"sidewalk-lamp","variantString":"right|pride","width":4},{"type":"turn-lane","variantString":"outbound|left","width":10},{"type":"turn-lane","variantString":"outbound|left-right-straight","width":10},{"type":"turn-lane","variantString":"outbound|right","width":10},{"type":"parking-lane","variantString":"outbound|right","width":7},{"type":"scooter","variantString":"outbound|regular","width":5},{"type":"sidewalk-lamp","variantString":"both|modern","width":4},{"type":"divider","variantString":"planter-box","width":4},{"type":"bike-lane","variantString":"inbound|red|road","width":6},{"type":"bike-lane","variantString":"outbound|green|road","width":6},{"type":"sidewalk-lamp","variantString":"left|modern","width":2},{"type":"sidewalk-tree","variantString":"palm-tree","width":2},{"type":"sidewalk","variantString":"normal","width":6,"randSeed":419985576}],"editCount":61}},"createdAt":"2020-05-15T18:08:01.084Z","updatedAt":"2020-05-15T18:29:05.292Z","originalStreetId":null,"creator":{"id":"kfarr"}}
`;

describe('StreetmixUtils', function () {
  describe('#streetmixUserToAPI()', function () {
    it('should return API redirect URL when given user facing URL WITH a creator ID', function () {
      assert.strictEqual(
        streetmixUtils.streetmixUserToAPI('https://streetmix.net/kfarr/3/a-frame-city-builder-street-only'),
        'https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr');
    });

    it('should return API redirect URL when given user facing URL WITHOUT a creator ID', function () {
      assert.strictEqual(
        streetmixUtils.streetmixUserToAPI('https://streetmix.net/-/3/a-frame-city-builder-street-only'),
        'https://streetmix.net/api/v1/streets?namespacedId=3');
    });
  });

  describe('#pathStartsWithAPI()', function () {
    it('should return true when provided urlString includes /api/ top level directory', function () {
      assert.ok(streetmixUtils.pathStartsWithAPI('https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr'));
    });
    it('should return false when provided urlString does NOT include /api/ top level directory', function () {
      assert.ok(!streetmixUtils.pathStartsWithAPI('https://streetmix.net/kfarr/3/a-frame-city-builder-street-only'));
    });
  });

  describe('#streetmixAPIToUser()', function () {
    it('should return user friendly URL when given API URL WITH a creator ID', function () {
      assert.strictEqual(
        streetmixUtils.streetmixAPIToUser('https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr'),
        'https://streetmix.net/kfarr/3');
    });
    it('should return user friendly URL when given API URL WITHOUT a creator ID', function () {
      assert.strictEqual(
        streetmixUtils.streetmixAPIToUser('https://streetmix.net/api/v1/streets?namespacedId=3'),
        'https://streetmix.net/-/3');
    });
  });
});
