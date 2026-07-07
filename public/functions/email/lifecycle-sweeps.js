/**
 * Sweep-driven lifecycle emails: the "state X has persisted for N hours/days"
 * triggers that no single event fires for. An hourly cron scans the trigger
 * collections and routes every send through sendLifecycleEmail (which owns
 * suppression, stop-rules, and audit) — so re-scanning the same candidates
 * every hour is safe by construction.
 *
 * Trigger data, written by the instrumentation in index.js / geoid-height.js:
 *   checkoutSessions/{sessionId} — { userId, email, priceId, status:
 *       'open'|'complete'|'expired', createdAt } from createStripeSession /
 *       stripeWebhook
 *   userSignals/{uid}            — { lastPaymentModalAt } (client, narrow
 *       rules-validated write), { lastCheckoutStartedAt } (server)
 *   emailLog/{uid}               — emails.welcome.lastSentAt doubles as the
 *       signup marker for the geo sweep (welcome sends via Auth onCreate), so
 *       only post-launch users are ever candidates — intentional no-backfill.
 *   tokenProfile/{uid}           — firstGeoActivatedAt stamped by geoid-height
 *
 * See docs/email-lifecycle.md.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertAppCheck } = require('../app-check.js');
const { withJobHealth } = require('../scheduled/job-health.js');
const { sendLifecycleEmail } = require('./lifecycle-email.js');
const TEMPLATES = require('./templates.js');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// The 72h abandoned-checkout follow-up is built but ships disabled: enable
// only after the 1h email's numbers justify a second touch.
const ENABLE_ABANDONED_72H = false;

const tsBefore = (nowMs, ageMs) =>
  admin.firestore.Timestamp.fromMillis(nowMs - ageMs);

// Per-sweep result tally, mirroring processEmailType's shape.
const newTally = () => ({
  candidates: 0,
  sent: 0,
  wouldSend: [],
  skipped: {}
});

const tally = (t, result) => {
  if (result.action === 'sent') {
    t.sent++;
  } else if (result.action === 'would-send') {
    t.wouldSend.push(result.to);
    t.sent++;
  } else {
    const key = result.reason || result.action;
    t.skipped[key] = (t.skipped[key] || 0) + 1;
  }
};

/**
 * Checkout started but never completed. minAgeMs distinguishes the 1h nudge
 * from the 72h follow-up; both key idempotency on the Stripe session id.
 * Sessions are scanned for 7 days, then age out of the query window.
 */
const sweepCheckoutAbandoned = async (
  db,
  { dryRun, nowMs, emailId, template, minAgeMs }
) => {
  const t = newTally();
  const snap = await db
    .collection('checkoutSessions')
    .where('createdAt', '<=', tsBefore(nowMs, minAgeMs))
    .where('createdAt', '>=', tsBefore(nowMs, 7 * DAY_MS))
    .get();

  for (const doc of snap.docs) {
    const session = doc.data();
    // 'complete' means they bought; 'open' and 'expired' both mean abandoned
    // (Stripe expires sessions after ~24h, so the 72h follow-up mostly sees
    // 'expired'). Status is filtered in code, not the query, to stay on
    // single-field indexes.
    if (session.status === 'complete' || !session.userId) continue;
    t.candidates++;
    const result = await sendLifecycleEmail({
      db,
      uid: session.userId,
      emailId,
      category: 'conversion',
      stream: 'conversion',
      template,
      rules: { stopIfPro: true, categoryNotWithinDays: 7 },
      dedupeKey: doc.id,
      dryRun
    });
    tally(t, result);
  }
  return t;
};

/**
 * Opened the payment modal, never started a checkout, 24h+ ago. Users who did
 * start a checkout are excluded — the abandoned-checkout emails own them.
 */
const sweepPricingNudge = async (db, { dryRun, nowMs }) => {
  const t = newTally();
  const snap = await db
    .collection('userSignals')
    .where('lastPaymentModalAt', '<=', tsBefore(nowMs, DAY_MS))
    .where('lastPaymentModalAt', '>=', tsBefore(nowMs, 14 * DAY_MS))
    .get();

  for (const doc of snap.docs) {
    const signals = doc.data();
    const startedCheckoutAfter =
      signals.lastCheckoutStartedAt &&
      signals.lastCheckoutStartedAt.toMillis() >=
        signals.lastPaymentModalAt.toMillis();
    if (startedCheckoutAfter) continue;
    t.candidates++;
    const result = await sendLifecycleEmail({
      db,
      uid: doc.id,
      emailId: 'pricingPageNudge',
      category: 'conversion',
      stream: 'conversion',
      template: TEMPLATES.pricingPageNudge,
      rules: { stopIfPro: true, notWithinDays: 30, categoryNotWithinDays: 7 },
      dryRun
    });
    tally(t, result);
  }
  return t;
};

