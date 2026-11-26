/**
 * Team scenes and projects (#1267 Phase 2, docs/team-scenes.md).
 *
 * A team scene has an orgId and an optional projectId; projects are folders
 * of a team's scenes (orgs/{orgId}/projects/{projectId}). Firestore rules
 * let org editors create team scenes and save them while holding the edit
 * lock; these callables do what the rules don't allow from the client:
 * creating and renaming projects, and moving a scene into a team or between
 * its projects.
 */

const { randomUUID } = require('crypto');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { OrgError, callable, requireAuth } = require('./orgs.js');
const {
  normalizeOrgName,
  isValidOrgName,
  canManageOrg,
  takesSeat,
  canEditTeamItem
} = require('./org-utils.js');

const { isUserProInternal } = require('./token-management.js');

const db = () => admin.firestore();
const orgRef = (orgId) => db().collection('orgs').doc(orgId);
const projectRef = (orgId, projectId) => orgRef(orgId).collection('projects').doc(projectId);

/**
 * The actor's role in an active org, and the org's data; refuses non-members
 * and suspended orgs.
 */
async function requireOrgMember(tx, orgId, uid) {
  const org = await tx.get(orgRef(orgId));
  if (!org.exists) throw new OrgError('org-not-found');
  if (org.data().status !== 'active') throw new OrgError('org-suspended');
  const member = await tx.get(orgRef(orgId).collection('members').doc(uid));
  if (!member.exists) throw new OrgError('not-member');
  return { role: member.data().role, org: org.data() };
}

const requireOrgRole = async (tx, orgId, uid) =>
  (await requireOrgMember(tx, orgId, uid)).role;

