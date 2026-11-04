/* global describe, it, afterEach */

/**
 * One-time time-boxed Pro passes (#1922).
 *
 * Covers the pure parts of the pass: price matching, the stacking rule
 * (proUntil = max(now, proUntil) + days), the single entitlement rule every
 * server Pro check routes through, and the webhook-retry idempotency of the
 * grant (planProPassGrant is the body of grantPass's transaction).
 */

const assert = require('assert');
const {
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
} = require('../../public/functions/pro-pass.js');

const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
const PROJECT = PRO_PASSES.find((p) => p.id === 'project');

describe('PRO_PASSES config', () => {
  it('Project Pass is 90 days + 300 tokens for $30', () => {
    assert.ok(PROJECT, 'project pass missing');
    assert.strictEqual(PROJECT.days, 90);
    assert.strictEqual(PROJECT.tokens, 300);
    assert.strictEqual(PROJECT.priceUsd, 30);
  });

  it('declares one price-ID secret per pass', () => {
    assert.deepStrictEqual(
      PRO_PASS_PRICE_SECRETS,
      PRO_PASSES.map((p) => p.priceIdEnv)
    );
  });
});

describe('findProPassByPriceId', () => {
  const saved = {};
  afterEach(() => {
    for (const env of PRO_PASS_PRICE_SECRETS) {
      if (saved[env] === undefined) delete process.env[env];
      else process.env[env] = saved[env];
    }
  });
  const setEnv = (env, value) => {
    if (!(env in saved)) saved[env] = process.env[env];
    process.env[env] = value;
  };

  it('matches the configured price', () => {
    setEnv(PROJECT.priceIdEnv, 'price_pass');
    assert.strictEqual(findProPassByPriceId('price_pass'), PROJECT);
  });

  it('never matches when the secret is unset or empty', () => {
    setEnv(PROJECT.priceIdEnv, '');
    assert.strictEqual(findProPassByPriceId(''), null);
    assert.strictEqual(findProPassByPriceId(undefined), null);
    assert.strictEqual(findProPassByPriceId('price_pass'), null);
  });

  it('does not match an unknown price', () => {
    setEnv(PROJECT.priceIdEnv, 'price_pass');
    assert.strictEqual(findProPassByPriceId('price_other'), null);
  });

  it('summarizePassItems sums pass line items and ignores the rest', () => {
    setEnv(PROJECT.priceIdEnv, 'price_pass');
    assert.strictEqual(
      summarizePassItems([{ price: { id: 'price_pack' }, quantity: 1 }]),
      null
    );
    const summary = summarizePassItems([
      { price: { id: 'price_pass' }, quantity: 2 },
      { price: { id: 'price_pack' }, quantity: 1 }
    ]);
    assert.strictEqual(summary.days, 180);
    assert.strictEqual(summary.tokens, 600);
    assert.strictEqual(summary.source, 'pro-pass-project');
  });
});

describe('computeProUntil (stacking)', () => {
  it('starts from now when there is no pass', () => {
    assert.strictEqual(computeProUntil(null, NOW, 90), NOW + 90 * DAY_MS);
  });

  it('extends from the current expiry while a pass is active', () => {
    const current = NOW + 10 * DAY_MS;
    assert.strictEqual(
      computeProUntil(current, NOW, 90),
      current + 90 * DAY_MS
    );
  });

  it('starts from now after a pass has lapsed (never back-dates)', () => {
    const lapsed = NOW - 30 * DAY_MS;
    assert.strictEqual(computeProUntil(lapsed, NOW, 90), NOW + 90 * DAY_MS);
  });

  it('accepts a Firestore Timestamp-like value', () => {
    const current = { toMillis: () => NOW + DAY_MS };
    assert.strictEqual(computeProUntil(current, NOW, 90), NOW + 91 * DAY_MS);
  });
});

