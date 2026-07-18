const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertAppCheck } = require('../app-check.js');
const { withJobHealth } = require('./job-health.js');
const { sendPostmarkEmail, getUserInfo } = require('../email/postmark.js');
const { sendLifecycleEmail } = require('../email/lifecycle-email.js');

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// EMAIL TEMPLATES
// ============================================================================

const EMAIL_TEMPLATES = {
  geoTokenExhaustion: {
    subject: "You've used all your geo tokens on 3DStreet",
    getTextBody: (userName) => `Hi ${userName},

You've used all of your free geo tokens on 3DStreet. Geo tokens let you access Google 3D Tiles to see real-world context around your street designs.

Want to keep designing with real-world context? Upgrade to 3DStreet Pro and get:

- Unlimited geo tokens for Google 3D Tiles
- 100 AI generation tokens per month
- Priority support
- Early access to new features

Upgrade now: https://3dstreet.app/?utm_source=email&utm_medium=token_exhaustion&utm_campaign=geo_zero&utm_content=cta_link#modal/payment

Thanks for using 3DStreet!

The 3DStreet Team
https://3dstreet.com

---
You received this email because you created an account on 3DStreet. This message is only sent once.
If you have questions, reply to this email or visit https://3dstreet.com/docs/`,
    getHtmlBody: (userName) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <img src="https://3dstreet.app/ui_assets/3dstreet-logo-rect-r-640.png" alt="3DStreet" style="height: 40px;">
  </div>

  <h2 style="color: #1a1a1a; margin-bottom: 20px;">Hi ${userName},</h2>

  <p>You've used all of your free <strong>geo tokens</strong> on 3DStreet. Geo tokens let you access Google 3D Tiles to see real-world context around your street designs.</p>

  <p>Want to keep designing with real-world context? <strong>Upgrade to 3DStreet Pro</strong> and get:</p>

  <ul style="padding-left: 20px;">
    <li>Unlimited geo tokens for Google 3D Tiles</li>
    <li>100 AI generation tokens per month</li>
    <li>Priority support</li>
    <li>Early access to new features</li>
  </ul>

  <div style="text-align: center; margin: 30px 0;">
    <a href="https://3dstreet.app/?utm_source=email&utm_medium=token_exhaustion&utm_campaign=geo_zero&utm_content=cta_button#modal/payment" style="display: inline-block; background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Upgrade to Pro</a>
  </div>

  <p>Thanks for using 3DStreet!</p>

  <p style="color: #666;">The 3DStreet Team<br>
  <a href="https://3dstreet.com" style="color: #6366f1;">https://3dstreet.com</a></p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="font-size: 12px; color: #999;">
    You received this email because you created an account on 3DStreet.<br>
    This message is only sent once. If you have questions, reply to this email or visit <a href="https://3dstreet.com/docs/" style="color: #6366f1;">our documentation</a>.
  </p>
</body>
</html>`
  },

  genTokenExhaustion: {
    subject: "You've used all your AI tokens on 3DStreet",
    getTextBody: (userName) => `Hi ${userName},

You've used all of your free AI generation tokens on 3DStreet. AI tokens let you create stunning photorealistic renders of your street designs using our AI image generator.

Want to keep creating amazing renders? Upgrade to 3DStreet Pro and get:

- 100 AI generation tokens per month
- Unlimited geo tokens for Google 3D Tiles
- Priority support
- Early access to new features

Upgrade now: https://3dstreet.app/?utm_source=email&utm_medium=token_exhaustion&utm_campaign=ai_zero&utm_content=cta_link#modal/payment

Thanks for using 3DStreet!

The 3DStreet Team
https://3dstreet.com

---
You received this email because you created an account on 3DStreet. This message is only sent once.
If you have questions, reply to this email or visit https://3dstreet.com/docs/`,
    getHtmlBody: (userName) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <img src="https://3dstreet.app/ui_assets/3dstreet-logo-rect-r-640.png" alt="3DStreet" style="height: 40px;">
  </div>

  <h2 style="color: #1a1a1a; margin-bottom: 20px;">Hi ${userName},</h2>

  <p>You've used all of your free <strong>AI generation tokens</strong> on 3DStreet. AI tokens let you create stunning photorealistic renders of your street designs using our AI image generator.</p>

  <p>Want to keep creating amazing renders? <strong>Upgrade to 3DStreet Pro</strong> and get:</p>

  <ul style="padding-left: 20px;">
    <li>100 AI generation tokens per month</li>
    <li>Unlimited geo tokens for Google 3D Tiles</li>
    <li>Priority support</li>
    <li>Early access to new features</li>
  </ul>

  <div style="text-align: center; margin: 30px 0;">
    <a href="https://3dstreet.app/?utm_source=email&utm_medium=token_exhaustion&utm_campaign=ai_zero&utm_content=cta_button#modal/payment" style="display: inline-block; background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Upgrade to Pro</a>
  </div>

  <p>Thanks for using 3DStreet!</p>

  <p style="color: #666;">The 3DStreet Team<br>
  <a href="https://3dstreet.com" style="color: #6366f1;">https://3dstreet.com</a></p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="font-size: 12px; color: #999;">
    You received this email because you created an account on 3DStreet.<br>
    This message is only sent once. If you have questions, reply to this email or visit <a href="https://3dstreet.com/docs/" style="color: #6366f1;">our documentation</a>.
  </p>
</body>
</html>`
  },

  // Sent once per opted-in generation job that finishes while the user is away
  // (no live tab acked the result). Triggered from the generation-job reconciler,
  // not the daily scheduler — it reuses sendPostmarkEmail below.
  //
  // Kind-aware so video and image (the next async generations) reuse it with no
  // new template: the queue + sweep are already kind-agnostic, so a new kind just
  // adds a copy entry here (and an opt-in checkbox on its tab). Unknown kinds
  // fall back to neutral "generation" wording rather than failing.
  generationReady: {
    copyByKind: {
      splat: { noun: 'splat', desc: '3D Gaussian Splat' },
      video: { noun: 'video', desc: 'video' },
      image: { noun: 'image', desc: 'image' },
      mesh: { noun: '3D model', desc: '3D model (GLB)' }
    },
    getCopy(kind) {
      return this.copyByKind[kind] || { noun: 'generation', desc: 'generation' };
    },
    // Fallback CTA when a caller doesn't pass a deep link to the specific asset.
    defaultCtaUrl:
      'https://3dstreet.app/?utm_source=email&utm_medium=notification&utm_campaign=generation_ready',
    // Compact, human-readable UTC stamp (e.g. "Jun 2, 3:41 PM UTC"). Used to keep
    // each notification distinct so mail clients don't thread/collapse them.
    formatWhen(when) {
      if (!when) return '';
      const d = when instanceof Date ? when : new Date(when);
      if (isNaN(d.getTime())) return '';
      return (
        d.toLocaleString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
          timeZone: 'UTC'
        }) + ' UTC'
      );
    },
    // Each finished asset already carries a unique, timestamped name (e.g.
    // "SHARP Splat 2026-06-02T15-41-03"), so threading the name into the subject
    // makes every notification distinct. Fall back to a formatted time when no
    // name is on the job. ctx: { assetName, when }.
    getSubject(kind, ctx = {}) {
      const { noun } = this.getCopy(kind);
      if (ctx.assetName) return `Your 3DStreet ${noun} "${ctx.assetName}" is ready`;
      const when = this.formatWhen(ctx.when);
      return when
        ? `Your 3DStreet ${noun} is ready (${when})`
        : `Your 3DStreet ${noun} is ready`;
    },
    getTextBody(userName, kind, ctaUrl, ctx = {}) {
      const { noun, desc } = this.getCopy(kind);
      const link = ctaUrl || this.defaultCtaUrl;
      const name = ctx.assetName ? ` "${ctx.assetName}"` : '';
      const when = this.formatWhen(ctx.when);
      const generatedLine = when ? `\nGenerated ${when}.\n` : '';
      return `Hi ${userName},

Your ${desc}${name} finished generating and has been saved to your 3DStreet gallery.
${generatedLine}

Open it in the editor:
${link}

Thanks for using 3DStreet!

The 3DStreet Team
https://3dstreet.com

---
You received this email because you asked to be notified when your ${noun} finished. You can opt out by unchecking that box next time.`;
    },
    getHtmlBody(userName, kind, ctaUrl, ctx = {}) {
      const { noun, desc } = this.getCopy(kind);
      const link = ctaUrl || this.defaultCtaUrl;
      const name = ctx.assetName
        ? ` <strong>&ldquo;${ctx.assetName}&rdquo;</strong>`
        : '';
      const when = this.formatWhen(ctx.when);
      const generatedLine = when
        ? `\n  <p style="color: #666; font-size: 13px;">Generated ${when}.</p>`
        : '';
      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <img src="https://3dstreet.app/ui_assets/3dstreet-logo-rect-r-640.png" alt="3DStreet" style="height: 40px;">
  </div>

  <h2 style="color: #1a1a1a; margin-bottom: 20px;">Hi ${userName},</h2>

  <p>Your <strong>${desc}</strong>${name} finished generating and has been saved to your 3DStreet gallery.</p>
${generatedLine}
  <p>Open it in the editor to preview it and drag it into your scene.</p>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${link}" style="display: inline-block; background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Open my ${noun}</a>
  </div>

  <p>Thanks for using 3DStreet!</p>

  <p style="color: #666;">The 3DStreet Team<br>
  <a href="https://3dstreet.com" style="color: #6366f1;">https://3dstreet.com</a></p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="font-size: 12px; color: #999;">
    You received this email because you asked to be notified when your ${noun} finished.<br>
    You can opt out by unchecking that box next time.
  </p>
</body>
</html>`;
    }
  },

  // Failure counterpart of generationReady (same opt-in, same send/claim
  // machinery — see sendGenerationOutcomeEmail). Honors the checkbox's "you
  // can close this tab" promise for the unhappy path: the user learns the job
  // didn't finish and that any charged tokens came back, instead of silence.
  // There's nothing to deep-link (a failed job never creates a gallery
  // asset), so the CTA returns them to where they generated to try again.
  generationFailed: {
    getCopy(kind) {
      return EMAIL_TEMPLATES.generationReady.getCopy(kind);
    },
    formatWhen(when) {
      return EMAIL_TEMPLATES.generationReady.formatWhen(when);
    },
    defaultCtaUrl:
      'https://3dstreet.app/?utm_source=email&utm_medium=notification&utm_campaign=generation_failed',
    getSubject(kind, ctx = {}) {
      const { noun } = this.getCopy(kind);
      if (ctx.assetName) {
        return `Your 3DStreet ${noun} "${ctx.assetName}" didn't finish`;
      }
      const when = this.formatWhen(ctx.when);
      return when
        ? `Your 3DStreet ${noun} didn't finish (${when})`
        : `Your 3DStreet ${noun} didn't finish`;
    },
    getTextBody(userName, kind, ctaUrl, ctx = {}) {
      const { noun, desc } = this.getCopy(kind);
      const link = ctaUrl || this.defaultCtaUrl;
      const name = ctx.assetName ? ` "${ctx.assetName}"` : '';
      return `Hi ${userName},

Unfortunately your ${desc}${name} didn't finish generating. Any tokens charged for it have been refunded to your account.

This is usually a temporary problem with the generation service, and trying again often works:
${link}

If it keeps failing, reply to this email and we'll take a look.

The 3DStreet Team
https://3dstreet.com

---
You received this email because you asked to be notified about this ${noun}. You can opt out by unchecking that box next time.`;
    },
    getHtmlBody(userName, kind, ctaUrl, ctx = {}) {
      const { noun, desc } = this.getCopy(kind);
      const link = ctaUrl || this.defaultCtaUrl;
      const name = ctx.assetName
        ? ` <strong>&ldquo;${ctx.assetName}&rdquo;</strong>`
        : '';
      return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="text-align: center; margin-bottom: 30px;">
    <img src="https://3dstreet.app/ui_assets/3dstreet-logo-rect-r-640.png" alt="3DStreet" style="height: 40px;">
  </div>

  <h2 style="color: #1a1a1a; margin-bottom: 20px;">Hi ${userName},</h2>

  <p>Unfortunately your <strong>${desc}</strong>${name} didn't finish generating. Any tokens charged for it have been <strong>refunded</strong> to your account.</p>

  <p>This is usually a temporary problem with the generation service, and trying again often works.</p>

  <div style="text-align: center; margin: 30px 0;">
    <a href="${link}" style="display: inline-block; background-color: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; font-weight: 600;">Try again</a>
  </div>

  <p>If it keeps failing, reply to this email and we'll take a look.</p>

  <p style="color: #666;">The 3DStreet Team<br>
  <a href="https://3dstreet.com" style="color: #6366f1;">https://3dstreet.com</a></p>

  <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">

  <p style="font-size: 12px; color: #999;">
    You received this email because you asked to be notified about this ${noun}.<br>
    You can opt out by unchecking that box next time.
  </p>
</body>
</html>`;
    }
  }

  // Add more email templates here as needed:
  // welcome: { ... },
  // reEngagement: { ... },
  // featureAnnouncement: { ... },
};

// ============================================================================
// EMAIL TYPE CONFIGURATIONS
// Each type defines how to find eligible users (the trigger) and how the send
// service should treat the email (id/category/stream/stop-rules). Sending,
// stop-rule enforcement, and audit logging all happen in
// ../email/lifecycle-email.js — see docs/email-lifecycle.md.
// ============================================================================

const EMAIL_TYPES = {
  tokenExhaustion: {
    // Identity + routing for sendLifecycleEmail. onceEver means one
    // tokenExhaustion email per user, ever (regardless of which template
    // variant they get); stopIfPro skips PRO users.
    emailId: 'tokenExhaustion',
    category: 'transactional',
    stream: 'outbound',
    rules: { onceEver: true, stopIfPro: true },

    // Sends recorded before the emailLog migration live in
    // notifyLog/{uid}.tokenExhaustionEmailSent; users with that flag must
    // never be emailed again even though their emailLog is empty.
    legacyNotifyLogField: 'tokenExhaustionEmailSent',

    // Query users with either token at 0
    // Firestore doesn't support OR queries, so we run two queries and merge
    async getEligibleUsers(db) {
      const [geoSnapshot, genSnapshot] = await Promise.all([
        db.collection('tokenProfile').where('geoToken', '==', 0).get(),
        db.collection('tokenProfile').where('genToken', '==', 0).get()
      ]);

      // Merge and dedupe by userId
      const userMap = new Map();

      for (const doc of geoSnapshot.docs) {
        userMap.set(doc.id, { userId: doc.id, ...doc.data() });
      }
      for (const doc of genSnapshot.docs) {
        if (!userMap.has(doc.id)) {
          userMap.set(doc.id, { userId: doc.id, ...doc.data() });
        }
      }

      return Array.from(userMap.values());
    },

    // Select template based on which token is exhausted
    // Prioritize AI (genToken) if both are exhausted
    getTemplateKey(userData) {
      if (userData.genToken === 0) {
        return 'genTokenExhaustion';
      }
      return 'geoTokenExhaustion';
    }
  }

  // Add more email types here as needed:
  // welcome: { ... },
  // reEngagement: { ... },
};

// ============================================================================
// CORE EMAIL FUNCTIONS
// ============================================================================
// The Postmark transport (sendPostmarkEmail) and Auth lookup (getUserInfo)
// live in ../email/postmark.js, shared with the lifecycle send service.

/**
 * Check whether a pre-emailLog send was recorded in notifyLog. Only consulted
 * for history that predates the lifecycle-email migration; new sends are
 * tracked in emailLog by sendLifecycleEmail.
 */
const hasLegacyNotifyLogEntry = (notifyLog, notifyLogField) => {
  if (!notifyLog || !notifyLog[notifyLogField]) {
    return false;
  }
  return true;
};

/**
 * Adapt a static-subject EMAIL_TEMPLATES entry to the template interface
 * sendLifecycleEmail expects ({ getSubject, getHtmlBody, getTextBody }).
 */
const asLifecycleTemplate = (template) => ({
  getSubject: () => template.subject,
  getHtmlBody: (userName) => template.getHtmlBody(userName),
  getTextBody: (userName) => template.getTextBody(userName)
});

// Failure emails older than this are retired unsent (pending cleared, no
// email). Guards the first deploy against a backfill flood of historic
// failed jobs whose pending flag never cleared under the old success-only
// rule, and generally against emailing about a failure the user has long
// moved past.
const STALE_FAILURE_CUTOFF_MS = DAY_MS;

/**
 * Send the outcome email for a single terminal, opted-in job, exactly once:
 * generationReady for succeeded jobs, generationFailed ("didn't finish, tokens
 * refunded") for failed/canceled ones. Shared by BOTH the real-time path (the
 * provider webhooks, which call this the instant a job finishes) and the
 * reconciler sweep (the dropped-webhook backstop). Idempotency lives here, not
 * at the call sites:
 *
 *   - A transaction CAS-claims the send by flipping `notify.pending` → false.
 *     Only the winner proceeds, so the webhook and the sweep can't double-send.
 *   - If the client already acked (an open tab saw the result — the render or
 *     the failure toast), we clear the flag and skip — no email for a user
 *     who's watching.
 *   - Failed jobs with no providerJobId are retired silently: the failure
 *     happened during submit, so the callable returned the error straight to
 *     the still-open tab. Same for failures older than the staleness cutoff.
 *   - On a send failure we restore `notify.pending` so the sweep retries later
 *     (fail-safe: a transient Postmark/Auth error never silently drops the
 *     notification).
 *
 * The transaction re-checks eligibility against the live doc regardless of
 * what the caller saw. dryRun reports what would send without claiming or
 * sending.
 *
 * @returns {Promise<{action: 'sent'|'suppressed'|'skip'|'no-email'|'would-send'|'error', error?: string}>}
 */
const sendGenerationOutcomeEmail = async (db, uid, jobRef, options = {}) => {
  const { dryRun = false } = options;

  // Atomically decide whether THIS call owns the send.
  let job = null;
  let outcome = 'skip';
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) return;
    job = snap.data();
    const failed = job.status === 'failed' || job.status === 'canceled';
    // Only terminal, opted-in, still-pending jobs are eligible. Anything else
    // (already sent, not opted in, not yet terminal) drops out.
    if (job.status !== 'succeeded' && !failed) return;
    if (!job.notify?.email || !job.notify?.pending) return;
    // An open tab acked → the user saw it. Clear the flag, send nothing.
    if (job.notify?.clientAckedAt) {
      outcome = 'suppressed';
      if (!dryRun) tx.update(jobRef, { 'notify.pending': false });
      return;
    }
    if (failed) {
      const doneMs =
        job.completedAt?.toMillis?.() || job.createdAt?.toMillis?.() || 0;
      const stale = doneMs && Date.now() - doneMs > STALE_FAILURE_CUTOFF_MS;
      if (!job.providerJobId || stale) {
        outcome = 'suppressed';
        if (!dryRun) tx.update(jobRef, { 'notify.pending': false });
        return;
      }
    }
    if (dryRun) {
      outcome = 'would-send';
      return;
    }
    // Claim the send. From here, no other caller can also send this job.
    outcome = 'claimed';
    tx.update(jobRef, { 'notify.pending': false });
  });

  if (outcome !== 'claimed') {
    return { action: outcome === 'would-send' ? 'would-send' : outcome };
  }

  try {
    const userInfo = await getUserInfo(uid);
    if (!userInfo?.email) {
      // No address on file — pending is already cleared; record why and stop.
      await jobRef.update({ 'notify.error': 'no-email' });
      return { action: 'no-email' };
    }

    // Kind-aware copy. Project-aware base so a dev/staging email deep-links to
    // the dev app where the asset actually lives, mirroring replicate.js's
    // webhook-URL project resolution. Success CTA deep-links to the asset's
    // detail modal (#asset:OWNER/ID); a failed job has no asset, so its CTA
    // returns the user to where they generated to try again.
    const failed = job.status !== 'succeeded';
    const tpl = failed
      ? EMAIL_TEMPLATES.generationFailed
      : EMAIL_TEMPLATES.generationReady;
    const project =
      process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
    const appBase =
      project === 'dev-3dstreet'
        ? 'https://dev-3dstreet.web.app'
        : 'https://3dstreet.app';
    let ctaUrl;
    if (failed) {
      const retryPath = job.source === 'generator' ? '/generator/' : '/';
      ctaUrl = `${appBase}${retryPath}?utm_source=email&utm_medium=notification&utm_campaign=generation_failed`;
    } else if (job.assetId) {
      ctaUrl = `${appBase}/?utm_source=email&utm_medium=notification&utm_campaign=generation_ready#asset:${uid}/${job.assetId}`;
    } // else fall back to the template's default app link
    const emailCtx = {
      assetName: job.assetName || null,
      when: job.completedAt?.toMillis?.() || job.createdAt?.toMillis?.() || null
    };

    await sendPostmarkEmail(
      userInfo.email,
      tpl.getSubject(job.kind, emailCtx),
      tpl.getHtmlBody(userInfo.displayName, job.kind, ctaUrl, emailCtx),
      tpl.getTextBody(userInfo.displayName, job.kind, ctaUrl, emailCtx)
    );
    await jobRef.update({
      'notify.sentAt': admin.firestore.FieldValue.serverTimestamp()
    });
    return { action: 'sent' };
  } catch (err) {
    // Restore the flag so the backstop sweep retries — never drop it silently.
    await jobRef
      .update({
        'notify.pending': true,
        'notify.error': String(err?.message || err)
      })
      .catch(() => {});
    return { action: 'error', error: err?.message || String(err) };
  }
};

