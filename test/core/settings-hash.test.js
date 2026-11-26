/* global describe, it */

import assert from 'assert';
import {
  parseSettingsHash,
  settingsHash
} from '../../src/tested/settings-hash.js';

describe('settings-hash', function () {
  it('opens a section, a team, or My profile for the old and unknown links', function () {
    assert.deepStrictEqual(parseSettingsHash('#/modal/settings/billing'), {
      id: 'billing'
    });
    assert.deepStrictEqual(
      parseSettingsHash('#/modal/settings/team/la-metro'),
      {
        id: 'team',
        orgId: 'la-metro'
      }
    );
    for (const hash of [
      '#/modal/settings',
      '#/modal/settings/nope',
      '#/modal/settings/team',
      '#/modal/settings/account',
      '#/modal/settings/teams',
      '#/modal/profile'
    ]) {
      assert.deepStrictEqual(parseSettingsHash(hash), { id: 'profile' });
    }
  });

  it('ignores other hashes', function () {
    assert.strictEqual(parseSettingsHash(''), null);
    assert.strictEqual(parseSettingsHash('#/scenes/abc'), null);
    assert.strictEqual(parseSettingsHash('#/modal/settingsx'), null);
  });

  it('round-trips', function () {
    for (const section of [
      { id: 'profile' },
      { id: 'billing' },
      { id: 'billing', orgId: 'la-metro' },
      { id: 'team', orgId: 'org 1/2' }
    ]) {
      assert.deepStrictEqual(parseSettingsHash(settingsHash(section)), section);
    }
  });
});
