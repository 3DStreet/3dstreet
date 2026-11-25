/**
 * Emulator-backed tests for team AI token wallets (#1267 Phase 3,
 * team-wallet.js): who pays a generation, the monthly refill, member caps,
 * refunds back to the wallet, and keeping the billing team consistent with
 * membership.
 *
 * Runs under `npm run test:rules`. firebase-admin must be the instance
 * public/functions sees — hence createRequire anchored there.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const functionsRequire = createRequire(
  resolve(__dirname, '../../public/functions/index.js')
);
const admin = functionsRequire('firebase-admin');

let db;
let wallet;
let tokens;
let replicate;
let fal3d;
let orgs;
let utils;
let seq = 0;
const uniq = () => `${Date.now().toString(36)}${++seq}`;

async function setup({
  budget = 100,
  cap = null,
  status = 'active',
  role = 'member'
} = {}) {
  const orgId = `org-${uniq()}`;
  const uid = `user-${uniq()}`;
  await db
    .doc(`orgs/${orgId}`)
    .set({ name: 'Team', plan: 'PRO', seats: 5, status });
  await db.doc(`orgs/${orgId}/members/${uid}`).set({ uid, role });
  await db.doc(`orgWallets/${orgId}`).set({
    genToken: 0,
    monthlyTokenBudget: budget,
    memberMonthlyCap: cap,
    lastRefill: null
  });
  await db
    .doc(`userOrgs/${uid}`)
    .set({ orgs: { [orgId]: role }, activeOrgId: orgId });
  await db
    .doc(`tokenProfile/${uid}`)
    .set({ userId: uid, genToken: 7, geoToken: 3 });
  return { orgId, uid };
}

async function newJob(uid) {
  const ref = db
    .collection('users')
    .doc(uid)
    .collection('generationJobs')
    .doc();
  await ref.set({ kind: 'image', model: 'test', tokenCharged: false });
  return ref;
}

const charge = async (uid, cost = 4) => {
  const jobRef = await newJob(uid);
  const result = await tokens.chargeGenerationTokens(db, {
    userId: uid,
    jobRef,
    tokenCost: cost,
    source: 'test',
    relatedModel: 'test'
  });
  return { jobRef, result };
};

const walletOf = async (orgId) =>
  (await db.doc(`orgWallets/${orgId}`).get()).data();
const usageOf = async (orgId) =>
  (await db.doc(`orgWallets/${orgId}/usage/${utils.monthKey()}`).get()).data();
const personal = async (uid) =>
  (await db.doc(`tokenProfile/${uid}`).get()).data().genToken;

describe('team wallets (emulator)', () => {
  beforeAll(() => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeTruthy();
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'demo-3dstreet-rules' });
    }
    db = admin.firestore();
    wallet = functionsRequire('./team-wallet.js');
    tokens = functionsRequire('./token-management.js');
    replicate = functionsRequire('./replicate.js');
    fal3d = functionsRequire('./fal-3d.js');
    orgs = functionsRequire('./orgs.js');
    utils = functionsRequire('./wallet-utils.js');
  });

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('charging', () => {
    it('charges the team: refills to the budget, counts usage, leaves personal tokens', async () => {
      const { orgId, uid } = await setup({ budget: 100 });
      const { jobRef, result } = await charge(uid, 4);
      expect(result).toMatchObject({
        tokensBefore: 100,
        remainingTokens: 96,
        chargedOrgId: orgId
      });
      expect(await walletOf(orgId)).toMatchObject({
        genToken: 96,
        lastRefill: utils.monthKey()
      });
      expect(await usageOf(orgId)).toMatchObject({
        total: 4,
        members: { [uid]: 4 }
      });
      expect((await jobRef.get()).data()).toMatchObject({
        tokenCharged: true,
        chargedOrgId: orgId,
        chargedMonth: utils.monthKey()
      });
      expect(await personal(uid)).toBe(7);
      expect(await wallet.spendableGenTokens(uid, 7)).toEqual({
        orgId,
        available: 96
      });
    });

    it('refuses over the member cap, then on an empty wallet', async () => {
      const capped = await setup({ budget: 100, cap: 5 });
      await charge(capped.uid, 4);
      expect(await wallet.spendableGenTokens(capped.uid, 7)).toMatchObject({
        available: 1
      });
      await expect(charge(capped.uid, 4)).rejects.toMatchObject({
        code: 'resource-exhausted',
        details: { reason: 'member-cap' }
      });
      const small = await setup({ budget: 3 });
      await expect(charge(small.uid, 4)).rejects.toMatchObject({
        details: { reason: 'wallet-empty' }
      });
      expect(await personal(small.uid)).toBe(7);
    });

    it('falls back to personal tokens for viewers and removed members', async () => {
      for (const options of [{ role: 'viewer' }]) {
        const { orgId, uid } = await setup(options);
        const { result } = await charge(uid, 4);
        expect(result.chargedOrgId).toBe(null);
        expect(await personal(uid)).toBe(3);
        expect((await walletOf(orgId)).genToken).toBe(0);
      }
      const { orgId, uid } = await setup();
      await db.doc(`orgs/${orgId}/members/${uid}`).delete();
      expect((await charge(uid, 2)).result.chargedOrgId).toBe(null);
    });
  });

  describe('refunds', () => {
    it('gives a failed team job back to the wallet and the month, once (replicate)', async () => {
      const { orgId, uid } = await setup({ budget: 100 });
      const { jobRef } = await charge(uid, 4);
      const job = (await jobRef.get()).data();
      await replicate.refundSplatToken(db, uid, jobRef, {
        ...job,
        tokenCost: 4
      });
      await replicate.refundSplatToken(db, uid, jobRef, {
        ...job,
        tokenCost: 4
      });
      expect((await walletOf(orgId)).genToken).toBe(100);
      expect(await usageOf(orgId)).toMatchObject({
        total: 0,
        members: { [uid]: 0 }
      });
      expect(await personal(uid)).toBe(7);
    });

    it('does the same for fal jobs', async () => {
      const { orgId, uid } = await setup({ budget: 100 });
      const { jobRef } = await charge(uid, 5);
      await fal3d.refundFalJobInline(db, uid, jobRef, 5);
      await fal3d.refundFalJobInline(db, uid, jobRef, 5);
      expect((await walletOf(orgId)).genToken).toBe(100);
      expect(await personal(uid)).toBe(7);
    });
  });

  describe('who pays', () => {
    it('the active team pays for a seat holder; Personal or a viewer pays alone', async () => {
      const { orgId, uid } = await setup();
      await wallet.setActiveOrg({ uid, orgId: null });
      expect((await charge(uid, 1)).result.chargedOrgId).toBe(null);
      await wallet.setActiveOrg({ uid, orgId });
      expect((await charge(uid, 1)).result.chargedOrgId).toBe(orgId);
      expect(await wallet.readActiveOrgId(uid)).toBe(orgId);
      // A viewer can make the team active, but pays with their own tokens.
      const viewer = await setup({ role: 'viewer' });
      await wallet.setActiveOrg({ uid: viewer.uid, orgId: viewer.orgId });
      expect((await charge(viewer.uid, 1)).result.chargedOrgId).toBe(null);
      await expect(
        wallet.setActiveOrg({ uid, orgId: viewer.orgId })
      ).rejects.toMatchObject({ reason: 'not-member' });
    });

    it('joining a first team makes it active; leaving it goes back to Personal', async () => {
      const owner = await admin
        .auth()
        .createUser({ email: `o-${uniq()}@example.test`, emailVerified: true });
      const member = await admin
        .auth()
        .createUser({ email: `m-${uniq()}@example.test`, emailVerified: true });
      const { orgId } = await orgs.createOrg({
        name: 'Billing team',
        plan: 'MAX',
        seats: 4,
        ownerEmail: owner.email,
        actorUid: 'staff'
      });
      expect((await walletOf(orgId)).monthlyTokenBudget).toBe(2000);
      const [invite] = await orgs.createInvitations({
        orgId,
        actorUid: owner.uid,
        inviterName: 'Owner',
        invites: [{ email: member.email, role: 'member' }]
      });
      await orgs.acceptInvitation({
        uid: member.uid,
        invitationId: invite.invitationId
      });
      const active = async () =>
        (await db.doc(`userOrgs/${member.uid}`).get()).data().activeOrgId;
      expect(await active()).toBe(orgId);
      // A role change keeps it active (as a viewer it pays nothing).
      await orgs.changeMemberRole({
        actorUid: owner.uid,
        orgId,
        targetUid: member.uid,
        role: 'viewer'
      });
      expect(await active()).toBe(orgId);
      expect(await wallet.resolveBillingOrg(member.uid)).toBe(null);
      await orgs.removeMember({
        actorUid: member.uid,
        orgId,
        targetUid: member.uid
      });
      expect(await active()).toBeUndefined();
      expect(await wallet.readActiveOrgId(member.uid)).toBe(null);
    });

    it('refuses, and never charges personal tokens, while the active team is suspended', async () => {
      const { uid, orgId } = await setup({ status: 'suspended' });
      const before = (await db.doc(`tokenProfile/${uid}`).get()).data();
      const refusal = { details: { reason: 'org-suspended' } };
      await expect(charge(uid, 1)).rejects.toMatchObject(refusal);
      await expect(wallet.spendableGenTokens(uid, 7)).rejects.toMatchObject(
        refusal
      );
      expect((await db.doc(`tokenProfile/${uid}`).get()).data()).toEqual(
        before
      );
      // Switching to Personal is the user's choice to pay.
      await wallet.setActiveOrg({ uid, orgId: null });
      await charge(uid, 1);
      expect((await db.doc(`tokenProfile/${uid}`).get()).data().genToken).toBe(
        before.genToken - 1
      );
      expect((await db.doc(`orgs/${orgId}`).get()).data().status).toBe(
        'suspended'
      );
    });

    it('picking Personal sticks through role changes and new teams', async () => {
      const make = async () =>
        admin.auth().createUser({
          email: `p-${uniq()}@example.test`,
          emailVerified: true
        });
      const owner = await make();
      const user = await make();
      const newOrg = () =>
        orgs.createOrg({
          name: 'Team',
          plan: 'PRO',
          seats: 5,
          ownerEmail: owner.email,
          actorUid: 'staff'
        });
      const add = (orgId) =>
        orgs.addMember({ orgId, uid: user.uid, role: 'member', via: 'staff' });
      const active = () => wallet.readActiveOrgId(user.uid);
      const a = (await newOrg()).orgId;
      const b = (await newOrg()).orgId;
      const c = (await newOrg()).orgId;

      await add(a);
      expect(await active()).toBe(a);
      await add(b); // a second team never switches
      expect(await active()).toBe(a);
      await wallet.setActiveOrg({ uid: user.uid, orgId: null });
      await orgs.changeMemberRole({
        actorUid: owner.uid,
        orgId: a,
        targetUid: user.uid,
        role: 'admin'
      });
      expect(await active()).toBe(null);
      await add(c);
      expect(await active()).toBe(null);

      // Still Personal after leaving every team and joining again.
      for (const orgId of [a, b, c]) {
        await orgs.removeMember({
          actorUid: user.uid,
          orgId,
          targetUid: user.uid
        });
      }
      await add(a);
      expect(await active()).toBe(null);
    });

    it('losing the active team is not picking Personal', async () => {
      const owner = await admin.auth().createUser({
        email: `q-${uniq()}@example.test`,
        emailVerified: true
      });
      const user = await admin.auth().createUser({});
      const { orgId } = await orgs.createOrg({
        name: 'Team',
        plan: 'PRO',
        seats: 5,
        ownerEmail: owner.email,
        actorUid: 'staff'
      });
      const add = () =>
        orgs.addMember({ orgId, uid: user.uid, role: 'member', via: 'staff' });
      await add();
      await orgs.removeMember({
        actorUid: owner.uid,
        orgId,
        targetUid: user.uid
      });
      expect(await wallet.readActiveOrgId(user.uid)).toBe(null);
      await add();
      expect(await wallet.readActiveOrgId(user.uid)).toBe(orgId);
    });
  });

  describe('settings', () => {
    it('managers set the member cap; staff set the budget and add tokens', async () => {
      const { orgId, uid } = await setup();
      await expect(
        wallet.setMemberCap({ actorUid: uid, orgId, memberMonthlyCap: 10 })
      ).rejects.toMatchObject({ reason: 'not-manager' });
      await db.doc(`orgs/${orgId}/members/${uid}`).update({ role: 'admin' });
      await wallet.setMemberCap({ actorUid: uid, orgId, memberMonthlyCap: 10 });
      await wallet.updateWallet({
        orgId,
        monthlyTokenBudget: 500,
        addTokens: 50,
        actorUid: 'staff'
      });
      expect(await walletOf(orgId)).toMatchObject({
        memberMonthlyCap: 10,
        monthlyTokenBudget: 500,
        genToken: 50
      });
      // The first charge of the month tops up to the new budget.
      await charge(uid, 1);
      expect((await walletOf(orgId)).genToken).toBe(499);
    });
  });
});
