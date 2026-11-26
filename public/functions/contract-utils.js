/**
 * A team's contract terms (#1267, docs/orgs.md#contract-terms): the pure
 * rules, no Firebase. The Firestore side is in org-contracts.js.
 *
 * Staff record what a customer agreed to: how they pay, the price (which
 * overrides the published one), until when they've paid, and who gets the
 * invoices. The team's token budget override stays on its wallet
 * (orgWallets.customBudget, docs/team-wallet.md).
 */

const { isPlausibleEmail, normalizeEmail } = require('./org-utils.js');

// stripe: a subscription (P3); invoice: billed by hand; comp: free of charge.
const BILLING_SOURCES = ['stripe', 'invoice', 'comp'];
const PRICE_INTERVALS = ['month', 'year'];
const CONTRACT_FIELDS = [
  'billingSource',
  'price',
  'paidThrough',
  'autoRenew',
  'billingContact',
  'invoiceReference',
  'notes'
];

const isAmount = (value) => Number.isInteger(value) && value >= 0 && value <= 100000000;
const isCurrency = (value) => typeof value === 'string' && /^[a-z]{3}$/.test(value);
const isDateMs = (value) => Number.isInteger(value) && value > 0;
const text = (value, max) => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length <= max ? trimmed || null : undefined;
};

/**
 * The validated contract fields of a staff patch: each value checked, null
 * clears a field, dates are ms. Returns { fields } or { refusal } with
 * 'unknown-field' or 'invalid-contract'.
 */
const contractPatch = (patch = {}) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { refusal: 'invalid-contract' };
  if (Object.keys(patch).some((key) => !CONTRACT_FIELDS.includes(key))) return { refusal: 'unknown-field' };
  const fields = {};
  for (const [key, value] of Object.entries(patch)) {
    let ok = true;
    let next = value;
    if (value === null) {
      ok = key !== 'billingSource' && key !== 'autoRenew';
    } else if (key === 'billingSource') {
      ok = BILLING_SOURCES.includes(value);
    } else if (key === 'autoRenew') {
      ok = typeof value === 'boolean';
    } else if (key === 'paidThrough') {
      ok = isDateMs(value);
    } else if (key === 'price') {
      ok =
        isAmount(value.amount) &&
        isCurrency(value.currency) &&
        PRICE_INTERVALS.includes(value.interval);
      next = ok ? { amount: value.amount, currency: value.currency, interval: value.interval } : null;
    } else if (key === 'billingContact') {
      const name = text(value.name ?? '', 120);
      const email = normalizeEmail(value.email);
      ok = name !== undefined && isPlausibleEmail(email);
      next = { name, email };
    } else {
      next = text(value, key === 'notes' ? 5000 : 200);
      ok = next !== undefined;
    }
    if (!ok) return { refusal: 'invalid-contract' };
    fields[key] = next;
  }
  return { fields };
};

/**
 * A payment staff record: { amount, currency, paidAt, paidThrough, reference }
 * (dates in ms). Returns { payment } or { refusal: 'invalid-payment' }.
 * Paying extends the contract to `paidThrough`.
 */
const paymentRecord = ({ amount, currency, paidAt, paidThrough, reference } = {}) => {
  const ref = reference == null ? null : text(reference, 200);
  if (
    !isAmount(amount) ||
    !isCurrency(currency) ||
    !isDateMs(paidAt) ||
    !isDateMs(paidThrough) ||
    ref === undefined
  ) {
    return { refusal: 'invalid-payment' };
  }
  return { payment: { amount, currency, paidAt, paidThrough, reference: ref } };
};

module.exports = {
  BILLING_SOURCES,
  PRICE_INTERVALS,
  CONTRACT_FIELDS,
  contractPatch,
  paymentRecord
};
