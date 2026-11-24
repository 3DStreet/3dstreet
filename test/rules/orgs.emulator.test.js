/**
 * Emulator-backed tests for organizations (#1267 Phase 1, orgs.js):
 * creating orgs, invitations and their seats, accepting with the right
 * account, roles, removal, domain auto-join and the plan members get.
 *
 * Runs under `npm run test:rules` (firestore + auth emulators). firebase-admin
 * must be the instance public/functions sees — hence createRequire anchored
 * there (same as pass-codes.emulator.test.js). Invitation emails fail without
 * POSTMARK_API_KEY, which orgs.js treats as best-effort (emailSent: false).
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const functionsRequire = createRequire(
  resolve(__dirname, '../../public/functions/index.js')
);
const admin = functionsRequire('firebase-admin');

let db;
let orgs;
let seq = 0;

const uniq = () => `${Date.now().toString(36)}${++seq}`;

async function makeUser({ verified = true, domain = 'example.test' } = {}) {
  const email = `user-${uniq()}@${domain}`;
  const user = await admin
    .auth()
    .createUser({ email, emailVerified: verified });
  return { uid: user.uid, email };
}

const member = async (orgId, uid) =>
  (await db.doc(`orgs/${orgId}/members/${uid}`).get()).data();
const userOrgs = async (uid) =>
  ((await db.doc(`userOrgs/${uid}`).get()).data() || {}).orgs || {};
const invitation = async (id) =>
  (await db.doc(`orgInvitations/${id}`).get()).data();

const expectReason = async (promise, reason) => {
  await expect(promise).rejects.toMatchObject({ reason });
};

async function newOrg({ seats = 3, plan = 'PRO', domains = [] } = {}) {
  const owner = await makeUser();
  const { orgId } = await orgs.createOrg({
    name: `Org ${uniq()}`,
    plan,
    seats,
    domains,
    ownerEmail: owner.email,
    actorUid: 'staff'
  });
  return { orgId, owner };
}

async function invite(orgId, actorUid, email, role = 'member') {
  const [result] = await orgs.createInvitations({
    orgId,
    actorUid,
    inviterName: 'Tester',
    invites: [{ email, role }]
  });
  return result;
}

describe('organizations (emulator)', () => {
  beforeAll(() => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeTruthy();
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBeTruthy();
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'demo-3dstreet-rules' });
    }
    db = admin.firestore();
    orgs = functionsRequire('./orgs.js');
  });

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('createOrg', () => {
    it('adds an existing user as owner and mirrors userOrgs', async () => {
      const { orgId, owner } = await newOrg();
      expect((await member(orgId, owner.uid)).role).toBe('owner');
      expect(await userOrgs(owner.uid)).toEqual({ [orgId]: 'owner' });
      const org = (await db.doc(`orgs/${orgId}`).get()).data();
      expect(org).toMatchObject({ plan: 'PRO', seats: 3, status: 'active' });
    });

    it('invites the owner when they have no account yet', async () => {
      const email = `nobody-${uniq()}@example.test`;
      const result = await orgs.createOrg({
        name: 'Future Org',
        plan: 'MAX',
        seats: 2,
        ownerEmail: email,
        actorUid: 'staff'
      });
      expect(result.owner).toBe('invited');
      const inv = await invitation(result.invitation.invitationId);
      expect(inv).toMatchObject({ email, role: 'owner', status: 'pending' });
    });

    it('rejects bad input', async () => {
      await expectReason(
        orgs.createOrg({
          name: ' ',
          plan: 'PRO',
          seats: 1,
          ownerEmail: 'a@b.co'
        }),
        'invalid-name'
      );
      await expectReason(
        orgs.createOrg({
          name: 'X',
          plan: 'FREE',
          seats: 1,
          ownerEmail: 'a@b.co'
        }),
        'invalid-plan'
      );
      await expectReason(
        orgs.createOrg({
          name: 'X',
          plan: 'PRO',
          seats: 0,
          ownerEmail: 'a@b.co'
        }),
        'invalid-seats'
      );
    });
  });

  describe('invitations', () => {
    it('invites, then the invitee accepts with the invited email', async () => {
      const { orgId, owner } = await newOrg();
      const invitee = await makeUser();
      const result = await invite(
        orgId,
        owner.uid,
        invitee.email.toUpperCase()
      );
      expect(result).toMatchObject({ status: 'invited', emailSent: false });
      const accepted = await orgs.acceptInvitation({
        uid: invitee.uid,
        invitationId: result.invitationId
      });
      expect(accepted).toMatchObject({
        orgId,
        role: 'member',
        alreadyMember: false
      });
      expect((await member(orgId, invitee.uid)).role).toBe('member');
      expect(await userOrgs(invitee.uid)).toEqual({ [orgId]: 'member' });
      expect((await invitation(result.invitationId)).status).toBe('accepted');
    });

    it('refuses another account, an unverified email and a second accept', async () => {
      const { orgId, owner } = await newOrg();
      const invitee = await makeUser({ verified: false });
      const stranger = await makeUser();
      const { invitationId } = await invite(orgId, owner.uid, invitee.email);
      await expectReason(
        orgs.acceptInvitation({ uid: stranger.uid, invitationId }),
        'wrong-account'
      );
      await expectReason(
        orgs.acceptInvitation({ uid: invitee.uid, invitationId }),
        'email-not-verified'
      );
      await admin.auth().updateUser(invitee.uid, { emailVerified: true });
      await orgs.acceptInvitation({ uid: invitee.uid, invitationId });
      await expectReason(
        orgs.acceptInvitation({ uid: invitee.uid, invitationId }),
        'invitation-closed'
      );
    });

    it('reports members, duplicates and bad emails per address', async () => {
      const { orgId, owner } = await newOrg();
      const results = await orgs.createInvitations({
        orgId,
        actorUid: owner.uid,
        inviterName: 'Tester',
        invites: [
          { email: owner.email, role: 'member' },
          { email: 'dup@example.test', role: 'member' },
          { email: 'DUP@example.test', role: 'member' },
          { email: 'not-an-email', role: 'member' }
        ]
      });
      expect(results.map((r) => r.status)).toEqual([
        'already-member',
        'invited',
        'already-invited',
        'invalid-email'
      ]);
    });

    it('pending invitations take seats; viewers take none', async () => {
      const { orgId, owner } = await newOrg({ seats: 2 });
      const results = await orgs.createInvitations({
        orgId,
        actorUid: owner.uid,
        inviterName: 'Tester',
        invites: [
          { email: `a-${uniq()}@example.test`, role: 'member' },
          { email: `b-${uniq()}@example.test`, role: 'member' },
          { email: `c-${uniq()}@example.test`, role: 'viewer' }
        ]
      });
      expect(results.map((r) => r.status)).toEqual([
        'invited',
        'no-seat-left',
        'invited'
      ]);
    });

    it('only managers invite, and only owners invite owners', async () => {
      const { orgId, owner } = await newOrg({ seats: 5 });
      const adminUser = await makeUser();
      const plain = await makeUser();
      for (const [user, role] of [
        [adminUser, 'admin'],
        [plain, 'member']
      ]) {
        const { invitationId } = await invite(
          orgId,
          owner.uid,
          user.email,
          role
        );
        await orgs.acceptInvitation({ uid: user.uid, invitationId });
      }
      await expectReason(
        invite(orgId, plain.uid, 'x@example.test'),
        'not-manager'
      );
      await expectReason(
        invite(orgId, adminUser.uid, 'y@example.test', 'owner'),
        'owner-only'
      );
      expect(
        (await invite(orgId, adminUser.uid, `z-${uniq()}@example.test`)).status
      ).toBe('invited');
    });

    it('an expired invitation can no longer be accepted, but can be resent', async () => {
      const { orgId, owner } = await newOrg();
      const invitee = await makeUser();
      const { invitationId } = await invite(orgId, owner.uid, invitee.email);
      await db.doc(`orgInvitations/${invitationId}`).update({
        expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() - 1000)
      });
      await expectReason(
        orgs.acceptInvitation({ uid: invitee.uid, invitationId }),
        'invitation-expired'
      );
      const resent = await orgs.resendInvitation({
        actorUid: owner.uid,
        invitationId
      });
      expect(resent.emailSent).toBe(false);
      expect((await invitation(invitationId)).sendCount).toBe(2);
      await orgs.acceptInvitation({ uid: invitee.uid, invitationId });
      expect((await member(orgId, invitee.uid)).role).toBe('member');
    });

    it('a revoked or declined invitation is closed', async () => {
      const { orgId, owner } = await newOrg();
      const a = await makeUser();
      const b = await makeUser();
      const invA = await invite(orgId, owner.uid, a.email);
      const invB = await invite(orgId, owner.uid, b.email);
      await orgs.revokeInvitation({
        actorUid: owner.uid,
        invitationId: invA.invitationId
      });
      await orgs.declineInvitation({
        uid: b.uid,
        invitationId: invB.invitationId
      });
      await expectReason(
        orgs.acceptInvitation({ uid: a.uid, invitationId: invA.invitationId }),
        'invitation-closed'
      );
      expect((await invitation(invB.invitationId)).status).toBe('declined');
      await expectReason(
        orgs.acceptInvitation({ uid: b.uid, invitationId: invB.invitationId }),
        'invitation-closed'
      );
    });

    it('accepting fails when the seats were lowered below the members', async () => {
      const { orgId, owner } = await newOrg({ seats: 2 });
      const invitee = await makeUser();
      const { invitationId } = await invite(orgId, owner.uid, invitee.email);
      await orgs.updateOrg({ orgId, patch: { seats: 1 } });
      await expectReason(
        orgs.acceptInvitation({ uid: invitee.uid, invitationId }),
        'no-seat-left'
      );
    });
  });

  describe('members', () => {
    async function orgWithMember(role = 'member', seats = 5) {
      const { orgId, owner } = await newOrg({ seats });
      const user = await makeUser();
      const { invitationId } = await invite(orgId, owner.uid, user.email, role);
      await orgs.acceptInvitation({ uid: user.uid, invitationId });
      return { orgId, owner, user };
    }

    it('changes roles and keeps userOrgs in sync', async () => {
      const { orgId, owner, user } = await orgWithMember();
      await orgs.changeMemberRole({
        actorUid: owner.uid,
        orgId,
        targetUid: user.uid,
        role: 'admin'
      });
      expect((await member(orgId, user.uid)).role).toBe('admin');
      expect(await userOrgs(user.uid)).toEqual({ [orgId]: 'admin' });
    });

    it('never demotes or removes the last owner', async () => {
      const { orgId, owner } = await newOrg();
      await expectReason(
        orgs.changeMemberRole({
          actorUid: owner.uid,
          orgId,
          targetUid: owner.uid,
          role: 'member'
        }),
        'last-owner'
      );
      await expectReason(
        orgs.removeMember({ actorUid: owner.uid, orgId, targetUid: owner.uid }),
        'last-owner'
      );
    });

    it('a viewer becoming a member needs a free seat', async () => {
      const { orgId, owner, user } = await orgWithMember('viewer', 1);
      await expectReason(
        orgs.changeMemberRole({
          actorUid: owner.uid,
          orgId,
          targetUid: user.uid,
          role: 'member'
        }),
        'no-seat-left'
      );
    });

    it('members leave, managers remove, and userOrgs forgets the org', async () => {
      const { orgId, owner, user } = await orgWithMember();
      await expectReason(
        orgs.removeMember({ actorUid: user.uid, orgId, targetUid: owner.uid }),
        'not-manager'
      );
      await orgs.removeMember({
        actorUid: user.uid,
        orgId,
        targetUid: user.uid
      });
      expect(await member(orgId, user.uid)).toBeUndefined();
      expect(await userOrgs(user.uid)).toEqual({});
    });

    it('renames for managers only', async () => {
      const { orgId, owner, user } = await orgWithMember();
      await expectReason(
        orgs.renameOrg({ actorUid: user.uid, orgId, name: 'X' }),
        'not-manager'
      );
      await orgs.renameOrg({
        actorUid: owner.uid,
        orgId,
        name: '  New   name '
      });
      expect((await db.doc(`orgs/${orgId}`).get()).data().name).toBe(
        'New name'
      );
    });
  });

  describe('team settings', () => {
    it('managers set what members edit and the domain join role', async () => {
      const { orgId, owner } = await newOrg();
      const user = await makeUser();
      const { invitationId } = await invite(orgId, owner.uid, user.email);
      await orgs.acceptInvitation({ uid: user.uid, invitationId });
      await expectReason(
        orgs.updateOrgSettings({
          actorUid: user.uid,
          orgId,
          memberEditScope: 'own'
        }),
        'not-manager'
      );
      await expectReason(
        orgs.updateOrgSettings({
          actorUid: owner.uid,
          orgId,
          memberEditScope: 'mine'
        }),
        'invalid-setting'
      );
      await expectReason(
        orgs.updateOrgSettings({ actorUid: owner.uid, orgId }),
        'invalid-argument'
      );
      await orgs.updateOrgSettings({
        actorUid: owner.uid,
        orgId,
        memberEditScope: 'own',
        domainJoinRole: 'viewer'
      });
      const data = (await db.doc(`orgs/${orgId}`).get()).data();
      expect(data.memberEditScope).toBe('own');
      expect(data.domainJoinRole).toBe('viewer');
      // The client learns the setting with the user's orgs.
      const [entry] = await orgs.readUserOrgs(user.uid);
      expect(entry.memberEditScope).toBe('own');
    });
  });

  describe('domain auto-join and plan', () => {
    it('joins orgs claiming the verified email domain while seats last', async () => {
      const domain = `d${uniq()}.test`;
      const { orgId } = await newOrg({
        seats: 2,
        domains: [domain],
        plan: 'MAX'
      });
      const first = await makeUser({ domain });
      const second = await makeUser({ domain });
      const unverified = await makeUser({ domain, verified: false });
      expect(await orgs.autoJoinDomainOrgs(first.uid)).toEqual([orgId]);
      expect(await orgs.autoJoinDomainOrgs(first.uid)).toEqual([]);
      expect(await orgs.autoJoinDomainOrgs(second.uid)).toEqual([]); // owner + first fill 2 seats
      expect(await orgs.autoJoinDomainOrgs(unverified.uid)).toEqual([]);
      expect((await member(orgId, first.uid)).via).toBe('domain');
    });

    it('never re-adds someone who was removed or left, until they accept an invitation', async () => {
      const domain = `d${uniq()}.test`;
      const { orgId, owner } = await newOrg({ seats: 5, domains: [domain] });
      const removed = await makeUser({ domain });
      const left = await makeUser({ domain });
      for (const user of [removed, left]) {
        expect(await orgs.autoJoinDomainOrgs(user.uid)).toEqual([orgId]);
      }
      await orgs.removeMember({
        actorUid: owner.uid,
        orgId,
        targetUid: removed.uid
      });
      await orgs.removeMember({
        actorUid: left.uid,
        orgId,
        targetUid: left.uid
      });
      for (const user of [removed, left]) {
        expect(await orgs.autoJoinDomainOrgs(user.uid)).toEqual([]);
        expect(await member(orgId, user.uid)).toBeUndefined();
        expect(await userOrgs(user.uid)).toEqual({});
      }
      // Also refused inside the transaction, not only by the pre-check.
      await expectReason(
        orgs.addMember({
          orgId,
          uid: removed.uid,
          role: 'member',
          via: 'domain'
        }),
        'departed'
      );
      // Others still join.
      const next = await makeUser({ domain });
      expect(await orgs.autoJoinDomainOrgs(next.uid)).toEqual([orgId]);

      const { invitationId } = await invite(orgId, owner.uid, removed.email);
      await orgs.acceptInvitation({ uid: removed.uid, invitationId });
      expect((await member(orgId, removed.uid)).role).toBe('member');
      expect(
        (await db.doc(`orgs/${orgId}/departed/${removed.uid}`).get()).exists
      ).toBe(false);
    });

    it('joins as a viewer, without a seat, when the team says so', async () => {
      const domain = `d${uniq()}.test`;
      const { orgId, owner } = await newOrg({ seats: 1, domains: [domain] });
      await orgs.updateOrgSettings({
        actorUid: owner.uid,
        orgId,
        domainJoinRole: 'viewer'
      });
      const student = await makeUser({ domain });
      // The owner fills the only seat; a viewer needs none.
      expect(await orgs.autoJoinDomainOrgs(student.uid)).toEqual([orgId]);
      expect((await member(orgId, student.uid)).role).toBe('viewer');
    });

    it('gives seat roles the org plan, but not viewers or suspended orgs', async () => {
      const { orgId, owner } = await newOrg({ plan: 'MAX' });
      const viewer = await makeUser();
      const { invitationId } = await invite(
        orgId,
        owner.uid,
        viewer.email,
        'viewer'
      );
      await orgs.acceptInvitation({ uid: viewer.uid, invitationId });
      expect(await orgs.readOrgPlan(owner.uid)).toBe('MAX');
      expect(await orgs.readOrgPlan(viewer.uid)).toBe(null);
      await orgs.updateOrg({ orgId, patch: { status: 'suspended' } });
      expect(await orgs.readOrgPlan(owner.uid)).toBe(null);
    });
  });
});
