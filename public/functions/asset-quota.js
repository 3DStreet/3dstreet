/**
 * Asset quota tracking & pre-flight check.
 *
 * Two functions:
 *   - onAssetWritten   : Firestore trigger maintaining users/{uid}/usage.bytesUsed
 *                        as the running sum of size on non-deleted asset docs.
 *   - getUploadQuota   : Callable returning { bytesUsed, planLimit, allowed,
 *                        planName }. Client uses this for the inline pre-flight
 *                        check before starting an upload.
 *
 * Plan limits:
 *   FREE: 100 MB · PRO: 5 GB · MAX/TEAM: 25 GB
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');

const MB = 1000 * 1000;
const GB = 1000 * MB;

const PLAN_LIMITS = {
  FREE: 100 * MB,
  PRO: 5 * GB,
  TEAM: 25 * GB,
  MAX: 25 * GB
};

function getPlanLimit(planName) {
  return PLAN_LIMITS[planName] || PLAN_LIMITS.FREE;
}

async function resolvePlanForUser(uid) {
  try {
    const record = await getAuth().getUser(uid);
    const claims = record.customClaims || {};
    if (claims.plan === 'MAX') return 'MAX';
    if (claims.plan === 'TEAM') return 'TEAM';
    if (claims.plan === 'PRO') return 'PRO';
  } catch (err) {
    console.warn('[asset-quota] failed to read user claims', err);
  }
  return 'FREE';
}

/**
 * Firestore trigger: maintain users/{uid}/usage.bytesUsed.
 * Path: users/{userId}/assets/{assetId}
 */
const onAssetWritten = functions.firestore
  .document('users/{userId}/assets/{assetId}')
  .onWrite(async (change, context) => {
    const { userId } = context.params;
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;

    const sizeBefore = before && !before.deleted ? Number(before.size) || 0 : 0;
    const sizeAfter = after && !after.deleted ? Number(after.size) || 0 : 0;
    const delta = sizeAfter - sizeBefore;
    if (delta === 0) return null;

    const usageRef = admin
      .firestore()
      .collection('users')
      .doc(userId)
      .collection('meta')
      .doc('usage');

    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(usageRef);
      const current = snap.exists ? Number(snap.data().bytesUsed) || 0 : 0;
      const next = Math.max(0, current + delta);
      tx.set(
        usageRef,
        {
          bytesUsed: next,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    });

    return null;
  });

/**
 * Callable: pre-flight quota check.
 * Input:  { proposedBytes }
 * Output: { bytesUsed, planLimit, planName, allowed, reason? }
 */
const getUploadQuota = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be authenticated.'
    );
  }
  const uid = context.auth.uid;
  const proposedBytes = Math.max(0, Number(data?.proposedBytes) || 0);

  const planName = await resolvePlanForUser(uid);
  const planLimit = getPlanLimit(planName);

  const usageSnap = await admin
    .firestore()
    .collection('users')
    .doc(uid)
    .collection('meta')
    .doc('usage')
    .get();
  const bytesUsed = usageSnap.exists ? Number(usageSnap.data().bytesUsed) || 0 : 0;

  const allowed = bytesUsed + proposedBytes <= planLimit;
  return {
    bytesUsed,
    planLimit,
    planName,
    allowed,
    reason: allowed ? null : 'over_limit'
  };
});

module.exports = { onAssetWritten, getUploadQuota };
