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

const GRACE_PERIOD_DAYS = 30;
const BATCH_LIMIT = 500;

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
  .onRun(async () => {
    console.log('[asset-gc] starting weekly purge');
    const summary = await purgeBatch({ dryRun: false });
    console.log('[asset-gc] purge complete:', JSON.stringify(summary));
    return summary;
  });

const triggerPurgeSoftDeletedAssets = functions
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
    console.log(`[asset-gc] manual trigger (dryRun=${dryRun})`);
    const summary = await purgeBatch({ dryRun });
    console.log('[asset-gc] manual run complete:', JSON.stringify(summary));
    return summary;
  });

module.exports = { purgeSoftDeletedAssets, triggerPurgeSoftDeletedAssets };
