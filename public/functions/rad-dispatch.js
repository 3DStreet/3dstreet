/**
 * RAD conversion dispatch — the automatic path that turns a new splat into a
 * Spark RAD (LOD) "optimized" variant, with no manual POST.
 *
 *   splat asset doc created
 *     └─ onSplatAssetCreated (this file)
 *          ├─ writes a generationJobs doc {provider:'cloudrun', kind:'splat-rad'}
 *          └─ enqueues a Cloud Task (OIDC) → POSTs the rad-converter Cloud Run
 *             service, which converts, patches optimizedSource* on the asset,
 *             and writes the job's terminal status.
 *
 * One trigger covers BOTH splat origins (drag-upload and generator
 * saveSplatToGallery) — both create the asset doc without an optimized variant.
 *
 * RAD is a silent backend optimization (the splat analog of the GLB optimized
 * variant), so the job carries tokenCost:0 — it never charges the user.
 *
 * The enqueue helper is exported so the reconciler can re-enqueue a wedged job.
 *
 * NOTE: config below is hardcoded to the dev project (dev-3dstreet). When this
 * goes to prod, lift these into env/functions-params (per-project service URL,
 * queue, invoker SA).
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { CloudTasksClient } = require('@google-cloud/tasks');

// --- dev-3dstreet constants (hardcoded for now) ----------------------------
const RAD_CONFIG = {
  project: 'dev-3dstreet',
  location: 'us-central1',
  queue: 'rad-convert',
  // The rad-converter Cloud Run service (private; the invoker SA has run.invoker).
  serviceUrl: 'https://rad-converter-zz2pqvu65a-uc.a.run.app',
  // SA whose OIDC token the Cloud Task carries so Cloud Run accepts it.
  invokerServiceAccount: 'rad-task-invoker@dev-3dstreet.iam.gserviceaccount.com'
};

let tasksClient = null;
function getTasksClient() {
  if (!tasksClient) tasksClient = new CloudTasksClient();
  return tasksClient;
}

/**
 * Enqueue a durable Cloud Task that POSTs the rad-converter service. The task
 * carries an OIDC token for the invoker SA (audience = the service URL) so the
 * private service accepts it. Idempotent at the worker: a duplicate task just
 * re-converts and overwrites the same -lod.rad / re-patches the same doc.
 */
async function enqueueRadTask({ uid, assetId, plyPath, jobId }) {
  const client = getTasksClient();
  const parent = client.queuePath(
    RAD_CONFIG.project,
    RAD_CONFIG.location,
    RAD_CONFIG.queue
  );
  const payload = JSON.stringify({ uid, assetId, plyPath, jobId });
  const task = {
    httpRequest: {
      httpMethod: 'POST',
      url: RAD_CONFIG.serviceUrl,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(payload).toString('base64'),
      oidcToken: {
        serviceAccountEmail: RAD_CONFIG.invokerServiceAccount,
        audience: RAD_CONFIG.serviceUrl
      }
    }
  };
  const [created] = await client.createTask({ parent, task });
  return created.name;
}

/**
 * Firestore trigger: on a new splat asset doc, queue a RAD conversion.
 * Path: users/{userId}/assets/{assetId}
 *
 * Guard: type==='splat' && no optimizedSourceUrl yet && has a source path.
 * Mirrors onAssetWritten's path/shape in asset-quota.js.
 */
const onSplatAssetCreated = functions.firestore
  .document('users/{userId}/assets/{assetId}')
  .onCreate(async (snap, context) => {
    const { userId, assetId } = context.params;
    const asset = snap.data() || {};

    if (asset.type !== 'splat') return null;
    if (asset.optimizedSourceUrl) return null; // already has a RAD variant
    const plyPath = asset.storagePath;
    if (!plyPath) {
      console.warn(
        `[rad-dispatch] splat ${userId}/${assetId} has no storagePath; skipping`
      );
      return null;
    }
    // A user-uploaded .rad is already the streaming-optimized form — the
    // renderer serves storageUrl and streams it paged — so there's nothing to
    // convert. (build-lod also accepts .ply/.splat/.spz/.ksplat/.sog and
    // content-sniffs the input, so every other splat upload converts fine.)
    if (plyPath.toLowerCase().endsWith('.rad')) {
      console.log(
        `[rad-dispatch] splat ${userId}/${assetId} uploaded as .rad; already optimized, skipping`
      );
      return null;
    }

    const db = admin.firestore();
    const jobId = crypto.randomUUID();
    const jobRef = db
      .collection('users').doc(userId)
      .collection('generationJobs').doc(jobId);

    // Write the queued job BEFORE enqueueing — a crash mid-enqueue leaves a
    // visible, reconcilable job rather than silently dropping the conversion.
    // Normalized status vocab matches the Replicate jobs so the reconciler's
    // "non-terminal" collectionGroup query stays provider-agnostic.
    await jobRef.set({
      status: 'queued',
      providerStatus: null,
      kind: 'splat-rad',
      provider: 'cloudrun',
      providerJobId: null, // cloudrun has none — the worker owns writeback
      assetId,
      plyPath,
      tokenCost: 0, // silent backend optimization — never charges the user
      tokenCharged: false,
      refunded: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    try {
      const taskName = await enqueueRadTask({ uid: userId, assetId, plyPath, jobId });
      console.log(
        `[rad-dispatch] queued RAD job ${jobId} for splat ${assetId} → ${taskName}`
      );
    } catch (err) {
      // Leave the job 'queued' so the reconciler re-enqueues it; just record why.
      console.error(`[rad-dispatch] enqueue failed for ${assetId}:`, err);
      await jobRef.update({ enqueueError: String((err && err.message) || err) });
    }

    return null;
  });

module.exports = { onSplatAssetCreated, enqueueRadTask, RAD_CONFIG };
