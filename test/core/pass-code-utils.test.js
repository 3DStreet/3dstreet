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
  checkPassCodeRedeemable,
  appBaseForProject,
  buildInvitationText
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

describe('buildInvitationText', () => {
  const base = {
    code: 'WSU-ABCD2345',
    days: 90,
    tokens: 300,
    redeemByMs: Date.UTC(2027, 9, 1)
  };

  it('names the giver and carries the link, code, contents and deadline', () => {
    const text = buildInvitationText({ ...base, fromName: 'Prof. Smith, WSU' });
    assert.match(
      text,
      /Prof\. Smith, WSU has sent you a 3DStreet Project Pass/
    );
    assert.match(
      text,
      /3 months of 3DStreet Pro, plus 300 AI generation tokens/
    );
    assert.ok(text.includes('https://3dstreet.app/#redeem?code=WSU-ABCD2345'));
    assert.ok(text.includes('Or enter this code: WSU-ABCD2345'));
    assert.ok(text.includes('Redeem it by 2027-10-01'));
  });

  it('stays anonymous without a fromName and says days when not whole months', () => {
    const text = buildInvitationText({ ...base, fromName: null, days: 45 });
    assert.match(
      text,
      /^Subject: .*\n\nYou've been sent a 3DStreet Project Pass: 45 days/
    );
    assert.ok(!/null|undefined/.test(text));
  });
});

describe('appBaseForProject', () => {
  it('maps production to 3dstreet.app and other projects to web.app', () => {
    assert.strictEqual(
      appBaseForProject('dstreet-305604'),
      'https://3dstreet.app'
    );
    assert.strictEqual(appBaseForProject(undefined), 'https://3dstreet.app');
    assert.strictEqual(
      appBaseForProject('dev-3dstreet'),
      'https://dev-3dstreet.web.app'
    );
    const text = buildInvitationText({
      code: 'X-ABCD2345',
      days: 90,
      tokens: 300,
      baseUrl: appBaseForProject('dev-3dstreet')
    });
    assert.ok(
      text.includes('https://dev-3dstreet.web.app/#redeem?code=X-ABCD2345')
    );
  });
});
