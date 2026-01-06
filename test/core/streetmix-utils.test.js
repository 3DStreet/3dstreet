/* global describe, it */

const assert = require('assert');
const streetmixUtils = require('../../src/tested/streetmix-utils');
require('jsdom-global')();

describe('StreetmixUtils', function () {
  describe('#streetmixUserToAPI()', function () {
    it('should return API redirect URL when given user facing URL WITH a creator ID', function () {
      assert.strictEqual(
        streetmixUtils.streetmixUserToAPI(
          'https://streetmix.net/kfarr/3/a-frame-city-builder-street-only'
        ),
        'https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr'
      );
    });

    it('should return API redirect URL when given user facing URL WITHOUT a creator ID', function () {
      assert.strictEqual(
        streetmixUtils.streetmixUserToAPI(
          'https://streetmix.net/-/3/a-frame-city-builder-street-only'
        ),
        'https://streetmix.net/api/v1/streets?namespacedId=3'
      );
    });
  });

  describe('#pathStartsWithAPI()', function () {
    it('should return true when provided urlString includes /api/ top level directory', function () {
      assert.ok(
        streetmixUtils.pathStartsWithAPI(
          'https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr'
        )
      );
    });
    it('should return false when provided urlString does NOT include /api/ top level directory', function () {
      assert.ok(
        !streetmixUtils.pathStartsWithAPI(
          'https://streetmix.net/kfarr/3/a-frame-city-builder-street-only'
        )
      );
    });
  });

  describe('#streetmixAPIToUser()', function () {
    it('should return user friendly URL when given API URL WITH a creator ID', function () {
      assert.strictEqual(
        streetmixUtils.streetmixAPIToUser(
          'https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr'
        ),
        'https://streetmix.net/kfarr/3'
      );
    });
    it('should return user friendly URL when given API URL WITHOUT a creator ID', function () {
      assert.strictEqual(
        streetmixUtils.streetmixAPIToUser(
          'https://streetmix.net/api/v1/streets?namespacedId=3'
        ),
        'https://streetmix.net/-/3'
      );
    });
  });
});
