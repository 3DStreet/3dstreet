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
 */

const FREE_USER = {
  isPro: false,
  isProTeam: false,
  teamDomain: null,
  plan: null,
  isProPass: false,
  proUntil: null
};

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
      proUntil
    } = result.data;

    if (isPro) {
      if (isProSubscription) console.log('PRO PLAN USER (subscription)');
      if (isProDomain) console.log(`PRO PLAN USER (domain: ${teamDomain})`);
      if (isProPass) console.log(`PRO PLAN USER (pass until ${proUntil})`);
      return {
        isPro: true,
        isProTeam: !!isProDomain,
        teamDomain,
        plan: plan || null,
        isProPass: !!isProPass,
        proUntil: proUntil || null
      };
    }
    console.log('FREE PLAN USER');
    return { ...FREE_USER, proUntil: proUntil || null };
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
