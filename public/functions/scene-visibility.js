/**
 * Scene visibility (#1267, docs/scene-visibility.md, docs/team-scenes.md).
 *
 *   'public'   — anyone can open it; listed in the community feed
 *   'unlisted' — anyone with the link can open it; not listed
 *   'private'  — personal scene: only the author (Pro); team scene (orgId
 *                set): only the org's members
 *
 * Firestore rules let the author of a personal scene switch between public
 * and unlisted, but never to private: the Pro entitlement includes team
 * domains, which live in a secret the rules can't read. setSceneVisibility
 * is the only writer of 'private' on personal scenes, and of any change on a
 * team scene (owners and admins only; the org's plan pays for private).
 * getScene (index.js) serves private scenes to who may read them.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
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
 * run when needed (a change to private on a personal scene; a team scene).
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
  if (visibility === 'private' && !(await isPro())) return 'pro-required';
  return null;
}

const REASON_TO_HTTPS = {
  'invalid-visibility': ['invalid-argument', 'Unknown visibility.'],
  'not-found': ['not-found', 'Scene not found.'],
  'not-author': ['permission-denied', 'Only the scene author can change its visibility.'],
  'not-manager': ['permission-denied', "Only the team's owners and admins can change its sharing."],
  'pro-required': ['permission-denied', 'Private scenes are a Pro feature.']
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
  setSceneVisibility,
  uidFromAuthorizationHeader
};
