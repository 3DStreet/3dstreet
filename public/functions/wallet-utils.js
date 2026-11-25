/**
 * Team AI token wallets (#1267 Phase 3, docs/team-wallet.md) — the pure
 * rules, no Firebase. The Firestore side is in team-wallet.js.
 *
 * A team's wallet (orgWallets/{orgId}) holds genTokens that its members
 * spend instead of their own while it's their active team and they hold a
 * seat in it (userOrgs/{uid}.activeOrgId). Each month it is topped up to the team's
 * monthlyTokenBudget (tokens bought on top survive, like personal top-ups),
 * so the team's AI cost per month is capped by its budget. An optional
 * memberMonthlyCap limits what one member spends per month.
 */

const { computeMonthlyRefill } = require('./token-packs.js');

// Per-seat monthly allowance a new team's budget defaults to: the same
// tokens its members would get from a personal subscription to its plan.
const BUDGET_PER_SEAT = { PRO: 100, MAX: 500 };

/** 'YYYY-M' (month 0-based), the key the personal refill already uses. */
const monthKey = (date = new Date()) => `${date.getFullYear()}-${date.getMonth()}`;

const defaultMonthlyBudget = (plan, seats) => (BUDGET_PER_SEAT[plan] || 0) * (seats || 0);

/**
 * What changes in a wallet when its team's plan or seats change: { budget,
 * addNow }, or null for nothing. The budget follows the plan and seats unless
 * staff set a custom one. An increase is also added right away when this
 * month's top-up already happened (else the top-up brings it); a decrease
 * waits for the next month, taking nothing back.
 */
const budgetChange = ({ wallet = {}, plan, seats, key = monthKey() }) => {
  if (wallet.customBudget) return null;
  const budget = defaultMonthlyBudget(plan, seats);
  const before = wallet.monthlyTokenBudget || 0;
  if (budget === before) return null;
  return {
    budget,
    addNow: wallet.lastRefill === key ? Math.max(0, budget - before) : 0
  };
};

/**
 * The wallet after this month's top-up: genToken raised to monthlyTokenBudget
 * the first time the wallet is used in a new month, else unchanged.
 */
const refillWallet = (wallet = {}, key = monthKey()) => {
  if (wallet.lastRefill === key) return { ...wallet };
  return {
    ...wallet,
    genToken: computeMonthlyRefill(wallet.genToken, wallet.monthlyTokenBudget || 0),
    lastRefill: key
  };
};

/**
 * What `uid` may still spend from the wallet this month: its balance, capped
 * by what's left of the member's monthly cap (null = no cap).
 */
const memberAvailable = ({ wallet = {}, usedThisMonth = 0 }) => {
  const balance = Math.max(0, wallet.genToken || 0);
  const cap = wallet.memberMonthlyCap;
  if (cap === null || cap === undefined) return balance;
  return Math.max(0, Math.min(balance, cap - usedThisMonth));
};

/**
 * Null when `uid` can spend `cost` from the (refilled) wallet, else the
 * reason: 'member-cap' (their monthly cap is reached) or 'wallet-empty'.
 */
const walletChargeRefusal = ({ wallet = {}, usedThisMonth = 0, cost }) => {
  const cap = wallet.memberMonthlyCap;
  if (cap !== null && cap !== undefined && usedThisMonth + cost > cap) return 'member-cap';
  if ((wallet.genToken || 0) < cost) return 'wallet-empty';
  return null;
};

const isValidCap = (cap) => cap === null || (Number.isInteger(cap) && cap >= 0 && cap <= 1000000);
const isValidBudget = (budget) => Number.isInteger(budget) && budget >= 0 && budget <= 10000000;

module.exports = {
  BUDGET_PER_SEAT,
  monthKey,
  defaultMonthlyBudget,
  budgetChange,
  refillWallet,
  memberAvailable,
  walletChargeRefusal,
  isValidCap,
  isValidBudget
};
