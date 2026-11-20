/**
 * Team AI token wallets (#1267 Phase 3, docs/team-wallet.md), client side:
 * what a member can spend from their billing team's wallet. Mirrors
 * public/functions/wallet-utils.js (refillWallet, memberAvailable); the
 * drift test is test/shared/team-wallet-sync.test.js. The server refills
 * lazily on the first charge of a month, so the client applies the same
 * refill to show the right balance before that.
 */

/** 'YYYY-M' (month 0-based), as the server keys months. */
export const monthKey = (date = new Date()) =>
  `${date.getFullYear()}-${date.getMonth()}`;

export const refillWallet = (wallet = {}, key = monthKey()) => {
  if (wallet.lastRefill === key) return { ...wallet };
  return {
    ...wallet,
    genToken: Math.max(wallet.genToken || 0, wallet.monthlyTokenBudget || 0),
    lastRefill: key
  };
};

export const memberAvailable = ({ wallet = {}, usedThisMonth = 0 }) => {
  const balance = Math.max(0, wallet.genToken || 0);
  const cap = wallet.memberMonthlyCap;
  if (cap === null || cap === undefined) return balance;
  return Math.max(0, Math.min(balance, cap - usedThisMonth));
};
