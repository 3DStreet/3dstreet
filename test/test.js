/* global describe, it */

const rewire = require('rewire');
const assert = require('assert');

const app = rewire('../src/tested/streetmix-utils');

const streetmixUserToAPI = app.__get__('streetmixUserToAPI');
const streetmixAPIToUser = app.__get__('streetmixAPIToUser');

describe('StreetmixUtils', function () {
  describe('#streetmixUserToAPI()', function () {
    it('should return API redirect URL when given user facing URL WITH a creator ID', function () {
      assert.strictEqual(
        streetmixUserToAPI('https://streetmix.net/kfarr/3/a-frame-city-builder-street-only'),
        'https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr');
    });

    it('should return API redirect URL when given user facing URL WITHOUT a creator ID', function () {
      assert.strictEqual(
        streetmixUserToAPI('https://streetmix.net/-/3/a-frame-city-builder-street-only'),
        'https://streetmix.net/api/v1/streets?namespacedId=3');
    });
  });

  describe('#streetmixAPIToUser()', function () {
    it('should return user friendly URL when given API URL WITH a creator ID', function () {
      assert.strictEqual(
        streetmixAPIToUser('https://streetmix.net/api/v1/streets?namespacedId=3&creatorId=kfarr'),
        'https://streetmix.net/kfarr/3');
    });
    it('should return user friendly URL when given API URL WITHOUT a creator ID', function () {
      assert.strictEqual(
        streetmixAPIToUser('https://streetmix.net/api/v1/streets?namespacedId=3'),
        'https://streetmix.net/-/3');
    });
  });
});
