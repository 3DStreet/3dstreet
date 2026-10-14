/**
 * Shared email transport: the raw Postmark API call and the Auth-backed
 * recipient lookup. Everything that sends email — the daily sweep in
 * scheduled/scheduledEmails.js, the lifecycle send service in
 * lifecycle-email.js, and the generation-ready notification — goes through
 * sendPostmarkEmail so stream routing and error handling live in one place.
 */

const admin = require('firebase-admin');
const { getAuth } = require('firebase-admin/auth');

const POSTMARK_API_URL = 'https://api.postmarkapp.com/email';

// Sender signatures: transactional mail keeps the root-domain address;
// broadcast streams send from the updates subdomain so marketing reputation
// is isolated from transactional deliverability.
const FROM_TRANSACTIONAL = 'notify@3dstreet.com';
const FROM_BROADCAST = 'team@updates.3dstreet.com';

/**
 * Send email via Postmark API
 *
 * options.stream selects the Postmark message stream: 'outbound'
 * (transactional, default) or a broadcast stream ('conversion', 'lifecycle')
 * where Postmark manages unsubscribe. Callers sending to a broadcast stream
 * must include an unsubscribe link/placeholder in the body (the lifecycle
 * send service in lifecycle-email.js appends one).
 */
const sendPostmarkEmail = async (
  toEmail,
  subject,
  htmlBody,
  textBody,
  options = {}
) => {
  const { stream = 'outbound' } = options;
  const apiKey = process.env.POSTMARK_API_KEY;

  if (!apiKey) {
    throw new Error('POSTMARK_API_KEY is not configured');
  }

  const response = await fetch(POSTMARK_API_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': apiKey
    },
    body: JSON.stringify({
      From: stream === 'outbound' ? FROM_TRANSACTIONAL : FROM_BROADCAST,
      To: toEmail,
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
      MessageStream: stream
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(
      `Postmark API error sending to ${toEmail}: status=${response.status}, body=${errorText}`
    );
    const err = new Error(`Postmark API error (${response.status}): ${errorText}`);
    err.status = response.status;
    try {
      err.postmarkCode = JSON.parse(errorText).ErrorCode ?? null;
    } catch {
      err.postmarkCode = null;
    }
    throw err;
  }

  return response.json();
};

// Postmark ErrorCodes that mean "this recipient can never be emailed as-is":
// 406 = inactive recipient (hard bounce, spam complaint or manual
// suppression), 300 = invalid email address. Deliberately NOT every 4xx:
// account/config problems (bad sender signature, unapproved account) also
// return 422, and treating those as permanent would silently drop every email
// during a misconfiguration. Those stay retryable, bounded by callers' caps.
const PERMANENT_RECIPIENT_CODES = new Set([300, 406]);

/** True when a sendPostmarkEmail error will fail the same way on every retry. */
const isPermanentRecipientError = (err) =>
  err?.status === 422 && PERMANENT_RECIPIENT_CODES.has(err?.postmarkCode);

// Undeliverable-address memory: emailPrefs/{uid}.undeliverable records the
// address Postmark permanently rejected, so sweeps skip it up front instead of
// re-hitting Postmark every run. Keyed to the address, so a user who changes
// their email is emailable again; postmarkSubscriptionWebhook clears it when
// Postmark reactivates the recipient.
const markUndeliverable = async (db, uid, email, err) => {
  await db
    .collection('emailPrefs')
    .doc(uid)
    .set(
      {
        userId: uid,
        undeliverable: {
          email,
          code: err?.postmarkCode ?? null,
          error: String(err?.message || err),
          at: admin.firestore.FieldValue.serverTimestamp()
        }
      },
      { merge: true }
    );
};

const isUndeliverable = async (db, uid, email) => {
  const snap = await db.collection('emailPrefs').doc(uid).get();
  const rec = snap.exists ? snap.data()?.undeliverable : null;
  return !!rec && rec.email === email;
};

/**
 * Get user info from Firebase Auth. displayName feeds the "Hi ${name}," email
 * greeting: Auth displayName when present (Google sign-ins), otherwise null so
 * localized templates can pick their own neutral greeting ("Hi there," /
 * "¡Hola!" — see CHROME in email/templates.js). Never fall back to the raw
 * email local-part ("Hi kieran.farr," reads like a mail merge gone wrong) or
 * the socialProfile username (those are auto-generated handles like
 * "streetcreator_x4f2").
 */
const getUserInfo = async (userId) => {
  try {
    const userRecord = await getAuth().getUser(userId);
    return {
      email: userRecord.email,
      displayName: userRecord.displayName || null
    };
  } catch (error) {
    console.error(`Failed to get user info for ${userId}:`, error);
    return null;
  }
};

module.exports = {
  sendPostmarkEmail,
  getUserInfo,
  isPermanentRecipientError,
  markUndeliverable,
  isUndeliverable
};
