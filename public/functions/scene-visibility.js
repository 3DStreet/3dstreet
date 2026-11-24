/**
 * Scene visibility (#1267, docs/scene-visibility.md, docs/team-scenes.md).
 *
 *   'public'   — anyone can open it; listed in the community feed
 *   'unlisted' — anyone with the link can open it; not listed (Pro to set
 *                on a personal scene)
 *   'private'  — personal scene: only the author (Pro); team scene (orgId
 *                set): only the org's members
 *
 * Firestore rules let the author of a personal scene make it less
 * restricted, never more: the Pro entitlement includes team domains, which
 * live in a secret the rules can't read. setSceneVisibility and
 * createRestrictedScene are the only writers of 'unlisted' and 'private' on
 * personal scenes, and setSceneVisibility is the only one of any change on a
 * team scene (owners and admins only; the org's plan pays for private).
 * getScene (index.js) serves private scenes to who may read them.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { randomUUID } = require('crypto');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue } = require('firebase-admin/firestore');
const { assertAppCheck } = require('./app-check.js');
const { isUserProInternal } = require('./token-management.js');

const SCENE_VISIBILITIES = ['public', 'unlisted', 'private'];

// Docs written before the field existed are public.
const sceneVisibility = (scene) => (scene && scene.visibility) || 'public';

/**
 * Whether `uid` may read `scene`. For a private team scene, `isOrgMember`
 * says whether uid is a member of the scene's org (callers look it up only
 * when needed, see readSceneAccess).
 */
const canReadScene = (scene, uid, isOrgMember = false) => {
  if (sceneVisibility(scene) !== 'private') return true;
  if (scene.orgId) return !!uid && isOrgMember;
  return !!uid && uid === scene.author;
};

/** The caller's role in an org, or null. */
async function readOrgRole(orgId, uid) {
  if (!orgId || !uid) return null;
  const member = await admin
    .firestore()
    .collection('orgs')
    .doc(orgId)
    .collection('members')
    .doc(uid)
    .get();
  return member.exists ? member.data().role : null;
}

/** canReadScene with the org membership looked up when it matters. */
async function readSceneAccess(scene, uid) {
  if (canReadScene(scene, uid)) return true;
  if (!scene.orgId || !uid) return false;
  return canReadScene(scene, uid, !!(await readOrgRole(scene.orgId, uid)));
}

/**
 * Whether `uid` may set `scene` to `visibility`. Returns null when allowed,
 * else a reason. `isPro` and `orgRole` are functions so their lookups only
 * run when needed (restricting a personal scene; a team scene).
 */
async function visibilityChangeRefusal({ scene, uid, visibility, isPro, orgRole = async () => null }) {
  if (!SCENE_VISIBILITIES.includes(visibility)) return 'invalid-visibility';
  if (!scene) return 'not-found';
  if (scene.orgId) {
    // Team scene: sharing is the managers' call; the org's plan covers
    // private (team-only), so no Pro check.
    const role = await orgRole();
    return role === 'owner' || role === 'admin' ? null : 'not-manager';
  }
  if (scene.author !== uid) return 'not-author';
  // Lowering a private scene to unlisted needs no Pro: it may have lapsed.
  const isRestricting =
    visibility === 'private' || (visibility === 'unlisted' && sceneVisibility(scene) !== 'private');
  if (isRestricting && visibility !== sceneVisibility(scene) && !(await isPro())) {
    return 'pro-required';
  }
  return null;
}

/**
 * What the community Discord may show of a finished generation job:
 * 'full' (output, prompt, username, scene link) or 'minimal' (model, time
 * and app only). The payer decides first: paid by a team is minimal. Paid
 * personally is full from a public scene or, in the generator, with no
 * scene; a scene that isn't public (or can't be read), or an unsaved one in
 * the editor, is minimal. `scene` is the job's scene as read now, or null.
 */
const communityPostLevel = (job, scene) => {
  if (job.chargedOrgId) return 'minimal';
  const sceneId = job.generationParams && job.generationParams.scene_id;
  if (!sceneId) return job.source === 'generator' ? 'full' : 'minimal';
  return scene && sceneVisibility(scene) === 'public' ? 'full' : 'minimal';
};

/** communityPostLevel with the scene looked up; a failed read is minimal. */
async function readCommunityPostLevel(job) {
  const sceneId = job.generationParams && job.generationParams.scene_id;
  if (job.chargedOrgId || typeof sceneId !== 'string' || !sceneId) {
    return communityPostLevel(job, null);
  }
  try {
    const snapshot = await admin.firestore().collection('scenes').doc(sceneId).get();
    return communityPostLevel(job, snapshot.exists ? snapshot.data() : null);
  } catch (error) {
    console.error(`readCommunityPostLevel: could not read scene ${sceneId}:`, error);
    return 'minimal';
  }
}

