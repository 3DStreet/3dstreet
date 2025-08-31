const isUserPro = async (user) => {
  if (user) {
    try {
      // Use server-side validation for both subscription and domain checking
      const { functions } = await import('../services/firebase.js');
      const { httpsCallable } = await import('firebase/functions');

      const checkProStatus = httpsCallable(functions, 'checkUserProStatus');
      const result = await checkProStatus();

      const { isPro, isProSubscription, isProDomain, matchedDomain } =
        result.data;

      if (isPro) {
        if (isProSubscription) {
          console.log('PRO PLAN USER (subscription)');
        }
        if (isProDomain) {
          console.log(`PRO PLAN USER (domain: ${matchedDomain})`);
        }
        return {
          isPro: true,
          isProSubscription,
          isProDomain,
          matchedDomain
        };
      } else {
        console.log('FREE PLAN USER');
        return {
          isPro: false,
          isProSubscription: false,
          isProDomain: false,
          matchedDomain: null
        };
      }
    } catch (error) {
      console.error('Error checking PRO plan:', error);

      // Fallback to local claims check if server call fails
      try {
        await user.getIdToken(true);
        const idTokenResult = await user.getIdTokenResult();
        if (idTokenResult.claims.plan === 'PRO') {
          console.log('PRO PLAN USER (fallback)');
          return {
            isPro: true,
            isProSubscription: true,
            isProDomain: false,
            matchedDomain: null
          };
        }
      } catch (fallbackError) {
        console.error('Fallback pro check also failed:', fallbackError);
      }

      return {
        isPro: false,
        isProSubscription: false,
        isProDomain: false,
        matchedDomain: null
      };
    }
  } else {
    console.log('refreshIdTokens: currentUser not set');
    return {
      isPro: false,
      isProSubscription: false,
      isProDomain: false,
      matchedDomain: null
    };
  }
};

const isUserBeta = async (user) => {
  if (user) {
    try {
      await user.getIdToken(true);
      const idTokenResult = await user.getIdTokenResult();
      if (idTokenResult.claims.beta) {
        console.log('BETA USER');
        return true;
      } else {
        console.log('NOT BETA USER');
        return false;
      }
    } catch (error) {
      console.error('Error checking BETA status:', error);
      return false;
    }
  } else {
    console.log('refreshIdTokens: currentUser not set');
    return false;
  }
};

export { isUserPro, isUserBeta };
