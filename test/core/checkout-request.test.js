/* global describe, it, before, after */

/**
 * What createStripeSession accepts and builds, and what is left of a plan
 * after a cancellation.
 */

const assert = require('assert');
const {
  parseCheckoutRequest,
  buildCheckoutParams
} = require('../../public/functions/checkout-request.js');
const {
  SUBSCRIPTION_PRICE_SECRETS,
  findSubscriptionPlan,
  planAfterCancellation
} = require('../../public/functions/subscription-plans.js');

const ENV = {
  STRIPE_YEARLY_PRICE_ID: 'price_pro_year',
  STRIPE_MONTHLY_PRICE_ID: 'price_pro_month',
  STRIPE_MAX_YEARLY_PRICE_ID: 'price_max_year',
  STRIPE_MAX_MONTHLY_PRICE_ID: 'price_max_month',
  STRIPE_TOKENS_STARTER_PRICE_ID: 'price_starter',
  STRIPE_PROJECT_PASS_PRICE_ID: 'price_pass'
};
const saved = {};

const ask = (price, extra = {}) => ({
  line_items: [{ price, quantity: 1 }],
  ...extra
});

describe('checkout request', () => {
  before(() => {
    for (const [key, value] of Object.entries(ENV)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  });
  after(() => {
    for (const key of Object.keys(ENV)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('recognizes each kind of product', () => {
    for (const key of SUBSCRIPTION_PRICE_SECRETS) {
      assert.strictEqual(
        parseCheckoutRequest(ask(ENV[key])).kind,
        'subscription'
      );
    }
    assert.strictEqual(
      parseCheckoutRequest(ask('price_starter')).product,
      'token-pack-starter'
    );
    assert.strictEqual(
      parseCheckoutRequest(ask('price_pass')).product,
      'pro-pass-project'
    );
  });

  it('refuses anything that is not exactly one known price', () => {
    for (const data of [
      undefined,
      null,
      {},
      { line_items: 'price_pass' },
      { line_items: [] },
      { line_items: [null] },
      ask('price_unknown'),
      ask(['price_pass']),
      ask(''),
      { line_items: [{ price_data: { unit_amount: 1 } }] },
      { line_items: [{ price: 'price_pro_month' }, { price: 'price_unknown' }] }
    ]) {
      assert.strictEqual(
        parseCheckoutRequest(data),
        null,
        JSON.stringify(data)
      );
    }
  });

  it('never matches an unset price', () => {
    delete process.env.STRIPE_MAX_YEARLY_PRICE_ID;
    assert.strictEqual(findSubscriptionPlan([undefined]), null);
    assert.strictEqual(parseCheckoutRequest(ask('price_max_year')), null);
    process.env.STRIPE_MAX_YEARLY_PRICE_ID = ENV.STRIPE_MAX_YEARLY_PRICE_ID;
  });

  it('passes nothing else from the client to Stripe', () => {
    const request = parseCheckoutRequest({
      line_items: [
        {
          price: 'price_max_month',
          quantity: 0,
          adjustable_quantity: { enabled: true }
        }
      ],
      mode: 'payment',
      discounts: [{ coupon: 'x' }],
      allow_promotion_codes: true,
      subscription_data: { trial_period_days: 365 },
      customer: 'cus_other',
      payment_method_types: ['us_bank_account'],
      metadata: {
        userId: 'other',
        product: 'fake',
        source: 'Winback',
        extra: 'x'
      }
    });
    assert.deepStrictEqual(
      buildCheckoutParams({
        request,
        userId: 'u1',
        userEmail: 'a@example.test',
        stripeCustomerId: null
      }),
      {
        ui_mode: 'embedded',
        redirect_on_completion: 'never',
        mode: 'subscription',
        line_items: [{ price: 'price_max_month', quantity: 1 }],
        payment_method_types: ['card'],
        metadata: { userId: 'u1', product: 'subscription', source: 'winback' },
        customer_email: 'a@example.test',
        subscription_data: { metadata: { userId: 'u1' } }
      }
    );
  });

  it('builds one-time purchases in payment mode', () => {
    const request = parseCheckoutRequest(
      ask('price_pass', { metadata: { source: 'bad source!' } })
    );
    const fresh = buildCheckoutParams({
      request,
      userId: 'u1',
      userEmail: 'a@example.test'
    });
    assert.strictEqual(fresh.mode, 'payment');
    assert.strictEqual(fresh.customer_creation, 'always');
    assert.strictEqual('subscription_data' in fresh, false);
    assert.deepStrictEqual(fresh.metadata, {
      userId: 'u1',
      product: 'pro-pass-project'
    });

    const returning = buildCheckoutParams({
      request,
      userId: 'u1',
      userEmail: 'a@example.test',
      stripeCustomerId: 'cus_1'
    });
    assert.strictEqual(returning.customer, 'cus_1');
    assert.strictEqual('customer_email' in returning, false);
    assert.strictEqual('customer_creation' in returning, false);
  });

  describe('planAfterCancellation', () => {
    const sub = (id, price, status = 'active') => ({
      id,
      status,
      items: { data: [{ price: { id: price } }] }
    });
    const plan = (subscriptions, currentPlan = 'MAX') =>
      planAfterCancellation({ subscriptions, deletedId: 'gone', currentPlan });

    it('clears the plan when nothing else is live', () => {
      assert.strictEqual(plan([]), '');
      assert.strictEqual(plan([sub('gone', 'price_max_month')]), '');
      assert.strictEqual(plan([sub('old', 'price_pro_month', 'canceled')]), '');
      assert.strictEqual(
        plan([sub('new', 'price_pro_month', 'incomplete')]),
        ''
      );
    });

    it('keeps the best live plan', () => {
      assert.strictEqual(plan([sub('a', 'price_pro_month')]), 'PRO');
      assert.strictEqual(
        plan(
          [sub('a', 'price_pro_month', 'past_due'), sub('b', 'price_max_year')],
          'PRO'
        ),
        'MAX'
      );
    });

    it('keeps the current plan for a live subscription on an unknown price, and never adds one', () => {
      assert.strictEqual(plan([sub('a', 'price_legacy')], 'PRO'), 'PRO');
      assert.strictEqual(plan([sub('a', 'price_legacy')], ''), '');
    });
  });
});
