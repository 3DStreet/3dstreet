/* global describe, it, afterEach */

/**
 * One-time gen-token packs (#1374).
 *
 * The claw-back regression test the issue calls out explicitly lives here:
 * the monthly refill tops UP to the plan allowance and must never pull a
 * balance DOWN — a balance above the allowance means the user bought token
 * packs, and a refactor that resets to the allowance would silently claw
 * back paid tokens.
 */

const assert = require('assert');
const {
  TOKEN_PACKS,
  TOKEN_PACK_PRICE_SECRETS,
  findTokenPackByPriceIds,
  computeMonthlyRefill
} = require('../../public/functions/token-packs.js');

describe('computeMonthlyRefill', () => {
  it('tops a below-allowance balance up to the allowance', () => {
    assert.strictEqual(computeMonthlyRefill(40, 100), 100);
    assert.strictEqual(computeMonthlyRefill(0, 500), 500);
  });

  it('preserves purchased tokens above the allowance (never claws back)', () => {
    // PRO user (100/mo allowance) who bought the 250 pack mid-month.
    assert.strictEqual(computeMonthlyRefill(150 + 250, 100), 400);
    // MAX user (500/mo) sitting on stacked pack purchases.
    assert.strictEqual(computeMonthlyRefill(730, 500), 730);
    // Exactly at the allowance is a no-op either way.
    assert.strictEqual(computeMonthlyRefill(100, 100), 100);
  });

  it('treats a missing balance as zero', () => {
    assert.strictEqual(computeMonthlyRefill(undefined, 100), 100);
    assert.strictEqual(computeMonthlyRefill(null, 500), 500);
  });
});

describe('TOKEN_PACKS', () => {
  it('every pack is flat $0.10/token — no volume discount (v1)', () => {
    assert.ok(TOKEN_PACKS.length > 0);
    for (const pack of TOKEN_PACKS) {
      assert.strictEqual(
        pack.priceUsd,
        pack.tokens * 0.1,
        `${pack.id}: expected flat $0.10/token`
      );
    }
  });

  it('declares one price-ID secret per pack', () => {
    assert.strictEqual(TOKEN_PACK_PRICE_SECRETS.length, TOKEN_PACKS.length);
    assert.strictEqual(
      new Set(TOKEN_PACK_PRICE_SECRETS).size,
      TOKEN_PACK_PRICE_SECRETS.length
    );
  });
});

describe('findTokenPackByPriceIds', () => {
  afterEach(() => {
    for (const secret of TOKEN_PACK_PRICE_SECRETS) {
      delete process.env[secret];
    }
  });

  it('matches a configured pack price id', () => {
    process.env[TOKEN_PACKS[0].priceIdEnv] = 'price_test_starter';
    const pack = findTokenPackByPriceIds(['price_other', 'price_test_starter']);
    assert.strictEqual(pack && pack.id, TOKEN_PACKS[0].id);
  });

  it('never matches when the secret is unset (no undefined === undefined)', () => {
    assert.strictEqual(findTokenPackByPriceIds([undefined]), null);
    assert.strictEqual(findTokenPackByPriceIds(['price_unknown']), null);
    assert.strictEqual(findTokenPackByPriceIds([]), null);
    assert.strictEqual(findTokenPackByPriceIds(null), null);
  });
});
