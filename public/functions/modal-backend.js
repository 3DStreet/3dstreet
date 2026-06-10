/**
 * Modal compute backend for vid2scene (video → Gaussian splat).
 *
 * Replicate's on-demand tier preempts long-running private jobs (~1/3 of
 * vid2scene runs observed), so vid2scene executes on Modal instead: the same
 * cog-built image, deployed as a split-shape app (SfM on T4 → training on L4,
 * ≈$0.94/default job vs $1.36 single-machine). See the vid2scene-cog repo's
 * modal_app.py for the service side of this contract.
 *
 * This module is ONLY the provider adapter. Job identity, token charge/refund,
 * the idempotent terminal processor, and the gallery save all live in
 * replicate.js and are shared across providers — a Modal job differs from a
 * Replicate job in exactly three places:
 *   submit  → POST to the Modal `enqueue` endpoint (returns a call_id we store
 *             as providerJobId) instead of replicate.predictions.create
 *   status  → GET the Modal `status` endpoint (poll + reconciler) instead of
 *             replicate.predictions.get
 *   result  → Modal uploads the .ply itself to a staging prefix IN OUR OWN
 *             BUCKET (gs://<bucket>/vid2scene-staging/<jobId>.ply), so the
 *             save is a same-bucket server-side copy (metadata-only, instant)
 *             instead of streaming a download from a provider CDN.
 *
 * Config (Secret Manager, per Firebase project — this is what makes dev/prod
 * split automatic):
 *   MODAL_ENQUEUE_URL     e.g. https://3dstreet-dev--vid2scene-enqueue.modal.run
 *                         (the status URL is derived: -enqueue. → -status.)
 *   MODAL_ENQUEUE_SECRET  shared token; sent as `secret` in the enqueue body
 *                         and as ?secret= on status GETs
 * The Modal side reads its own copy of these from the `vid2scene-io` secret in
 * the matching Modal environment (dev ↔ dev-3dstreet, main ↔ prod).
 */

const MODAL_SECRETS = ['MODAL_ENQUEUE_URL', 'MODAL_ENQUEUE_SECRET'];

// Where the Modal app stages finished .ply files in our default bucket. MUST
// match GCS_PREFIX in the Modal environment's `vid2scene-io` secret. Objects
// are named <prefix>/<jobId>.ply — deterministic, because we pass our own
// jobId as the Modal job_id at enqueue.
const MODAL_STAGING_PREFIX = 'vid2scene-staging';

function modalConfigured() {
  return Boolean(process.env.MODAL_ENQUEUE_URL && process.env.MODAL_ENQUEUE_SECRET);
}

function modalStatusUrl() {
  // Modal web endpoints are named <workspace>[-env]--<app>-<function>.modal.run,
  // so the status endpoint differs from enqueue only in the function label.
  return process.env.MODAL_ENQUEUE_URL.replace('-enqueue.', '-status.');
}

function stagingPathForJob(jobId) {
  return `${MODAL_STAGING_PREFIX}/${jobId}.ply`;
}

// Submit a vid2scene job. Fire-and-forget on the Modal side: returns the
// call_id (stored as the job's providerJobId) immediately; completion arrives
// via our webhook + the pollable status endpoint. The Modal endpoints scale to
// zero, so a cold start can take a while — callers need timeoutSeconds
// headroom beyond the default 60s.
async function enqueueModalJob({ videoUrl, jobId, webhookUrl }) {
  if (!modalConfigured()) {
    throw new Error('Modal backend is not configured (MODAL_ENQUEUE_URL / MODAL_ENQUEUE_SECRET).');
  }
  const response = await fetch(process.env.MODAL_ENQUEUE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_url: videoUrl,
      job_id: jobId,
      secret: process.env.MODAL_ENQUEUE_SECRET,
      webhook_url: webhookUrl
      // Quality knobs (target_framecount / training_num_steps /
      // training_max_num_gaussians / resolution) ride here once pricing tiers
      // land; defaults = the calibrated "default preset".
    }),
    signal: AbortSignal.timeout(240000) // cold start can exceed 2 min
  });
  if (!response.ok) {
    throw new Error(`Modal enqueue failed: HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body.error || !body.call_id) {
    throw new Error(`Modal enqueue rejected: ${body.error || 'no call_id returned'}`);
  }
  return body.call_id;
}

// Fetch a Modal job's authoritative state, shaped like a Replicate prediction
// ({status, output, error}) so the shared idempotent processor
// (processTerminalPrediction) and the reconciler can consume it unchanged.
// Mirrors fetchProviderPrediction's contract: { prediction } or { absent }.
//
// Success is ultimately proven by the staged .ply existing in our own bucket —
// only the Modal service account can write there. That existence check also
// closes a timing gap: Modal posts the success webhook from inside the
// training container moments BEFORE the coordinator function returns, so the
// status endpoint can still say "running" when the webhook arrives.
async function fetchModalPrediction(admin, job, jobId) {
  const stagingPath = stagingPathForJob(jobId);
  const gcsUri = `gs://${admin.storage().bucket().name}/${stagingPath}`;

  let status = null;
  let error = null;
  if (job.providerJobId && modalConfigured()) {
    try {
      const url = `${modalStatusUrl()}?call_id=${encodeURIComponent(job.providerJobId)}` +
        `&secret=${encodeURIComponent(process.env.MODAL_ENQUEUE_SECRET)}`;
      const response = await fetch(url, { signal: AbortSignal.timeout(240000) });
      if (response.ok) {
        const body = await response.json();
        status = body.status || null;
        error = body.error || null;
      }
    } catch (e) {
      // Transient (cold start timeout, network) — fall through to the
      // existence check; a still-unknown status just reports "running".
      console.warn(`Modal status fetch failed for ${jobId}:`, e.message);
    }
  }

  if (status === 'succeeded') {
    return { prediction: { id: job.providerJobId, status: 'succeeded', output: gcsUri } };
  }
  if (status === 'failed') {
    // Drop noisy infra wrappers (e.g. Modal exception-serialization artifacts)
    // down to the underlying message where recognizable.
    const cleaned = (error || '').replace(/^Failed to serialize exception /, '');
    return { prediction: { id: job.providerJobId, status: 'failed', error: cleaned || 'Modal job failed.' } };
  }
  if (status === 'expired') {
    // Result retention (~7 days) lapsed — the reconciler's give-up windows
    // fire orders of magnitude earlier, so treat like a provider 404.
    return { absent: true };
  }

  // running / unknown → check for the staged result directly.
  const [exists] = await admin.storage().bucket().file(stagingPath).exists();
  if (exists) {
    return { prediction: { id: job.providerJobId || jobId, status: 'succeeded', output: gcsUri } };
  }
  return { prediction: { id: job.providerJobId || jobId, status: 'processing' } };
}

module.exports = {
  MODAL_SECRETS,
  MODAL_STAGING_PREFIX,
  modalConfigured,
  enqueueModalJob,
  fetchModalPrediction,
  stagingPathForJob
};
