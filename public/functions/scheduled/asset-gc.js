/**
 * Asset garbage collection.
 *
 * Soft-deleted assets (`deleted: true`) stick around in Firestore + Storage
 * for a grace period so users can restore them (assetsService.undeleteAsset).
 * After that window, this job hard-deletes them: removes the original and
 * optimized Storage blobs, then deletes the Firestore doc. The onAssetWritten
 * trigger sees `before.deleted == true` (sizeBefore=0) → no usage delta, so
 * quota accounting stays consistent.
 *
 * Two entry points:
 *   - purgeSoftDeletedAssets        : pubsub schedule, weekly Sun 02:00 PT
 *   - triggerPurgeSoftDeletedAssets : admin-only callable, dryRun default,
 *                                     for manual runs + verification
 *
 * Query uses only a `deletedAt` range. Collection-group queries need a
 * single-field exemption (`assets.deletedAt` ASC, COLLECTION_GROUP) — checked
 * in to firestore.indexes.json under fieldOverrides. Docs without a
 * `deletedAt` field are excluded by the orderBy. We still recheck
 * `deleted === true` before deleting as a belt-and-suspenders against any
 * future code path that sets `deletedAt` without `deleted: true`.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertAppCheck } = require('../app-check.js');
const { withJobHealth } = require('./job-health.js');
const {
  enqueueNeedleDeleteTask,
  NEEDLE_LEDGER_COLLECTION
} = require('../progressive-dispatch.js');

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const GRACE_PERIOD_DAYS = 30;
const BATCH_LIMIT = 500;

/**
 * Progressive-streaming copies (#1990) live on Needle Cloud, not in our bucket.
 * The needle-uploader worker records each one in the `needleContent/{assetId}`
 * ledger; on purge we ask the worker (the only holder of the Needle token) to
 * trash it and update the ledger with the outcome. A ledger doc that is not
 * `deleted` afterwards is the orphan list to purge by hand (needle-cloud
 * delete <needleAssetId>). Returns a summary key for the counters.
 */
