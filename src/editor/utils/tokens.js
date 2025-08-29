import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { isUserPro } from '../api/user';

export const getTokenProfile = async (userId) => {
  try {
    const tokenProfileRef = doc(db, 'tokenProfile', userId);
    const tokenProfileDoc = await getDoc(tokenProfileRef);

    if (tokenProfileDoc.exists()) {
      return tokenProfileDoc.data();
    } else {
      // Create initial token profile with exactly 3 tokens for each type
      // Firestore rules enforce this must be exactly 3 tokens
      const defaultProfile = {
        userId,
        geoToken: 3,
        imageToken: 3,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      await setDoc(tokenProfileRef, defaultProfile);
      return { ...defaultProfile, geoToken: 3, imageToken: 3 };
    }
  } catch (error) {
    console.error('Error getting token profile:', error);
    throw error;
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
  if (user.isPro) return true;

  try {
    const tokenProfile = await getTokenProfile(user.uid);
    return tokenProfile.imageToken > 0;
  } catch (error) {
    console.error('Error checking image feature access:', error);
    return false;
  }
};
