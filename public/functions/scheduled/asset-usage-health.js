/**
 * Storage usage health — "know before the bill" awareness for storage growth.
 *
 * Per-file/per-plan size enforcement is intentionally client + preflight only
 * (storage.rules can't read a user's plan), so the only safety net against a
 * usage spike (a flood of large uploads, or a user blowing past their plan cap)
 * is *visibility*. This daily probe surfaces two signals on the admin System
 * Health page (the same jobHealth/{jobName} doc the reconciler writes):
 *
 *   - growthBytes  : platform-total bytesUsed delta since the previous run.
 *                    A sudden jump is the "100 users uploaded 5GB" alarm.
 *   - usersOverCap : how many users' true bytesUsed exceeds THEIR plan limit
 *                    (the soft cap actually being breached).
 *
 * Both are exposed as 0-when-healthy degradedKeys (growthBacklog / usersOverCap)
 * so deriveStatus flips the page yellow past threshold and the ERROR-level log
 * gives a Cloud Error Reporting hook — no new infra.
 *
 * Cost: one Firestore read per user (the meta/usage docs, NOT per asset), plus a
 * bounded number of Admin SDK getUser() calls (only for users already over the
 * smallest plan cap, capped at MAX_PLAN_LOOKUPS). Cheap enough to run daily.
 *
 * Two entry points:
 *   - checkAssetUsageHealth        : pubsub schedule, daily 04:00 PT
 *   - triggerCheckAssetUsageHealth : admin-only callable, dryRun-agnostic (read-only)
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertAppCheck } = require('../app-check.js');

const { PLAN_LIMITS, resolvePlanForUser, getPlanLimit } = require('../asset-quota');
const { withJobHealth } = require('./job-health.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const GB = 1000 * 1000 * 1000;

// Daily platform-total growth past this flips the page yellow. Overridable via
// env so the threshold can be tuned without a deploy. Default 10 GB/day: a
// normal day is well under this; a "many users x multi-GB" spike blows past it.
const GROWTH_WARN_BYTES =
  (Number(process.env.USAGE_GROWTH_WARN_GB) || 10) * GB;

// Anyone over their plan cap is necessarily over the SMALLEST cap (FREE), so we
// only need a plan lookup for users above this. Bounds the getUser() fan-out.
const FREE_LIMIT_BYTES = PLAN_LIMITS.FREE;

// Hard cap on per-user plan lookups in one run. Over-cap users are the largest,
// so checking the top-N by bytesUsed catches every realistic offender; anything
// beyond is recorded as "unchecked" rather than scanned.
const MAX_PLAN_LOOKUPS = 100;

const JOB_NAME = 'checkAssetUsageHealth';

// Read the previous run's platform total off this job's own health doc (job-
// health writes the summary AFTER the work fn, so at start it holds the prior
// run's). Lets us compute growth with no extra snapshot doc.
async function readPreviousTotal(db) {
  try {
    const snap = await db.collection('jobHealth').doc(JOB_NAME).get();
    if (!snap.exists) return null;
    const t = snap.data()?.summary?.totalBytes;
    return typeof t === 'number' ? t : null;
  } catch (err) {
    console.warn('[asset-usage-health] could not read previous total:', err);
    return null;
  }
}

// Sum bytesUsed across all users from the per-user meta/usage docs (one doc per
// user — NOT a per-asset scan), and collect the over-FREE-cap candidates.
async function readUsage(db) {
  const usageSnap = await db.collectionGroup('meta').get();
  let totalBytes = 0;
  let usersScanned = 0;
  const candidates = []; // { userId, bytesUsed } for bytesUsed > FREE cap

  for (const docSnap of usageSnap.docs) {
    if (docSnap.id !== 'usage') continue;
    const userId = docSnap.ref.parent.parent?.id;
    if (!userId) continue;
    const bytesUsed = Number(docSnap.data().bytesUsed) || 0;
    usersScanned++;
    totalBytes += bytesUsed;
    if (bytesUsed > FREE_LIMIT_BYTES) candidates.push({ userId, bytesUsed });
  }

  // Largest first: over-cap users sort to the top, so a capped lookup still
  // catches every realistic offender.
  candidates.sort((a, b) => b.bytesUsed - a.bytesUsed);
  return { totalBytes, usersScanned, candidates };
}

async function checkUsageHealth() {
  const db = admin.firestore();
  const prevTotalBytes = await readPreviousTotal(db);
  const { totalBytes, usersScanned, candidates } = await readUsage(db);

  const growthBytes = prevTotalBytes == null ? null : totalBytes - prevTotalBytes;

  // Plan lookups only for the biggest over-FREE users, bounded.
  const toCheck = candidates.slice(0, MAX_PLAN_LOOKUPS);
  const uncheckedCandidates = candidates.length - toCheck.length;
  let usersOverCap = 0;
  const samples = [];

  for (const { userId, bytesUsed } of toCheck) {
    const { tier, membership } = await resolvePlanForUser(userId);
    const limit = getPlanLimit(tier);
    if (bytesUsed > limit) {
      usersOverCap++;
      if (samples.length < 20) {
        samples.push({
          userId,
          bytesUsed,
          tier,
          membership,
          limit,
          overByBytes: bytesUsed - limit
        });
      }
    }
  }

  const round1 = (n) => Math.round((n / GB) * 10) / 10; // GB, 1 decimal

  const summary = {
    usersScanned,
    totalBytes,
    totalGB: round1(totalBytes),
    prevTotalBytes,
    growthBytes,
    growthGB: growthBytes == null ? null : round1(growthBytes),
    // 0-when-healthy degraded signal: positive only when growth exceeds the warn
    // line. Null/negative growth (first run, or net deletions) stays 0 = green.
    growthBacklog:
      growthBytes == null ? 0 : Math.max(0, growthBytes - GROWTH_WARN_BYTES),
    growthWarnGB: round1(GROWTH_WARN_BYTES),
    candidatesOverFreeCap: candidates.length,
    candidatesChecked: toCheck.length,
    uncheckedCandidates,
    usersOverCap,
    samples
  };
  return summary;
}

const checkAssetUsageHealth = functions
  .runWith({ secrets: ['ALLOWED_PRO_TEAM_DOMAINS'], timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('0 4 * * *') // daily 04:00 PT
  .timeZone('America/Los_Angeles')
  .onRun(
    withJobHealth(
      JOB_NAME,
      {
        schedule: '0 4 * * *',
        timeZone: 'America/Los_Angeles',
        expectedIntervalMs: DAY_MS,
        degradedKeys: ['usersOverCap', 'growthBacklog']
      },
      async () => {
        console.log('[asset-usage-health] starting daily usage check');
        const summary = await checkUsageHealth();
        console.log('[asset-usage-health] complete:', JSON.stringify(summary));
        if (summary.usersOverCap > 0 || summary.growthBacklog > 0) {
          // ERROR-level line = the Cloud Error Reporting / log-based-alert hook.
          console.error(
            '[asset-usage-health] ALERT: storage usage needs attention:',
            JSON.stringify({
              usersOverCap: summary.usersOverCap,
              growthGB: summary.growthGB,
              totalGB: summary.totalGB
            })
          );
        }
        return summary;
      }
    )
  );

const triggerCheckAssetUsageHealth = functions
  .runWith({ secrets: ['ALLOWED_PRO_TEAM_DOMAINS'], timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (data, context) => {
    // Defense-in-depth: also gate on App Check (admin claim required below).
    // No-op until APP_CHECK_ENFORCE is enabled (see app-check.js).
    assertAppCheck(context);
    if (!context.auth) {
      throw new functions.https.HttpsError(
        'unauthenticated',
        'User must be authenticated.'
      );
    }
    if (!context.auth.token.admin) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Admin access required.'
      );
    }
    // Read-only probe; no dryRun distinction needed.
    console.log('[asset-usage-health] manual trigger');
    const summary = await checkUsageHealth();
    console.log(
      '[asset-usage-health] manual run complete:',
      JSON.stringify(summary)
    );
    return summary;
  });

module.exports = { checkAssetUsageHealth, triggerCheckAssetUsageHealth };
