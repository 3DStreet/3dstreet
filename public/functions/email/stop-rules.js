/**
 * Pure stop-rule evaluation for lifecycle emails.
 *
 * No firebase-admin dependency on purpose: this module is unit-tested directly
 * (test/core/email-stop-rules.test.js) without an emulator. The send service
 * (lifecycle-email.js) calls evaluateStopRules inside a Firestore transaction
 * against the user's emailLog summary doc.
 *
 * Summary doc shape (emailLog/{uid}):
 *   {
 *     userId, email, updatedAt,
 *     emails:     { [emailId]:  { lastSentAt, sentCount, dedupeKeys: { [key]: sentAt } } },
 *     categories: { [category]: { lastSentAt } }
 *   }
 *
 * Supported rules:
 *   onceEver: true              — never resend this emailId
 *   notWithinDays: N            — skip if this emailId sent in the last N days
 *   categoryNotWithinDays: N    — skip if ANY email in this category sent in
 *                                 the last N days (e.g. ≤1 conversion email / 7d)
 *   stopIfPro: true             — evaluated by the caller (async Auth lookup);
 *                                 pass the result in as `isPro`
 *   dedupeKey (send param)      — skip if this exact key was already recorded
 *                                 for this emailId (once per invoice/session)
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// Accepts Firestore Timestamp, Date, or epoch ms; null when absent/unparseable.
const toMillis = (v) => {
  if (v == null) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  return null;
};

/**
 * @returns {{allowed: boolean, reason: string|null}} reason is set iff blocked
 */
const evaluateStopRules = ({
  emailId,
  category,
  rules = {},
  summary = null,
  dedupeKey = null,
  isPro = false,
  nowMs = Date.now()
}) => {
  if (rules.stopIfPro && isPro) {
    return { allowed: false, reason: 'pro' };
  }

  const emailEntry = summary?.emails?.[emailId];

  if (rules.onceEver && emailEntry?.lastSentAt) {
    return { allowed: false, reason: 'onceEver' };
  }

  if (rules.notWithinDays > 0) {
    const last = toMillis(emailEntry?.lastSentAt);
    if (last != null && nowMs - last < rules.notWithinDays * DAY_MS) {
      return { allowed: false, reason: 'notWithinDays' };
    }
  }

  if (rules.categoryNotWithinDays > 0 && category) {
    const last = toMillis(summary?.categories?.[category]?.lastSentAt);
    if (last != null && nowMs - last < rules.categoryNotWithinDays * DAY_MS) {
      return { allowed: false, reason: 'categoryNotWithinDays' };
    }
  }

  if (dedupeKey && emailEntry?.dedupeKeys?.[dedupeKey] != null) {
    return { allowed: false, reason: 'dedupeKey' };
  }

  return { allowed: true, reason: null };
};

module.exports = { evaluateStopRules, toMillis, DAY_MS };