async function requestNeedleDelete(db, uid, assetId, { dryRun }) {
  const ledgerRef = db.collection(NEEDLE_LEDGER_COLLECTION).doc(assetId);
  const ledgerSnap = await ledgerRef.get();
  if (!ledgerSnap.exists) return null;
  const ledger = ledgerSnap.data() || {};
  if (ledger.status === 'deleted') return 'needleAlreadyDeleted';
  if (!ledger.needleAssetId) return 'needleNoId';
  if (dryRun) {
    console.log(
      `[asset-gc] would request Needle delete of ${ledger.needleAssetId} for asset ${assetId}`
    );
    return 'needleDeleteRequested';
  }
  try {
    await enqueueNeedleDeleteTask({
      uid,
      assetId,
      needleAssetId: ledger.needleAssetId
    });
    await ledgerRef.set(
      {
        status: 'delete-requested',
        deleteRequestedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    return 'needleDeleteRequested';
  } catch (err) {
    const message = err?.message || String(err);
    console.error(
      `[asset-gc] Needle delete enqueue failed for asset ${assetId}:`,
      message
    );
    await ledgerRef.set(
      {
        status: 'orphaned',
        error: message,
        orphanedAt: admin.firestore.FieldValue.serverTimestamp()
      },
      { merge: true }
    );
    return 'needleOrphaned';
  }
}

async function deleteStorageObject(bucket, path) {
  if (!path) return { skipped: true };
  try {
    await bucket.file(path).delete();
    return { deleted: true };
  } catch (err) {
    // 404 is fine — object was already removed (manual cleanup, prior partial run).
    if (err?.code === 404) return { skipped: true, reason: 'not_found' };
    return { error: err?.message || String(err) };
  }
}

async function purgeBatch({ dryRun }) {
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  const cutoff = admin.firestore.Timestamp.fromMillis(
    Date.now() - GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000
  );

  const snap = await db
    .collectionGroup('assets')
    .where('deletedAt', '<=', cutoff)
    .orderBy('deletedAt')
    .limit(BATCH_LIMIT)
    .get();

  const summary = {
    candidates: 0,
    skippedNotDeleted: 0,
    purgedDocs: 0,
    storageDeleted: 0,
    storageSkipped: 0,
    storageErrors: 0,
    needleDeleteRequested: 0,
    needleOrphaned: 0,
    docErrors: 0,
    bytesReclaimedOriginal: 0,
    bytesReclaimedOptimized: 0,
    dryRun
  };

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    // Defensive recheck. `undeleteAsset` nulls deletedAt so restored docs
    // shouldn't appear here, but a stray deletedAt without `deleted: true`
    // should not be purged.
    if (data.deleted !== true) {
      summary.skippedNotDeleted++;
      continue;
    }
    summary.candidates++;
    const { storagePath, optimizedSourcePath, thumbnailPath } = data;
    const sizeOriginal = Number(data.size) || 0;
    const sizeOptimized = Number(data.optimizedSourceSize) || 0;
    // users/{uid}/assets/{assetId} — the owner uid is the parent user doc id.
    const ownerUid = docSnap.ref.parent.parent?.id || data.userId;

    // Off-bucket progressive copy, if any (ledger lookup; no-op for most docs).
    try {
      const needleOutcome = await requestNeedleDelete(db, ownerUid, docSnap.id, {
        dryRun
      });
      if (needleOutcome === 'needleDeleteRequested') summary.needleDeleteRequested++;
      else if (needleOutcome === 'needleOrphaned') summary.needleOrphaned++;
    } catch (err) {
      summary.needleOrphaned++;
      console.error(`[asset-gc] Needle ledger check failed for ${docSnap.id}:`, err);
    }

    if (dryRun) {
      summary.bytesReclaimedOriginal += sizeOriginal;
      summary.bytesReclaimedOptimized += sizeOptimized;
      console.log(
        `[asset-gc] would purge ${docSnap.ref.path} ` +
          `size=${sizeOriginal} optimizedSize=${sizeOptimized} ` +
          `storage=${storagePath || '-'} optimized=${optimizedSourcePath || '-'} ` +
          `thumbnail=${thumbnailPath || '-'}`
      );
      continue;
    }

    // Storage first — if a doc is deleted but blobs remain, those become
    // orphans (no doc points at them). The reverse (blobs deleted, doc kept)
    // is recoverable by re-running this job. Thumbnail is included so the
    // monthly orphan-cleanup job doesn't have to mop up after us.
    for (const path of [storagePath, optimizedSourcePath, thumbnailPath]) {
      const result = await deleteStorageObject(bucket, path);
      if (result.deleted) summary.storageDeleted++;
      else if (result.skipped) summary.storageSkipped++;
      else if (result.error) {
        summary.storageErrors++;
        console.error(`[asset-gc] storage delete failed path=${path}:`, result.error);
      }
    }

    try {
      await docSnap.ref.delete();
      summary.purgedDocs++;
      summary.bytesReclaimedOriginal += sizeOriginal;
      summary.bytesReclaimedOptimized += sizeOptimized;
    } catch (err) {
      summary.docErrors++;
      console.error(`[asset-gc] doc delete failed ${docSnap.ref.path}:`, err);
    }
  }

  return summary;
}

const purgeSoftDeletedAssets = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('0 2 * * 0')
  .timeZone('America/Los_Angeles')
  .onRun(
    withJobHealth(
      'purgeSoftDeletedAssets',
      {
        schedule: '0 2 * * 0',
        timeZone: 'America/Los_Angeles',
        expectedIntervalMs: WEEK_MS,
        degradedKeys: ['storageErrors', 'docErrors']
      },
      async () => {
        console.log('[asset-gc] starting weekly purge');
        const summary = await purgeBatch({ dryRun: false });
        console.log('[asset-gc] purge complete:', JSON.stringify(summary));
        return summary;
      }
    )
  );

const triggerPurgeSoftDeletedAssets = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
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
    const dryRun = data?.dryRun ?? true;
    console.log(`[asset-gc] manual trigger (dryRun=${dryRun})`);
    const summary = await purgeBatch({ dryRun });
    console.log('[asset-gc] manual run complete:', JSON.stringify(summary));
    return summary;
  });

module.exports = { purgeSoftDeletedAssets, triggerPurgeSoftDeletedAssets };
