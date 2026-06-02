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
const Replicate = require('replicate');

const {
  processTerminalPrediction,
  refundSplatToken,
  cleanupSplatTempFile
} = require('../replicate.js');
const { enqueueRadTask } = require('../rad-dispatch.js');
const {
  sendPostmarkEmail,
  getUserInfo,
  EMAIL_TEMPLATES
} = require('./scheduledEmails.js');

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
// success, or { absent: true } if the provider no longer knows the job (404).
// Replicate-only today — this switch is the future provider registry seam.
async function fetchProviderPrediction(job, replicate) {
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
  await jobRef.update({
    status: 'failed',
    error: reason,
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

  const summary = {
    scanned: snap.size,
    tooFresh: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    refunded: 0,
    gaveUp: 0,
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
      // prediction to poll — a job stuck non-terminal past RACE_GUARD means the
      // Cloud Task was dropped or the worker died mid-flight. Re-enqueue (the
      // worker is idempotent: it just overwrites the same -lod.rad / re-patches
      // the doc), and give up only once it's truly old. tokenCost is 0, so
      // failJob's refund is a no-op.
      if (job.provider === 'cloudrun') {
        if (age > GIVE_UP_MS) {
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
        } else {
          sample.action = 're-enqueued-cloudrun';
          summary.processed++;
          if (!dryRun) {
            await enqueueRadTask({
              uid,
              assetId: job.assetId,
              plyPath: job.plyPath,
              jobId: jobRef.id
            });
          }
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

      const { prediction, absent } = await fetchProviderPrediction(
        job,
        replicate
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

// Completion-email sweep — the "notify by email when a job finishes while the
// tab is closed" path, implemented entirely on the job doc (no separate
// notification system). It queries opted-in, succeeded jobs whose notify is
// still `pending` and either suppresses (the client acked → tab was open) or
// emails (past the grace window with no ack → user is away). Success-only by
// design; failed jobs refund silently. Idempotent: `notify.pending` is cleared
// the instant we act, so a job is emailed at most once.
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

    // The client acked while polling → the tab was open and the user saw it.
    // No email; just clear the flag so it drops out of this query.
    if (job.notify?.clientAckedAt) {
      summary.suppressed++;
      if (!dryRun) await jobRef.update({ 'notify.pending': false });
      continue;
    }

    // Give an open tab a moment to ack before we conclude the user is away.
    const doneMs =
      job.completedAt?.toMillis?.() || job.createdAt?.toMillis?.() || 0;
    if (doneMs && Date.now() - doneMs < NOTIFY_GRACE_MS) {
      summary.waiting++;
      continue;
    }

    try {
      if (dryRun) {
        summary.sent++;
        if (summary.samples.length < 25) {
          summary.samples.push({ uid, jobId: jobRef.id, action: 'would-email' });
        }
        continue;
      }

      const userInfo = await getUserInfo(uid);
      if (!userInfo?.email) {
        // No address on file — don't retry forever; close the notify out.
        await jobRef.update({
          'notify.pending': false,
          'notify.error': 'no-email'
        });
        summary.errored++;
        continue;
      }

      // Kind-aware copy (splat today; video/image reuse it for free). The CTA
      // deep-links straight to the asset's detail modal in the editor:
      // #asset:OWNER/ID (the issue #1641 asset-token shape). Needs the owner uid
      // because assets are addressed as users/{uid}/assets/{assetId}; assets are
      // public-read so the link works before the recipient's auth resolves.
      const tpl = EMAIL_TEMPLATES.generationReady;
      const ctaUrl = job.assetId
        ? `https://3dstreet.app/?utm_source=email&utm_medium=notification&utm_campaign=generation_ready#asset:${uid}/${job.assetId}`
        : undefined; // fall back to the template's default app link
      await sendPostmarkEmail(
        userInfo.email,
        tpl.getSubject(job.kind),
        tpl.getHtmlBody(userInfo.displayName, job.kind, ctaUrl),
        tpl.getTextBody(userInfo.displayName, job.kind, ctaUrl)
      );
      await jobRef.update({
        'notify.pending': false,
        'notify.sentAt': admin.firestore.FieldValue.serverTimestamp()
      });
      summary.sent++;
      if (summary.samples.length < 25) {
        summary.samples.push({ uid, jobId: jobRef.id, action: 'emailed' });
      }
    } catch (err) {
      console.error(
        `[generation-job-reconcile] notify email failed uid=${uid} job=${jobRef.id}:`,
        err.message || err
      );
      summary.errored++;
    }
  }

  return summary;
}

// Escalate a sweep's bad outcomes to ERROR level so Cloud Error Reporting picks
// them up — that's the whole monitoring hook (no new infra): point an Error
// Reporting / log-based alert notification channel at this and you get paged
// when jobs systematically give up, error, or fail to email.
function escalateIfNeeded(summary, notify) {
  if (summary.gaveUp > 0 || summary.errored > 0 || notify.errored > 0) {
    console.error(
      '[generation-job-reconcile] ALERT: generation jobs need attention:',
      JSON.stringify({
        gaveUp: summary.gaveUp,
        errored: summary.errored,
        notifyErrored: notify.errored
      })
    );
  }
}

const reconcileGenerationJobs = functions
  .runWith({
    secrets: ['REPLICATE_API_TOKEN', 'POSTMARK_API_KEY'],
    // processTerminalPrediction may stream a .ply save (no full-file buffering);
    // 512 MB is fixed headroom, not sized to the file. 540s covers a backlog.
    timeoutSeconds: 540,
    memory: '512MB'
  })
  .pubsub.schedule('*/10 * * * *') // every 10 minutes
  .timeZone('America/Los_Angeles')
  .onRun(async () => {
    console.log('[generation-job-reconcile] starting sweep');
    const summary = await reconcile({ dryRun: false });
    const notify = await sendReadyNotifications({ dryRun: false });
    console.log(
      '[generation-job-reconcile] complete:',
      JSON.stringify({ ...summary, notify })
    );
    escalateIfNeeded(summary, notify);
    return { ...summary, notify };
  });

const triggerReconcileGenerationJobs = functions
  .runWith({
    secrets: ['REPLICATE_API_TOKEN', 'POSTMARK_API_KEY'],
    timeoutSeconds: 540,
    memory: '512MB'
  })
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
