/**
 * Team AI token wallets (#1267 Phase 3, docs/team-wallet.md). Pure rules in
 * wallet-utils.js.
 *
 * Data (Admin SDK writes only):
 *   orgWallets/{orgId}                { genToken, monthlyTokenBudget,
 *                                       memberMonthlyCap (null = none),
 *                                       customBudget (staff set the budget),
 *                                       lastRefill: 'YYYY-M', updatedAt }
 *   orgWallets/{orgId}/usage/{month}  { total, members: { [uid]: tokens } }
 *   userOrgs/{uid}.activeOrgId        the user's active team (the team
 *                                     switcher), or null (Personal)
 *
 * The active team pays the user's AI generations. Who pays is checked at
 * charge time: the user must hold a seat in the active team (owner, admin,
 * member); otherwise (Personal, a viewer) the charge falls back to the user's
 * personal tokens. A suspended team pays nothing, and the charge is refused
 * rather than falling back. A job charged to a team records chargedOrgId and chargedMonth, so its refund goes back to that
 * wallet and that month's usage.
 */

const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const { OrgError, callable, requireAuth } = require('./orgs.js');
const { takesSeat, canManageOrg } = require('./org-utils.js');
const {
  monthKey,
  defaultMonthlyBudget,
  refillWallet,
  memberAvailable,
  walletChargeRefusal,
  isValidCap,
  isValidBudget
} = require('./wallet-utils.js');

const db = () => admin.firestore();
const walletRef = (orgId) => db().collection('orgWallets').doc(orgId);
const usageRef = (orgId, key) => walletRef(orgId).collection('usage').doc(key);
const userOrgsRef = (uid) => db().collection('userOrgs').doc(uid);

const ORG_INACTIVE_MESSAGE =
  'Your team is inactive, so it can not pay for AI generations. Switch to Personal in the profile menu to use your own tokens.';

/**
 * The team paying `uid`'s generations: their active team when they hold a
 * seat in it, else null. Refuses when that team is suspended: their own
 * tokens pay only once they switch to Personal, never silently. Reads through `tx` when given
 * (inside a charge), else directly.
 */
async function resolveBillingOrg(uid, tx = null) {
  const get = (ref) => (tx ? tx.get(ref) : ref.get());
  const userOrgs = await get(userOrgsRef(uid));
  const orgId = userOrgs.exists ? userOrgs.data().activeOrgId : null;
  if (!orgId) return null;
  const [org, member] = await Promise.all([
    get(db().collection('orgs').doc(orgId)),
    get(db().collection('orgs').doc(orgId).collection('members').doc(uid))
  ]);
  if (!org.exists || !member.exists || !takesSeat(member.data().role)) return null;
  if (org.data().status !== 'active') {
    throw new functions.https.HttpsError('failed-precondition', ORG_INACTIVE_MESSAGE, {
      reason: 'org-suspended',
      orgId
    });
  }
  return orgId;
}

/**
 * What `uid` can spend right now, for the pre-flight checks before a job:
 * { orgId, available } from their billing team's wallet, or
 * { orgId: null, available: personalBalance }. Refuses like
 * resolveBillingOrg.
 */
async function spendableGenTokens(uid, personalBalance) {
  try {
    const orgId = await resolveBillingOrg(uid);
    if (!orgId) return { orgId: null, available: personalBalance || 0 };
    const key = monthKey();
    const [wallet, usage] = await Promise.all([walletRef(orgId).get(), usageRef(orgId, key).get()]);
    const refilled = refillWallet(wallet.exists ? wallet.data() : {}, key);
    const usedThisMonth = (usage.exists && usage.data().members?.[uid]) || 0;
    return { orgId, available: memberAvailable({ wallet: refilled, usedThisMonth }) };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error(`spendableGenTokens failed for ${uid}:`, error);
    return { orgId: null, available: personalBalance || 0 };
  }
}

const WALLET_REFUSAL_MESSAGES = {
  'member-cap': "You've reached your monthly AI token limit for this team.",
  'wallet-empty': "Your team's AI tokens are used up for this month."
};

/**
 * Inside the caller's transaction (all reads first, as Firestore requires):
 * read the wallet and this month's usage, refill, check the member's cap.
 * Returns a `commit()` that writes the charge, or throws a
 * resource-exhausted HttpsError with details.reason.
 */
