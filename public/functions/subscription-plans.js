/**
 * Subscription plans: the Stripe prices we sell as recurring plans. The one
 * list used by createStripeSession (what may be bought), stripeWebhook (what
 * a purchase grants) and handleSubscriptionWebhook (what is left after a
 * cancellation).
 *
 * `tokens` is the tier's monthly floor, the same on both cycles;
 * test/shared/pricing-sync.test.js guards it against the client's copy.
 *
 * No firebase imports: test/core/checkout-request.test.js requires this
 * directly under mocha.
 */

const { priceIdFromEnv } = require('./price-env.js');

const SUBSCRIPTION_PLANS = [
  { tier: 'MAX', cycle: 'annual', priceIdEnv: 'STRIPE_MAX_YEARLY_PRICE_ID', tokens: 500 },
  { tier: 'MAX', cycle: 'monthly', priceIdEnv: 'STRIPE_MAX_MONTHLY_PRICE_ID', tokens: 500 },
  { tier: 'PRO', cycle: 'annual', priceIdEnv: 'STRIPE_YEARLY_PRICE_ID', tokens: 100 },
  { tier: 'PRO', cycle: 'monthly', priceIdEnv: 'STRIPE_MONTHLY_PRICE_ID', tokens: 100 }
];

// For functions.runWith({ secrets: [...] }) declarations.
const SUBSCRIPTION_PRICE_SECRETS = SUBSCRIPTION_PLANS.map((plan) => plan.priceIdEnv);

// Env vars are read at call time (Cloud Functions injects secrets after
// require); an unset secret never matches.
const findSubscriptionPlan = (priceIds) =>
  SUBSCRIPTION_PLANS.find((plan) => {
    const configuredId = priceIdFromEnv(plan.priceIdEnv);
    return configuredId && priceIds.includes(configuredId);
  }) || null;

// Statuses that still entitle the customer. past_due keeps the plan while
// Stripe retries the payment; Stripe deletes the subscription if it gives up.
const LIVE_STATUSES = ['active', 'trialing', 'past_due'];

/**
 * The plan claim after `deletedId` ended, from the customer's subscriptions
 * ('MAX' | 'PRO' | ''). A live subscription on a price we no longer sell
 * (a legacy plan) keeps the current claim: we can't tell its tier.
 */
const planAfterCancellation = ({ subscriptions, deletedId, currentPlan }) => {
  const live = subscriptions.filter(
    (sub) => sub.id !== deletedId && LIVE_STATUSES.includes(sub.status)
  );
  if (live.length === 0) return '';
  const plans = live.map((sub) =>
    findSubscriptionPlan((sub.items?.data || []).map((item) => item.price?.id).filter(Boolean))
  );
  if (plans.some((plan) => plan?.tier === 'MAX')) return 'MAX';
  if (plans.includes(null)) return currentPlan || '';
  return 'PRO';
};

module.exports = {
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PRICE_SECRETS,
  findSubscriptionPlan,
  planAfterCancellation
};
