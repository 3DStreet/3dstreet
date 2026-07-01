/**
 * Generation job reconciliation — the dropped-webhook backstop.
 *
 * Async AI generations (image → splat today) complete via three convergent,
 * idempotent paths: the Replicate webhook, the client poll, and this scheduled
 * sweep. The webhook + poll cover the common cases, but if the webhook is never
 * delivered *and* the user has closed the tab, nothing finishes the job — the
 * token stays charged and the result is never saved. This job closes that gap,
 * and also re-triggers jobs wedged in `saving` (a save that crashed mid-flight
 * left a stale claim; the TTL in processTerminalPrediction makes it re-takeable,
 * but something still has to call the processor — that's us).
 *
 * It runs the SAME idempotent processor as the webhook/poll
 * (processTerminalPrediction), so it can't double-save or double-charge even if
 * it races a live webhook. To avoid needless churn it ignores very fresh jobs
 * (RACE_GUARD_MS) where a webhook/poll is still the expected finisher.
 *
 * Provider dispatch is a `switch (job.provider)` — Replicate-only today. This is
 * the seam that becomes a real registry when fal / Teleport land.
 *
 * Two entry points:
 *   - reconcileGenerationJobs        : pubsub schedule, every 10 min
 *   - triggerReconcileGenerationJobs : admin-only callable, dryRun default
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertAppCheck } = require('../app-check.js');
const Replicate = require('replicate');

const {
  processTerminalPrediction,
  refundSplatToken,
  cleanupSplatTempFile
} = require('../replicate.js');
const {
  MODAL_SECRETS,
  fetchModalPrediction,
  modalEndpointHealthy,
  stagingPathForJob
} = require('../modal-backend.js');
const { enqueueRadTask } = require('../rad-dispatch.js');
const { withJobHealth } = require('./job-health.js');

const TEN_MIN_MS = 10 * 60 * 1000;
const { sendGenerationReadyEmail } = require('./scheduledEmails.js');

// Our normalized non-terminal vocabulary (see normalizeReplicateStatus). The
// reconciler only ever touches jobs in these states; everything else is done.
// `saving` is included on purpose: a crashed save leaves a stale claim that the
// TTL makes re-takeable, but only a call to the processor actually re-takes it.
const NON_TERMINAL = ['queued', 'running', 'saving'];

// Don't touch jobs younger than this — a webhook or live client poll is still
// the expected finisher, and racing them just wastes a provider fetch. Matches
// the SAVING_CLAIM_TTL window so we never fight an in-flight save.
const RACE_GUARD_MS = 3 * 60 * 1000;

// Past this age, a job that the provider also reports as failed/absent is
// declared dead: mark failed and refund once. We deliberately do NOT give up on
// a job the provider still reports as running — SHARP cold-boots can be slow.
const GIVE_UP_MS = 30 * 60 * 1000;

// Absolute backstop, independent of what the provider reports. A charged job
// that has stayed non-terminal this long is declared dead and refunded
// regardless of provider status. This is the safety net for wedges the provider
// can't surface — most importantly a prediction that SUCCEEDED but whose save
// deterministically fails (expired output URL, rejected Storage write), which
// otherwise loops in 'running' forever with the token charged and never
// refunded. Sized far past any real SHARP generation (cold-boots are minutes,
// not an hour), so it never kills a legitimately-running job; it only bounds how
// long a genuine wedge can hold a user's token.
const ABSOLUTE_GIVE_UP_MS = 60 * 60 * 1000;

// Modal (vid2scene) jobs legitimately run ~45 min at the DEFAULT preset, and
// longer with bigger presets, Modal capacity waits, or a worker-preemption
// restart — a live dev run hit all three and crossed 60 min while training
// was still (correctly) burning GPU. Killing+refunding such a job hands the
// user a refund AND a wasted compute bill, and the late success is then
// refused resurrection by design. Modal's own coordinator timeout (2× the 2 h
// stage cap) terminates a genuinely wedged job, so the absolute ceiling here
// only needs to bound the save-wedge case: 3 h clears every preset with room
// for one full restart.
const MODAL_ABSOLUTE_GIVE_UP_MS = 3 * 60 * 60 * 1000;

function absoluteGiveUpMs(job) {
  return job.provider === 'modal' ? MODAL_ABSOLUTE_GIVE_UP_MS : ABSOLUTE_GIVE_UP_MS;
}

// cloudrun (RAD) jobs have no provider to poll, so age alone can't tell
// "mid-conversion" from "wedged". The worker flips status→'running' with a
// startedAt heartbeat the moment it begins (rad-converter writeJobStatus); an
// actively-running job is left alone (see CLOUDRUN_RUNNING_STALL_MS). For jobs
// that never reported 'running' (the task was dropped before the worker booted),
// we re-enqueue once the CURRENT dispatch (job.dispatchedAt) has been silent
// longer than one full Cloud Tasks deadline (1800s) — otherwise a still-pending
// dispatch would get a duplicate concurrent conversion every sweep.
const CLOUDRUN_REENQUEUE_MS = 35 * 60 * 1000;
// A job the worker reported 'running' is genuinely converting — a large splat
// can legitimately run for many minutes, and dispatchedAt is NOT refreshed
// during the run. Only treat 'running' as wedged once startedAt is older than
// the worker's own max request lifetime (Cloud Run --timeout=3600s), past which
// the request would have been killed and the job is truly dead.
const CLOUDRUN_RUNNING_STALL_MS = 65 * 60 * 1000;
// Total-age ceiling before a RAD job is declared dead — roomy enough for Cloud
// Tasks' own retries (maxAttempts=3) plus a reconciler re-enqueue.
const CLOUDRUN_GIVE_UP_MS = 2 * 60 * 60 * 1000;

// Non-terminal backlog size that flips the health page to yellow. A flood of
// uploads spawning hundreds of concurrent conversions is the failure mode we
// want to see BEFORE it shows up on the bill.
const QUEUE_DEPTH_WARN = 100;

// Safety cap so a pathological backlog can't blow the function's time budget in
// one run; the next scheduled tick picks up the remainder.
const MAX_JOBS_PER_RUN = 200;

// Grace after completion before we email. If the tab was open, a live poll acks
// the result within a few seconds (clientAckedAt) and we suppress; this window
// just keeps us from racing that ack. So the email effectively means "finished
// AND the user wasn't watching."
const NOTIFY_GRACE_MS = 3 * 60 * 1000;

function ageMs(createdAt) {
  const ms = createdAt && createdAt.toMillis ? createdAt.toMillis() : 0;
  return ms ? Date.now() - ms : Infinity; // missing timestamp → treat as old
}

// Fetch a provider's authoritative prediction state. Returns { prediction } on
// success, or { absent: true } if the provider no longer knows the job (404 /
// expired). This switch is the provider registry seam.
async function fetchProviderPrediction(job, replicate, jobId) {
  switch (job.provider) {
    case 'replicate': {
      try {
        const prediction = await replicate.predictions.get(job.providerJobId);
        return { prediction };
      } catch (error) {
        if (error?.response?.status === 404) return { absent: true };
        throw error;
      }
    }
    case 'modal':
      // Returns a Replicate-shaped prediction synthesized from the Modal
      // status endpoint + a staged-.ply existence check in our own bucket.
      return fetchModalPrediction(admin, job, jobId);
    default:
      throw new Error(`Unknown provider: ${job.provider}`);
  }
}

// Declare a job dead: refund once (guarded by the job's `refunded` flag), clean
// up any staged input, and mark it failed. Mirrors the failure path in
// processTerminalPrediction so behavior is identical regardless of who notices.
async function failJob(db, uid, jobRef, job, reason) {
  const remainingTokens = await refundSplatToken(db, uid, jobRef, job);
  await cleanupSplatTempFile(job.tempFilePath);
  // A killed modal job may still produce a late result into the staging
  // prefix (or already have one nobody will consume) — without this it sits
  // there forever, since the success path's cleanup only runs on a save.
  if (job.provider === 'modal') {
    await admin
      .storage()
      .bucket()
      .file(stagingPathForJob(jobRef.id))
      .delete()
      .catch(() => {});
  }
  await jobRef.update({
    status: 'failed',
    error: reason,
    // The reconciler killed this job (gave-up / stall ceiling), as opposed to the
    // worker reporting its own failure. Keep them distinguishable for later
    // analysis: worker-failed jobs have no terminatedBy.
    terminatedBy: 'reconciler',
    reconciledAt: admin.firestore.FieldValue.serverTimestamp(),
    completedAt: admin.firestore.FieldValue.serverTimestamp()
  });
  return remainingTokens;
}

async function reconcile({ dryRun }) {
  const db = admin.firestore();
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
    useFileOutput: false
  });

  const snap = await db
    .collectionGroup('generationJobs')
    .where('status', 'in', NON_TERMINAL)
    .limit(MAX_JOBS_PER_RUN)
    .get();

  // Total non-terminal backlog (not just this run's capped slice) so the health
  // page can see a runaway queue. queueBacklog is 0 when healthy and positive
  // past the warn line, so it drops straight into degradedKeys (deriveStatus
  // flags any value > 0). Best-effort: a failed count must not abort the sweep.
  let queueDepth = snap.size;
  try {
    const countSnap = await db
      .collectionGroup('generationJobs')
      .where('status', 'in', NON_TERMINAL)
      .count()
      .get();
    queueDepth = countSnap.data().count;
  } catch (err) {
    console.warn(
      '[generation-job-reconcile] queue-depth count failed:',
      (err && err.message) || err
    );
  }

  // Direct Modal control-plane liveness: without this, an outage only shows
  // indirectly (backlog/give-up counts) once the give-up windows elapse.
  // 1 = down → degraded key flips the health entry yellow immediately.
  const modalEndpointDown = (await modalEndpointHealthy()) ? 0 : 1;

  const summary = {
    scanned: snap.size,
    queueDepth,
    queueBacklog: Math.max(0, queueDepth - QUEUE_DEPTH_WARN),
    modalEndpointDown,
    tooFresh: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    refunded: 0,
    gaveUp: 0,
    reEnqueued: 0,
    stillRunning: 0,
    errored: 0,
    samples: [],
    dryRun
  };

  for (const docSnap of snap.docs) {
    const job = docSnap.data();
    const jobRef = docSnap.ref;
    // Path: users/{uid}/generationJobs/{jobId}
    const uid = jobRef.parent.parent?.id;
    if (!uid) continue;

    const age = ageMs(job.createdAt);
    if (age < RACE_GUARD_MS) {
      summary.tooFresh++;
      continue;
    }

    const sample = {
      uid,
      jobId: jobRef.id,
      status: job.status,
      provider: job.provider,
      ageMin: Math.round(age / 60000)
    };

    try {
      // cloudrun (splat-rad): the worker owns writeback, so there's no external
      // prediction to poll. The worker flips status→'running' with a startedAt
      // heartbeat when it begins, so we can distinguish "actively converting"
      // (leave alone) from "task dropped / worker died" (re-enqueue). Re-enqueuing
      // a job that's simply still running spawns a duplicate concurrent conversion
      // — wasteful on exactly the heaviest jobs. The worker is idempotent, so a
      // real re-enqueue just overwrites the same -lod.rad. tokenCost is 0, so
      // failJob's refund is a no-op.
      if (job.provider === 'cloudrun') {
        const sinceDispatch = ageMs(job.dispatchedAt || job.createdAt);
        sample.sinceDispatchMin = Math.round(sinceDispatch / 60000);
        // Honor the worker's heartbeat: a job it reported 'running' recently is
        // mid-conversion, not wedged. dispatchedAt isn't refreshed during the
        // run, so this is the ONLY signal that separates a slow-but-healthy
        // conversion from a dropped task once dispatchedAt ages out.
        const activelyRunning =
          job.status === 'running' &&
          ageMs(job.startedAt) < CLOUDRUN_RUNNING_STALL_MS;
        if (age > CLOUDRUN_GIVE_UP_MS) {
          sample.action = 'gave-up-cloudrun';
          summary.gaveUp++;
          if (!dryRun) {
            await failJob(db, uid, jobRef, job, 'RAD conversion did not complete in time.');
          }
        } else if (!job.plyPath) {
          // Nothing to retry with — treat as dead immediately.
          sample.action = 'gave-up-cloudrun-no-plyPath';
          summary.gaveUp++;
          if (!dryRun) {
            await failJob(db, uid, jobRef, job, 'RAD job missing plyPath.');
          }
        } else if (activelyRunning) {
          // Worker is converting right now — don't spawn a duplicate.
          sample.action = 'cloudrun-running';
          summary.stillRunning++;
        } else if (sinceDispatch > CLOUDRUN_REENQUEUE_MS) {
          sample.action = 're-enqueued-cloudrun';
          summary.reEnqueued++;
          if (!dryRun) {
            await enqueueRadTask({
              uid,
              assetId: job.assetId,
              plyPath: job.plyPath,
              jobId: jobRef.id
            });
            // Reset the dispatch clock so the next sweep measures from THIS
            // re-enqueue, not the original — no duplicate-per-sweep spiral.
            await jobRef.update({
              dispatchedAt: admin.firestore.FieldValue.serverTimestamp()
            });
          }
        } else {
          // Within the current dispatch's window — presumed mid-conversion.
          sample.action = 'cloudrun-in-flight';
          summary.stillRunning++;
        }
        if (summary.samples.length < 25) summary.samples.push(sample);
        continue;
      }

      // Never submitted a provider job (crashed mid-submit). If it's been stuck
      // this long it's not coming back. tokenCharged is almost certainly false
      // here, so the refund is a no-op, but we run it for safety.
      if (!job.providerJobId) {
        if (age > GIVE_UP_MS) {
          sample.action = 'gave-up-no-provider-id';
          summary.gaveUp++;
          if (!dryRun) {
            const rt = await failJob(
              db,
              uid,
              jobRef,
              job,
              'Never submitted to provider.'
            );
            if (typeof rt !== 'undefined') summary.refunded++;
          }
        } else {
          sample.action = 'skip-no-provider-id';
        }
        if (summary.samples.length < 25) summary.samples.push(sample);
        continue;
      }

      // Absolute backstop: a charged job stuck non-terminal past the ceiling
      // (provider-aware — see MODAL_ABSOLUTE_GIVE_UP_MS) is refunded and failed
      // without consulting the provider. Catches the wedge the per-status
      // give-up rules miss — a provider-'succeeded' job whose save keeps
      // throwing resets itself to 'running' every sweep and would otherwise
      // never refund.
      if (age > absoluteGiveUpMs(job)) {
        sample.action = 'gave-up-absolute';
        summary.gaveUp++;
        if (!dryRun) {
          const rt = await failJob(
            db,
            uid,
            jobRef,
            job,
            'Job did not reach a terminal state in time.'
          );
          if (typeof rt !== 'undefined') summary.refunded++;
        }
        if (summary.samples.length < 25) summary.samples.push(sample);
        continue;
      }

      const { prediction, absent } = await fetchProviderPrediction(
        job,
        replicate,
        jobRef.id
      );

      // Provider has no record of it anymore — only give up once it's old.
      if (absent) {
        if (age > GIVE_UP_MS) {
          sample.action = 'gave-up-provider-absent';
          summary.gaveUp++;
          if (!dryRun) {
            const rt = await failJob(
              db,
              uid,
              jobRef,
              job,
              'Provider no longer has this job.'
            );
            if (typeof rt !== 'undefined') summary.refunded++;
          }
        } else {
          sample.action = 'skip-provider-absent';
        }
        if (summary.samples.length < 25) summary.samples.push(sample);
        continue;
      }

      sample.providerStatus = prediction.status;

      if (dryRun) {
        sample.action = `would-process (${prediction.status})`;
        if (summary.samples.length < 25) summary.samples.push(sample);
        continue;
      }

      // Run the shared idempotent processor — saves on success (claim-guarded),
      // refunds once on failure, or just refreshes status if still running.
      const result = await processTerminalPrediction(
        db,
        uid,
        jobRef,
        prediction
      );
      summary.processed++;
      sample.action = `processed → ${result.status}`;
      if (result.status === 'succeeded') summary.succeeded++;
      else if (result.status === 'failed' || result.status === 'canceled') {
        summary.failed++;
        if (typeof result.remainingTokens !== 'undefined') summary.refunded++;
      } else {
        summary.stillRunning++;
        // Provider still working but past the give-up window with no terminal in
        // sight: leave it — only failed/absent providers trigger give-up.
      }
    } catch (error) {
      console.error(
        `[generation-job-reconcile] error on uid=${uid} job=${jobRef.id}:`,
        error
      );
      summary.errored++;
      sample.action = `error: ${error.message}`;
    }
    if (summary.samples.length < 25) summary.samples.push(sample);
  }

  return summary;
}

// Completion-email sweep — the BACKSTOP for the real-time completion email.
// The Replicate webhook now sends the email the instant a job finishes (see
// sendGenerationReadyEmail, called from the webhook), so the happy path no
// longer waits on this 10-min sweep. This sweep only catches jobs the webhook
// missed: a dropped webhook where the user also closed the tab (no client ack),
// or a transient send failure that restored `notify.pending`. It queries
// opted-in, succeeded, still-pending jobs and delegates each to the shared,
// idempotent send helper — so it can't double-send against a racing webhook.
// Success-only by design; failed jobs refund silently.
async function sendReadyNotifications({ dryRun }) {
  const db = admin.firestore();
  const snap = await db
    .collectionGroup('generationJobs')
    .where('notify.pending', '==', true)
    .where('status', '==', 'succeeded')
    .limit(MAX_JOBS_PER_RUN)
    .get();

  const summary = {
    scanned: snap.size,
    sent: 0,
    suppressed: 0,
    waiting: 0,
    errored: 0,
    dryRun,
    samples: []
  };

  for (const docSnap of snap.docs) {
    const job = docSnap.data();
    const jobRef = docSnap.ref;
    const uid = jobRef.parent.parent?.id; // users/{uid}/generationJobs/{jobId}
    if (!uid) continue;

    // Give an open tab a moment to ack before this backstop concludes the user
    // is away. The webhook sends in real time, so anything still pending here
    // either had its webhook dropped or just completed; the grace avoids racing
    // an in-flight client ack. (clientAckedAt already set → no need to wait.)
    const doneMs =
      job.completedAt?.toMillis?.() || job.createdAt?.toMillis?.() || 0;
    if (
      !job.notify?.clientAckedAt &&
      doneMs &&
      Date.now() - doneMs < NOTIFY_GRACE_MS
    ) {
      summary.waiting++;
      continue;
    }

    const result = await sendGenerationReadyEmail(db, uid, jobRef, { dryRun });
    switch (result.action) {
      case 'sent':
      case 'would-send':
        summary.sent++;
        if (summary.samples.length < 25) {
          summary.samples.push({ uid, jobId: jobRef.id, action: result.action });
        }
        break;
      case 'suppressed':
        summary.suppressed++;
        break;
      case 'no-email':
      case 'error':
        if (result.action === 'error') {
          console.error(
            `[generation-job-reconcile] notify email failed uid=${uid} job=${jobRef.id}: ${result.error}`
          );
        }
        summary.errored++;
        break;
      default:
        // 'skip' — another path (the webhook) already claimed/sent it between
        // our query and this call. Nothing to do.
        break;
    }
  }

  return summary;
}

// Escalate a sweep's bad outcomes to ERROR level so Cloud Error Reporting picks
// them up — that's the whole monitoring hook (no new infra): point an Error
// Reporting / log-based alert notification channel at this and you get paged
// when jobs systematically give up, error, or fail to email.
function escalateIfNeeded(summary, notify) {
  if (
    summary.gaveUp > 0 ||
    summary.errored > 0 ||
    notify.errored > 0 ||
    summary.queueBacklog > 0 ||
    summary.modalEndpointDown > 0
  ) {
    console.error(
      '[generation-job-reconcile] ALERT: generation jobs need attention:',
      JSON.stringify({
        gaveUp: summary.gaveUp,
        errored: summary.errored,
        notifyErrored: notify.errored,
        queueDepth: summary.queueDepth,
        queueBacklog: summary.queueBacklog,
        modalEndpointDown: summary.modalEndpointDown
      })
    );
  }
}

const reconcileGenerationJobs = functions
  .runWith({
    secrets: ['REPLICATE_API_TOKEN', 'POSTMARK_API_KEY', 'DISCORD_WEBHOOK_URL', ...MODAL_SECRETS],
    // processTerminalPrediction may stream a .ply save (no full-file buffering);
    // 512 MB is fixed headroom, not sized to the file. 540s covers a backlog.
    timeoutSeconds: 540,
    memory: '512MB'
  })
  .pubsub.schedule('*/10 * * * *') // every 10 minutes
  .timeZone('America/Los_Angeles')
  .onRun(
    withJobHealth(
      'reconcileGenerationJobs',
      {
        schedule: '*/10 * * * *',
        timeZone: 'America/Los_Angeles',
        expectedIntervalMs: TEN_MIN_MS,
        degradedKeys: [
          'gaveUp',
          'errored',
          'notify.errored',
          'queueBacklog',
          'modalEndpointDown'
        ]
      },
      async () => {
        console.log('[generation-job-reconcile] starting sweep');
        const summary = await reconcile({ dryRun: false });
        const notify = await sendReadyNotifications({ dryRun: false });
        console.log(
          '[generation-job-reconcile] complete:',
          JSON.stringify({ ...summary, notify })
        );
        // Still log the ERROR-level ALERT line for Cloud Error Reporting; the
        // health doc is the at-a-glance view, this is the paging hook.
        escalateIfNeeded(summary, notify);
        return { ...summary, notify };
      }
    )
  );

const triggerReconcileGenerationJobs = functions
  .runWith({
    secrets: ['REPLICATE_API_TOKEN', 'POSTMARK_API_KEY', 'DISCORD_WEBHOOK_URL', ...MODAL_SECRETS],
    timeoutSeconds: 540,
    memory: '512MB'
  })
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
    console.log(`[generation-job-reconcile] manual trigger (dryRun=${dryRun})`);
    const summary = await reconcile({ dryRun });
    const notify = await sendReadyNotifications({ dryRun });
    console.log(
      '[generation-job-reconcile] manual run complete:',
      JSON.stringify({ ...summary, notify })
    );
    return { ...summary, notify };
  });

module.exports = { reconcileGenerationJobs, triggerReconcileGenerationJobs };
