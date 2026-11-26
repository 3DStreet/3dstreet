/* global describe, it */

/**
 * Organizations (#1267 Phase 1): the pure rules in org-utils.js — roles,
 * seats, invitations and the plan a user gets from their orgs.
 */

const assert = require('assert');
const {
  normalizeEmail,
  isPlausibleEmail,
  emailDomain,
  normalizeOrgName,
  isValidOrgName,
  countSeatsUsed,
  invitationState,
  roleChangeRefusal,
  removalRefusal,
  inviteRefusal,
  planFromMemberships,
  higherPlan,
  invitationExpiry,
  memberEditScopeOf,
  domainSuffixes,
  isOnOrgDomain,
  siteLicenseTakes,
  canEditTeamItem,
  INVITATION_TTL_DAYS
} = require('../../public/functions/org-utils.js');

const NOW = Date.UTC(2026, 10, 20);
const DAY = 24 * 60 * 60 * 1000;

describe('org-utils', () => {
  describe('emails and names', () => {
    it('normalizes emails to trimmed lowercase', () => {
      assert.strictEqual(normalizeEmail('  Ana@Metro.ORG '), 'ana@metro.org');
      assert.strictEqual(normalizeEmail(undefined), '');
    });

    it('accepts plausible emails and rejects junk', () => {
      assert.ok(isPlausibleEmail('ana@metro.org'));
      assert.ok(!isPlausibleEmail('ana@metro'));
      assert.ok(!isPlausibleEmail('ana metro@x.org'));
      assert.ok(!isPlausibleEmail(''));
    });

    it('extracts the domain', () => {
      assert.strictEqual(emailDomain('Ana@Metro.org'), 'metro.org');
      assert.strictEqual(emailDomain('nope'), '');
    });

    it('validates org names', () => {
      assert.strictEqual(normalizeOrgName('  LA   Metro '), 'LA Metro');
      assert.ok(isValidOrgName('LA Metro'));
      assert.ok(!isValidOrgName('   '));
      assert.ok(!isValidOrgName('x'.repeat(81)));
    });
  });

  describe('invitationState', () => {
    const pending = { status: 'pending', expiresAt: NOW + DAY };

    it('is pending before expiry and expired after', () => {
      assert.strictEqual(invitationState(pending, NOW), 'pending');
      assert.strictEqual(invitationState(pending, NOW + 2 * DAY), 'expired');
    });

    it('keeps final states', () => {
      for (const status of ['accepted', 'declined', 'revoked']) {
        assert.strictEqual(
          invitationState({ ...pending, status }, NOW + 2 * DAY),
          status
        );
      }
    });

    it('reads Firestore Timestamps', () => {
      const inv = { status: 'pending', expiresAt: { toMillis: () => NOW - 1 } };
      assert.strictEqual(invitationState(inv, NOW), 'expired');
    });

    it('expires after the TTL', () => {
      assert.strictEqual(
        invitationExpiry(NOW),
        NOW + INVITATION_TTL_DAYS * DAY
      );
    });
  });

  describe('countSeatsUsed', () => {
    it('counts seat roles and pending seat invitations, not viewers or expired ones', () => {
      const members = [
        { role: 'owner' },
        { role: 'admin' },
        { role: 'member' },
        { role: 'viewer' }
      ];
      const invitations = [
        { role: 'member', status: 'pending', expiresAt: NOW + DAY },
        { role: 'viewer', status: 'pending', expiresAt: NOW + DAY },
        { role: 'member', status: 'pending', expiresAt: NOW - DAY },
        { role: 'member', status: 'revoked', expiresAt: NOW + DAY }
      ];
      assert.strictEqual(
        countSeatsUsed({ members, invitations, nowMs: NOW }),
        4
      );
    });
  });

  describe('roleChangeRefusal', () => {
    it('lets an owner change anyone, including making owners', () => {
      assert.strictEqual(
        roleChangeRefusal({
          actorRole: 'owner',
          targetRole: 'member',
          newRole: 'owner',
          ownerCount: 1
        }),
        null
      );
    });

    it('lets an admin change admins, members and viewers', () => {
      assert.strictEqual(
        roleChangeRefusal({
          actorRole: 'admin',
          targetRole: 'member',
          newRole: 'viewer',
          ownerCount: 1
        }),
        null
      );
    });

    it('keeps owners out of an admin’s reach', () => {
      assert.strictEqual(
        roleChangeRefusal({
          actorRole: 'admin',
          targetRole: 'owner',
          newRole: 'member',
          ownerCount: 2
        }),
        'owner-only'
      );
      assert.strictEqual(
        roleChangeRefusal({
          actorRole: 'admin',
          targetRole: 'member',
          newRole: 'owner',
          ownerCount: 1
        }),
        'owner-only'
      );
    });

    it('never demotes the last owner', () => {
      assert.strictEqual(
        roleChangeRefusal({
          actorRole: 'owner',
          targetRole: 'owner',
          newRole: 'admin',
          ownerCount: 1
        }),
        'last-owner'
      );
      assert.strictEqual(
        roleChangeRefusal({
          actorRole: 'owner',
          targetRole: 'owner',
          newRole: 'admin',
          ownerCount: 2
        }),
        null
      );
    });

    it('refuses members, viewers and unknown roles', () => {
      assert.strictEqual(
        roleChangeRefusal({
          actorRole: 'member',
          targetRole: 'viewer',
          newRole: 'member',
          ownerCount: 1
        }),
        'not-manager'
      );
      assert.strictEqual(
        roleChangeRefusal({
          actorRole: 'owner',
          targetRole: 'member',
          newRole: 'boss',
          ownerCount: 1
        }),
        'invalid-role'
      );
    });
  });

  describe('removalRefusal', () => {
    it('lets anyone leave, except the last owner', () => {
      assert.strictEqual(
        removalRefusal({
          actorUid: 'a',
          actorRole: 'viewer',
          targetUid: 'a',
          targetRole: 'viewer',
          ownerCount: 1
        }),
        null
      );
      assert.strictEqual(
        removalRefusal({
          actorUid: 'a',
          actorRole: 'owner',
          targetUid: 'a',
          targetRole: 'owner',
          ownerCount: 1
        }),
        'last-owner'
      );
    });

    it('lets managers remove others, owners only by owners', () => {
      assert.strictEqual(
        removalRefusal({
          actorUid: 'a',
          actorRole: 'admin',
          targetUid: 'b',
          targetRole: 'member',
          ownerCount: 1
        }),
        null
      );
      assert.strictEqual(
        removalRefusal({
          actorUid: 'a',
          actorRole: 'admin',
          targetUid: 'b',
          targetRole: 'owner',
          ownerCount: 2
        }),
        'owner-only'
      );
      assert.strictEqual(
        removalRefusal({
          actorUid: 'a',
          actorRole: 'member',
          targetUid: 'b',
          targetRole: 'viewer',
          ownerCount: 1
        }),
        'not-manager'
      );
      // Permission before the last-owner rule.
      assert.strictEqual(
        removalRefusal({
          actorUid: 'a',
          actorRole: 'member',
          targetUid: 'b',
          targetRole: 'owner',
          ownerCount: 1
        }),
        'not-manager'
      );
      assert.strictEqual(
        removalRefusal({
          actorUid: 'a',
          actorRole: 'owner',
          targetUid: 'b',
          targetRole: 'owner',
          ownerCount: 1
        }),
        'last-owner'
      );
    });
  });

  describe('inviteRefusal', () => {
    it('lets managers invite, owners only by owners', () => {
      assert.strictEqual(
        inviteRefusal({ actorRole: 'admin', role: 'member' }),
        null
      );
      assert.strictEqual(
        inviteRefusal({ actorRole: 'admin', role: 'owner' }),
        'owner-only'
      );
      assert.strictEqual(
        inviteRefusal({ actorRole: 'owner', role: 'owner' }),
        null
      );
      assert.strictEqual(
        inviteRefusal({ actorRole: 'member', role: 'viewer' }),
        'not-manager'
      );
      assert.strictEqual(
        inviteRefusal({ actorRole: 'owner', role: 'guest' }),
        'invalid-role'
      );
    });
  });

  describe('planFromMemberships', () => {
    const active = (plan) => ({ plan, status: 'active' });

    it('gives the best plan among active orgs where the user holds a seat', () => {
      assert.strictEqual(
        planFromMemberships([
          { role: 'member', org: active('PRO') },
          { role: 'admin', org: active('MAX') }
        ]),
        'MAX'
      );
      assert.strictEqual(
        planFromMemberships([{ role: 'owner', org: active('PRO') }]),
        'PRO'
      );
    });

    it('gives nothing to viewers, suspended orgs or no orgs', () => {
      assert.strictEqual(
        planFromMemberships([{ role: 'viewer', org: active('MAX') }]),
        null
      );
      assert.strictEqual(
        planFromMemberships([
          { role: 'member', org: { plan: 'MAX', status: 'suspended' } }
        ]),
        null
      );
      assert.strictEqual(planFromMemberships([]), null);
    });
  });

  describe('team domains', () => {
    it('match subdomains, never a bare top-level domain', () => {
      assert.deepStrictEqual(domainSuffixes('cs.univ.edu'), [
        'cs.univ.edu',
        'univ.edu'
      ]);
      assert.deepStrictEqual(domainSuffixes(''), []);
      const org = { domains: ['univ.edu'] };
      assert.ok(isOnOrgDomain(org, 'a@cs.univ.edu'));
      assert.ok(isOnOrgDomain(org, 'a@univ.edu'));
      assert.ok(!isOnOrgDomain(org, 'a@notuniv.edu'));
      assert.ok(!isOnOrgDomain(org, 'a@univ.edu.evil.test'));
      assert.ok(siteLicenseTakes({ domains: [] }, 'a@x.test'));
      assert.ok(!siteLicenseTakes({ siteLicense: true, ...org }, 'a@x.test'));
      assert.ok(
        siteLicenseTakes({ siteLicense: true, ...org }, 'a@cs.univ.edu')
      );
    });
  });

  describe('team settings', () => {
    it('defaults to members editing everything', () => {
      assert.strictEqual(memberEditScopeOf({}), 'all');
      assert.strictEqual(memberEditScopeOf({ memberEditScope: 'own' }), 'own');
      assert.strictEqual(memberEditScopeOf({ memberEditScope: 'x' }), 'all');
    });

    it('lets members edit only their own under "own"; managers everything', () => {
      const org = { memberEditScope: 'own' };
      const can = (role, creatorUid, o = org) =>
        canEditTeamItem({ role, org: o, creatorUid, uid: 'u1' });
      assert.strictEqual(can('member', 'u1'), true);
      assert.strictEqual(can('member', 'u2'), false);
      assert.strictEqual(can('member', 'u2', {}), true);
      assert.strictEqual(can('owner', 'u2'), true);
      assert.strictEqual(can('admin', 'u2'), true);
      assert.strictEqual(can('viewer', 'u1'), false);
    });
  });

  describe('higherPlan', () => {
    it('orders MAX over PRO over nothing', () => {
      assert.strictEqual(higherPlan('PRO', 'MAX'), 'MAX');
      assert.strictEqual(higherPlan(null, 'PRO'), 'PRO');
      assert.strictEqual(higherPlan(undefined, null), null);
    });
  });
});
