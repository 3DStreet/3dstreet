/**
 * Pass code redemption (#1922 follow-up). Data model and code format live in
 * pass-code-utils.js; codes are minted by scripts/mint-pass-codes.js (sold by
 * hand for now). Fulfilment is the same grantPass as a paid Project Pass.
 * A successful redemption sends the recipient a "your pass is active"
 * email (passActivated), naming who it's from when the code has a fromName.
 */
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { assertAppCheck } = require('./app-check.js');
const { grantPass } = require('./token-management.js');
const { sendLifecycleEmail } = require('./email/lifecycle-email.js');
const EMAIL_TEMPLATES = require('./email/templates.js');
const {
  normalizePassCode,
  passRedemptionId,
  checkPassCodeRedeemable
} = require('./pass-code-utils.js');

/**
 * Redeem `rawCode` for `userId`. Two steps, both retry-safe:
 *
 *   1. One transaction on the code + this user's redemption row: if the row
 *      already exists this is a repeat (no new use is consumed); otherwise
 *      validate the code, increment `uses` and create the row. The code doc
 *      read serializes concurrent redemptions, so `maxUses` can't be exceeded.
 *   2. grantPass keyed on the redemption id. Idempotent, so a repeat call —
 *      including one after a crash between steps 1 and 2 — completes a
 *      half-finished redemption instead of double-granting.
 *   3. The passActivated email, deduped on the redemption id: sent once per
 *      redemption, and retried by a repeat call if the first send failed.
 *      Best-effort — an email problem never fails the redemption.
 *
 * Returns { status: 'redeemed' | 'already-redeemed', days, tokens, fromName,
 * proUntilMs }
 * or { status: <reason> } with reason one of 'invalid-code', 'not-found',
 * 'inactive', 'expired', 'exhausted', 'invalid', 'grant-failed'.
 */
const redeemPassCodeForUser = async (userId, rawCode, { nowMs = Date.now() } = {}) => {
  const code = normalizePassCode(rawCode);
  if (!code) return { status: 'invalid-code' };

  const db = admin.firestore();
  const codeRef = db.collection('passCodes').doc(code);
  const redemptionId = passRedemptionId(code, userId);
  const redemptionRef = db.collection('passRedemptions').doc(redemptionId);

  const step1 = await db.runTransaction(async (tx) => {
    const [codeDoc, redemptionDoc] = await Promise.all([tx.get(codeRef), tx.get(redemptionRef)]);
    if (redemptionDoc.exists) {
      const { days, tokens, product = 'project', fromName = null } = redemptionDoc.data();
      return { status: 'already-redeemed', days, tokens, product, fromName };
    }
    const codeData = codeDoc.exists ? codeDoc.data() : null;
    const reason = checkPassCodeRedeemable(codeData, nowMs);
    if (reason) return { status: reason };

    const { days, tokens, product = 'project', org = null, fromName = null } = codeData;
    tx.update(codeRef, {
      uses: admin.firestore.FieldValue.increment(1),
      lastRedeemedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    tx.set(redemptionRef, {
      code,
      userId,
      product,
      org,
      fromName,
      days,
      tokens,
      redeemedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { status: 'redeemed', days, tokens, product, fromName };
  });

  if (step1.status !== 'redeemed' && step1.status !== 'already-redeemed') {
    return step1;
  }

  const grant = await grantPass(userId, {
    days: step1.days,
    tokens: step1.tokens,
    idempotencyKey: redemptionId,
    source: 'pass-code',
    details: { passCode: code, product: step1.product }
  });
  if (!grant.granted) {
    console.error(`pass code grant failed (${grant.reason}): code=${code} user=${userId}`);
    return { status: 'grant-failed' };
  }

  try {
    const email = await sendLifecycleEmail({
      db,
      uid: userId,
      emailId: 'passActivated',
      category: 'transactional',
      stream: 'outbound',
      template: EMAIL_TEMPLATES.passActivated,
      data: {
        fromName: step1.fromName,
        days: step1.days,
        tokens: step1.tokens,
        proUntilMs: grant.proUntilMs
      },
      dedupeKey: redemptionId
    });
    console.log(`passActivated for ${redemptionId}:`, JSON.stringify(email));
  } catch (err) {
    console.error(`passActivated email failed for ${redemptionId}:`, err);
  }

  return { ...step1, proUntilMs: grant.proUntilMs };
};

// Client-facing error codes. 'already-redeemed' is NOT an error: the caller
// gets their (unchanged) pass back so a double click or reload is harmless.
const REASON_TO_HTTPS = {
  'invalid-code': ['invalid-argument', 'That code is not valid.'],
  'not-found': ['not-found', 'That code is not valid.'],
  inactive: ['failed-precondition', 'That code is no longer active.'],
  expired: ['deadline-exceeded', 'That code has expired.'],
  exhausted: ['resource-exhausted', 'That code has been fully redeemed.'],
  invalid: ['failed-precondition', 'That code is misconfigured. Please contact support.'],
  'grant-failed': ['internal', 'Could not apply the pass. Please try again.']
};

// POSTMARK_API_KEY: the passActivated confirmation email.
const redeemPassCode = functions
  .runWith({ secrets: ['POSTMARK_API_KEY'] })
  .https
  .onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Sign in to redeem a code.');
    }
    assertAppCheck(context);

    const result = await redeemPassCodeForUser(context.auth.uid, data && data.code);
    if (result.status === 'redeemed' || result.status === 'already-redeemed') {
      return {
        status: result.status,
        days: result.days,
        tokens: result.tokens,
        fromName: result.fromName || null,
        proUntil: result.proUntilMs ? new Date(result.proUntilMs).toISOString() : null
      };
    }
    const [code, message] = REASON_TO_HTTPS[result.status] || REASON_TO_HTTPS['grant-failed'];
    // `reason` lets the client pick localized copy without parsing messages.
    throw new functions.https.HttpsError(code, message, { reason: result.status });
  });

module.exports = { redeemPassCode, redeemPassCodeForUser };
