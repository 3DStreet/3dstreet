/* global describe, it */

import assert from 'assert';
import { isInviteHash, getInviteId } from '../../src/tested/org-invite-link.js';

describe('org-invite-link (#1267)', function () {
  it('matches #invite=<id> and extracts the id', function () {
    assert.strictEqual(isInviteHash('#invite=AbC123xyz'), true);
    assert.strictEqual(getInviteId('#invite=AbC123xyz'), 'AbC123xyz');
    assert.strictEqual(getInviteId('#invite=AbC123xyz&src=email'), 'AbC123xyz');
  });

  it('rejects other routes and malformed ids', function () {
    for (const hash of [
      '',
      '#invite',
      '#invite=',
      '#invites=abc',
      '#redeem?code=X',
      '#invite=a b',
      undefined
    ]) {
      assert.strictEqual(isInviteHash(hash), false, String(hash));
      assert.strictEqual(getInviteId(hash), '', String(hash));
    }
  });
});