async function prepareWalletCharge(tx, { orgId, uid, cost }) {
  const key = monthKey();
  const [wallet, usage] = await Promise.all([tx.get(walletRef(orgId)), tx.get(usageRef(orgId, key))]);
  const refilled = refillWallet(wallet.exists ? wallet.data() : {}, key);
  const usedThisMonth = (usage.exists && usage.data().members?.[uid]) || 0;
  const reason = walletChargeRefusal({ wallet: refilled, usedThisMonth, cost });
  if (reason) {
    throw new functions.https.HttpsError('resource-exhausted', WALLET_REFUSAL_MESSAGES[reason], {
      reason,
      orgId
    });
  }
  const tokensBefore = refilled.genToken;
  const tokensAfter = tokensBefore - cost;
  return {
    tokensBefore,
    tokensAfter,
    monthKey: key,
    commit: () => {
      tx.set(
        walletRef(orgId),
        { genToken: tokensAfter, lastRefill: refilled.lastRefill, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      tx.set(
        usageRef(orgId, key),
        { total: FieldValue.increment(cost), members: { [uid]: FieldValue.increment(cost) } },
        { merge: true }
      );
    }
  };
}

/**
 * Inside the caller's transaction (reads done): give a refunded charge back
 * to the wallet, and take it off the month's usage it was counted in.
 */
function refundToWallet(tx, { orgId, uid, cost, chargedMonth }) {
  tx.set(
    walletRef(orgId),
    { genToken: FieldValue.increment(cost), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  if (chargedMonth) {
    tx.set(
      usageRef(orgId, chargedMonth),
      { total: FieldValue.increment(-cost), members: { [uid]: FieldValue.increment(-cost) } },
      { merge: true }
    );
  }
}

/**
 * Switch the user's active team (the team switcher): a team they belong to,
 * in any role, or null for Personal. It sets the defaults for new work and
 * pays for their generations when they hold a seat in it.
 */
async function setActiveOrg({ uid, orgId }) {
  if (orgId !== null && (typeof orgId !== 'string' || !orgId)) throw new OrgError('invalid-argument');
  if (orgId) {
    const member = await db().collection('orgs').doc(orgId).collection('members').doc(uid).get();
    if (!member.exists) throw new OrgError('not-member');
  }
  await userOrgsRef(uid).set(
    { activeOrgId: orgId, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  return { activeOrgId: orgId };
}

/** The user's active team if they still belong to it, else null. */
async function readActiveOrgId(uid) {
  const userOrgs = await userOrgsRef(uid).get();
  const data = userOrgs.exists ? userOrgs.data() : {};
  const orgId = data.activeOrgId || null;
  return orgId && data.orgs && data.orgs[orgId] ? orgId : null;
}

/** Owners and admins set the per-member monthly cap (null = none). */
async function setMemberCap({ actorUid, orgId, memberMonthlyCap }) {
  if (!isValidCap(memberMonthlyCap)) throw new OrgError('invalid-argument');
  const member = await db().collection('orgs').doc(orgId).collection('members').doc(actorUid).get();
  if (!member.exists) throw new OrgError('not-member');
  if (!canManageOrg(member.data().role)) throw new OrgError('not-manager');
  await walletRef(orgId).set(
    { memberMonthlyCap, updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  return { orgId, memberMonthlyCap };
}

/**
 * Staff: set a custom monthly budget (kept when the plan or seats change;
 * 'default' goes back to the plan's allowance per seat, not for a site
 * license) and/or add tokens on
 * top (a purchase). null means unchanged, like undefined: the callable client
 * sends an omitted value as null. Logged in tokenLog.
 */
async function updateWallet({ orgId, monthlyTokenBudget, addTokens, actorUid }) {
  const setsBudget = monthlyTokenBudget != null;
  const addsTokens = addTokens != null;
  if (setsBudget && monthlyTokenBudget !== 'default' && !isValidBudget(monthlyTokenBudget)) {
    throw new OrgError('invalid-argument');
  }
  if (addsTokens && !(Number.isInteger(addTokens) && addTokens > 0 && addTokens <= 1000000)) {
    throw new OrgError('invalid-argument');
  }
  const org = await db().collection('orgs').doc(orgId).get();
  if (!org.exists) throw new OrgError('org-not-found');
  // A site license has no seats to derive a budget from.
  if (monthlyTokenBudget === 'default' && org.data().siteLicense) {
    throw new OrgError('site-license-terms');
  }
  const budget =
    monthlyTokenBudget === 'default'
      ? defaultMonthlyBudget(org.data().plan, org.data().seats)
      : monthlyTokenBudget;
  await walletRef(orgId).set(
    {
      ...(setsBudget && {
        monthlyTokenBudget: budget,
        customBudget: monthlyTokenBudget !== 'default'
      }),
      ...(addsTokens && { genToken: FieldValue.increment(addTokens) }),
      updatedAt: FieldValue.serverTimestamp()
    },
    { merge: true }
  );
  if (addsTokens) {
    await db().collection('tokenLog').add({
      orgId,
      userId: actorUid || null,
      type: 'purchase',
      tokenCost: addTokens,
      source: 'staff-org-grant',
      createdAt: FieldValue.serverTimestamp()
    });
  }
  return {
    orgId,
    ...(setsBudget && { monthlyTokenBudget: budget }),
    ...(addsTokens && { addTokens })
  };
}

const requireStaff = (context) => {
  const uid = requireAuth(context);
  if (context.auth.token.admin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Staff only.');
  }
  return uid;
};

const orgSetActive = callable((data, context) =>
  setActiveOrg({ uid: requireAuth(context), orgId: data.orgId || null })
);

const orgSetMemberCap = callable((data, context) =>
  setMemberCap({
    actorUid: requireAuth(context),
    orgId: data.orgId,
    memberMonthlyCap: data.memberMonthlyCap === undefined ? null : data.memberMonthlyCap
  })
);

const orgUpdateWallet = callable((data, context) =>
  updateWallet({
    actorUid: requireStaff(context),
    orgId: data.orgId,
    monthlyTokenBudget: data.monthlyTokenBudget,
    addTokens: data.addTokens
  })
);

module.exports = {
  resolveBillingOrg,
  spendableGenTokens,
  prepareWalletCharge,
  refundToWallet,
  setActiveOrg,
  readActiveOrgId,
  setMemberCap,
  updateWallet,
  orgSetActive,
  orgSetMemberCap,
  orgUpdateWallet
};
