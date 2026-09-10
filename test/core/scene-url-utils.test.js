/* global describe, it */

import assert from 'assert';
import {
  getSceneIdFromPathname,
  getSceneIdFromHash,
  scenePath,
  upgradedSceneUrlFromHash,
  clearedSceneUrl
} from '../../src/tested/scene-url-utils.js';

const UUID = 'bc72ab26-891d-417b-a50f-0cf84621a54c';

describe('scene-url-utils', function () {
  describe('#getSceneIdFromPathname()', function () {
    it('parses /scenes/UUID', function () {
      assert.strictEqual(getSceneIdFromPathname(`/scenes/${UUID}`), UUID);
    });
    it('tolerates a trailing slash', function () {
      assert.strictEqual(getSceneIdFromPathname(`/scenes/${UUID}/`), UUID);
    });
    it('lowercases an uppercase UUID', function () {
      assert.strictEqual(
        getSceneIdFromPathname(`/scenes/${UUID.toUpperCase()}`),
        UUID
      );
    });
    it('does not match the .json data endpoint', function () {
      assert.strictEqual(getSceneIdFromPathname(`/scenes/${UUID}.json`), null);
    });
    it('does not match a non-UUID id', function () {
      assert.strictEqual(getSceneIdFromPathname('/scenes/hello-world'), null);
    });
    it('does not match root or other paths', function () {
      assert.strictEqual(getSceneIdFromPathname('/'), null);
      assert.strictEqual(getSceneIdFromPathname(`/gallery/${UUID}`), null);
      assert.strictEqual(getSceneIdFromPathname(''), null);
      assert.strictEqual(getSceneIdFromPathname(undefined), null);
    });
  });

  describe('#getSceneIdFromHash()', function () {
    it('parses #/scenes/UUID', function () {
      assert.strictEqual(getSceneIdFromHash(`#/scenes/${UUID}`), UUID);
    });
    it('parses with a ?camera= query inside the hash', function () {
      assert.strictEqual(
        getSceneIdFromHash(`#/scenes/${UUID}?camera=1,2,3,0,0,0,45`),
        UUID
      );
    });
    it('parses the legacy .json hash forms', function () {
      // https://3dstreet.app/#scenes/UUID.json (cloud-uuid-legacy)
      assert.strictEqual(getSceneIdFromHash(`#scenes/${UUID}.json`), UUID);
      assert.strictEqual(getSceneIdFromHash(`#/scenes/${UUID}.json`), UUID);
    });
    it('ignores non-scene hashes', function () {
      assert.strictEqual(getSceneIdFromHash('#mcp'), null);
      assert.strictEqual(getSceneIdFromHash('#asset:owner/id'), null);
      assert.strictEqual(getSceneIdFromHash(''), null);
      assert.strictEqual(getSceneIdFromHash(undefined), null);
    });
  });

  describe('#scenePath()', function () {
    it('builds the canonical path', function () {
      assert.strictEqual(scenePath(UUID), `/scenes/${UUID}`);
    });
  });

  describe('#upgradedSceneUrlFromHash()', function () {
    it('upgrades a plain hash link to the path form', function () {
      assert.strictEqual(
        upgradedSceneUrlFromHash({ search: '', hash: `#/scenes/${UUID}` }),
        `/scenes/${UUID}`
      );
    });
    it('preserves query params written before the hash', function () {
      assert.strictEqual(
        upgradedSceneUrlFromHash({
          search: '?embed=true',
          hash: `#/scenes/${UUID}`
        }),
        `/scenes/${UUID}?embed=true`
      );
    });
    it('folds a ?camera= param inside the hash into the query string', function () {
      const url = upgradedSceneUrlFromHash({
        search: '?viewer=true',
        hash: `#/scenes/${UUID}?camera=1,2,3,0,0,0,45`
      });
      const [path, query] = url.split('?');
      const params = new URLSearchParams(query);
      assert.strictEqual(path, `/scenes/${UUID}`);
      assert.strictEqual(params.get('viewer'), 'true');
      assert.strictEqual(params.get('camera'), '1,2,3,0,0,0,45');
    });
    it('returns null for a non-scene hash', function () {
      assert.strictEqual(
        upgradedSceneUrlFromHash({ search: '', hash: '#mcp' }),
        null
      );
      assert.strictEqual(
        upgradedSceneUrlFromHash({ search: '?embed=true', hash: '' }),
        null
      );
    });
  });

  describe('#clearedSceneUrl()', function () {
    it('resets to root with no params', function () {
      assert.strictEqual(clearedSceneUrl({ search: '' }), '/');
    });
    it('keeps unrelated query params', function () {
      assert.strictEqual(
        clearedSceneUrl({ search: '?viewer=true' }),
        '/?viewer=true'
      );
    });
    it('drops the scene-specific camera param', function () {
      assert.strictEqual(
        clearedSceneUrl({ search: '?viewer=true&camera=1,2,3,0,0,0,45' }),
        '/?viewer=true'
      );
    });
  });
});
