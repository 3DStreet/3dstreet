/**
 * One-time time-boxed Pro passes (#1922) — definitions + pure entitlement math.
 *
 * A pass is a one-time purchase (no subscription object, no renewal) that
 * grants Pro-tier access for a fixed number of days plus an up-front
 * gen-token lump sum. The only new account state is `proUntil`, stored on
 * tokenProfile/{uid} (NOT in auth custom claims — the Stripe webhooks call
 * setCustomUserClaims({ plan }), which replaces the whole claims object and
 * would wipe it; and NOT on userProfile, which owners can update from the
 * client). Firestore rules deny every client update to tokenProfile and
 * forbid a client-created profile from carrying `proUntil`.
 *
 * Expiry is evaluated when entitlement is read (hasProEntitlement), never by
 * a scheduled job: a missed job can't leave anyone Pro forever, and nothing
 * — scenes, assets, tokens already granted — is touched when a pass lapses.
 *
 * Pass holders get NO monthly token top-up: the refill in
 * token-management.js keys off the subscription plan claim (and team domain)
 * only. The pass's lump sum replaces the drip.
 *
 * How a pass is delivered today: sold by hand (Stripe invoice or Payment
 * Link), then a pass code is minted (scripts/mint-pass-codes.js) and
 * redeemed through pass-codes.js → grantPass. Self-serve checkout
 * (#project-pass, matching the price in stripe.js) is a follow-up; the
 * price-matching helpers below are for it and are not wired in yet.
 *
 * Update a pass here, in the client mirror (src/shared/components/
 * UpgradeModal/pricing.js PRO_PASSES), and in the Stripe dashboard
 * price together; test/shared/pricing-sync.test.js guards the two copies.
 *
 * No firebase imports in this module — test/core/pro-pass.test.js requires it
 * directly under mocha.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// `priceUsd` is informational (audit/log context); the amount charged is
// whatever the Stripe price object says. Price IDs live in Secret Manager,
// resolved at call time via `priceIdEnv`, same as TOKEN_PACKS.
//
// A second pass SKU (e.g. a team/client variant with different days and
// tokens) is a config-only change: add an entry + its secret.
//
// `priceIdEnv` is not read by any deployed function yet. When the self-serve
// checkout follow-up declares it in runWith() (createStripeSession,
// stripeWebhook), `firebase deploy` will FAIL until the secret exists:
//   firebase functions:secrets:set STRIPE_PROJECT_PASS_PRICE_ID
const PRO_PASSES = [
  {
    id: 'project',
    name: 'Project Pass',
    days: 90,
    tokens: 300,
    priceUsd: 30,
    priceIdEnv: 'STRIPE_PROJECT_PASS_PRICE_ID'
  }
];

// For functions.runWith({ secrets: [...] }) declarations.
const PRO_PASS_PRICE_SECRETS = PRO_PASSES.map((pass) => pass.priceIdEnv);

// Match ONE Stripe price ID against the configured passes. Env vars are read
// at call time (Cloud Functions injects secrets after require); an unset
// secret never matches, so an unconfigured pass simply doesn't exist.
const findProPassByPriceId = (priceId) => {
  if (!priceId) return null;
  return (
    PRO_PASSES.find((pass) => {
      const configuredId = process.env[pass.priceIdEnv];
      return configuredId && configuredId === priceId;
    }) || null
  );
};

// MAX is a superset of PRO: both paid subscription tiers unlock every Pro
// feature. The single definition shared by token-management.js and
// utilities/user-audit.js.
const isPaidPlanClaim = (plan) => plan === 'PRO' || plan === 'MAX';

// Normalize a stored proUntil (Firestore Timestamp, Date, epoch ms, ISO
// string) to epoch ms; null when absent or unparseable.
const toMillis = (value) => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'string') {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
};

const isProUntilActive = (proUntil, nowMs = Date.now()) => {
  const ms = toMillis(proUntil);
  return ms !== null && ms > nowMs;
};

// Stacking: a new pass extends from the later of now and the current
// proUntil, so buying early never loses days and buying after a lapse never
// back-dates. `days` is the total to add (pass.days × quantity).
const computeProUntil = (currentProUntil, nowMs, days) => {
  const currentMs = toMillis(currentProUntil);
  const base = currentMs !== null && currentMs > nowMs ? currentMs : nowMs;
  return base + days * DAY_MS;
};

// The one Pro rule: paid subscription claim OR Pro-team domain OR an
// unexpired pass. Every server-side Pro check routes through this.
const hasProEntitlement = ({ plan, isProDomain, proUntil, nowMs = Date.now() }) =>
  isPaidPlanClaim(plan) || !!isProDomain || isProUntilActive(proUntil, nowMs);

// Sum every pass line item on a checkout session. Returns null when no line
// item is a configured pass. Unknown items are ignored here (token packs are
// matched separately).
const summarizePassItems = (lineItems) => {
  const items = (Array.isArray(lineItems) ? lineItems : [])
    .map((item) => ({
      pass: findProPassByPriceId(item?.price?.id),
      quantity: item?.quantity || 1
    }))
    .filter(({ pass }) => pass);
  if (items.length === 0) return null;
  return {
    items,
    days: items.reduce((sum, { pass, quantity }) => sum + pass.days * quantity, 0),
    tokens: items.reduce((sum, { pass, quantity }) => sum + pass.tokens * quantity, 0),
    source: `pro-pass-${items.map(({ pass }) => pass.id).join('+')}`
  };
};

// The pure core of grantPass (token-management.js), evaluated inside its
// Firestore transaction. `alreadyGranted` is whether this grant's tokenLog
// row (keyed on its idempotency key) exists: when it does the grant is a
// no-op (returns null), which is what makes retries safe. Otherwise returns the balances
// and proUntil to write. `summary` is { days, tokens }.
const planProPassGrant = ({ alreadyGranted, tokenProfile, summary, nowMs }) => {
  if (alreadyGranted) return null;
  const data = tokenProfile || {};
  const tokensBefore = data.genToken || 0;
  const proUntilBeforeMs = toMillis(data.proUntil);
  return {
    tokensBefore,
    tokensAfter: tokensBefore + summary.tokens,
    proUntilBeforeMs,
    proUntilAfterMs: computeProUntil(proUntilBeforeMs, nowMs, summary.days)
  };
};

module.exports = {
  DAY_MS,
  PRO_PASSES,
  PRO_PASS_PRICE_SECRETS,
  findProPassByPriceId,
  isPaidPlanClaim,
  toMillis,
  isProUntilActive,
  computeProUntil,
  hasProEntitlement,
  summarizePassItems,
  planProPassGrant
};
