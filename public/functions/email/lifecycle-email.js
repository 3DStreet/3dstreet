/**
 * Lifecycle email foundation (P0 wave, PR 1).
 *
 * One send path for every lifecycle email: suppression check → stop-rules
 * (transactional claim on the emailLog summary doc) → Postmark send → audit
 * record. Email *definitions* (templates + triggers) arrive in later PRs;
 * this module only ships the plumbing plus a `testPing` definition so the
 * whole pipeline can be exercised end-to-end via the admin callable.
 *
 * Firestore (all cloud-only, see firestore.rules):
 *   emailLog/{uid}            — summary doc backing stop-rules (shape in stop-rules.js)
 *   emailLog/{uid}/sends/{id} — append-only audit of every attempted send
 *   emailPrefs/{uid}          — per-stream suppression state, written by
 *                               postmarkSubscriptionWebhook
 *
 * Streams: 'outbound' is transactional (no unsubscribe). 'conversion' and
 * 'lifecycle' are Postmark broadcast streams that double as the category
 * preference center; broadcast sends get an unsubscribe footer appended and
 * are checked against emailPrefs first. Postmark manages the unsubscribe UI
 * and reports opt-outs back through the Subscription Change webhook.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');
const { assertAppCheck } = require('../app-check.js');
const { isUserProInternal } = require('../token-management.js');
const {
  sendPostmarkEmail,
  getUserInfo
} = require('../scheduled/scheduledEmails.js');
const { evaluateStopRules } = require('./stop-rules.js');

const TRANSACTIONAL_STREAM = 'outbound';
// Broadcast streams live in Postmark (created manually in the dashboard;
// stream IDs must match these strings). Add 'expansion' / 're-engagement'
// when P1 emails need them.
const BROADCAST_STREAMS = ['conversion', 'lifecycle'];

// Appended to broadcast-stream messages. Postmark replaces the placeholder
// with a per-recipient, per-stream unsubscribe URL.
const UNSUBSCRIBE_HTML = `
  <p style="font-size: 12px; color: #999;">
    Don't want these emails?
    <a href="{{{ pm:unsubscribe_url }}}" style="color: #6366f1;">Unsubscribe</a>.
  </p>`;
const UNSUBSCRIBE_TEXT = `

---
Don't want these emails? Unsubscribe: {{{ pm:unsubscribe_url }}}`;

/**
 * Send one lifecycle email to one user, enforcing suppression + stop-rules.
 *
 * Idempotent under concurrent triggers (e.g. a retried Stripe webhook): the
 * stop-rule check and the send claim happen in one Firestore transaction on
 * emailLog/{uid}, so only one caller can claim a given send. On a Postmark
 * failure the claim is rolled back so a later sweep can retry.
 *
 * @param {Object} p
 * @param {Object} p.db - Firestore instance
 * @param {string} p.uid - Firebase Auth uid of the recipient
 * @param {string} p.emailId - stable id, e.g. 'welcome', 'checkoutAbandoned1h'
 * @param {string} p.category - preference category, e.g. 'transactional', 'conversion'
 * @param {string} p.stream - Postmark stream ('outbound' | broadcast stream id)
 * @param {Object} p.template - { getSubject(name, data), getHtmlBody(name, data), getTextBody(name, data) }
 * @param {Object} [p.data] - template data
 * @param {Object} [p.rules] - stop-rules (see stop-rules.js)
 * @param {string} [p.dedupeKey] - once-per-key guard (invoice id, session id)
 * @param {boolean} [p.dryRun] - evaluate everything, claim and send nothing
 * @returns {Promise<{action: 'sent'|'would-send'|'skipped'|'no-email'|'error', reason?: string, messageId?: string}>}
 */