/**
 * Signed up 3+ days ago, never activated a geospatial map. The welcome
 * email's emailLog timestamp is the signup marker (welcome fires on Auth
 * onCreate), which naturally scopes this to post-launch accounts.
 */
const sweepGeoNotUsed = async (db, { dryRun, nowMs }) => {
  const t = newTally();
  const snap = await db
    .collection('emailLog')
    .where('emails.welcome.lastSentAt', '<=', tsBefore(nowMs, 3 * DAY_MS))
    .where('emails.welcome.lastSentAt', '>=', tsBefore(nowMs, 30 * DAY_MS))
    .get();

  for (const doc of snap.docs) {
    const uid = doc.id;
    const tokenProfile = await db.collection('tokenProfile').doc(uid).get();
    if (tokenProfile.exists && tokenProfile.data().firstGeoActivatedAt) {
      continue; // they used geo — no nudge
    }
    t.candidates++;
    const result = await sendLifecycleEmail({
      db,
      uid,
      emailId: 'geoNotUsed',
      category: 'lifecycle',
      stream: 'lifecycle',
      template: TEMPLATES.geoNotUsed,
      rules: { onceEver: true, stopIfPro: true },
      dryRun
    });
    tally(t, result);
  }
  return t;
};

/**
 * Run every sweep once. Exported for the emulator tests and shared by the
 * hourly cron and the admin callable.
 */
const runLifecycleSweeps = async (db, { dryRun = false, nowMs } = {}) => {
  const now = nowMs ?? Date.now();
  const sweeps = {};

  sweeps.checkoutAbandoned1h = await sweepCheckoutAbandoned(db, {
    dryRun,
    nowMs: now,
    emailId: 'checkoutAbandoned1h',
    template: TEMPLATES.checkoutAbandoned1h,
    minAgeMs: HOUR_MS
  });

  sweeps.checkoutAbandoned72h = ENABLE_ABANDONED_72H
    ? await sweepCheckoutAbandoned(db, {
        dryRun,
        nowMs: now,
        emailId: 'checkoutAbandoned72h',
        template: TEMPLATES.checkoutAbandoned72h,
        minAgeMs: 72 * HOUR_MS
      })
    : { disabled: true };

  sweeps.pricingPageNudge = await sweepPricingNudge(db, {
    dryRun,
    nowMs: now
  });
  sweeps.geoNotUsed = await sweepGeoNotUsed(db, { dryRun, nowMs: now });

  const enabled = Object.values(sweeps).filter((s) => !s.disabled);
  return {
    dryRun,
    sent: enabled.reduce((n, s) => n + s.sent, 0),
    candidates: enabled.reduce((n, s) => n + s.candidates, 0),
    errors: enabled.reduce((n, s) => n + (s.skipped.error || 0), 0),
    sweeps
  };
};

/**
 * Hourly cron. Hourly (not daily) because the abandoned-checkout nudge is
 * time-sensitive — "an hour after you walked away", not "tomorrow at 9am".
 * The other sweeps just come along for the ride; stop-rules make repeat
 * scanning free.
 */
const lifecycleEmailSweep = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '256MB',
    secrets: ['POSTMARK_API_KEY', 'ALLOWED_PRO_TEAM_DOMAINS']
  })
  .pubsub.schedule('10 * * * *')
  .timeZone('America/Los_Angeles')
  .onRun(
    withJobHealth(
      'lifecycleEmailSweep',
      {
        schedule: '10 * * * *',
        timeZone: 'America/Los_Angeles',
        expectedIntervalMs: HOUR_MS,
        degradedKeys: ['errors']
      },
      async () => {
        const results = await runLifecycleSweeps(admin.firestore(), {});
        console.log('lifecycleEmailSweep complete:', JSON.stringify(results));
        return { success: true, ...results };
      }
    )
  );

/**
 * Admin callable mirror of the cron for testing. Dry run by default.
 *
 * From the browser console (admin claim required):
 *   await adminTools.triggerLifecycleSweep()                  // dry run
 *   await adminTools.triggerLifecycleSweep({ dryRun: false }) // actually send
 */
const triggerLifecycleSweep = functions
  .runWith({
    timeoutSeconds: 300,
    memory: '256MB',
    secrets: ['POSTMARK_API_KEY', 'ALLOWED_PRO_TEAM_DOMAINS']
  })
  .https.onCall(async (data, context) => {
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

    const dryRun = data?.dryRun ?? true; // default to dry run for safety
    const results = await runLifecycleSweeps(admin.firestore(), { dryRun });
    console.log(
      `triggerLifecycleSweep (dryRun=${dryRun}):`,
      JSON.stringify(results)
    );
    return { success: true, ...results };
  });

module.exports = {
  lifecycleEmailSweep,
  triggerLifecycleSweep,
  runLifecycleSweeps
};
