/**
 * One-time gen-token pack definitions + pure token-balance math (#1374).
 *
 * Pricing model (v1): flat $0.10/token across every pack — no volume discount.
 * That matches the subscription per-token price exactly (PRO $10/100, MAX
 * $50/500), and pack demand is urgency-driven, so a discount buys nothing.
 * Update here, in the client mirror (src/shared/components/UpgradeModal/
 * pricing.js TOKEN_PACKS), and in the Stripe dashboard prices together;
 * test/shared/pricing-sync.test.js guards the client/server copies against
 * drifting and enforces the flat rate.
 *
 * No firebase imports in this module — test/core/token-packs.test.js requires
 * it directly under mocha.
 */

// `priceUsd` is informational (audit/log context); the amount actually charged
// is whatever the Stripe price object says. The price IDs live in Secret
// Manager (one secret per pack, resolved at call time via `priceIdEnv`) so the
// webhook and createStripeSession can both match line items against them.
const TOKEN_PACKS = [
  {
    id: 'starter',
    name: 'Starter',
    tokens: 100,
    priceUsd: 10,
    priceIdEnv: 'STRIPE_TOKENS_STARTER_PRICE_ID'
  },
  {
    id: 'standard',
    name: 'Standard',
    tokens: 250,
    priceUsd: 25,
    priceIdEnv: 'STRIPE_TOKENS_STANDARD_PRICE_ID'
  },
  {
    id: 'power',
    name: 'Power',
    tokens: 500,
    priceUsd: 50,
    priceIdEnv: 'STRIPE_TOKENS_POWER_PRICE_ID'
  }
];

// For functions.runWith({ secrets: [...] }) declarations.
const TOKEN_PACK_PRICE_SECRETS = TOKEN_PACKS.map((pack) => pack.priceIdEnv);

// Match a list of Stripe price IDs against the configured packs. Env vars are
// read at call time (not module load) because Cloud Functions injects secrets
// after require. Unset secrets never match — an unconfigured pack simply
// doesn't exist as far as matching is concerned.
const findTokenPackByPriceIds = (priceIds) => {
  if (!Array.isArray(priceIds) || priceIds.length === 0) return null;
  return (
    TOKEN_PACKS.find((pack) => {
      const configuredId = process.env[pack.priceIdEnv];
      return configuredId && priceIds.includes(configuredId);
    }) || null
  );
};

// Monthly refill tops UP to the allowance, never down: a balance above the
// allowance (one-time token pack purchases) must survive the refill. Extracted
// pure so the claw-back regression test in test/core/token-packs.test.js can
// exercise it without firebase-admin.
const computeMonthlyRefill = (currentBalance, monthlyAllowance) =>
  Math.max(currentBalance || 0, monthlyAllowance);

module.exports = {
  TOKEN_PACKS,
  TOKEN_PACK_PRICE_SECRETS,
  findTokenPackByPriceIds,
  computeMonthlyRefill
};
