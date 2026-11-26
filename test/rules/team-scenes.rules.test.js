/**
 * Firestore and Storage rules — team scenes (#1267 Phase 2,
 * docs/team-scenes.md): who reads, lists, creates, edits (with the edit
 * lock) and deletes a scene that belongs to an org, and its files.
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
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore';
import { ref, getMetadata, uploadString } from 'firebase/storage';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OWNER = 'owner-uid';
const ADMIN = 'admin-uid';
const MEMBER = 'member-uid';
const MEMBER2 = 'member2-uid';
const VIEWER = 'viewer-uid';
const OUTSIDER = 'outsider-uid';
const FORMER = 'former-uid'; // created a team scene, then left

let testEnv;

const as = (uid) => testEnv.authenticatedContext(uid).firestore();
const sceneRef = (db, id) => doc(db, 'scenes', id);
const inMinutes = (minutes) =>
  Timestamp.fromMillis(Date.now() + minutes * 60000);
const lockFor = (uid, minutes = 2) => ({
  uid,
  name: uid,
  expiresAt: inMinutes(minutes)
});

const teamScene = (extra = {}) => ({
  author: MEMBER,
  orgId: 'org1',
  projectId: 'p1',
  visibility: 'private',
  title: 'Team scene',
  data: [],
  updateTimestamp: new Date('2026-11-01'),
  ...extra
});

describe('rules — team scenes', () => {
  beforeAll(async () => {
    testEnv = await initializeTestEnvironment({
      // The project the emulators run under: storage rules read Firestore.
      projectId: 'demo-3dstreet-rules',
      firestore: {
        rules: readFileSync(
          resolve(__dirname, '../../public/firestore.rules'),
          'utf8'
        ),
        host: '127.0.0.1',
        port: 8080
      },
      storage: {
        rules: readFileSync(
          resolve(__dirname, '../../public/storage.rules'),
          'utf8'
        ),
        host: '127.0.0.1',
        port: 9199
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
        seats: 5,
        status: 'active'
      });
      await setDoc(doc(db, 'orgs/org2'), {
        name: 'Old',
        plan: 'PRO',
        seats: 5,
        status: 'suspended'
      });
      for (const [uid, role] of [
        [OWNER, 'owner'],
        [ADMIN, 'admin'],
        [MEMBER, 'member'],
        [MEMBER2, 'member'],
        [VIEWER, 'viewer']
      ]) {
        await setDoc(doc(db, 'orgs/org1/members', uid), { uid, role });
      }
      await setDoc(doc(db, 'orgs/org2/members', MEMBER), {
        uid: MEMBER,
        role: 'member'
      });
      await setDoc(doc(db, 'orgs/org1/projects/p1'), { name: 'TOD Visuals' });
      await setDoc(sceneRef(db, 'team-private'), teamScene());
      await setDoc(
        sceneRef(db, 'team-public'),
        teamScene({ visibility: 'public' })
      );
      await setDoc(sceneRef(db, 'by-former'), teamScene({ author: FORMER }));
      await setDoc(
        sceneRef(db, 'locked'),
        teamScene({ editLock: lockFor(MEMBER2) })
      );
      await setDoc(sceneRef(db, 'personal'), {
        author: MEMBER,
        orgId: null,
        visibility: 'public',
        data: []
      });
    });
  });

  describe('read', () => {
    it('every member reads a team-only scene, viewers included', async () => {
      for (const uid of [OWNER, ADMIN, MEMBER, VIEWER]) {
        await assertSucceeds(getDoc(sceneRef(as(uid), 'team-private')));
      }
    });

    it('outsiders, and its creator after leaving the team, cannot', async () => {
      await assertFails(getDoc(sceneRef(as(OUTSIDER), 'team-private')));
      await assertFails(getDoc(sceneRef(as(FORMER), 'by-former')));
      await assertFails(
        getDoc(
          sceneRef(testEnv.unauthenticatedContext().firestore(), 'team-private')
        )
      );
    });

    it('a public team scene is readable by anyone', async () => {
      await assertSucceeds(getDoc(sceneRef(as(OUTSIDER), 'team-public')));
    });

    it("members list the team's scenes; outsiders cannot", async () => {
      const teamQuery = (db) =>
        getDocs(query(collection(db, 'scenes'), where('orgId', '==', 'org1')));
      const snapshot = await assertSucceeds(teamQuery(as(VIEWER)));
      if (snapshot.size !== 4) throw new Error(`got ${snapshot.size}`);
      await assertFails(teamQuery(as(OUTSIDER)));
    });
  });

  describe('create', () => {
    it('an editor creates a team-only scene in a project, holding the lock', async () => {
      await assertSucceeds(
        setDoc(
          sceneRef(as(MEMBER), 'n1'),
          teamScene({ editLock: lockFor(MEMBER) })
        )
      );
      await assertSucceeds(
        setDoc(
          sceneRef(as(ADMIN), 'n2'),
          teamScene({ author: ADMIN, projectId: null })
        )
      );
    });

    it('refuses viewers, outsiders, suspended orgs, unknown projects and others’ locks', async () => {
      await assertFails(
        setDoc(sceneRef(as(VIEWER), 'n3'), teamScene({ author: VIEWER }))
      );
      await assertFails(
        setDoc(sceneRef(as(OUTSIDER), 'n4'), teamScene({ author: OUTSIDER }))
      );
      await assertFails(
        setDoc(
          sceneRef(as(MEMBER), 'n5'),
          teamScene({ orgId: 'org2', projectId: null })
        )
      );
      await assertFails(
        setDoc(sceneRef(as(MEMBER), 'n6'), teamScene({ projectId: 'nope' }))
      );
      await assertFails(
        setDoc(
          sceneRef(as(MEMBER), 'n7'),
          teamScene({ editLock: lockFor(MEMBER2) })
        )
      );
    });
  });

  describe('edit lock and saving', () => {
    it('an editor takes a free lock, saves while holding it, and releases it', async () => {
      const db = as(MEMBER);
      await assertFails(
        updateDoc(sceneRef(db, 'team-private'), { title: 'No lock' })
      );
      await assertSucceeds(
        updateDoc(sceneRef(db, 'team-private'), { editLock: lockFor(MEMBER) })
      );
      await assertSucceeds(
        updateDoc(sceneRef(db, 'team-private'), { title: 'Saved', data: [1] })
      );
      await assertSucceeds(
        updateDoc(sceneRef(db, 'team-private'), { editLock: lockFor(MEMBER) })
      );
      await assertSucceeds(
        updateDoc(sceneRef(db, 'team-private'), { editLock: null })
      );
      await assertFails(
        updateDoc(sceneRef(db, 'team-private'), { title: 'Released' })
      );
    });

    it('nobody else saves or takes a held lock, except a manager taking over', async () => {
      await assertFails(
        updateDoc(sceneRef(as(MEMBER), 'locked'), { title: 'Mine?' })
      );
      await assertFails(
        updateDoc(sceneRef(as(MEMBER), 'locked'), { editLock: lockFor(MEMBER) })
      );
      await assertFails(
        updateDoc(sceneRef(as(MEMBER), 'locked'), { editLock: null })
      );
      await assertSucceeds(
        updateDoc(sceneRef(as(ADMIN), 'locked'), { editLock: lockFor(ADMIN) })
      );
      await assertFails(
        updateDoc(sceneRef(as(MEMBER2), 'locked'), { title: 'Lost it' })
      );
    });

    it('an expired lock is free', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(sceneRef(ctx.firestore(), 'locked'), {
          editLock: lockFor(MEMBER2, -1)
        });
      });
      await assertSucceeds(
        updateDoc(sceneRef(as(MEMBER), 'locked'), { editLock: lockFor(MEMBER) })
      );
    });

    it('refuses long or foreign locks, and viewers', async () => {
      await assertFails(
        updateDoc(sceneRef(as(MEMBER), 'team-private'), {
          editLock: lockFor(MEMBER, 10)
        })
      );
      await assertFails(
        updateDoc(sceneRef(as(MEMBER), 'team-private'), {
          editLock: lockFor(MEMBER2)
        })
      );
      await assertFails(
        updateDoc(sceneRef(as(VIEWER), 'team-private'), {
          editLock: lockFor(VIEWER)
        })
      );
    });

    it('sharing, project, org and author never change from the client, even with the lock', async () => {
      const db = as(OWNER);
      await assertSucceeds(
        updateDoc(sceneRef(db, 'team-private'), { editLock: lockFor(OWNER) })
      );
      for (const change of [
        { visibility: 'public' },
        { projectId: null },
        { orgId: 'org2' },
        { author: OWNER }
      ]) {
        await assertFails(updateDoc(sceneRef(db, 'team-private'), change));
      }
    });

    it('members edit only their own scenes when the team says so; managers edit all', async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), 'orgs/org1'), {
          memberEditScope: 'own'
        });
      });
      // Another member's scene: no lock, so no save.
      await assertFails(
        updateDoc(sceneRef(as(MEMBER2), 'team-private'), {
          editLock: lockFor(MEMBER2)
        })
      );
      // Their own scene, and a manager on anyone's.
      await assertSucceeds(
        updateDoc(sceneRef(as(MEMBER), 'team-private'), {
          editLock: lockFor(MEMBER)
        })
      );
      await assertSucceeds(
        updateDoc(sceneRef(as(MEMBER), 'team-private'), { title: 'Mine' })
      );
      await assertSucceeds(
        updateDoc(sceneRef(as(OWNER), 'by-former'), {
          editLock: lockFor(OWNER)
        })
      );
    });

    it('a lock taken before the team switched to "own" no longer saves', async () => {
      await assertSucceeds(
        updateDoc(sceneRef(as(MEMBER2), 'team-private'), {
          editLock: lockFor(MEMBER2)
        })
      );
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await updateDoc(doc(ctx.firestore(), 'orgs/org1'), {
          memberEditScope: 'own'
        });
      });
      await assertFails(
        updateDoc(sceneRef(as(MEMBER2), 'team-private'), { title: 'Late' })
      );
      // Releasing it still works.
      await assertSucceeds(
        updateDoc(sceneRef(as(MEMBER2), 'team-private'), { editLock: null })
      );
    });

    it('a personal scene cannot be moved into a team from the client', async () => {
      await assertFails(
        updateDoc(sceneRef(as(MEMBER), 'personal'), { orgId: 'org1' })
      );
    });
  });

  describe('delete', () => {
    it('managers delete team scenes; members and viewers cannot', async () => {
      await assertFails(deleteDoc(sceneRef(as(MEMBER), 'team-private')));
      await assertFails(deleteDoc(sceneRef(as(VIEWER), 'team-private')));
      await testEnv.withSecurityRulesDisabled((ctx) =>
        updateDoc(doc(ctx.firestore(), 'orgs/org1'), { status: 'suspended' })
      );
      await assertFails(deleteDoc(sceneRef(as(OWNER), 'team-private')));
      await testEnv.withSecurityRulesDisabled((ctx) =>
        updateDoc(doc(ctx.firestore(), 'orgs/org1'), { status: 'active' })
      );
      await assertSucceeds(deleteDoc(sceneRef(as(ADMIN), 'team-private')));
    });
  });

  describe('storage files', () => {
    const fileRef = (uid, sceneId) =>
      ref(
        (uid
          ? testEnv.authenticatedContext(uid)
          : testEnv.unauthenticatedContext()
        ).storage(),
        `scenes/${sceneId}/files/preview.jpg`
      );

    beforeEach(async () => {
      await testEnv.clearStorage();
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await uploadString(
          ref(ctx.storage(), 'scenes/team-private/files/preview.jpg'),
          'x',
          'raw',
          {
            contentType: 'image/jpeg'
          }
        );
      });
    });

    it("members read a team-only scene's files; outsiders cannot", async () => {
      await assertSucceeds(getMetadata(fileRef(VIEWER, 'team-private')));
      await assertFails(getMetadata(fileRef(OUTSIDER, 'team-private')));
      await assertFails(getMetadata(fileRef(null, 'team-private')));
    });

    it("members read the team library's files; nobody writes them", async () => {
      const libraryRef = (uid) =>
        ref(
          (uid
            ? testEnv.authenticatedContext(uid)
            : testEnv.unauthenticatedContext()
          ).storage(),
          'orgs/org1/assets/a1/c1/bench.glb'
        );
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await uploadString(
          ref(ctx.storage(), 'orgs/org1/assets/a1/c1/bench.glb'),
          'x',
          'raw',
          { contentType: 'model/gltf-binary' }
        );
      });
      await assertSucceeds(getMetadata(libraryRef(VIEWER)));
      await assertFails(getMetadata(libraryRef(OUTSIDER)));
      await assertFails(getMetadata(libraryRef(null)));
      // An existing file is never overwritten from a client.
      await assertFails(
        uploadString(libraryRef(OWNER), 'y', 'raw', {
          contentType: 'model/gltf-binary'
        })
      );
    });

    it("seats upload new files into a library asset's folder; viewers can't", async () => {
      const newFile = (uid) =>
        uploadString(
          ref(
            testEnv.authenticatedContext(uid).storage(),
            `orgs/org1/assets/a2/${uid}.glb`
          ),
          'y',
          'raw',
          { contentType: 'model/gltf-binary' }
        );
      await assertSucceeds(newFile(MEMBER));
      await assertFails(newFile(VIEWER));
      await assertFails(newFile(OUTSIDER));
    });

    it('editors write them; viewers and outsiders cannot', async () => {
      const upload = (uid) =>
        uploadString(fileRef(uid, 'team-private'), 'y', 'raw', {
          contentType: 'image/jpeg'
        });
      await assertSucceeds(upload(MEMBER2));
      await assertFails(upload(VIEWER));
      await assertFails(upload(OUTSIDER));
    });
  });
});