describe('toMillis / isProUntilActive', () => {
  it('normalizes the stored shapes', () => {
    assert.strictEqual(toMillis(NOW), NOW);
    assert.strictEqual(toMillis(new Date(NOW)), NOW);
    assert.strictEqual(toMillis(new Date(NOW).toISOString()), NOW);
    assert.strictEqual(toMillis({ toMillis: () => NOW }), NOW);
    assert.strictEqual(toMillis(null), null);
    assert.strictEqual(toMillis(undefined), null);
    assert.strictEqual(toMillis('not a date'), null);
    assert.strictEqual(toMillis({}), null);
  });

  it('is active only strictly before expiry', () => {
    assert.strictEqual(isProUntilActive(NOW + 1, NOW), true);
    assert.strictEqual(isProUntilActive(NOW, NOW), false);
    assert.strictEqual(isProUntilActive(NOW - DAY_MS, NOW), false);
    assert.strictEqual(isProUntilActive(null, NOW), false);
  });
});

describe('hasProEntitlement', () => {
  const future = NOW + DAY_MS;
  const past = NOW - DAY_MS;

  it('subscription claims (PRO, MAX) are Pro', () => {
    assert.strictEqual(isPaidPlanClaim('PRO'), true);
    assert.strictEqual(isPaidPlanClaim('MAX'), true);
    assert.strictEqual(isPaidPlanClaim(''), false);
    assert.strictEqual(hasProEntitlement({ plan: 'MAX', nowMs: NOW }), true);
  });

  it('team domain is Pro', () => {
    assert.strictEqual(
      hasProEntitlement({ plan: '', isProDomain: true, nowMs: NOW }),
      true
    );
  });

  it('an unexpired pass is Pro with no plan claim', () => {
    assert.strictEqual(
      hasProEntitlement({ plan: '', proUntil: future, nowMs: NOW }),
      true
    );
  });

  it('an expired pass alone is Community', () => {
    assert.strictEqual(
      hasProEntitlement({ plan: '', proUntil: past, nowMs: NOW }),
      false
    );
    assert.strictEqual(hasProEntitlement({ nowMs: NOW }), false);
  });

  it('cancelling a subscription keeps Pro while the pass runs', () => {
    // customer.subscription.deleted clears `plan` only; proUntil stands.
    assert.strictEqual(
      hasProEntitlement({ plan: '', proUntil: future, nowMs: NOW }),
      true
    );
  });
});

describe('planProPassGrant (webhook idempotency)', () => {
  const summary = { days: 90, tokens: 300 };

  it('first delivery grants tokens and 90 days', () => {
    const plan = planProPassGrant({
      alreadyGranted: false,
      tokenProfile: { genToken: 5 },
      summary,
      nowMs: NOW
    });
    assert.strictEqual(plan.tokensBefore, 5);
    assert.strictEqual(plan.tokensAfter, 305);
    assert.strictEqual(plan.proUntilBeforeMs, null);
    assert.strictEqual(plan.proUntilAfterMs, NOW + 90 * DAY_MS);
  });

  it('a retried delivery for the same session is a no-op', () => {
    assert.strictEqual(
      planProPassGrant({
        alreadyGranted: true,
        tokenProfile: { genToken: 305, proUntil: NOW + 90 * DAY_MS },
        summary,
        nowMs: NOW + 60 * 1000
      }),
      null
    );
  });

  it('a second purchase (new session) stacks on the first', () => {
    const plan = planProPassGrant({
      alreadyGranted: false,
      tokenProfile: { genToken: 120, proUntil: NOW + 40 * DAY_MS },
      summary,
      nowMs: NOW
    });
    assert.strictEqual(plan.tokensAfter, 420);
    assert.strictEqual(plan.proUntilAfterMs, NOW + 130 * DAY_MS);
  });

  it('creates from scratch when the user has no token profile', () => {
    const plan = planProPassGrant({
      alreadyGranted: false,
      tokenProfile: null,
      summary,
      nowMs: NOW
    });
    assert.strictEqual(plan.tokensAfter, 300);
  });
});
