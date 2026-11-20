/* global describe, it */

/**
 * Team AI token wallets (#1267 Phase 3): monthly top-up, member caps.
 */

const assert = require('assert');
const {
  monthKey,
  defaultMonthlyBudget,
  refillWallet,
  memberAvailable,
  walletChargeRefusal,
  isValidCap
} = require('../../public/functions/wallet-utils.js');

describe('wallet-utils', () => {
  it('keys months like the personal refill (0-based month)', () => {
    assert.strictEqual(monthKey(new Date(2026, 10, 20)), '2026-10');
  });

  it('defaults the budget to the plan allowance per seat', () => {
    assert.strictEqual(defaultMonthlyBudget('PRO', 10), 1000);
    assert.strictEqual(defaultMonthlyBudget('MAX', 3), 1500);
    assert.strictEqual(defaultMonthlyBudget('FREE', 3), 0);
  });

  describe('refillWallet', () => {
    const wallet = {
      genToken: 40,
      monthlyTokenBudget: 1000,
      lastRefill: '2026-9'
    };

    it('tops up to the budget once in a new month', () => {
      const refilled = refillWallet(wallet, '2026-10');
      assert.strictEqual(refilled.genToken, 1000);
      assert.strictEqual(refilled.lastRefill, '2026-10');
      assert.deepStrictEqual(refillWallet(refilled, '2026-10'), refilled);
    });

    it('keeps tokens bought above the budget', () => {
      assert.strictEqual(
        refillWallet({ ...wallet, genToken: 1500 }, '2026-10').genToken,
        1500
      );
    });

    it('does nothing within the same month', () => {
      assert.strictEqual(refillWallet(wallet, '2026-9').genToken, 40);
    });

    it('starts an unused wallet at its budget', () => {
      assert.strictEqual(
        refillWallet({ monthlyTokenBudget: 200 }, '2026-10').genToken,
        200
      );
    });
  });

  describe('member limits', () => {
    const wallet = { genToken: 300, memberMonthlyCap: 50 };

    it('limits what a member can spend to the rest of their cap', () => {
      assert.strictEqual(memberAvailable({ wallet, usedThisMonth: 45 }), 5);
      assert.strictEqual(memberAvailable({ wallet, usedThisMonth: 60 }), 0);
      assert.strictEqual(
        memberAvailable({ wallet: { genToken: 20, memberMonthlyCap: 50 } }),
        20
      );
      assert.strictEqual(
        memberAvailable({ wallet: { genToken: 300, memberMonthlyCap: null } }),
        300
      );
    });

    it('refuses over the cap first, then an empty wallet', () => {
      assert.strictEqual(
        walletChargeRefusal({ wallet, usedThisMonth: 48, cost: 5 }),
        'member-cap'
      );
      assert.strictEqual(
        walletChargeRefusal({
          wallet: { genToken: 3, memberMonthlyCap: null },
          cost: 5
        }),
        'wallet-empty'
      );
      assert.strictEqual(
        walletChargeRefusal({ wallet, usedThisMonth: 10, cost: 5 }),
        null
      );
    });

    it('validates caps', () => {
      assert.ok(isValidCap(null));
      assert.ok(isValidCap(0));
      assert.ok(!isValidCap(-1));
      assert.ok(!isValidCap(2.5));
    });
  });
});