/**
 * Process a single email type - find eligible users and send emails
 * @param {Object} db - Firestore database instance
 * @param {string} emailTypeKey - The email type identifier
 * @param {Object} emailType - The email type configuration
 * @param {Object} options - Processing options
 * @param {boolean} options.dryRun - If true, log what would be sent without actually sending
 */
const processEmailType = async (db, emailTypeKey, emailType, options = {}) => {
  const { dryRun = false } = options;
  const results = {
    type: emailTypeKey,
    dryRun,
    processed: 0,
    sent: 0,
    wouldSend: [], // For dry run mode - list of emails that would be sent
    skipped: {
      alreadySent: 0,
      noEmail: 0,
      filtered: 0,
      error: 0
    }
  };

  // Get eligible users
  let eligibleUsers;
  try {
    eligibleUsers = await emailType.getEligibleUsers(db);
    console.log(`Found ${eligibleUsers.length} eligible users for ${emailTypeKey}`);
    if (dryRun && eligibleUsers.length > 0) {
      console.log(`[DRY RUN] Eligible users found:`, eligibleUsers.map(u => ({
        userId: u.userId,
        geoToken: u.geoToken,
        genToken: u.genToken,
        geoTokenType: typeof u.geoToken,
        genTokenType: typeof u.genToken
      })));
    }
  } catch (error) {
    console.error(`Error querying eligible users for ${emailTypeKey}:`, error);
    return results;
  }

  if (eligibleUsers.length === 0) {
    return results;
  }

  // Batch-read legacy notifyLog docs (sends recorded before the emailLog
  // migration). Firestore getAll() has a limit of 100 documents per call.
  const userIds = eligibleUsers.map(u => u.userId);
  const notifyLogMap = {};
  const BATCH_SIZE = 100;

  for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
    const batchIds = userIds.slice(i, i + BATCH_SIZE);
    const notifyLogRefs = batchIds.map(id => db.collection('notifyLog').doc(id));
    const notifyLogDocs = await db.getAll(...notifyLogRefs);
    notifyLogDocs.forEach((doc, index) => {
      if (doc.exists) {
        notifyLogMap[batchIds[index]] = doc.data();
      }
    });
  }

  // Process each user. Stop-rules (once-ever, PRO skip), the Auth email
  // lookup, the Postmark call, and emailLog bookkeeping all happen inside
  // sendLifecycleEmail; this loop only picks the template and tallies results.
  for (const user of eligibleUsers) {
    results.processed++;
    const userId = user.userId;

    try {
      // Users emailed under the old notifyLog tracking have no emailLog
      // entry, so onceEver alone wouldn't stop a resend.
      const notifyLog = notifyLogMap[userId];
      if (hasLegacyNotifyLogEntry(notifyLog, emailType.legacyNotifyLogField)) {
        results.skipped.alreadySent++;
        continue;
      }

      // Select template - either static or dynamic based on user data
      const templateKey = emailType.getTemplateKey
        ? emailType.getTemplateKey(user)
        : emailType.templateKey;

      const template = EMAIL_TEMPLATES[templateKey];
      if (!template) {
        console.error(`Template not found: ${templateKey}`);
        results.skipped.error++;
        continue;
      }

      const result = await sendLifecycleEmail({
        db,
        uid: userId,
        emailId: emailType.emailId,
        category: emailType.category,
        stream: emailType.stream,
        template: asLifecycleTemplate(template),
        rules: emailType.rules,
        dryRun
      });

      switch (result.action) {
        case 'sent':
          results.sent++;
          break;
        case 'would-send':
          console.log(`[DRY RUN] Would send ${emailTypeKey} (${templateKey}) email to ${result.to}`);
          results.wouldSend.push({
            email: result.to,
            templateKey,
            subject: result.subject
          });
          results.sent++;
          break;
        case 'no-email':
          results.skipped.noEmail++;
          break;
        case 'skipped':
          // 'pro' and 'unsubscribed' are eligibility filters; everything else
          // ('onceEver', cooldowns, dedupe) means a prior send blocked this one.
          if (result.reason === 'pro' || result.reason === 'unsubscribed') {
            results.skipped.filtered++;
          } else {
            results.skipped.alreadySent++;
          }
          break;
        default:
          console.error(`Error processing ${emailTypeKey} for user ${userId}:`, result.reason);
          results.skipped.error++;
      }
    } catch (error) {
      console.error(`Error processing ${emailTypeKey} for user ${userId}:`, error.message || error);
      results.skipped.error++;
    }
  }

  return results;
};

