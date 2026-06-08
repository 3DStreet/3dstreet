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
 * Config is resolved per-project at runtime (resolveRadConfig) from the
 * function's own GCLOUD_PROJECT, so deploying to staging vs prod automatically
 * targets that project's Cloud Run service / queue / invoker SA with no code
 * change — mirroring how replicate.js derives the webhook URL.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { CloudTasksClient } = require('@google-cloud/tasks');

// The rad-converter Cloud Run URL embeds a project-specific hash, so it can't be
// derived from the project id — keep an explicit per-project map. New
// environments can override via the RAD_CONVERTER_URL env var without a code
// change (and add their entry here once stable).
const RAD_SERVICE_URLS = {
  'dev-3dstreet': 'https://rad-converter-zz2pqvu65a-uc.a.run.app',
  'dstreet-305604': 'https://rad-converter-ybpa26dqcq-uc.a.run.app'
};

/**
 * Resolve the dispatch config for the project this function is running in.
 * Everything except the Cloud Run URL is either constant across projects or
 * convention-derived (the invoker SA always follows
 * `rad-task-invoker@<project>.iam.gserviceaccount.com`), so the only per-env
 * value that must be supplied is the service URL (map entry or env override).
 */
function resolveRadConfig() {
  const project =
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    (admin.apps.length && admin.app().options.projectId) ||
    'dev-3dstreet';
  const serviceUrl =
    process.env.RAD_CONVERTER_URL || RAD_SERVICE_URLS[project] || null;
  return {
    project,
    location: process.env.RAD_TASKS_LOCATION || 'us-central1',
    queue: process.env.RAD_TASKS_QUEUE || 'rad-convert',
    // The rad-converter Cloud Run service (private; the invoker SA has run.invoker).
    serviceUrl,
    // SA whose OIDC token the Cloud Task carries so Cloud Run accepts it.
    invokerServiceAccount:
      process.env.RAD_INVOKER_SA ||
      `rad-task-invoker@${project}.iam.gserviceaccount.com`
  };
}

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
  const config = resolveRadConfig();
  if (!config.serviceUrl) {
    // No converter URL known for this project — refuse to dispatch rather than
    // silently route the task at another environment's service.
    throw new Error(
      `[rad-dispatch] no rad-converter URL for project '${config.project}'; ` +
        'set RAD_CONVERTER_URL or add it to RAD_SERVICE_URLS'
    );
  }
  const client = getTasksClient();
  const parent = client.queuePath(
    config.project,
    config.location,
    config.queue
  );
  const payload = JSON.stringify({ uid, assetId, plyPath, jobId });
  const task = {
    httpRequest: {
      httpMethod: 'POST',
      url: config.serviceUrl,
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.from(payload).toString('base64'),
      oidcToken: {
        serviceAccountEmail: config.invokerServiceAccount,
        audience: config.serviceUrl
      }
    },
    // The conversion runs synchronously inside this POST. A large (22M-splat)
    // LOD build takes many minutes; the default 600s deadline makes Cloud Tasks
    // give up mid-build and retry (thrashing from scratch each time). Raise to
    // the Cloud Tasks maximum (1800s / 30 min). The Cloud Run service timeout
    // (rad-converter/deploy.sh) is set above this so the request isn't cut off
    // first.
    dispatchDeadline: { seconds: 1800 }
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
    // convert. Every other splat extension is dispatched to build-lod, which
    // decodes by extension (the converter preserves it). Formats build-lod can't
    // handle surface as a deterministic ConversionError and are marked 'skipped'
    // (terminal, no retry) — the asset still renders from its original source.
    if (plyPath.toLowerCase().endsWith('.rad')) {
      console.log(
        `[rad-dispatch] splat ${userId}/${assetId} uploaded as .rad; already optimized, skipping`
      );
      return null;
    }

    // Source size up front (cheap Storage metadata read) so the queued job doc
    // carries inputBytes — lets later analysis correlate convert time/cost with
    // splat size without re-reading the object. Best-effort: a metadata miss
    // must not block the conversion.
    let inputBytes = null;
    try {
      const [meta] = await admin.storage().bucket().file(plyPath).getMetadata();
      inputBytes = Number(meta.size) || null;
    } catch (err) {
      console.warn(
        `[rad-dispatch] could not read size for ${plyPath}:`,
        (err && err.message) || err
      );
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
      inputBytes, // source splat size (null if the metadata read failed)
      tokenCost: 0, // silent backend optimization — never charges the user
      tokenCharged: false,
      refunded: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      // When the Cloud Task was (last) dispatched. The reconciler measures
      // staleness from this — not createdAt — so it only re-enqueues a job whose
      // current dispatch has genuinely exceeded its deadline, never one that's
      // simply mid-conversion (which keeps status 'queued' the whole time).
      dispatchedAt: admin.firestore.FieldValue.serverTimestamp()
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

module.exports = { onSplatAssetCreated, enqueueRadTask, resolveRadConfig };
