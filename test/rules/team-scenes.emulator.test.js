/**
 * Emulator-backed tests for team scenes (#1267 Phase 2, team-scenes.js and
 * scene-visibility.js): projects, moving scenes into a team, and who reads a
 * team-only scene.
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
let teamScenes;
let visibility;
let seq = 0;
const uniq = () => `${Date.now().toString(36)}${++seq}`;

const expectReason = (promise, reason) =>
  expect(promise).rejects.toMatchObject({ reason });

async function setupOrg({ status = 'active' } = {}) {
  const orgId = `org-${uniq()}`;
  const uids = {
    owner: `owner-${uniq()}`,
    member: `member-${uniq()}`,
    viewer: `viewer-${uniq()}`,
    outsider: `outsider-${uniq()}`
  };
  await db
    .doc(`orgs/${orgId}`)
    .set({ name: 'Team', plan: 'PRO', seats: 5, status });
  for (const role of ['owner', 'member', 'viewer']) {
    await db
      .doc(`orgs/${orgId}/members/${uids[role]}`)
      .set({ uid: uids[role], role });
  }
  return { orgId, ...uids };
}

async function scene(data) {
  const ref = db.collection('scenes').doc();
  await ref.set({ data: [], updateTimestamp: new Date('2026-11-01'), ...data });
  return ref.id;
}

const sceneDoc = async (id) => (await db.doc(`scenes/${id}`).get()).data();

describe('team scenes (emulator)', () => {
  beforeAll(() => {
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBeTruthy();
    if (!admin.apps.length) {
      admin.initializeApp({ projectId: 'demo-3dstreet-rules' });
    }
    db = admin.firestore();
    teamScenes = functionsRequire('./team-scenes.js');
    visibility = functionsRequire('./scene-visibility.js');
  });

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('projects', () => {
    it('editors create projects; viewers and outsiders cannot', async () => {
      const t = await setupOrg();
      const created = await teamScenes.createProject({
        actorUid: t.member,
        orgId: t.orgId,
        name: '  2026  TOD Visuals '
      });
      const project = (
        await db.doc(`orgs/${t.orgId}/projects/${created.projectId}`).get()
      ).data();
      expect(project).toMatchObject({
        name: '2026 TOD Visuals',
        createdBy: t.member
      });
      await expectReason(
        teamScenes.createProject({
          actorUid: t.viewer,
          orgId: t.orgId,
          name: 'X'
        }),
        'not-editor'
      );
      await expectReason(
        teamScenes.createProject({
          actorUid: t.outsider,
          orgId: t.orgId,
          name: 'X'
        }),
        'not-member'
      );
    });

    it('a suspended team creates nothing', async () => {
      const t = await setupOrg({ status: 'suspended' });
      await expectReason(
        teamScenes.createProject({
          actorUid: t.owner,
          orgId: t.orgId,
          name: 'X'
        }),
        'org-suspended'
      );
    });

    it('the creator or a manager renames a project', async () => {
      const t = await setupOrg();
      const member2 = `member2-${uniq()}`;
      await db
        .doc(`orgs/${t.orgId}/members/${member2}`)
        .set({ uid: member2, role: 'member' });
      const { projectId } = await teamScenes.createProject({
        actorUid: t.member,
        orgId: t.orgId,
        name: 'Draft'
      });
      await expectReason(
        teamScenes.renameProject({
          actorUid: member2,
          orgId: t.orgId,
          projectId,
          name: 'Nope'
        }),
        'not-manager'
      );
      await teamScenes.renameProject({
        actorUid: t.member,
        orgId: t.orgId,
        projectId,
        name: 'Mine'
      });
      await teamScenes.renameProject({
        actorUid: t.owner,
        orgId: t.orgId,
        projectId,
        name: 'Final'
      });
      expect(
        (await db.doc(`orgs/${t.orgId}/projects/${projectId}`).get()).data()
          .name
      ).toBe('Final');
    });
  });

  describe('moveScene', () => {
    it("moves the author's personal scene into a team project, keeping its date", async () => {
      const t = await setupOrg();
      const { projectId } = await teamScenes.createProject({
        actorUid: t.owner,
        orgId: t.orgId,
        name: 'P'
      });
      const id = await scene({
        author: t.member,
        orgId: null,
        visibility: 'private'
      });
      await teamScenes.moveScene({
        actorUid: t.member,
        sceneId: id,
        orgId: t.orgId,
        projectId
      });
      const moved = await sceneDoc(id);
      expect(moved).toMatchObject({
        orgId: t.orgId,
        projectId,
        visibility: 'private',
        editLock: null
      });
      expect(moved.updateTimestamp.toDate().toISOString()).toBe(
        '2026-11-01T00:00:00.000Z'
      );
    });

    it("refuses someone else's personal scene, viewers and unknown projects", async () => {
      const t = await setupOrg();
      const id = await scene({
        author: t.owner,
        orgId: null,
        visibility: 'public'
      });
      await expectReason(
        teamScenes.moveScene({
          actorUid: t.member,
          sceneId: id,
          orgId: t.orgId
        }),
        'not-author'
      );
      const viewerScene = await scene({ author: t.viewer, orgId: null });
      await expectReason(
        teamScenes.moveScene({
          actorUid: t.viewer,
          sceneId: viewerScene,
          orgId: t.orgId
        }),
        'not-editor'
      );
      await expectReason(
        teamScenes.moveScene({
          actorUid: t.owner,
          sceneId: id,
          orgId: t.orgId,
          projectId: 'nope'
        }),
        'project-not-found'
      );
    });

    it('moves a team scene between its projects, never to another team', async () => {
      const t = await setupOrg();
      const other = await setupOrg();
      const { projectId } = await teamScenes.createProject({
        actorUid: t.owner,
        orgId: t.orgId,
        name: 'P'
      });
      const id = await scene({
        author: t.owner,
        orgId: t.orgId,
        projectId: null
      });
      await teamScenes.moveScene({
        actorUid: t.member,
        sceneId: id,
        orgId: t.orgId,
        projectId
      });
      expect((await sceneDoc(id)).projectId).toBe(projectId);
      await db
        .doc(`orgs/${other.orgId}/members/${t.member}`)
        .set({ uid: t.member, role: 'member' });
      await expectReason(
        teamScenes.moveScene({
          actorUid: t.member,
          sceneId: id,
          orgId: other.orgId
        }),
        'invalid-move'
      );
    });
  });

  describe('moveScene, members editing only their own', () => {
    it("refuses another member's scene; their own and a manager's moves pass", async () => {
      const t = await setupOrg();
      await db.doc(`orgs/${t.orgId}`).update({ memberEditScope: 'own' });
      const { projectId } = await teamScenes.createProject({
        actorUid: t.owner,
        orgId: t.orgId,
        name: 'P'
      });
      const byOwner = await scene({ author: t.owner, orgId: t.orgId });
      const byMember = await scene({ author: t.member, orgId: t.orgId });
      await expectReason(
        teamScenes.moveScene({
          actorUid: t.member,
          sceneId: byOwner,
          orgId: t.orgId,
          projectId
        }),
        'own-only'
      );
      await teamScenes.moveScene({
        actorUid: t.member,
        sceneId: byMember,
        orgId: t.orgId,
        projectId
      });
      await teamScenes.moveScene({
        actorUid: t.owner,
        sceneId: byMember,
        orgId: t.orgId,
        projectId: null
      });
      expect((await sceneDoc(byMember)).projectId).toBe(null);
    });
  });

  describe('readSceneAccess (getScene)', () => {
    it('serves a team-only scene to its members, not to its author once gone', async () => {
      const t = await setupOrg();
      const id = await scene({
        author: 'former',
        orgId: t.orgId,
        visibility: 'private'
      });
      const data = await sceneDoc(id);
      expect(await visibility.readSceneAccess(data, t.viewer)).toBe(true);
      expect(await visibility.readSceneAccess(data, t.outsider)).toBe(false);
      expect(await visibility.readSceneAccess(data, 'former')).toBe(false);
      expect(await visibility.readSceneAccess(data, null)).toBe(false);
    });
  });

  describe('createRestrictedScene', () => {
    it('creates an empty personal scene, restricted from the start', async () => {
      for (const value of ['unlisted', 'private']) {
        const { sceneId } = await visibility.createRestrictedScene({
          uid: 'pro',
          visibility: value,
          isPro: async () => true
        });
        expect(await sceneDoc(sceneId)).toMatchObject({
          author: 'pro',
          orgId: null,
          visibility: value
        });
      }
    });
  });
});