const sendLifecycleEmail = async ({
  db,
  uid,
  emailId,
  category,
  stream,
  template,
  data = {},
  rules = {},
  dedupeKey = null,
  dryRun = false
}) => {
  const isBroadcast = stream !== TRANSACTIONAL_STREAM;
  if (isBroadcast && !BROADCAST_STREAMS.includes(stream)) {
    return { action: 'error', reason: `unknown stream: ${stream}` };
  }

  const userInfo = await getUserInfo(uid);
  if (!userInfo?.email) {
    return { action: 'no-email' };
  }

  // Async pre-checks happen outside the transaction; the transaction re-checks
  // everything that lives in the summary doc.
  const isPro = rules.stopIfPro ? await isUserProInternal(uid) : false;

  // Broadcast sends respect the recipient's stream-level opt-out. Postmark
  // also suppresses server-side; this check just avoids counting a suppressed
  // send against stop-rule windows. Transactional mail skips it by design.
  if (isBroadcast) {
    const prefs = await db.collection('emailPrefs').doc(uid).get();
    if (prefs.exists && prefs.data()?.streams?.[stream]?.suppressed) {
      return { action: 'skipped', reason: 'unsubscribed' };
    }
  }

  const summaryRef = db.collection('emailLog').doc(uid);

  // Transaction: evaluate stop-rules against the live summary doc and claim
  // the send by writing it. `prevEntries` captures the pre-claim state so a
  // failed Postmark call can roll the claim back.
  let outcome = null; // { action, reason } when blocked/dry-run; null → claimed
  let prevEntries = null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(summaryRef);
    const summary = snap.exists ? snap.data() : null;

    const verdict = evaluateStopRules({
      emailId,
      category,
      rules,
      summary,
      dedupeKey,
      isPro
    });
    if (!verdict.allowed) {
      outcome = { action: 'skipped', reason: verdict.reason };
      return;
    }
    if (dryRun) {
      outcome = { action: 'would-send' };
      return;
    }

    prevEntries = {
      email: summary?.emails?.[emailId] ?? null,
      category: summary?.categories?.[category] ?? null
    };
    const now = admin.firestore.FieldValue.serverTimestamp();
    // set + merge (not update) so map keys like Stripe ids are literal and the
    // doc is created on first send.
    tx.set(
      summaryRef,
      {
        userId: uid,
        email: userInfo.email,
        updatedAt: now,
        emails: {
          [emailId]: {
            lastSentAt: now,
            sentCount: admin.firestore.FieldValue.increment(1),
            ...(dedupeKey ? { dedupeKeys: { [dedupeKey]: now } } : {})
          }
        },
        categories: { [category]: { lastSentAt: now } }
      },
      { merge: true }
    );
  });

  if (outcome) {
    return outcome;
  }

  const subject = template.getSubject(userInfo.displayName, data);
  let htmlBody = template.getHtmlBody(userInfo.displayName, data);
  let textBody = template.getTextBody(userInfo.displayName, data);
  if (isBroadcast) {
    htmlBody = htmlBody.includes('</body>')
      ? htmlBody.replace('</body>', `${UNSUBSCRIBE_HTML}</body>`)
      : htmlBody + UNSUBSCRIBE_HTML;
    textBody += UNSUBSCRIBE_TEXT;
  }

  try {
    const result = await sendPostmarkEmail(
      userInfo.email,
      subject,
      htmlBody,
      textBody,
      { stream }
    );
    await summaryRef.collection('sends').add({
      emailId,
      category,
      stream,
      to: userInfo.email,
      subject,
      dedupeKey,
      status: 'sent',
      messageId: result.MessageID || null,
      sentAt: admin.firestore.FieldValue.serverTimestamp()
    });
    console.log(
      `Sent lifecycle email ${emailId} to ${userInfo.email} (stream=${stream}, MessageID=${result.MessageID})`
    );
    return { action: 'sent', messageId: result.MessageID };
  } catch (err) {
    // Roll the claim back so a retry/sweep isn't blocked by a send that never
    // happened. Restoring the captured pre-claim entries can race another
    // concurrent send of a *different* email to the same user (only the
    // category entry overlaps); at current volumes that's acceptable.
    await summaryRef
      .set(
        {
          emails: { [emailId]: prevEntries.email },
          categories: { [category]: prevEntries.category }
        },
        { merge: true }
      )
      .catch(() => {});
    await summaryRef
      .collection('sends')
      .add({
        emailId,
        category,
        stream,
        to: userInfo.email,
        subject,
        dedupeKey,
        status: 'error',
        error: String(err?.message || err),
        sentAt: admin.firestore.FieldValue.serverTimestamp()
      })
      .catch(() => {});
    console.error(`Lifecycle email ${emailId} failed for ${uid}:`, err);
    return { action: 'error', reason: err?.message || String(err) };
  }
};

// ============================================================================
// TEST EMAIL — exercises the full pipeline (prefs → stop-rules → stream →
// emailLog) before any real P0 email exists. Admin-only via the callable.
// ============================================================================

