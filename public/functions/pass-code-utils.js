/**
 * Pass codes (#1922 follow-up) — pure helpers, no firebase imports, so
 * test/core/pass-code-utils.test.js and scripts/mint-pass-codes.js can require
 * this directly.
 *
 * A pass code lets someone other than the buyer receive a Project Pass: an
 * organization pays once for N passes (invoiced by hand for now) and gets ONE
 * shared code capped at N uses. Each recipient redeems it after signing in,
 * which runs the same grantPass fulfilment as a purchase. Their days start at
 * redemption, not at purchase.
 *
 * Firestore (server-only; rules deny all client access):
 *   passCodes/{CODE}          — { product, days, tokens, maxUses, uses,
 *                                 redeemBy, active, org, fromName,
 *                                 buyerEmail, notes, notifyEmail, createdAt,
 *                                 createdBy, lastRedeemedAt }
 *     `org` is internal (who paid); `fromName` is the optional display name
 *     recipients see ("Prof. Smith, WSU") in the redeem confirmation email
 *     and the invitation text. Omit it to keep the giver anonymous.
 *     `notifyEmail` (an address or a list) gets a status email on each
 *     redemption.
 *   passRedemptions/{CODE_uid} — one row per redemption; the doc id is also
 *                                 what stops a user redeeming a code twice and
 *                                 is grantPass's idempotency key.
 */

const { toMillis } = require('./pro-pass.js');

// Unambiguous characters only (no 0/O, 1/I/L) — codes get read aloud and
// retyped from slides.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_RANDOM_LENGTH = 8; // 31^8 ≈ 8.5e11 — not guessable at callable rates
const CODE_RE = /^[A-Z0-9][A-Z0-9-]{3,39}$/;

// Canonical form of user-typed input: trimmed, uppercased, inner whitespace
// removed. Returns null when the result can't be a code, so malformed input
// is rejected before any Firestore read.
const normalizePassCode = (raw) => {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toUpperCase().replace(/\s+/g, '');
  return CODE_RE.test(code) ? code : null;
};

// PREFIX-XXXXXXXX. `randomInt(max)` returns an integer in [0, max) — pass
// crypto.randomInt in production; injectable for tests.
const generatePassCode = (prefix, randomInt) => {
  const cleanPrefix = String(prefix || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 20);
  let suffix = '';
  for (let i = 0; i < CODE_RANDOM_LENGTH; i++) {
    suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return cleanPrefix ? `${cleanPrefix}-${suffix}` : suffix;
};

// Doc id of a user's redemption of a code. Codes never contain '_' or '/',
// and Firebase Auth uids never contain '/'.
const passRedemptionId = (code, userId) => `${code}_${userId}`;

// Why a code can't be redeemed right now, or null when it can. Checked inside
// the redemption transaction against the freshly read code doc.
const checkPassCodeRedeemable = (codeData, nowMs = Date.now()) => {
  if (!codeData) return 'not-found';
  if (codeData.active === false) return 'inactive';
  const redeemByMs = toMillis(codeData.redeemBy);
  if (redeemByMs !== null && redeemByMs <= nowMs) return 'expired';
  if (!Number.isFinite(codeData.days) || codeData.days <= 0) return 'invalid';
  if (!Number.isFinite(codeData.tokens) || codeData.tokens < 0) return 'invalid';
  if (!Number.isFinite(codeData.maxUses) || (codeData.uses || 0) >= codeData.maxUses) {
    return 'exhausted';
  }
  return null;
};

// Production app URL; other Firebase projects (e.g. dev-3dstreet) serve the
// app at their default <project>.web.app hosting domain.
const PROD_PROJECT_ID = 'dstreet-305604';
const appBaseForProject = (projectId) =>
  !projectId || projectId === PROD_PROJECT_ID
    ? 'https://3dstreet.app'
    : `https://${projectId}.web.app`;

const redeemLink = (code, baseUrl = 'https://3dstreet.app') =>
  `${baseUrl}/#redeem?code=${code}`;

// Ready-to-forward invitation for the buyer to paste into their own email
// (English; the buyer can edit it). Names the giver when fromName is set.
const buildInvitationText = ({ code, fromName, days, tokens, redeemByMs, baseUrl }) => {
  const duration = days % 30 === 0 ? `${days / 30} months` : `${days} days`;
  const deadline =
    Number.isFinite(redeemByMs)
      ? ` Redeem it by ${new Date(redeemByMs).toISOString().slice(0, 10)}.`
      : '';
  const giver = fromName ? `${fromName} has sent you` : "You've been sent";
  return `Subject: Your 3DStreet Project Pass

${giver} a 3DStreet Project Pass: ${duration} of 3DStreet Pro, plus ${tokens} AI generation tokens.

3DStreet is a browser-based tool for designing and sharing 3D street scenes. Pro includes watermark-free snapshots and HD renders, unlimited geospatial maps, glTF export, and more storage for your own 3D models, scans and images.

To claim it, open this link and sign in (or create a free account):
${redeemLink(code, baseUrl)}

Or enter this code: ${code}

Your ${duration} start when you redeem.${deadline} Nothing renews and you will not be charged.`;
};

module.exports = {
  CODE_ALPHABET,
  CODE_RANDOM_LENGTH,
  normalizePassCode,
  generatePassCode,
  passRedemptionId,
  checkPassCodeRedeemable,
  appBaseForProject,
  redeemLink,
  buildInvitationText
};
