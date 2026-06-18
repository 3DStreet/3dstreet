/**
 * Asset quota tracking & pre-flight check.
 *
 * Two functions:
 *   - onAssetWritten   : Firestore trigger maintaining users/{uid}/usage.bytesUsed
 *                        as the running sum of `size` (original source) on
 *                        non-deleted asset docs. `optimizedSourceSize` is
 *                        excluded — it's a platform-derived artifact.
 *   - getUploadQuota   : Callable returning { bytesUsed, planLimit, allowed,
 *                        tier, membership, planName }. bytesUsed reflects
 *                        original uploads only. Client uses this for the
 *                        inline pre-flight check before starting an upload.
 *
 * Plan limits:
 *   FREE: 100 MB · PRO: 5 GB · MAX: 25 GB (reserved; no users today)
 *
 * Plan shape is split into two orthogonal dimensions so the UI can render
 * "PRO TEAM" vs "PRO" (and future "MAX TEAM") without another rename:
 *   - tier:       FREE | PRO | MAX  (what storage you get)
 *   - membership: individual | team  (how you got it)
 * `planName` is the derived display label, kept for back-compat with callers.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { assertAppCheck } = require('./app-check.js');

const MB = 1000 * 1000;
const GB = 1000 * MB;

const PLAN_LIMITS = {
  FREE: 100 * MB,
  PRO: 5 * GB,
  MAX: 25 * GB
};

// Per-FILE upload cap, by plan. Single dimension (plan only) — deliberately
// NOT per-file-type: a big upload costs the same to host whether it's a model,
// image, or splat, so "upload bigger → pay more" scales by plan alone. This is
// the authority; the client mirrors only the top value as a fast reject, and
// storage.rules holds the same MAX value as a flat hard ceiling. (Total storage
// quota above is a separate, additive limit on aggregate stored bytes.)
const MAX_FILE_BYTES_BY_PLAN = {
  FREE: 100 * MB,
  PRO: 1 * GB,
  MAX: 5 * GB
};

function getPlanLimit(planName) {
  return PLAN_LIMITS[planName] || PLAN_LIMITS.FREE;
}

function getMaxFileBytes(tier) {
  return MAX_FILE_BYTES_BY_PLAN[tier] || MAX_FILE_BYTES_BY_PLAN.FREE;
}

/**
 * Resolve plan tier via Admin SDK getUser() — always reads fresh custom claims
 * server-side. JWT-decoded claims (context.auth.token) are stale between
 * setCustomUserClaims and the next ID-token refresh (~1h auto, or forced via
 * getIdToken(true)), which leaves the assets panel showing the old plan for
 * any plan change not initiated through EditorUpgradeModal (e.g. admin-side
 * downgrade). Mirrors checkUserProStatus in token-management.js so both the
 * upper-right badge and the assets panel see the same truth.
 */
async function resolvePlanForUser(uid) {
  try {
    const record = await getAuth().getUser(uid);
    const claims = record.customClaims || {};
    if (claims.plan === 'MAX') return { tier: 'MAX', membership: 'individual' };
    if (claims.plan === 'PRO') return { tier: 'PRO', membership: 'individual' };

    // Domain-based team access grants PRO at the team membership level.
    // Mirrors token-management.js validateUserDomain.
    const email = record.email;
    const allowedDomainsSecret = process.env.ALLOWED_PRO_TEAM_DOMAINS;
    if (email && allowedDomainsSecret) {
      const userDomain = email.split('@')[1];
      if (userDomain) {
        try {
          const domains = JSON.parse(allowedDomainsSecret);
          if (Array.isArray(domains) && domains.includes(userDomain)) {
            return { tier: 'PRO', membership: 'team' };
          }
        } catch (parseError) {
          console.error('[asset-quota] Error parsing ALLOWED_PRO_TEAM_DOMAINS secret:', parseError);
        }
      }
    }
  } catch (err) {
    console.warn('[asset-quota] failed to read user claims', err);
  }
  return { tier: 'FREE', membership: 'individual' };
}

function derivePlanName(tier, membership) {
  const tierLabel = PLAN_LIMITS[tier] ? tier : 'FREE';
  return membership === 'team' ? `${tierLabel} TEAM` : tierLabel;
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
 * Output: { bytesUsed, planLimit, tier, membership, planName, allowed, reason? }
 */
const getUploadQuota = functions.runWith({ secrets: ['ALLOWED_PRO_TEAM_DOMAINS'] }).https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be authenticated.'
    );
  }
  assertAppCheck(context);
  const uid = context.auth.uid;
  const proposedBytes = Math.max(0, Number(data?.proposedBytes) || 0);

  const { tier, membership } = await resolvePlanForUser(uid);
  const planLimit = getPlanLimit(tier);
  const planName = derivePlanName(tier, membership);

  const usageSnap = await admin
    .firestore()
    .collection('users')
    .doc(uid)
    .collection('meta')
    .doc('usage')
    .get();
  const bytesUsed = usageSnap.exists ? Number(usageSnap.data().bytesUsed) || 0 : 0;

  // Two independent gates: per-file cap (plan-scaled, type-agnostic) and total
  // quota. file_too_large takes precedence so the client can show the right
  // "this file exceeds your plan's per-file limit, upgrade for bigger" message.
  const perFileLimit = getMaxFileBytes(tier);
  const fileTooLarge = proposedBytes > perFileLimit;
  const overQuota = bytesUsed + proposedBytes > planLimit;
  const allowed = !fileTooLarge && !overQuota;

  return {
    bytesUsed,
    planLimit,
    perFileLimit,
    tier,
    membership,
    planName,
    allowed,
    reason: fileTooLarge ? 'file_too_large' : overQuota ? 'over_limit' : null
  };
});

module.exports = {
  onAssetWritten,
  getUploadQuota,
  resolvePlanForUser,
  getPlanLimit,
  PLAN_LIMITS,
  MAX_FILE_BYTES_BY_PLAN
};