// ============================================================================
// SCHEDULED CLOUD FUNCTION
// ============================================================================

/**
 * Scheduled function that runs daily to send notification emails
 * Runs at 9:00 AM Pacific Time (17:00 UTC)
 */
const sendScheduledEmails = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '256MB',
    secrets: ['POSTMARK_API_KEY', 'ALLOWED_PRO_TEAM_DOMAINS']
  })
  .pubsub
  .schedule('0 9 * * *')  // 9:00 AM PT
  .timeZone('America/Los_Angeles')
  .onRun(
    withJobHealth(
      'sendScheduledEmails',
      {
        schedule: '0 9 * * *',
        timeZone: 'America/Los_Angeles',
        expectedIntervalMs: DAY_MS,
        degradedKeys: ['errors']
      },
      async () => {
        console.log('Starting scheduled email job');
        const db = admin.firestore();
        const allResults = [];

        // Process each email type
        for (const [emailTypeKey, emailType] of Object.entries(EMAIL_TYPES)) {
          console.log(`Processing email type: ${emailTypeKey}`);
          const results = await processEmailType(db, emailTypeKey, emailType);
          allResults.push(results);
          console.log(`Completed ${emailTypeKey}:`, JSON.stringify(results));
        }

        console.log('Scheduled email job complete:', JSON.stringify(allResults));
        // Flatten to top-level counts so the health page shows totals at a
        // glance and `errors` can drive the degraded (yellow) status.
        const sent = allResults.reduce((n, r) => n + (r.sent || 0), 0);
        const processed = allResults.reduce((n, r) => n + (r.processed || 0), 0);
        const errors = allResults.reduce(
          (n, r) => n + ((r.skipped && r.skipped.error) || 0),
          0
        );
        return { success: true, sent, processed, errors, results: allResults };
      }
    )
  );

