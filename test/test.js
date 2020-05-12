const rewire = require('rewire');
const assert = require('assert');

const app = rewire('../src/streetmix-utils');
const streetmixUserToAPI = app.__get__('streetmixUserToAPI');

describe('StreetmixUtils', function () {
  describe('#streetmixUserToAPI()', function () {
    it('should return API redirect URL when given user facing URL', function () {
      assert.equal(
        streetmixUserToAPI('https://streetmix.net/kfarr/3/a-frame-city-builder-street-only'),
        'https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr');
    });
  });
});