const TEST_TEMPLATE = {
  getSubject: (userName, { stream }) =>
    `[3DStreet test] lifecycle email pipeline (${stream} stream)`,
  getTextBody: (userName, { stream }) => `Hi ${userName},

This is a test of the 3DStreet lifecycle email pipeline, sent via the "${stream}" Postmark stream.

If you weren't expecting this, an admin is testing email infrastructure — no action needed.

The 3DStreet Team
https://3dstreet.com`,
  getHtmlBody: (userName, { stream }) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #1a1a1a;">Hi ${userName},</h2>
  <p>This is a test of the 3DStreet lifecycle email pipeline, sent via the <strong>${stream}</strong> Postmark stream.</p>
  <p>If you weren't expecting this, an admin is testing email infrastructure — no action needed.</p>
  <p style="color: #666;">The 3DStreet Team<br>
  <a href="https://3dstreet.com" style="color: #6366f1;">https://3dstreet.com</a></p>
</body>
</html>`
};

/**
 * Admin callable to exercise sendLifecycleEmail end-to-end. Defaults to a
 * dry run against the caller themselves.
 *
 * From the browser console (admin claim required):
 *   await adminTools.testLifecycleEmail()                          // dry run, outbound
 *   await adminTools.testLifecycleEmail({ stream: 'conversion' })  // dry run, broadcast
 *   await adminTools.testLifecycleEmail({ dryRun: false })         // actually send
 */
const triggerLifecycleEmail = functions
  .runWith({
    timeoutSeconds: 60,
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

    const uid = data?.uid || context.auth.uid;
    const stream = data?.stream || TRANSACTIONAL_STREAM;
    const dryRun = data?.dryRun ?? true; // default to dry run for safety
    const isBroadcast = stream !== TRANSACTIONAL_STREAM;

    const result = await sendLifecycleEmail({
      db: admin.firestore(),
      uid,
      emailId: 'testPing',
      category: isBroadcast ? stream : 'transactional',
      stream,
      template: TEST_TEMPLATE,
      data: { stream },
      rules: {}, // repeatable on purpose — it's an admin-only test
      dryRun
    });

    console.log(
      `triggerLifecycleEmail uid=${uid} stream=${stream} dryRun=${dryRun}:`,
      JSON.stringify(result)
    );
    return { uid, stream, dryRun, ...result };
  });

// ============================================================================
// POSTMARK SUBSCRIPTION CHANGE WEBHOOK
// ============================================================================

/**
 * Receives Postmark's Subscription Change webhook and mirrors per-stream
 * opt-out state into emailPrefs/{uid}. Postmark enforces suppression on its
 * side regardless; this sync exists so eligibility sweeps can skip suppressed
 * users up front (and so we have consent state in our own database).
 *
 * Payload (RecordType 'SubscriptionChange'): Recipient, MessageStream,
 * SuppressSender (true = suppressed, false = reactivated), SuppressionReason
 * ('ManualSuppression' | 'HardBounce' | 'SpamComplaint'), Origin, ChangedAt.
 *
 * Auth: the webhook URL is configured in Postmark with HTTP Basic credentials
 * that must match the POSTMARK_WEBHOOK_AUTH secret ("username:password").
 * Fail closed — without the secret or with a bad header, reject.
 */
const postmarkSubscriptionWebhook = functions
  .runWith({ secrets: ['POSTMARK_WEBHOOK_AUTH'] })
  .https.onRequest(async (req, res) => {
    if (req.method !== 'POST') {
      return res.status(405).send('Method Not Allowed');
    }

    const expected = process.env.POSTMARK_WEBHOOK_AUTH;
    if (!expected) {
      console.error('POSTMARK_WEBHOOK_AUTH is not configured');
      return res.status(500).send('Webhook auth not configured');
    }
    const expectedHeader = `Basic ${Buffer.from(expected).toString('base64')}`;
    if (req.headers.authorization !== expectedHeader) {
      console.warn('postmarkSubscriptionWebhook: bad or missing auth header');
      return res.status(401).send('Unauthorized');
    }

    const body = req.body || {};
    // Postmark's "send test" and other record types land here too; ack and
    // ignore anything that isn't a subscription change.
    if (body.RecordType !== 'SubscriptionChange' || !body.Recipient) {
      console.log(
        `postmarkSubscriptionWebhook: ignoring RecordType=${body.RecordType}`
      );
      return res.status(200).json({ ok: true, ignored: true });
    }

    let userRecord;
    try {
      userRecord = await getAuth().getUserByEmail(body.Recipient);
    } catch (err) {
      // Not one of our users (or a deleted account). Postmark still enforces
      // its own suppression; nothing to record. 200 so Postmark doesn't retry.
      console.warn(
        `postmarkSubscriptionWebhook: no user for ${body.Recipient} (${err.code || err.message})`
      );
      return res.status(200).json({ ok: true, matched: false });
    }

    const stream = body.MessageStream || 'unknown';
    await admin
      .firestore()
      .collection('emailPrefs')
      .doc(userRecord.uid)
      .set(
        {
          userId: userRecord.uid,
          email: body.Recipient,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          streams: {
            [stream]: {
              suppressed: body.SuppressSender === true,
              reason: body.SuppressionReason || null,
              origin: body.Origin || null,
              changedAt: body.ChangedAt ? new Date(body.ChangedAt) : null
            }
          }
        },
        { merge: true }
      );

    console.log(
      `postmarkSubscriptionWebhook: ${body.Recipient} stream=${stream} suppressed=${body.SuppressSender === true}`
    );
    return res.status(200).json({ ok: true, matched: true });
  });

module.exports = {
  sendLifecycleEmail,
  triggerLifecycleEmail,
  postmarkSubscriptionWebhook,
  TRANSACTIONAL_STREAM,
  BROADCAST_STREAMS
};