/**
 * HTTP callable function for manual triggering (useful for testing)
 * Only processes specified email types if provided, otherwise all
 *
 * @param {Object} data - Function parameters
 * @param {string[]} data.emailTypes - Optional array of email types to process (defaults to all)
 * @param {boolean} data.dryRun - If true, shows what would be sent without actually sending emails
 *
 * Usage from client:
 *   const trigger = firebase.functions().httpsCallable('triggerScheduledEmails');
 *   // Dry run - see what would be sent without sending
 *   await trigger({ dryRun: true });
 *   // Actually send emails
 *   await trigger({ dryRun: false });
 */
const triggerScheduledEmails = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '256MB',
    secrets: ['POSTMARK_API_KEY', 'ALLOWED_PRO_TEAM_DOMAINS']
  })
  .https
  .onCall(async (data, context) => {
    // Defense-in-depth: also gate on App Check (admin claim required below).
    // No-op until APP_CHECK_ENFORCE is enabled (see app-check.js).
    assertAppCheck(context);
    // Verify user is authenticated
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated.');
    }

    // Require admin claim to trigger emails
    if (!context.auth.token.admin) {
      throw new functions.https.HttpsError('permission-denied', 'Admin access required.');
    }

    const dryRun = data?.dryRun ?? true; // Default to dry run for safety
    console.log(`Manually triggering scheduled emails (dryRun: ${dryRun})`);
    const db = admin.firestore();
    const allResults = [];

    // Allow filtering to specific email types
    const emailTypesToProcess = data?.emailTypes || Object.keys(EMAIL_TYPES);

    for (const emailTypeKey of emailTypesToProcess) {
      const emailType = EMAIL_TYPES[emailTypeKey];
      if (!emailType) {
        console.warn(`Unknown email type: ${emailTypeKey}`);
        continue;
      }

      console.log(`Processing email type: ${emailTypeKey}`);
      const results = await processEmailType(db, emailTypeKey, emailType, { dryRun });
      allResults.push(results);
      console.log(`Completed ${emailTypeKey}:`, JSON.stringify(results));
    }

    return { success: true, dryRun, results: allResults };
  });

module.exports = {
  sendScheduledEmails,
  triggerScheduledEmails,
  // Re-exported from ../email/postmark.js for existing callers.
  sendPostmarkEmail,
  getUserInfo,
  // Shared, idempotent completion-email send: the webhook calls it in real time;
  // the reconciler sweep calls it as the backstop.
  sendGenerationOutcomeEmail,
  // Export for testing
  EMAIL_TEMPLATES,
  EMAIL_TYPES,
  processEmailType
};
