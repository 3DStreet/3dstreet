/**
 * Asset quota tracking & pre-flight check.
 *
 * Two functions:
 *   - onAssetWritten   : Firestore trigger maintaining users/{uid}/usage.bytesUsed
 *                        as the running sum of `size` (original source) on
 *                        non-deleted asset docs. `optimizedSourceSize` is
 *                        excluded — it's a platform-derived artifact.
 *   - getUploadQuota   : Callable returning { bytesUsed, planLimit, allowed,
 *                        planName }. bytesUsed reflects original uploads only.
 *                        Client uses this for the inline pre-flight check
 *                        before starting an upload.
 *
 * Plan limits:
 *   FREE: 100 MB · PRO: 5 GB · MAX: 25 GB (reserved; no users today)
 *
 * Note: "team" is not its own quota tier — a team membership currently just
 * grants PRO. Domain-matched team users resolve to PRO here.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');

const MB = 1000 * 1000;
const GB = 1000 * MB;

const PLAN_LIMITS = {
  FREE: 100 * MB,
  PRO: 5 * GB,
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
    if (claims.plan === 'PRO') return 'PRO';

    // Domain-based team access grants PRO (team is not its own quota tier).
    // Mirrors token-management.js validateUserDomain.
    const email = record.email;
    const allowedDomainsSecret = process.env.ALLOWED_PRO_TEAM_DOMAINS;
    if (email && allowedDomainsSecret) {
      const userDomain = email.split('@')[1];
      if (userDomain) {
        try {
          const domains = JSON.parse(allowedDomainsSecret);
          if (Array.isArray(domains) && domains.includes(userDomain)) {
            return 'PRO';
          }
        } catch (parseError) {
          console.error('[asset-quota] Error parsing ALLOWED_PRO_TEAM_DOMAINS secret:', parseError);
        }
      }
    }
  } catch (err) {
    console.warn('[asset-quota] failed to read user claims', err);
  }
  return 'FREE';
}

/**
 * Firestore trigger: maintain users/{uid}/usage.bytesUsed.
 * Path: users/{userId}/assets/{assetId}
 *
 * Quota policy: only the `size` field (original source file) counts toward the
 * user's storage quota. `optimizedSourceSize` is a platform-derived artifact
 * stored at 3DStreet's expense and is intentionally excluded from this tally.
 * Storage files are tagged with `customMetadata.assetRole = 'original'|'optimized'`
 * so admin audit scripts can verify this split at the byte level.
 */
const onAssetWritten = functions.firestore
  .document('users/{userId}/assets/{assetId}')
  .onWrite(async (change, context) => {
    const { userId } = context.params;
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;

    // Read `size` only (original source). `optimizedSourceSize` is excluded.
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
const getUploadQuota = functions.runWith({ secrets: ['ALLOWED_PRO_TEAM_DOMAINS'] }).https.onCall(async (data, context) => {
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
