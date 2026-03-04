const isUserPro = async (user) => {
  if (user) {
    try {
      // Use server-side validation for both subscription and domain checking
      const { functions } = await import('../../services/firebase.js');
      const { httpsCallable } = await import('firebase/functions');

      const checkProStatus = httpsCallable(functions, 'checkUserProStatus');
      const result = await checkProStatus();

      const { isPro, isMax, plan, isProSubscription, isProDomain, teamDomain } =
        result.data;

      if (isPro) {
        if (isMax) {
          console.log('MAX PLAN USER (subscription)');
        } else if (isProSubscription) {
          console.log('PRO PLAN USER (subscription)');
        }
        if (isProDomain) {
          console.log(`PRO PLAN USER (domain: ${teamDomain})`);
        }
        return {
          isPro: true,
          isMax: !!isMax,
          plan: plan || null,
          isProSubscription,
          isProDomain,
          teamDomain
        };
      } else {
        console.log('FREE PLAN USER');
        return {
          isPro: false,
          isMax: false,
          plan: null,
          isProSubscription: false,
          isProDomain: false,
          teamDomain: null
        };
      }
    } catch (error) {
      console.error('Error checking PRO plan:', error);

      // Fallback to local claims check if server call fails.
      // Uses cached token (no forced refresh) to avoid additional latency.
      try {
        const idTokenResult = await user.getIdTokenResult();
        const claimPlan = idTokenResult.claims.plan;
        if (claimPlan === 'PRO' || claimPlan === 'MAX') {
          console.log(`${claimPlan} PLAN USER (fallback - cached claims)`);
          return {
            isPro: true,
            isMax: claimPlan === 'MAX',
            plan: claimPlan,
            isProSubscription: true,
            isProDomain: false,
            teamDomain: null
          };
        }
      } catch (fallbackError) {
        console.error('Fallback pro check also failed:', fallbackError);
      }

      return {
        isPro: false,
        isMax: false,
        plan: null,
        isProSubscription: false,
        isProDomain: false,
        teamDomain: null
      };
    }
  } else {
    return {
      isPro: false,
      isMax: false,
      plan: null,
      isProSubscription: false,
      isProDomain: false,
      teamDomain: null
    };
  }
};

const isUserBeta = async (user) => {
  if (user) {
    try {
      await user.getIdToken(true);
      const idTokenResult = await user.getIdTokenResult();
      if (idTokenResult.claims.beta) {
        return true;
      } else {
        return false;
      }
    } catch (error) {
      console.error('Error checking BETA status:', error);
      return false;
    }
  } else {
    return false;
  }
};

export { isUserPro, isUserBeta };
