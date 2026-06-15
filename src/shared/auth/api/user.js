/**
 * Boundary translator between the cloud function (`checkUserProStatus`) and
 * client code. The server still uses the legacy field name `isProDomain`;
 * we expose the friendlier `isProTeam` to the client and drop the unused
 * `isProSubscription` field. End-state client shape: { isPro, isProTeam,
 * teamDomain }.
 */

const FREE_USER = { isPro: false, isProTeam: false, teamDomain: null };

const isUserPro = async (user) => {
  if (!user) return FREE_USER;

  try {
    const { functions } = await import('../../services/firebase.js');
    const { httpsCallable } = await import('firebase/functions');

    const checkProStatus = httpsCallable(functions, 'checkUserProStatus');
    const result = await checkProStatus();

    const { isPro, isProSubscription, isProDomain, teamDomain } = result.data;

    if (isPro) {
      if (isProSubscription) console.log('PRO PLAN USER (subscription)');
      if (isProDomain) console.log(`PRO PLAN USER (domain: ${teamDomain})`);
      return { isPro: true, isProTeam: !!isProDomain, teamDomain };
    }
    console.log('FREE PLAN USER');
    return FREE_USER;
  } catch (error) {
    console.error('Error checking PRO plan:', error);

    // Fallback to local claims check. Uses the cached token (no forced
    // refresh) to avoid latency on the unhappy path.
    try {
      const idTokenResult = await user.getIdTokenResult();
      // MAX is a superset of Pro — both unlock all Pro features.
      if (
        idTokenResult.claims.plan === 'PRO' ||
        idTokenResult.claims.plan === 'MAX'
      ) {
        console.log('PRO PLAN USER (fallback - cached claims)');
        // Claims fallback can only confirm subscription Pro, not team Pro.
        return { isPro: true, isProTeam: false, teamDomain: null };
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
