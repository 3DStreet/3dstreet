const PRO_DOMAINS = ['unam.mx', 'uoregon.edu'];

const isUserPro = async (user) => {
  if (user) {
    try {
      // Check if the user's email contains "unam.mx"
      if (
        user.email &&
        PRO_DOMAINS.some((domain) => user.email.includes(domain))
      ) {
        return true;
      }

      await user.getIdToken(true);
      const idTokenResult = await user.getIdTokenResult();
      if (idTokenResult.claims.plan === 'PRO') {
        console.log('PRO PLAN USER');
        return true;
      } else {
        console.log('FREE PLAN USER');
        return false;
      }
    } catch (error) {
      console.error('Error checking PRO plan:', error);
      return false;
    }
  } else {
    console.log('refreshIdTokens: currentUser not set');
    return false;
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
