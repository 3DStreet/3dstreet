/* global describe, it */

/**
 * Project Pass codes (#1922 follow-up): code format, normalization and the
 * redeemability rules checked inside the redemption transaction.
 */

const assert = require('assert');
const {
  CODE_ALPHABET,
  normalizePassCode,
  generatePassCode,
  passRedemptionId,
  checkPassCodeRedeemable
} = require('../../public/functions/pass-code-utils.js');

const NOW = Date.UTC(2026, 9, 1);
const DAY = 24 * 60 * 60 * 1000;
const VALID = {
  days: 90,
  tokens: 300,
  maxUses: 10,
  uses: 0,
  active: true,
  redeemBy: NOW + 365 * DAY
};

describe('normalizePassCode', () => {
  it('uppercases, trims and strips inner whitespace', () => {
    assert.strictEqual(
      normalizePassCode('  foundation-7kq2 abcd '),
      'FOUNDATION-7KQ2ABCD'
    );
  });

  it('rejects anything that cannot be a code', () => {
    for (const bad of [
      undefined,
      null,
      42,
      '',
      'abc',
      '-LEADINGDASH',
      'HAS/SLASH',
      'HAS_UNDERSCORE',
      'A'.repeat(41)
    ]) {
      assert.strictEqual(normalizePassCode(bad), null, String(bad));
    }
  });
});

describe('generatePassCode', () => {
  it('produces PREFIX-XXXXXXXX from the unambiguous alphabet', () => {
    let i = 0;
    const code = generatePassCode('Pullman Class!', () => i++ % 31);
    assert.match(code, /^PULLMANCLASS-[23456789A-Z]{8}$/);
    assert.ok(!/[01IOL]/.test(code.split('-')[1]));
    assert.strictEqual(normalizePassCode(code), code);
  });

  it('omits the dash with no prefix', () => {
    const code = generatePassCode('', () => 0);
    assert.strictEqual(code, CODE_ALPHABET[0].repeat(8));
  });
});

describe('passRedemptionId', () => {
  it('is one id per code + user', () => {
    assert.strictEqual(passRedemptionId('ABCD-1234', 'uid1'), 'ABCD-1234_uid1');
    assert.notStrictEqual(
      passRedemptionId('ABCD-1234', 'uid1'),
      passRedemptionId('ABCD-1234', 'uid2')
    );
  });
});

describe('checkPassCodeRedeemable', () => {
  it('accepts a live code with uses left', () => {
    assert.strictEqual(checkPassCodeRedeemable(VALID, NOW), null);
    assert.strictEqual(
      checkPassCodeRedeemable({ ...VALID, uses: 9 }, NOW),
      null
    );
    // No deadline at all is allowed.
    assert.strictEqual(
      checkPassCodeRedeemable({ ...VALID, redeemBy: null }, NOW),
      null
    );
  });

  it('reports why a code cannot be redeemed', () => {
    assert.strictEqual(checkPassCodeRedeemable(null, NOW), 'not-found');
    assert.strictEqual(
      checkPassCodeRedeemable({ ...VALID, active: false }, NOW),
      'inactive'
    );
    assert.strictEqual(
      checkPassCodeRedeemable({ ...VALID, redeemBy: NOW }, NOW),
      'expired'
    );
    assert.strictEqual(
      checkPassCodeRedeemable(
        { ...VALID, redeemBy: { toMillis: () => NOW - 1 } },
        NOW
      ),
      'expired'
    );
    assert.strictEqual(
      checkPassCodeRedeemable({ ...VALID, uses: 10 }, NOW),
      'exhausted'
    );
    assert.strictEqual(
      checkPassCodeRedeemable({ ...VALID, days: 0 }, NOW),
      'invalid'
    );
    assert.strictEqual(
      checkPassCodeRedeemable({ ...VALID, tokens: -1 }, NOW),
      'invalid'
    );
    assert.strictEqual(
      checkPassCodeRedeemable({ ...VALID, maxUses: undefined }, NOW),
      'exhausted'
    );
  });
});
