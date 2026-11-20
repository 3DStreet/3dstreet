/**
 * Boundary translator between the cloud function (`checkUserProStatus`) and
 * client code. The server still uses the legacy field name `isProDomain`;
 * we expose the friendlier `isProTeam` to the client and drop the unused
 * `isProSubscription` field. End-state client shape: { isPro, isProTeam,
 * teamDomain, plan, isProPass, proUntil }.
 *
 * isProPass / proUntil (#1922): a one-time pass grants Pro until `proUntil`
 * (ISO string) with no plan claim. The server evaluates expiry on every call;
 * proUntil is returned even after it lapses, so the UI can say when it ended.
 *
 * Organizations (#1267): `orgs` lists the user's orgs ([{ orgId, name, role,
 * plan, status }]) and `orgPlan` is the plan their org seats give ('PRO' |
 * 'MAX' | null). `plan` stays the user's own subscription (billing UI keys
 * off it); `isProTeam` and `teamName` cover Pro from an org, for labels.
 */

const FREE_USER = {
  isPro: false,
  isProTeam: false,
  teamDomain: null,
  teamName: null,
  plan: null,
  orgPlan: null,
  orgs: [],
  isProPass: false,
  proUntil: null
};

// The org a user's plan comes from: the first active org where they hold a
// seat with that plan.
const SEAT_ROLES = ['owner', 'admin', 'member'];
const orgGivingPlan = (orgs, orgPlan) =>
  (orgs || []).find(
    (org) =>
      org.status === 'active' &&
      SEAT_ROLES.includes(org.role) &&
      org.plan === orgPlan
  ) || null;

const isUserPro = async (user) => {
  if (!user) return FREE_USER;

  try {
    const { functions } = await import('../../services/firebase.js');
    const { httpsCallable } = await import('firebase/functions');

    const checkProStatus = httpsCallable(functions, 'checkUserProStatus');
    const result = await checkProStatus();

    const {
      isPro,
      isProSubscription,
      isProDomain,
      teamDomain,
      plan,
      isProPass,
      proUntil,
      orgPlan = null,
      orgs = []
    } = result.data;
    const teamOrg = orgPlan ? orgGivingPlan(orgs, orgPlan) : null;

    if (isPro) {
      if (isProSubscription) console.log('PRO PLAN USER (subscription)');
      if (isProDomain) console.log(`PRO PLAN USER (domain: ${teamDomain})`);
      if (isProPass) console.log(`PRO PLAN USER (pass until ${proUntil})`);
      if (teamOrg) console.log(`PRO PLAN USER (org: ${teamOrg.name})`);
      return {
        isPro: true,
        isProTeam: !!isProDomain || !!teamOrg,
        teamDomain,
        teamName: teamOrg ? teamOrg.name : null,
        plan: plan || null,
        orgPlan,
        orgs,
        isProPass: !!isProPass,
        proUntil: proUntil || null
      };
    }
    console.log('FREE PLAN USER');
    return { ...FREE_USER, orgs, proUntil: proUntil || null };
  } catch (error) {
    console.error('Error checking PRO plan:', error);

    // Fallback to local claims check. Uses the cached token (no forced
    // refresh) to avoid latency on the unhappy path.
    try {
      const idTokenResult = await user.getIdTokenResult();
      const claimPlan = idTokenResult.claims.plan;
      // MAX is a superset of Pro — both unlock all Pro features.
      if (claimPlan === 'PRO' || claimPlan === 'MAX') {
        console.log('PRO PLAN USER (fallback - cached claims)');
        // Claims fallback can only confirm subscription Pro — not team Pro,
        // and not a one-time pass (proUntil lives in Firestore, not claims),
        // so a pass holder reads as free until the callable recovers.
        return {
          ...FREE_USER,
          isPro: true,
          plan: claimPlan
        };
      }
    } catch (fallbackError) {
      console.error('Fallback pro check also failed:', fallbackError);
    }
    return FREE_USER;
  }
};

const isUserBeta = async (user) => {
  if (!user) return false;
  try {
    await user.getIdToken(true);
    const idTokenResult = await user.getIdTokenResult();
    return !!idTokenResult.claims.beta;
  } catch (error) {
    console.error('Error checking BETA status:', error);
    return false;
  }
};

export { isUserPro, isUserBeta };
