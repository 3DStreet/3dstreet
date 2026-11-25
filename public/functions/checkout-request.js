/**
 * What a client may ask createStripeSession for, and the Stripe session built
 * from it. The client only picks one product, by its price ID; everything
 * else (mode, quantity, payment methods, metadata) is set here. Nothing from
 * the request is passed through to Stripe.
 *
 * No firebase imports: test/core/checkout-request.test.js requires this
 * directly under mocha.
 */

const { findSubscriptionPlan } = require('./subscription-plans.js');
const { findTokenPackByPriceIds } = require('./token-packs.js');
const { findProPassByPriceId } = require('./pro-pass.js');

// Same contract as the client parser (SOURCE_RE in
// src/tested/project-pass-link.js).
const SOURCE_RE = /^[a-z0-9_-]{1,40}$/i;

/**
 * { priceId, kind: 'subscription' | 'token-pack' | 'pro-pass', product,
 * source } or null when the request isn't exactly one product we sell.
 */
const parseCheckoutRequest = (data) => {
  const items = data?.line_items;
  if (!Array.isArray(items) || items.length !== 1) return null;
  const priceId = items[0]?.price;
  if (typeof priceId !== 'string' || !priceId) return null;

  const rawSource = data.metadata?.source;
  const source =
    typeof rawSource === 'string' && SOURCE_RE.test(rawSource) ? rawSource.toLowerCase() : null;

  const pass = findProPassByPriceId(priceId);
  if (pass) return { priceId, kind: 'pro-pass', product: `pro-pass-${pass.id}`, source };
  const pack = findTokenPackByPriceIds([priceId]);
  if (pack) return { priceId, kind: 'token-pack', product: `token-pack-${pack.id}`, source };
  if (findSubscriptionPlan([priceId])) {
    return { priceId, kind: 'subscription', product: 'subscription', source };
  }
  return null;
};

/** The complete params for stripe.checkout.sessions.create. */
const buildCheckoutParams = ({ request, userId, userEmail, stripeCustomerId }) => {
  const isOneTime = request.kind !== 'subscription';
  const params = {
    ui_mode: 'embedded',
    redirect_on_completion: 'never',
    mode: isOneTime ? 'payment' : 'subscription',
    line_items: [{ price: request.priceId, quantity: 1 }],
    // No US bank account; card includes Google Pay and Apple Pay.
    payment_method_types: ['card'],
    metadata: {
      userId,
      product: request.product,
      ...(request.source && { source: request.source })
    }
  };
  // customer and customer_email are mutually exclusive.
  if (stripeCustomerId) {
    params.customer = stripeCustomerId;
  } else if (userEmail) {
    params.customer_email = userEmail;
  }
  // Payment-mode sessions only create a Stripe Customer when asked. Creating
  // one lets the webhook backfill userProfile.stripeCustomerId, so later
  // checkouts and support lookups find the buyer.
  if (isOneTime && !stripeCustomerId) params.customer_creation = 'always';
  if (!isOneTime) params.subscription_data = { metadata: { userId } };
  return params;
};

module.exports = { parseCheckoutRequest, buildCheckoutParams };
