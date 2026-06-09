/**
 * Orphaned-Storage-object cleanup.
 *
 * Finds Storage objects under `users/*\/assets/...` that no Firestore asset
 * doc references and deletes them. Sources of orphans: failed uploads (file
 * landed but doc creation never happened), buggy code paths, files from
 * before the asset system existed.
 *
 * Reference fields scanned across every asset doc (including soft-deleted —
 * those get hard-deleted by purgeSoftDeletedAssets):
 *   - storagePath
 *   - optimizedSourcePath
 *   - thumbnailPath
 *
 * Safety:
 *   - Objects newer than GRACE_HOURS are skipped to avoid racing with
 *     in-flight uploads whose Firestore doc is still pending.
 *   - dryRun defaults to true on the manual trigger.
 *
 * Cost: O(total assets) Firestore reads + O(total storage objects / 1000)
 * list operations. Both cheap; running monthly is plenty.
 *
 * Two entry points:
 *   - cleanupOrphanedStorage        : pubsub schedule, monthly (1st @ 04:00 PT)
 *   - triggerCleanupOrphanedStorage : admin-only callable, dryRun default
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { withJobHealth } = require('./job-health.js');

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;

const GRACE_HOURS = 24;
const ASSETS_PREFIX = 'users/';
const ASSETS_SUBPATH = '/assets/';

async function collectReferencedPaths() {
  const db = admin.firestore();
  const refs = new Set();
  let cursor = null;
  let scanned = 0;
  const PAGE_SIZE = 1000;

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
      for (const field of ['storagePath', 'optimizedSourcePath', 'thumbnailPath']) {
        const path = data[field];
        if (path && typeof path === 'string') refs.add(path);
      }
    }
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.size < PAGE_SIZE) break;
  }

  return { refs, scanned };
}

async function cleanup({ dryRun }) {
  const bucket = admin.storage().bucket();
  const { refs, scanned: assetsScanned } = await collectReferencedPaths();
  const cutoffMs = Date.now() - GRACE_HOURS * 60 * 60 * 1000;

  const summary = {
    assetsScanned,
    referencedPaths: refs.size,
    objectsScanned: 0,
    orphans: 0,
    skippedTooNew: 0,
    skippedOutsideAssets: 0,
    deleted: 0,
    deleteErrors: 0,
    bytesReclaimed: 0,
    samples: [],
    dryRun
  };

  let pageToken;
  do {
    const [files, , apiResponse] = await bucket.getFiles({
      prefix: ASSETS_PREFIX,
      maxResults: 1000,
      pageToken,
      autoPaginate: false
    });
    pageToken = apiResponse?.nextPageToken;

    for (const file of files) {
      summary.objectsScanned++;
      const name = file.name;

      // Defensive: only consider paths matching users/{uid}/assets/...
      if (!name.includes(ASSETS_SUBPATH)) {
        summary.skippedOutsideAssets++;
        continue;
      }
      if (refs.has(name)) continue;

      const createdMs = file.metadata?.timeCreated
        ? Date.parse(file.metadata.timeCreated)
        : 0;
      if (createdMs && createdMs > cutoffMs) {
        summary.skippedTooNew++;
        continue;
      }

      summary.orphans++;
      const sizeBytes = Number(file.metadata?.size) || 0;
      summary.bytesReclaimed += sizeBytes;
      if (summary.samples.length < 20) {
        summary.samples.push({
          name,
          sizeBytes,
          created: file.metadata?.timeCreated || null
        });
      }

      if (dryRun) {
        console.log(
          `[asset-orphan-cleanup] would delete ${name} (${sizeBytes} bytes)`
        );
        continue;
      }

      try {
        await file.delete();
        summary.deleted++;
      } catch (err) {
        summary.deleteErrors++;
        console.error(
          `[asset-orphan-cleanup] delete failed ${name}:`,
          err?.message || err
        );
      }
    }
  } while (pageToken);

  return summary;
}

const cleanupOrphanedStorage = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('0 4 1 * *') // 1st of month, 04:00 PT
  .timeZone('America/Los_Angeles')
  .onRun(
    withJobHealth(
      'cleanupOrphanedStorage',
      {
        schedule: '0 4 1 * *',
        timeZone: 'America/Los_Angeles',
        expectedIntervalMs: MONTH_MS,
        degradedKeys: ['deleteErrors']
      },
      async () => {
        console.log('[asset-orphan-cleanup] starting monthly cleanup');
        const summary = await cleanup({ dryRun: false });
        console.log(
          '[asset-orphan-cleanup] complete:',
          JSON.stringify(summary)
        );
        return summary;
      }
    )
  );

const triggerCleanupOrphanedStorage = functions
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
    console.log(`[asset-orphan-cleanup] manual trigger (dryRun=${dryRun})`);
    const summary = await cleanup({ dryRun });
    console.log(
      '[asset-orphan-cleanup] manual run complete:',
      JSON.stringify(summary)
    );
    return summary;
  });

module.exports = { cleanupOrphanedStorage, triggerCleanupOrphanedStorage };
