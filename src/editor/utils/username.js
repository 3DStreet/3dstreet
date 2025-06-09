import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  updateDoc,
  serverTimestamp,
  limit
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { generateUsername } from './username-generator.js';

// Re-export the generator function
export { generateUsername };

// Validate username format
export const validateUsernameFormat = (username) => {
  if (!username) {
    return { valid: false, error: 'Username is required' };
  }
  if (username.length < 3) {
    return { valid: false, error: 'Username must be at least 3 characters' };
  }
  if (username.length > 25) {
    return { valid: false, error: 'Username must be 25 characters or less' };
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    return {
      valid: false,
      error: 'Username can only contain letters, numbers, and underscores'
    };
  }
  return { valid: true };
};

// Check if username is available
export const checkUsernameAvailability = async (username) => {
  try {
    const usernameQuery = query(
      collection(db, 'socialProfile'),
      where('username', '==', username.toLowerCase()),
      limit(1)
    );
    const querySnapshot = await getDocs(usernameQuery);
    return querySnapshot.empty;
  } catch (error) {
    console.error('Error checking username availability:', error);
    throw error;
  }
};

// Get user's social profile
export const getUserProfile = async (userId) => {
  try {
    const socialProfileRef = doc(db, 'socialProfile', userId);
    const socialProfileDoc = await getDoc(socialProfileRef);
    return socialProfileDoc.exists() ? socialProfileDoc.data() : null;
  } catch (error) {
    console.error('Error getting social profile:', error);
    throw error;
  }
};

// Create or update social profile
export const saveUserProfile = async (userId, profileData) => {
  try {
    const socialProfileRef = doc(db, 'socialProfile', userId);
    const existingProfile = await getDoc(socialProfileRef);

    if (existingProfile.exists()) {
      await updateDoc(socialProfileRef, {
        ...profileData,
        updatedAt: serverTimestamp()
      });
    } else {
      await setDoc(socialProfileRef, {
        userId,
        ...profileData,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
  } catch (error) {
    console.error('Error saving social profile:', error);
    throw error;
  }
};

// Generate and save username for user
export const generateAndSaveUsername = async (userId) => {
  let username;
  let isAvailable = false;
  let attempts = 0;
  const maxAttempts = 10;

  while (!isAvailable && attempts < maxAttempts) {
    username = generateUsername();
    isAvailable = await checkUsernameAvailability(username);
    attempts++;
  }

  if (!isAvailable) {
    throw new Error('Failed to generate unique username');
  }

  await saveUserProfile(userId, {
    username: username.toLowerCase(),
    usernameUpdatedAt: serverTimestamp(),
    isUsernameCustomized: false
  });

  return username;
};

// Update username
export const updateUsername = async (userId, newUsername) => {
  const validation = validateUsernameFormat(newUsername);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const isAvailable = await checkUsernameAvailability(newUsername);
  if (!isAvailable) {
    throw new Error('Username is already taken');
  }

  await saveUserProfile(userId, {
    username: newUsername.toLowerCase(),
    usernameUpdatedAt: serverTimestamp(),
    isUsernameCustomized: true
  });

  return newUsername.toLowerCase();
};

// Search for users by username
export const searchUsersByUsername = async (usernameQuery) => {
  try {
    if (!usernameQuery || usernameQuery.length < 2) {
      return [];
    }

    // Convert to lowercase for case-insensitive search
    const searchTerm = usernameQuery.toLowerCase();

    // Query the socialProfile collection for usernames that start with the search term
    const usernameQueryRef = query(
      collection(db, 'socialProfile'),
      where('username', '>=', searchTerm),
      where('username', '<=', searchTerm + '\uf8ff'),
      limit(10)
    );

    const querySnapshot = await getDocs(usernameQueryRef);

    // Map results to include userId and username
    const results = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      results.push({
        userId: doc.id,
        username: data.username
      });
    });

    return results;
  } catch (error) {
    console.error('Error searching users by username:', error);
    throw error;
  }
};
