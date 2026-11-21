/**
 * Firestore rules — organizations (#1267 Phase 1, docs/orgs.md): who reads
 * orgs, members, invitations and userOrgs. Every write is server-only.
 *
 * Run via `npm run test:rules`.
 */

import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let testEnv;

const OWNER = 'owner-uid';
const MEMBER = 'member-uid';
const OUTSIDER = 'outsider-uid';
const INVITEE = 'invitee-uid';

const as = (uid, token = {}) =>
  testEnv.authenticatedContext(uid, token).firestore();
const invitee = (verified = true, email = 'ana@metro.test') =>
  as(INVITEE, { email, email_verified: verified });

describe('firestore.rules — organizations', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      projectId: 'demo-3dstreet-rules-orgs',
      firestore: {
        rules: readFileSync(
          resolve(__dirname, '../../public/firestore.rules'),
          'utf8'
        ),
        host: '127.0.0.1',
        port: 8080
      }
    });
  });

  afterAll(async () => {
    await testEnv?.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, 'orgs/org1'), {
        name: 'LA Metro',
        plan: 'PRO',
        seats: 3,
        status: 'active'
      });
      await setDoc(doc(db, 'orgs/org1/members', OWNER), {
        uid: OWNER,
        role: 'owner'
      });
      await setDoc(doc(db, 'orgs/org1/members', MEMBER), {
        uid: MEMBER,
        role: 'member'
      });
      await setDoc(doc(db, 'orgs/org2'), {
        name: 'Other',
        plan: 'PRO',
        seats: 3,
        status: 'active'
      });
      await setDoc(doc(db, 'orgInvitations/inv1'), {
        orgId: 'org1',
        email: 'ana@metro.test',
        role: 'member',
        status: 'pending'
      });
      await setDoc(doc(db, 'orgInvitations/inv2'), {
        orgId: 'org2',
        email: 'bob@other.test',
        role: 'member',
        status: 'pending'
      });
      await setDoc(doc(db, 'userOrgs', MEMBER), { orgs: { org1: 'member' } });
    });
  });

  it('members read their org and its members; outsiders cannot', async () => {
    await assertSucceeds(getDoc(doc(as(MEMBER), 'orgs/org1')));
    await assertSucceeds(getDocs(collection(as(MEMBER), 'orgs/org1/members')));
    await assertFails(getDoc(doc(as(OUTSIDER), 'orgs/org1')));
    await assertFails(getDocs(collection(as(OUTSIDER), 'orgs/org1/members')));
    await assertFails(getDoc(doc(as(MEMBER), 'orgs/org2')));
    await assertFails(
      getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'orgs/org1'))
    );
  });

  it('nobody writes orgs or members from the client', async () => {
    await assertFails(updateDoc(doc(as(OWNER), 'orgs/org1'), { seats: 100 }));
    await assertFails(
      setDoc(doc(as(OWNER), 'orgs/org1/members', OUTSIDER), {
        uid: OUTSIDER,
        role: 'owner'
      })
    );
    await assertFails(
      updateDoc(doc(as(MEMBER), 'orgs/org1/members', MEMBER), { role: 'owner' })
    );
  });

  it('the invitee reads their invitations by verified email, case-insensitively', async () => {
    await assertSucceeds(getDoc(doc(invitee(), 'orgInvitations/inv1')));
    await assertSucceeds(
      getDoc(doc(invitee(true, 'Ana@Metro.test'), 'orgInvitations/inv1'))
    );
    await assertSucceeds(
      getDocs(
        query(
          collection(invitee(), 'orgInvitations'),
          where('email', '==', 'ana@metro.test')
        )
      )
    );
    await assertFails(getDoc(doc(invitee(false), 'orgInvitations/inv1')));
    await assertFails(getDoc(doc(invitee(), 'orgInvitations/inv2')));
  });

  it("managers list their org's invitations; members and others cannot", async () => {
    const byOrg = (db, orgId) =>
      getDocs(
        query(collection(db, 'orgInvitations'), where('orgId', '==', orgId))
      );
    await assertSucceeds(byOrg(as(OWNER), 'org1'));
    await assertFails(byOrg(as(MEMBER), 'org1'));
    await assertFails(byOrg(as(OWNER), 'org2'));
    await assertFails(getDocs(collection(as(OWNER), 'orgInvitations')));
  });

  it('nobody writes invitations from the client', async () => {
    await assertFails(
      updateDoc(doc(invitee(), 'orgInvitations/inv1'), { status: 'accepted' })
    );
    await assertFails(
      setDoc(doc(as(OWNER), 'orgInvitations/new'), {
        orgId: 'org1',
        email: 'x@y.test',
        role: 'owner',
        status: 'pending'
      })
    );
  });

  it("members read their team's asset library and its usage; nobody writes them", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'orgs/org1/assets/a1'), {
        name: 'Bench',
        deleted: false
      });
      await setDoc(doc(ctx.firestore(), 'orgs/org1/meta/usage'), {
        bytesUsed: 1
      });
    });
    await assertSucceeds(getDoc(doc(as(MEMBER), 'orgs/org1/assets/a1')));
    await assertSucceeds(getDoc(doc(as(MEMBER), 'orgs/org1/meta/usage')));
    await assertFails(getDoc(doc(as(OUTSIDER), 'orgs/org1/assets/a1')));
    await assertFails(getDoc(doc(as(OUTSIDER), 'orgs/org1/meta/usage')));
    await assertFails(
      setDoc(doc(as(OWNER), 'orgs/org1/assets/a2'), { name: 'Mine' })
    );
    await assertFails(
      updateDoc(doc(as(OWNER), 'orgs/org1/meta/usage'), { bytesUsed: 0 })
    );
  });

  it('seats upload straight into the library and rename; nothing else from a client', async () => {
    const VIEWER = 'viewer-uid';
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'orgs/org1/members', VIEWER), {
        uid: VIEWER,
        role: 'viewer'
      });
    });
    const teamAsset = (uid, extra = {}) => ({
      assetId: 'u1',
      orgId: 'org1',
      addedBy: uid,
      type: 'mesh',
      name: 'Bench',
      size: 10,
      deleted: false,
      storagePath: 'orgs/org1/assets/u1/u1.glb',
      storageUrl: 'https://x',
      ...extra
    });
    const ref = (uid, id = 'u1') => doc(as(uid), `orgs/org1/assets/${id}`);
    await assertFails(setDoc(ref(VIEWER), teamAsset(VIEWER)));
    await assertFails(setDoc(ref(OUTSIDER), teamAsset(OUTSIDER)));
    await assertFails(setDoc(ref(MEMBER), teamAsset(OWNER)));
    await assertFails(
      setDoc(
        ref(MEMBER),
        teamAsset(MEMBER, { storagePath: 'orgs/org1/assets/other/u1.glb' })
      )
    );
    await assertFails(
      setDoc(ref(MEMBER), teamAsset(MEMBER, { userId: MEMBER }))
    );
    await assertFails(
      setDoc(ref(MEMBER), teamAsset(MEMBER, { deleted: true }))
    );
    await assertSucceeds(
      setDoc(
        ref(MEMBER),
        teamAsset(MEMBER, {
          optimizedSourcePath: 'orgs/org1/assets/u1/u1-optimized.glb'
        })
      )
    );
    await assertSucceeds(
      updateDoc(ref(OWNER), {
        name: 'Park bench',
        attribution: { author: 'Ana' },
        thumbnailPath: 'orgs/org1/assets/u1/u1-thumb.jpg',
        thumbnailUrl: 'https://t'
      })
    );
    await assertFails(updateDoc(ref(VIEWER), { name: 'Mine' }));
    await assertFails(updateDoc(ref(MEMBER), { deleted: true }));
    await assertFails(updateDoc(ref(MEMBER), { size: 1 }));
    await assertFails(
      updateDoc(ref(MEMBER), {
        storagePath: 'orgs/org1/assets/u1/other.glb'
      })
    );
    await assertFails(
      updateDoc(ref(MEMBER), {
        thumbnailPath: 'users/member-uid/assets/t.jpg'
      })
    );
  });

  it("members read their team's wallet and usage; nobody writes them", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'orgWallets/org1'), { genToken: 10 });
      await setDoc(doc(ctx.firestore(), 'orgWallets/org1/usage/2026-10'), {
        total: 1
      });
    });
    await assertSucceeds(getDoc(doc(as(MEMBER), 'orgWallets/org1')));
    await assertSucceeds(
      getDoc(doc(as(MEMBER), 'orgWallets/org1/usage/2026-10'))
    );
    await assertFails(getDoc(doc(as(OUTSIDER), 'orgWallets/org1')));
    await assertFails(
      getDoc(doc(as(OUTSIDER), 'orgWallets/org1/usage/2026-10'))
    );
    await assertFails(
      updateDoc(doc(as(OWNER), 'orgWallets/org1'), { genToken: 9999 })
    );
    await assertFails(
      setDoc(doc(as(OWNER), 'orgWallets/org1/usage/2026-10'), { total: 0 })
    );
  });

  it('userOrgs is readable by its user only and never writable', async () => {
    await assertSucceeds(getDoc(doc(as(MEMBER), 'userOrgs', MEMBER)));
    await assertFails(getDoc(doc(as(OUTSIDER), 'userOrgs', MEMBER)));
    await assertFails(
      setDoc(doc(as(OUTSIDER), 'userOrgs', OUTSIDER), {
        orgs: { org1: 'owner' }
      })
    );
  });
});
