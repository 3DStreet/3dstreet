/**
 * Team AI token wallets (#1267 Phase 3, docs/team-wallet.md), client side:
 * what a member can spend from their billing team's wallet. Mirrors
 * public/functions/wallet-utils.js (refillWallet, memberAvailable); the
 * drift test is test/shared/team-wallet-sync.test.js. The server refills
 * lazily on the first charge of a month, so the client applies the same
 * refill to show the right balance before that.
 */

const SEAT_ROLES = ['owner', 'admin', 'member'];

/**
 * The team paying the user's AI generations, or null for their own tokens:
 * their active team (currentUser.activeOrgId) when it's active and they
 * hold a seat in it. Mirrors resolveBillingOrg in team-wallet.js, which
 * checks the same at every charge.
 */
export const billingOrgOf = (currentUser) => {
  const orgId = currentUser?.activeOrgId;
  const org = orgId && (currentUser.orgs || []).find((o) => o.orgId === orgId);
  return org && org.status === 'active' && SEAT_ROLES.includes(org.role)
    ? orgId
    : null;
};

/**
 * The user's active team when it's suspended and they hold a seat in it:
 * their generations are refused (never charged to their own tokens) until
 * they switch to Personal. Mirrors resolveBillingOrg.
 */
export const inactiveBillingOrgOf = (currentUser) => {
  const orgId = currentUser?.activeOrgId;
  const org = orgId && (currentUser.orgs || []).find((o) => o.orgId === orgId);
  return org && org.status !== 'active' && SEAT_ROLES.includes(org.role)
    ? orgId
    : null;
};

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
