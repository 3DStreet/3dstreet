/**
 * Asset-processing reaper — the backstop for asset-processing.js (#1643).
 *
 * The Firestore trigger is the primary path; this sweep only catches what it
 * can't finish on its own:
 *   - 'running' docs whose lease expired (worker crashed or timed out)
 *   - 'pending' retries whose backoff window has elapsed
 *   - recent creations the trigger never enrolled (dropped event)
 *
 * Both stuck-classes come from ONE composite index (processingState,
 * leaseExpiresAt) because leaseExpiresAt doubles as the not-before time on
 * 'pending' docs. Re-processing goes through the same transactional claim as
 * the trigger (processAsset), so racing a live trigger is harmless.
 *
 * Two entry points:
 *   - reapAssetProcessing        : pubsub schedule, every 10 min
 *   - triggerReapAssetProcessing : admin-only callable, dryRun default
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertAppCheck } = require('../app-check.js');
const { withJobHealth } = require('./job-health.js');
const {
  processAsset,
  needsProcessing
} = require('../asset-processing.js');

const TEN_MIN_MS = 10 * 60 * 1000;

// Cap per sweep so a pathological backlog can't blow the time budget; the
// next tick picks up the remainder.
const MAX_STUCK_PER_RUN = 50;

// Missed-enrollment scan: only look at recent creations (the trigger delivers
// at-least-once, so a genuinely dropped event is rare) — anything older is
// legacy backlog, which enrolls lazily on its next doc touch instead.
const MISSED_SCAN_LIMIT = 100;
const MISSED_MAX_AGE_MS = 24 * 60 * 60 * 1000;

async function reap({ dryRun }) {
  const db = admin.firestore();
  const now = admin.firestore.Timestamp.now();

  const summary = {
    stuckScanned: 0,
    missedScanned: 0,
    processed: 0,
    skipped: 0,
    errored: 0,
    samples: [],
    dryRun
  };

  const handleDoc = async (docSnap, source) => {
    const sample = { path: docSnap.ref.path, source };
    if (dryRun) {
      sample.action = 'would-process';
      summary.processed++;
    } else {
      // processAsset re-checks eligibility inside its claim transaction, so a
      // doc the live trigger already grabbed just counts as 'skipped'.
      const action = await processAsset(docSnap.ref);
      sample.action = action;
      if (action === 'processed') summary.processed++;
      else if (action === 'errored') summary.errored++;
      else summary.skipped++;
    }
    if (summary.samples.length < 25) summary.samples.push(sample);
  };

  // 1) Expired leases + elapsed retry backoffs.
  const stuckSnap = await db
    .collectionGroup('assets')
    .where('processingState', 'in', ['pending', 'running'])
    .where('leaseExpiresAt', '<=', now)
    .limit(MAX_STUCK_PER_RUN)
    .get();
  summary.stuckScanned = stuckSnap.size;
  for (const docSnap of stuckSnap.docs) {
    await handleDoc(docSnap, 'stuck');
  }

  // 2) Recent creations the trigger missed (no processingState at all).
  const recentSnap = await db
    .collectionGroup('assets')
    .where('deleted', '==', false)
    .orderBy('createdAt', 'desc')
    .limit(MISSED_SCAN_LIMIT)
    .get();
  const cutoffMs = Date.now() - MISSED_MAX_AGE_MS;
  for (const docSnap of recentSnap.docs) {
    const data = docSnap.data();
    const createdMs =
      data.createdAt && data.createdAt.toMillis ? data.createdAt.toMillis() : 0;
    if (createdMs && createdMs < cutoffMs) break; // ordered desc — all older
    if (data.processingState) continue; // enrolled — bucket 1 owns it
    if (!needsProcessing(data)) continue;
    summary.missedScanned++;
    await handleDoc(docSnap, 'missed');
  }

  return summary;
}

const reapAssetProcessing = functions
  .runWith({
    // Same profile as the trigger worker — the sweep runs the identical sharp
    // pass, just over the backlog, one asset at a time.
    memory: '1GB',
    timeoutSeconds: 540
  })
  .pubsub.schedule('*/10 * * * *') // every 10 minutes
  .timeZone('America/Los_Angeles')
  .onRun(
    withJobHealth(
      'reapAssetProcessing',
      {
        schedule: '*/10 * * * *',
        timeZone: 'America/Los_Angeles',
        expectedIntervalMs: TEN_MIN_MS,
        degradedKeys: ['errored']
      },
      async () => {
        console.log('[asset-processing-reaper] starting sweep');
        const summary = await reap({ dryRun: false });
        console.log(
          '[asset-processing-reaper] complete:',
          JSON.stringify(summary)
        );
        return summary;
      }
    )
  );

const triggerReapAssetProcessing = functions
  .runWith({ memory: '1GB', timeoutSeconds: 540 })
  .https.onCall(async (data, context) => {
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
    const dryRun = data?.dryRun ?? true;
    console.log(`[asset-processing-reaper] manual trigger (dryRun=${dryRun})`);
    const summary = await reap({ dryRun });
    console.log(
      '[asset-processing-reaper] manual run complete:',
      JSON.stringify(summary)
    );
    return summary;
  });

module.exports = { reapAssetProcessing, triggerReapAssetProcessing };
