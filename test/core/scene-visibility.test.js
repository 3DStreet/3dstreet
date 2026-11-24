/* global describe, it */

/**
 * Scene visibility (#1267): who may read a scene (getScene) and who may
 * change its visibility (setSceneVisibility). Rules-side checks are in
 * test/rules/scenes.rules.test.js.
 */

const assert = require('assert');
const {
  sceneVisibility,
  canReadScene,
  visibilityChangeRefusal,
  isCommunityPostable,
  mayPostToCommunity,
  createRestrictedScene
} = require('../../public/functions/scene-visibility.js');

const AUTHOR = 'author-uid';

describe('scene visibility', () => {
  describe('sceneVisibility', () => {
    it('treats a scene without the field as public', () => {
      assert.strictEqual(sceneVisibility({ author: AUTHOR }), 'public');
    });

    it('returns the stored value', () => {
      assert.strictEqual(sceneVisibility({ visibility: 'private' }), 'private');
    });
  });

  describe('canReadScene', () => {
    it('lets anyone read public, unlisted and legacy scenes', () => {
      for (const scene of [
        { author: AUTHOR },
        { author: AUTHOR, visibility: 'public' },
        { author: AUTHOR, visibility: 'unlisted' }
      ]) {
        assert.strictEqual(canReadScene(scene, null), true);
        assert.strictEqual(canReadScene(scene, 'someone'), true);
      }
    });

    it('lets only the author read a private scene', () => {
      const scene = { author: AUTHOR, visibility: 'private' };
      assert.strictEqual(canReadScene(scene, AUTHOR), true);
      assert.strictEqual(canReadScene(scene, 'someone'), false);
      assert.strictEqual(canReadScene(scene, null), false);
    });

    it('lets only org members read a private team scene, not its author', () => {
      const scene = { author: AUTHOR, orgId: 'org1', visibility: 'private' };
      assert.strictEqual(canReadScene(scene, 'member', true), true);
      assert.strictEqual(canReadScene(scene, AUTHOR, false), false);
      assert.strictEqual(canReadScene(scene, null, true), false);
      assert.strictEqual(
        canReadScene({ ...scene, visibility: 'unlisted' }, null),
        true
      );
    });

    it('never matches a private scene that has no author', () => {
      assert.strictEqual(
        canReadScene({ visibility: 'private' }, undefined),
        false
      );
    });
  });

  describe('community posts of AI outputs', () => {
    it('only from a public scene, not paid by a team', () => {
      const pub = { visibility: 'public' };
      assert.strictEqual(isCommunityPostable({}, pub), true);
      assert.strictEqual(isCommunityPostable({}, {}), true); // legacy
      assert.strictEqual(
        isCommunityPostable({ chargedOrgId: 'o' }, pub),
        false
      );
      for (const visibility of ['unlisted', 'private']) {
        assert.strictEqual(isCommunityPostable({}, { visibility }), false);
      }
      assert.strictEqual(isCommunityPostable({}, null), false);
    });

    it('never without a scene, or when it cannot be read', async () => {
      for (const generationParams of [
        undefined,
        {},
        { scene_id: null },
        { scene_id: { a: 1 } },
        { scene_id: 'unreadable/path' }
      ]) {
        assert.strictEqual(
          await mayPostToCommunity({ generationParams }),
          false
        );
      }
    });
  });

  describe('createRestrictedScene', () => {
    it('refuses public, unknown values and non-Pro users', async () => {
      const isPro = async () => false;
      const create = (visibility) =>
        createRestrictedScene({ uid: AUTHOR, visibility, isPro });
      assert.deepStrictEqual(await create('public'), {
        reason: 'invalid-visibility'
      });
      assert.deepStrictEqual(await create(undefined), {
        reason: 'invalid-visibility'
      });
      assert.deepStrictEqual(await create('private'), {
        reason: 'pro-required'
      });
      assert.deepStrictEqual(await create('unlisted'), {
        reason: 'pro-required'
      });
    });
  });

  describe('visibilityChangeRefusal', () => {
    const scene = { author: AUTHOR, visibility: 'public' };
    const notCalled = () => {
      throw new Error('isPro must not be looked up');
    };

    it('lets the author make a scene less restricted without a Pro lookup', async () => {
      for (const [from, visibility] of [
        ['public', 'public'],
        ['unlisted', 'unlisted'],
        ['unlisted', 'public'],
        ['private', 'unlisted'],
        ['private', 'public']
      ]) {
        assert.strictEqual(
          await visibilityChangeRefusal({
            scene: { author: AUTHOR, visibility: from },
            uid: AUTHOR,
            visibility,
            isPro: notCalled
          }),
          null,
          `${from} -> ${visibility}`
        );
      }
    });

    it('requires Pro to make a scene unlisted or more restricted', async () => {
      for (const [from, visibility] of [
        ['public', 'unlisted'],
        ['public', 'private'],
        ['unlisted', 'private']
      ]) {
        for (const isPro of [true, false]) {
          assert.strictEqual(
            await visibilityChangeRefusal({
              scene: { author: AUTHOR, visibility: from },
              uid: AUTHOR,
              visibility,
              isPro: async () => isPro
            }),
            isPro ? null : 'pro-required',
            `${from} -> ${visibility}`
          );
        }
      }
    });

    it('lets a Pro author make a scene private', async () => {
      assert.strictEqual(
        await visibilityChangeRefusal({
          scene,
          uid: AUTHOR,
          visibility: 'private',
          isPro: async () => true
        }),
        null
      );
    });

    it('refuses private to a non-Pro author', async () => {
      assert.strictEqual(
        await visibilityChangeRefusal({
          scene,
          uid: AUTHOR,
          visibility: 'private',
          isPro: async () => false
        }),
        'pro-required'
      );
    });

    it('refuses anyone but the author, before any Pro lookup', async () => {
      assert.strictEqual(
        await visibilityChangeRefusal({
          scene,
          uid: 'someone',
          visibility: 'private',
          isPro: notCalled
        }),
        'not-author'
      );
    });

    it('on a team scene, lets owners and admins change sharing, without a Pro check', async () => {
      const teamScene = {
        author: AUTHOR,
        orgId: 'org1',
        visibility: 'private'
      };
      for (const role of ['owner', 'admin']) {
        assert.strictEqual(
          await visibilityChangeRefusal({
            scene: teamScene,
            uid: 'someone',
            visibility: 'public',
            isPro: notCalled,
            orgRole: async () => role
          }),
          null
        );
      }
      for (const role of ['member', 'viewer', null]) {
        assert.strictEqual(
          await visibilityChangeRefusal({
            scene: teamScene,
            uid: AUTHOR,
            visibility: 'private',
            isPro: notCalled,
            orgRole: async () => role
          }),
          'not-manager'
        );
      }
    });

    it('refuses a missing scene and an unknown value', async () => {
      assert.strictEqual(
        await visibilityChangeRefusal({
          scene: null,
          uid: AUTHOR,
          visibility: 'public',
          isPro: notCalled
        }),
        'not-found'
      );
      assert.strictEqual(
        await visibilityChangeRefusal({
          scene,
          uid: AUTHOR,
          visibility: 'secret',
          isPro: notCalled
        }),
        'invalid-visibility'
      );
    });
  });
});
