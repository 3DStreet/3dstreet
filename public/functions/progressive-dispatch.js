/**
 * Progressive GLB dispatch (#1990) — the MANUAL path that turns a user's GLB
 * into a Needle Cloud progressive-streaming "optimized" variant.
 *
 *   owner presses "Make streamable" in the asset details modal
 *     └─ requestProgressiveGlb callable (this file)
 *          ├─ validates the asset (owner, mesh, has a source, not private/deleted)
 *          ├─ writes a generationJobs doc {provider:'cloudrun', kind:'glb-progressive'}
 *          └─ enqueues a Cloud Task (OIDC) → POSTs the needle-uploader Cloud Run
 *             service, which runs the needle-cloud CLI, patches optimizedSource*
 *             on the asset, records the Needle content id in the needleContent
 *             ledger and writes the job's terminal status.
 *
 * Deliberately NOT an onCreate trigger: the first release is opt-in per asset
 * (Needle processing is metered, the output lives on a third-party public CDN,
 * and the size threshold for doing it automatically is still an open
 * question). An automatic path can reuse createProgressiveJob() unchanged.
 *
 * Like RAD, this is a silent backend optimization of an asset that already
 * exists, so the job carries tokenCost:0 — it never charges the user.
 *
 * The enqueue helpers are exported so the reconciler can re-enqueue a wedged
 * job and the asset GC can ask the worker to delete the Needle copy of a
 * purged asset (the worker is the only place that holds the Needle token).
 *
 * Config is resolved per-project at runtime (resolveProgressiveConfig) from the
 * function's own GCLOUD_PROJECT, mirroring rad-dispatch.js.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { CloudTasksClient } = require('@google-cloud/tasks');
const { assertAppCheck } = require('./app-check.js');
const {
  PROGRESSIVE_JOB_KIND,
  NEEDLE_LEDGER_COLLECTION,
  progressiveRefusalReason,
  findActiveProgressiveJob
} = require('./progressive-rules.js');

// The needle-uploader Cloud Run URL embeds a project-specific hash, so it can't
// be derived from the project id — keep an explicit per-project map. New
// environments can override via NEEDLE_UPLOADER_URL without a code change (and
// add their entry here once stable). Empty until the service is deployed.
const PROGRESSIVE_SERVICE_URLS = {
  'dev-3dstreet': null,
  'dstreet-305604': null
};

function resolveProgressiveConfig() {
  const project =
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    (admin.apps.length && admin.app().options.projectId) ||
    'dev-3dstreet';
  const serviceUrl =
    process.env.NEEDLE_UPLOADER_URL || PROGRESSIVE_SERVICE_URLS[project] || null;
  return {
    project,
    location: process.env.PROGRESSIVE_TASKS_LOCATION || 'us-central1',
    queue: process.env.PROGRESSIVE_TASKS_QUEUE || 'glb-progressive',
    serviceUrl,
    // Same invoker SA as the RAD pipeline by default: one SA with run.invoker
    // on both private services keeps the IAM surface small.
    invokerServiceAccount:
      process.env.PROGRESSIVE_INVOKER_SA ||
      process.env.RAD_INVOKER_SA ||
      `rad-task-invoker@${project}.iam.gserviceaccount.com`
  };
}

let tasksClient = null;
function getTasksClient() {
  if (!tasksClient) tasksClient = new CloudTasksClient();
  return tasksClient;
}

async function enqueueWorkerTask(payload) {
  const config = resolveProgressiveConfig();
  if (!config.serviceUrl) {
    throw new Error(
      `[progressive-dispatch] no needle-uploader URL for project '${config.project}'; ` +
        'set NEEDLE_UPLOADER_URL or add it to PROGRESSIVE_SERVICE_URLS'
    );
  }
  const client = getTasksClient();
  const parent = client.queuePath(config.project, config.location, config.queue);
  const task = {
    httpRequest: {
      httpMethod: 'POST',
      url: config.serviceUrl,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(JSON.stringify(payload)).toString('base64'),
      oidcToken: {
        serviceAccountEmail: config.invokerServiceAccount,
        audience: config.serviceUrl
      }
    },
    // The upload + Needle processing runs synchronously inside this POST. The
    // 76 MB spike file took ~2 min end to end; give a 1 GB upload room and let
    // the Cloud Run timeout (needle-uploader/deploy.sh) sit above this.
    dispatchDeadline: { seconds: 1800 }
  };
  const [created] = await client.createTask({ parent, task });
  return created.name;
}

/**
 * Enqueue the optimize task for one asset. Idempotent at the worker: a
 * duplicate re-runs `needle-cloud optimize --name <assetId>`, which updates the
 * same Needle content item, and re-patches the same doc.
 */
