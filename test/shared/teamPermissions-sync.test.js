/**
 * The client's team edit rights (src/shared/utils/teamPermissions.js) must
 * match the server's (public/functions/org-utils.js), or the UI would offer
 * edits the server and rules refuse, or hide allowed ones.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { canEditTeamItem } from '@shared/utils/teamPermissions.js';

const require = createRequire(import.meta.url);
const server = require('../../public/functions/org-utils.js');

describe('team edit rights client/server sync', () => {
  it('agrees for every role, setting and creator', () => {
    for (const role of ['owner', 'admin', 'member', 'viewer']) {
      for (const memberEditScope of [undefined, 'all', 'own', 'junk']) {
        for (const creatorUid of ['me', 'other', undefined]) {
          const org = { role, memberEditScope };
          expect(canEditTeamItem(org, creatorUid, 'me')).toBe(
            server.canEditTeamItem({ role, org, creatorUid, uid: 'me' })
          );
        }
      }
    }
  });

  it('members edit their own only under "own"; viewers never', () => {
    const member = { role: 'member', memberEditScope: 'own' };
    expect(canEditTeamItem(member, 'me', 'me')).toBe(true);
    expect(canEditTeamItem(member, 'other', 'me')).toBe(false);
    expect(canEditTeamItem({ role: 'member' }, 'other', 'me')).toBe(true);
    expect(canEditTeamItem({ role: 'viewer' }, 'me', 'me')).toBe(false);
    expect(canEditTeamItem(null, 'me', 'me')).toBe(false);
  });
});