/** The Discord message for a 'minimal' post: nothing about who or what. */
const minimalCommunityMessage = ({ kind, modelName, source, at = new Date() }) => ({
  embeds: [
    {
      title: kind === 'video' ? 'Private AI video generated' : 'Private AI image generated',
      fields: [
        { name: 'Model', value: modelName || 'AI Model', inline: true },
        { name: 'App', value: source === 'generator' ? 'Generator' : 'Editor', inline: true }
      ],
      timestamp: at.toISOString()
    }
  ]
});

/**
 * Create an empty personal scene that is unlisted or private from the start
 * (the rules let clients create only public ones); its author then saves the
 * content into it. Used to copy such a scene without publishing it.
 */
async function createRestrictedScene({ uid, visibility, isPro }) {
  if (!['unlisted', 'private'].includes(visibility)) return { reason: 'invalid-visibility' };
  if (!(await isPro())) return { reason: 'pro-required' };
  const sceneId = randomUUID();
  const now = FieldValue.serverTimestamp();
  await admin.firestore().collection('scenes').doc(sceneId).set({
    author: uid,
    orgId: null,
    visibility,
    createTimestamp: now,
    updateTimestamp: now
  });
  return { sceneId, visibility };
}

const REASON_TO_HTTPS = {
  'invalid-visibility': ['invalid-argument', 'Unknown visibility.'],
  'not-found': ['not-found', 'Scene not found.'],
  'not-author': ['permission-denied', 'Only the scene author can change its visibility.'],
  'not-manager': ['permission-denied', "Only the team's owners and admins can change its sharing."],
  'pro-required': ['permission-denied', 'Unlisted and private scenes are a Pro feature.']
};

// ALLOWED_PRO_TEAM_DOMAINS: team-domain users are Pro (isUserProInternal).
const setSceneVisibility = functions
  .runWith({ secrets: ['ALLOWED_PRO_TEAM_DOMAINS'] })
  .https
  .onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in to change a scene visibility.');
    }
    assertAppCheck(context);

    const uid = context.auth.uid;
    const sceneId = data && data.sceneId;
    const visibility = data && data.visibility;
    if (typeof sceneId !== 'string' || !sceneId) {
      throw new functions.https.HttpsError('invalid-argument', 'sceneId is required.');
    }

    const sceneRef = admin.firestore().collection('scenes').doc(sceneId);
    const snapshot = await sceneRef.get();
    const reason = await visibilityChangeRefusal({
      scene: snapshot.exists ? snapshot.data() : null,
      uid,
      visibility,
      isPro: () => isUserProInternal(uid),
      orgRole: () => readOrgRole(snapshot.data().orgId, uid)
    });
    if (reason) {
      const [code, message] = REASON_TO_HTTPS[reason];
      // `reason` lets the client pick localized copy without parsing messages.
      throw new functions.https.HttpsError(code, message, { reason });
    }

    // Not a content change: updateTimestamp (the feed's sort key) is left alone.
    await sceneRef.update({ visibility });
    return { sceneId, visibility };
  });

const createRestrictedSceneCallable = functions
  .runWith({ secrets: ['ALLOWED_PRO_TEAM_DOMAINS'] })
  .https
  .onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in to save a scene.');
    }
    assertAppCheck(context);
    const uid = context.auth.uid;
    const { reason, ...result } = await createRestrictedScene({
      uid,
      visibility: data && data.visibility,
      isPro: () => isUserProInternal(uid)
    });
    if (reason) {
      const [code, message] = REASON_TO_HTTPS[reason];
      throw new functions.https.HttpsError(code, message, { reason });
    }
    return result;
  });

/**
 * The caller's uid from an `Authorization: Bearer <Firebase ID token>`
 * header, or null when absent or invalid.
 */
async function uidFromAuthorizationHeader(req) {
  const match = /^Bearer (.+)$/.exec(req.get('Authorization') || '');
  if (!match) return null;
  try {
    return (await getAuth().verifyIdToken(match[1])).uid;
  } catch (error) {
    console.warn('getScene: invalid ID token:', error.code || error.message);
    return null;
  }
}

module.exports = {
  SCENE_VISIBILITIES,
  sceneVisibility,
  canReadScene,
  readOrgRole,
  readSceneAccess,
  visibilityChangeRefusal,
  communityPostLevel,
  readCommunityPostLevel,
  minimalCommunityMessage,
  createRestrictedScene,
  createRestrictedSceneCallable,
  setSceneVisibility,
  uidFromAuthorizationHeader
};