function enqueueProgressiveTask({ uid, assetId, storagePath, jobId }) {
  return enqueueWorkerTask({
    action: 'optimize',
    uid,
    assetId,
    storagePath,
    jobId
  });
}

/**
 * Ask the worker to move a Needle content item to the trash (asset GC path).
 * The worker updates the needleContent ledger doc with the outcome.
 */
function enqueueNeedleDeleteTask({ uid, assetId, needleAssetId }) {
  return enqueueWorkerTask({ action: 'delete', uid, assetId, needleAssetId });
}

const ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * Write the queued job doc and enqueue the worker task. Shared by the manual
 * callable and any future automatic trigger. Writes the job BEFORE enqueueing
 * — a crash mid-enqueue leaves a visible, reconcilable job rather than a
 * silently dropped request. Returns the jobId.
 */
async function createProgressiveJob({ uid, assetId, asset, requestedBy }) {
  const db = admin.firestore();
  const jobId = crypto.randomUUID();
  const jobRef = db
    .collection('users')
    .doc(uid)
    .collection('generationJobs')
    .doc(jobId);
  const storagePath = asset.storagePath;

  await jobRef.set({
    status: 'queued',
    providerStatus: null,
    kind: PROGRESSIVE_JOB_KIND,
    provider: 'cloudrun',
    providerJobId: null, // cloudrun has none — the worker owns writeback
    assetId,
    storagePath,
    // Source size from the doc (immutable after create per firestore.rules).
    inputBytes: Number(asset.size) || null,
    requestedBy: requestedBy || 'user',
    tokenCost: 0, // silent backend optimization — never charges the user
    tokenCharged: false,
    refunded: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    // The reconciler measures staleness from this, not createdAt (see
    // rad-dispatch.js for why).
    dispatchedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  try {
    const taskName = await enqueueProgressiveTask({
      uid,
      assetId,
      storagePath,
      jobId
    });
    console.log(
      `[progressive-dispatch] queued job ${jobId} for mesh ${assetId} → ${taskName}`
    );
  } catch (err) {
    // Leave the job 'queued' so the reconciler re-enqueues it; just record why.
    console.error(`[progressive-dispatch] enqueue failed for ${assetId}:`, err);
    await jobRef.update({ enqueueError: String((err && err.message) || err) });
  }
  return jobId;
}

/**
 * Callable: owner-triggered progressive processing of one GLB asset.
 * Input:  { assetId }
 * Output: { jobId, existing: boolean }  — `existing` when a non-terminal job
 *         for this asset was already queued (no duplicate is created).
 */
const requestProgressiveGlb = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'User must be authenticated.'
    );
  }
  assertAppCheck(context);
  const uid = context.auth.uid;
  const assetId = typeof data?.assetId === 'string' ? data.assetId : '';
  if (!ID_RE.test(assetId)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid assetId.');
  }

  const db = admin.firestore();
  const userRef = db.collection('users').doc(uid);
  const snap = await userRef.collection('assets').doc(assetId).get();
  const asset = snap.exists ? snap.data() : null;
  const refusal = progressiveRefusalReason(asset);
  if (refusal === 'not_found') {
    throw new functions.https.HttpsError('not-found', 'Asset not found.');
  }
  if (refusal) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Asset cannot be processed: ${refusal}`,
      { reason: refusal }
    );
  }

  // One live job per asset. Single-field query (auto-indexed); the kind and
  // status filters run in memory because an asset only ever has a few jobs.
  const jobsSnap = await userRef
    .collection('generationJobs')
    .where('assetId', '==', assetId)
    .get();
  const existing = findActiveProgressiveJob(
    jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  );
  if (existing) return { jobId: existing.id, existing: true };

  const jobId = await createProgressiveJob({
    uid,
    assetId,
    asset,
    requestedBy: 'user'
  });
  return { jobId, existing: false };
});

module.exports = {
  PROGRESSIVE_JOB_KIND,
  NEEDLE_LEDGER_COLLECTION,
  requestProgressiveGlb,
  createProgressiveJob,
  enqueueProgressiveTask,
  enqueueNeedleDeleteTask,
  progressiveRefusalReason,
  resolveProgressiveConfig
};
