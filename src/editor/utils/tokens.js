import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';

export const getTokenProfile = async (userId) => {
  try {
    const tokenProfileRef = doc(db, 'tokenProfile', userId);
    const tokenProfileDoc = await getDoc(tokenProfileRef);

    if (tokenProfileDoc.exists()) {
      return tokenProfileDoc.data();
    } else {
      // Create initial token profile with exactly 3 tokens
      // Firestore rules enforce this must be exactly 3 tokens
      const defaultProfile = {
        userId,
        geoToken: 3,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      await setDoc(tokenProfileRef, defaultProfile);
      return { ...defaultProfile, geoToken: 3 };
    }
  } catch (error) {
    console.error('Error getting token profile:', error);
    throw error;
  }
};

export const canUseGeoFeature = async (user) => {
  if (!user) return false;

  if (user.isPro) return true;

  try {
    const tokenProfile = await getTokenProfile(user.uid);
    return tokenProfile.geoToken > 0;
  } catch (error) {
    console.error('Error checking geo feature access:', error);
    return false;
  }
};