/** Owners, admins and members (not viewers) create projects. */
async function createProject({ actorUid, orgId, name }) {
  if (!isValidOrgName(name)) throw new OrgError('invalid-name');
  const ref = orgRef(orgId).collection('projects').doc();
  await db().runTransaction(async (tx) => {
    const role = await requireOrgRole(tx, orgId, actorUid);
    if (!takesSeat(role)) throw new OrgError('not-editor');
    tx.set(ref, {
      name: normalizeOrgName(name),
      createdBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });
  return { orgId, projectId: ref.id, name: normalizeOrgName(name) };
}

/** Managers, or the project's creator, rename it. */
async function renameProject({ actorUid, orgId, projectId, name }) {
  if (!isValidOrgName(name)) throw new OrgError('invalid-name');
  await db().runTransaction(async (tx) => {
    const role = await requireOrgRole(tx, orgId, actorUid);
    const project = await tx.get(projectRef(orgId, projectId));
    if (!project.exists) throw new OrgError('project-not-found');
    if (!canManageOrg(role) && project.data().createdBy !== actorUid) {
      throw new OrgError('not-manager');
    }
    tx.update(projectRef(orgId, projectId), {
      name: normalizeOrgName(name),
      updatedAt: FieldValue.serverTimestamp()
    });
  });
  return { orgId, projectId, name: normalizeOrgName(name) };
}

/**
 * Move a scene into a team project, or between projects of its team
 * (projectId null = no project).
 *   personal → team: by its author, an editor of the target org. A private
 *     scene stays private, which now means team-only.
 *   team → team: by an editor of its org, within that org.
 * Leaving a team (team → personal or another team) isn't supported.
 */
async function moveScene({ actorUid, sceneId, orgId, projectId = null }) {
  if (typeof sceneId !== 'string' || !sceneId || typeof orgId !== 'string' || !orgId) {
    throw new OrgError('invalid-argument');
  }
  return db().runTransaction(async (tx) => {
    const sceneRef = db().collection('scenes').doc(sceneId);
    const snapshot = await tx.get(sceneRef);
    if (!snapshot.exists) throw new OrgError('scene-not-found');
    const scene = snapshot.data();
    const { role, org } = await requireOrgMember(tx, orgId, actorUid);
    if (!takesSeat(role)) throw new OrgError('not-editor');
    if (scene.orgId) {
      if (scene.orgId !== orgId) throw new OrgError('invalid-move');
      // A team set to "members edit only their own" (docs/team-scenes.md).
      if (!canEditTeamItem({ role, org, creatorUid: scene.author, uid: actorUid })) {
        throw new OrgError('own-only');
      }
    } else if (scene.author !== actorUid) {
      throw new OrgError('not-author');
    }
    if (projectId) {
      const project = await tx.get(projectRef(orgId, projectId));
      if (!project.exists) throw new OrgError('project-not-found');
    }
    // A move is not a content change: updateTimestamp (the lists' sort
    // key) is left alone, and any edit lock is dropped.
    tx.update(sceneRef, {
      orgId,
      projectId: projectId || null,
      editLock: null
    });
    return { sceneId, orgId, projectId: projectId || null };
  });
}

/**
 * Copy a team scene to its creator's own scenes; the team keeps the
 * original. Its creator only, still in the team (any role), when the team
 * allows it (`memberCopyToPersonal`) or they manage it. Works while the team
 * is suspended. The copy is private with Pro, else public, and then only
 * when the caller accepted that (`acceptPublic`).
 */
async function copySceneToPersonal({ uid, sceneId, acceptPublic = false, isPro }) {
  if (typeof sceneId !== 'string' || !sceneId) throw new OrgError('invalid-argument');
  const snapshot = await db().collection('scenes').doc(sceneId).get();
  if (!snapshot.exists) throw new OrgError('scene-not-found');
  const scene = snapshot.data();
  if (!scene.orgId) throw new OrgError('invalid-argument');
  const [org, member] = await Promise.all([
    orgRef(scene.orgId).get(),
    orgRef(scene.orgId).collection('members').doc(uid).get()
  ]);
  if (!org.exists || !member.exists) throw new OrgError('not-member');
  const allowed = canManageOrg(member.data().role) || org.data().memberCopyToPersonal === true;
  if (scene.author !== uid || !allowed) throw new OrgError('copy-not-allowed');
  const visibility = (await isPro()) ? 'private' : 'public';
  if (visibility === 'public' && acceptPublic !== true) throw new OrgError('would-be-public');
  const copyId = randomUUID();
  const now = FieldValue.serverTimestamp();
  await db().collection('scenes').doc(copyId).set({
    author: uid,
    orgId: null,
    visibility,
    title: scene.title || null,
    version: scene.version || null,
    data: scene.data || null,
    memory: scene.memory || null,
    copiedFrom: sceneId,
    createTimestamp: now,
    updateTimestamp: now
  });
  return { sceneId: copyId, visibility };
}

const orgCopySceneToPersonal = callable(
  (data, context) => {
    const uid = requireAuth(context);
    return copySceneToPersonal({
      uid,
      sceneId: data.sceneId,
      acceptPublic: data.acceptPublic,
      isPro: () => isUserProInternal(uid)
    });
  },
  { secrets: ['ALLOWED_PRO_TEAM_DOMAINS'] }
);

const orgCreateProject = callable((data, context) =>
  createProject({ actorUid: requireAuth(context), orgId: data.orgId, name: data.name })
);

const orgRenameProject = callable((data, context) =>
  renameProject({
    actorUid: requireAuth(context),
    orgId: data.orgId,
    projectId: data.projectId,
    name: data.name
  })
);

const orgMoveScene = callable((data, context) =>
  moveScene({
    actorUid: requireAuth(context),
    sceneId: data.sceneId,
    orgId: data.orgId,
    projectId: data.projectId || null
  })
);

module.exports = {
  createProject,
  renameProject,
  moveScene,
  orgCreateProject,
  orgRenameProject,
  orgMoveScene,
  copySceneToPersonal,
  orgCopySceneToPersonal
};
