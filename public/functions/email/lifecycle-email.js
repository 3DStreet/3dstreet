/**
 * Lifecycle email send service.
 *
 * One send path for every lifecycle email: suppression check → stop-rules
 * (transactional claim on the emailLog summary doc) → Postmark send → audit
 * record. Email *definitions* (templates + triggers) live with their
 * triggers — e.g. the tokenExhaustion sweep in scheduled/scheduledEmails.js —
 * and call sendLifecycleEmail to do the sending. See docs/email-lifecycle.md
 * (repo root) for the full system overview and how to add a new email.
 *
 * Firestore (all cloud-only, see firestore.rules):
 *   emailLog/{uid}            — summary doc backing stop-rules (shape in stop-rules.js)
 *   emailLog/{uid}/sends/{id} — audit of every attempted send. status is
 *                               'pending' (claimed, Postmark call in flight;
 *                               written atomically with the claim) → 'sent' or
 *                               'error' (claim rolled back). A record stuck on
 *                               'pending' means the instance died mid-send:
 *                               the claim survives but no email went out —
 *                               rare enough at current volumes that we surface
 *                               it as data instead of building a sweep.
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
const { sendPostmarkEmail, getUserInfo } = require('./postmark.js');
const { evaluateStopRules } = require('./stop-rules.js');
const {
  DEFAULT_EMAIL_LOCALE,
  normalizeEmailLocale,
  resolveEmailLocale
} = require('./locale.js');

const TRANSACTIONAL_STREAM = 'outbound';
// Broadcast streams live in Postmark (created manually in the dashboard;
// stream IDs must match these strings). Add 'expansion' / 're-engagement'
// when P1 emails need them.
const BROADCAST_STREAMS = ['conversion', 'lifecycle'];

// Appended to broadcast-stream messages, in the recipient's locale. Postmark
// replaces the placeholder with a per-recipient, per-stream unsubscribe URL.
const unsubscribeHtml = (prompt, label) => `
  <p style="font-size: 12px; color: #999;">
    ${prompt}
    <a href="{{{ pm:unsubscribe_url }}}" style="color: #6366f1;">${label}</a>.
  </p>`;
const unsubscribeText = (prompt, label) => `

---
${prompt} ${label}: {{{ pm:unsubscribe_url }}}`;

const UNSUBSCRIBE = {
  en: {
    html: unsubscribeHtml("Don't want these emails?", 'Unsubscribe'),
    text: unsubscribeText("Don't want these emails?", 'Unsubscribe')
  },
  es: {
    html: unsubscribeHtml(
      '¿No quieres recibir estos correos?',
      'Cancela tu suscripción'
    ),
    text: unsubscribeText(
      '¿No quieres recibir estos correos?',
      'Cancela tu suscripción'
    )
  },
  'pt-BR': {
    html: unsubscribeHtml(
      'Não quer receber estes e-mails?',
      'Cancelar inscrição'
    ),
    text: unsubscribeText(
      'Não quer receber estes e-mails?',
      'Cancelar inscrição'
    )
  },
  fr: {
    html: unsubscribeHtml(
      'Vous ne souhaitez plus recevoir ces e-mails ?',
      'Se désinscrire'
    ),
    text: unsubscribeText(
      'Vous ne souhaitez plus recevoir ces e-mails ?',
      'Se désinscrire'
    )
  }
};

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
 * @param {Object} p.template - { getSubject(name, data, locale), getHtmlBody(name, data, locale), getTextBody(name, data, locale) }
 * @param {Object} [p.data] - template data
 * @param {Object} [p.rules] - stop-rules (see stop-rules.js)
 * @param {string} [p.dedupeKey] - once-per-key guard (invoice id, session id)
 * @param {string} [p.locale] - explicit send locale; omit to resolve from the
 *   recipient's profile (locale.js), falling back to 'en'
 * @param {boolean} [p.dryRun] - evaluate everything, claim and send nothing
 * @returns {Promise<{action: 'sent'|'would-send'|'skipped'|'no-email'|'error', reason?: string, messageId?: string, to?: string, subject?: string}>}
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
  locale = null,
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

  // Locale: explicit param wins (normalized); otherwise resolved from the
  // recipient's socialProfile (explicit UI pick > detected browser locale >
  // 'en'). Templates receive it as their third argument.
  const sendLocale = locale
    ? normalizeEmailLocale(locale)
    : await resolveEmailLocale(db, uid);

  const subject = template.getSubject(userInfo.displayName, data, sendLocale);
  let htmlBody = template.getHtmlBody(userInfo.displayName, data, sendLocale);
  let textBody = template.getTextBody(userInfo.displayName, data, sendLocale);
  if (isBroadcast) {
    const unsubscribe =
      UNSUBSCRIBE[sendLocale] || UNSUBSCRIBE[DEFAULT_EMAIL_LOCALE];
    htmlBody = htmlBody.includes('</body>')
      ? htmlBody.replace('</body>', `${unsubscribe.html}</body>`)
      : htmlBody + unsubscribe.html;
    textBody += unsubscribe.text;
  }

  // Transaction: evaluate stop-rules against the live summary doc and claim
  // the send by writing it, atomically with a status:'pending' audit record.
  // `prevEntries` captures the pre-claim state so a failed Postmark call can
  // roll the claim back. If the instance dies between this commit and the
  // Postmark response, the claim sticks and the audit record stays 'pending'
  // forever — that's the detectable signal for a (future) orphan sweep; at
  // current volumes we accept the tiny crash window rather than build one now.
  const sendRef = summaryRef.collection('sends').doc();
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
      outcome = { action: 'would-send', to: userInfo.email, subject };
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
    tx.set(sendRef, {
      emailId,
      category,
      stream,
      to: userInfo.email,
      subject,
      locale: sendLocale,
      dedupeKey,
      status: 'pending',
      createdAt: now
    });
  });

  if (outcome) {
    return outcome;
  }

  try {
    const result = await sendPostmarkEmail(
      userInfo.email,
      subject,
      htmlBody,
      textBody,
      { stream }
    );
    await sendRef.update({
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
    // happened. update() with FieldPath replaces the ENTIRE entry (unlike
    // set+merge, which would leave a freshly-added dedupeKey behind and block
    // the retry forever); FieldPath segments are literal, so Stripe ids and
    // other dotted keys are safe. Restoring the captured pre-claim entries can
    // race another concurrent send of a *different* email to the same user
    // (only the category entry overlaps); at current volumes that's acceptable.
    const { FieldPath, FieldValue } = admin.firestore;
    await summaryRef
      .update(
        new FieldPath('emails', emailId),
        prevEntries.email ?? FieldValue.delete(),
        new FieldPath('categories', category),
        prevEntries.category ?? FieldValue.delete()
      )
      .catch(() => {});
    await sendRef
      .update({
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
// emailLog) without touching any real email's state. Admin-only via the
// callable.
// ============================================================================

const TEST_TEMPLATE = {
  getSubject: (userName, { stream }) =>
    `[3DStreet test] lifecycle email pipeline (${stream} stream)`,
  getTextBody: (userName, { stream }) => `Hi ${userName || 'there'},

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
  <h2 style="color: #1a1a1a;">Hi ${userName || 'there'},</h2>
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
 * SuppressSending (true = suppressed, false = reactivated), SuppressionReason
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
              suppressed: body.SuppressSending === true,
              reason: body.SuppressionReason || null,
              origin: body.Origin || null,
              changedAt: body.ChangedAt ? new Date(body.ChangedAt) : null
            }
          }
        },
        { merge: true }
      );

    console.log(
      `postmarkSubscriptionWebhook: ${body.Recipient} stream=${stream} suppressed=${body.SuppressSending === true}`
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
