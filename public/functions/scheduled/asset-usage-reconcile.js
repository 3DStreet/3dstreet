/**
 * Asset storage usage reconciliation.
 *
 * Recomputes users/{uid}/meta/usage.bytesUsed from the source of truth (the
 * `size` field on non-deleted asset docs) and corrects drift. The trigger
 * (onAssetWritten) is atomic per write but isn't idempotent against retries,
 * so a slow drift is possible over time. This job is the safety net.
 *
 * Cost: one Firestore read per live asset doc; no Storage calls. Cheap enough
 * to run weekly.
 *
 * Two entry points:
 *   - reconcileAssetUsage        : pubsub schedule, weekly Sun 03:00 PT
 *   - triggerReconcileAssetUsage : admin-only callable, dryRun default
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

const { PLAN_LIMITS } = require('../asset-quota');
const { withJobHealth } = require('./job-health.js');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const PAGE_SIZE = 1000;
const FREE_LIMIT_BYTES = PLAN_LIMITS.FREE;

async function computeTotals() {
  const db = admin.firestore();
  const totals = new Map(); // userId -> bytesUsed
  let cursor = null;
  let scanned = 0;

  // Paginated collection-group scan, sorted by __name__ for stable cursoring.
  // Filtering `deleted` in code (not in the query) keeps the scan single-query
  // and avoids missing legacy docs that lack the field entirely.
  while (true) {
    let q = db
      .collectionGroup('assets')
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;

    for (const docSnap of snap.docs) {
      scanned++;
      const data = docSnap.data();
      if (data.deleted === true) continue;
      const size = Number(data.size) || 0;
      if (!size) continue;
      // Path: users/{userId}/assets/{assetId}
      const userId = docSnap.ref.parent.parent?.id;
      if (!userId) continue;
      totals.set(userId, (totals.get(userId) || 0) + size);
    }

    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }

  return { totals, scanned };
}

async function reconcile({ dryRun }) {
  const db = admin.firestore();
  const { totals, scanned } = await computeTotals();

  // Pull every existing usage doc so we can also zero-out users whose only
  // assets were deleted (totals would have no entry for them).
  const usageSnap = await db.collectionGroup('meta').get();
  const existingUsageRefs = new Map();
  for (const docSnap of usageSnap.docs) {
    if (docSnap.id !== 'usage') continue;
    const userId = docSnap.ref.parent.parent?.id;
    if (!userId) continue;
    existingUsageRefs.set(userId, {
      ref: docSnap.ref,
      bytesUsed: Number(docSnap.data().bytesUsed) || 0
    });
  }

  const summary = {
    usersScanned: totals.size,
    assetsScanned: scanned,
    drifted: 0,
    corrected: 0,
    bytesAdjustedTotal: 0,
    // Conservative — counts every user (not just FREE) whose true usage is
    // over the FREE cap. PRO users in this bucket are unaffected, but it
    // surfaces who *could* be impacted without an Admin SDK plan lookup per uid.
    wouldExceedFreeLimit: 0,
    samples: [],
    dryRun
  };

  const allUserIds = new Set([...totals.keys(), ...existingUsageRefs.keys()]);

  for (const userId of allUserIds) {
    const truth = totals.get(userId) || 0;
    const existing = existingUsageRefs.get(userId);
    const current = existing ? existing.bytesUsed : 0;
    if (truth === current) continue;

    summary.drifted++;
    summary.bytesAdjustedTotal += Math.abs(truth - current);
    const overFreeLimit = truth > FREE_LIMIT_BYTES;
    if (overFreeLimit) summary.wouldExceedFreeLimit++;
    if (summary.samples.length < 20) {
      summary.samples.push({
        userId,
        current,
        truth,
        delta: truth - current,
        overFreeLimit
      });
    }

    if (dryRun) {
      console.log(
        `[asset-usage-reconcile] would correct uid=${userId} ` +
          `current=${current} truth=${truth} delta=${truth - current}`
      );
      continue;
    }

    const ref =
      existing?.ref ||
      db.collection('users').doc(userId).collection('meta').doc('usage');
    try {
      await ref.set(
        {
          bytesUsed: truth,
          lastReconciled: admin.firestore.FieldValue.serverTimestamp(),
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );
      summary.corrected++;
    } catch (err) {
      console.error(
        `[asset-usage-reconcile] write failed uid=${userId}:`,
        err
      );
    }
  }

  return summary;
}

const reconcileAssetUsage = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('0 3 * * 0') // Sunday 03:00 PT
  .timeZone('America/Los_Angeles')
  .onRun(
    withJobHealth(
      'reconcileAssetUsage',
      {
        schedule: '0 3 * * 0',
        timeZone: 'America/Los_Angeles',
        expectedIntervalMs: WEEK_MS,
        // `drifted`/`corrected` are this job's normal output (it's the safety
        // net that fixes drift), so they don't degrade status — only a thrown
        // error (red) matters here.
        degradedKeys: []
      },
      async () => {
        console.log('[asset-usage-reconcile] starting weekly reconciliation');
        const summary = await reconcile({ dryRun: false });
        console.log(
          '[asset-usage-reconcile] complete:',
          JSON.stringify(summary)
        );
        return summary;
      }
    )
  );

const triggerReconcileAssetUsage = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (data, context) => {
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
    const dryRun = data?.dryRun ?? true;
    console.log(`[asset-usage-reconcile] manual trigger (dryRun=${dryRun})`);
    const summary = await reconcile({ dryRun });
    console.log(
      '[asset-usage-reconcile] manual run complete:',
      JSON.stringify(summary)
    );
    return summary;
  });

module.exports = { reconcileAssetUsage, triggerReconcileAssetUsage };
