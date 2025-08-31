import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, functions } from '../services/firebase';
import { isUserPro } from '../api/user';
import { httpsCallable } from 'firebase/functions';

export const getTokenProfile = async (userId) => {
  try {
    const tokenProfileRef = doc(db, 'tokenProfile', userId);
    const tokenProfileDoc = await getDoc(tokenProfileRef);

    if (tokenProfileDoc.exists()) {
      return tokenProfileDoc.data();
    } else {
      // Create initial token profile with exactly 5 imageTokens and 3 geoTokens for free users
      const defaultProfile = {
        userId,
        geoToken: 3,
        imageToken: 5,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastMonthlyRefill: null // Track when pro tokens were last refilled
      };
      await setDoc(tokenProfileRef, defaultProfile);
      return { ...defaultProfile, geoToken: 3, imageToken: 5 };
    }
  } catch (error) {
    console.error('Error getting token profile:', error);
    throw error;
  }
};

// Call the Cloud Function to check and refill tokens for Pro users
export const checkAndRefillProTokens = async () => {
  try {
    const checkAndRefillFunction = httpsCallable(
      functions,
      'checkAndRefillImageTokens'
    );
    const result = await checkAndRefillFunction();

    if (result.data.success) {
      console.log('Token refill check result:', result.data.message);
      if (result.data.refilled) {
        console.log('Tokens were refilled for this month');
      }
      return result.data.tokenProfile;
    }

    return null;
  } catch (error) {
    console.error('Error calling checkAndRefillImageTokens:', error);
    return null;
  }
};

export const canUseGeoFeature = async (user) => {
  if (!user) return false;

  // Check if user is pro - use isPro property from context if available, otherwise use isUserPro
  if (user.isPro !== undefined) {
    // User from auth context with isPro property
    if (user.isPro) return true;
  } else {
    // User is Firebase auth user object, use isUserPro function
    const isPro = await isUserPro(user);
    if (isPro) return true;
  }

  try {
    const tokenProfile = await getTokenProfile(user.uid);
    return tokenProfile.geoToken > 0;
  } catch (error) {
    console.error('Error checking geo feature access:', error);
    return false;
  }
};

export const canUseImageFeature = async (user) => {
  if (!user) return false;

  // Check if user is pro - use isPro property from context if available
  if (user.isPro) {
    // For pro users, check and refill their monthly allowance
    try {
      await checkAndRefillProTokens(user.uid);
    } catch (error) {
      console.error('Error refilling pro tokens:', error);
    }
    return true;
  }

  try {
    const tokenProfile = await getTokenProfile(user.uid);
    return tokenProfile.imageToken > 0;
  } catch (error) {
    console.error('Error checking image feature access:', error);
    return false;
  }
};
