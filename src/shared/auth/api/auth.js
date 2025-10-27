/**
 * Shared authentication API with dependency injection
 * No hard dependencies on STREET, PostHog, or app-specific infrastructure
 *
 * @author 3DStreet Team
 * @category Shared API
 */

import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut
} from 'firebase/auth';

/**
 * Sign in with Google
 *
 * @param {Object} firebaseAuth - Firebase auth instance
 * @param {Function} [onAnalytics] - Optional analytics callback (eventName, properties)
 * @param {Function} [onNotification] - Optional notification callback (type, message)
 * @returns {Promise<Object>} Firebase user object
 */
export const signInWithGoogle = async (
  firebaseAuth,
  onAnalytics,
  onNotification
) => {
  try {
    const { user } = await signInWithPopup(
      firebaseAuth,
      new GoogleAuthProvider()
    );

    // Check if this is a new user (sign up) or existing user (sign in)
    const isNewUser =
      user.metadata.creationTime === user.metadata.lastSignInTime;

    // Fire analytics event if callback provided
    if (onAnalytics) {
      const eventName = isNewUser ? 'user_signed_up' : 'sign_in_completed';
      onAnalytics(eventName, {
        email: user.email,
        name: user.displayName,
        provider: 'google.com',
        user_id: user.uid
      });
    }

    onNotification?.('success', 'Successfully signed in with Google!');

    return user;
  } catch (error) {
    // Handle specific error for account-exists-with-different-credential
    if (error.code === 'auth/account-exists-with-different-credential') {
      onNotification?.(
        'error',
        'Cannot use Google login with your email, try using Microsoft login instead.'
      );
    } else {
      onNotification?.(
        'error',
        `Unexpected error using Google for login: ${error.message}`
      );
      console.error(error);
    }
    throw error;
  }
};

/**
 * Sign in with Microsoft
 *
 * @param {Object} firebaseAuth - Firebase auth instance
 * @param {Function} [onAnalytics] - Optional analytics callback (eventName, properties)
 * @param {Function} [onNotification] - Optional notification callback (type, message)
 * @returns {Promise<Object>} Firebase user object
 */
export const signInWithMicrosoft = async (
  firebaseAuth,
  onAnalytics,
  onNotification
) => {
  try {
    const provider = new OAuthProvider('microsoft.com');
    const { user } = await signInWithPopup(firebaseAuth, provider);

    // Check if this is a new user (sign up) or existing user (sign in)
    const isNewUser =
      user.metadata.creationTime === user.metadata.lastSignInTime;

    // Fire analytics event if callback provided
    if (onAnalytics) {
      const eventName = isNewUser ? 'user_signed_up' : 'sign_in_completed';
      onAnalytics(eventName, {
        email: user.email,
        name: user.displayName,
        provider: 'microsoft.com',
        user_id: user.uid
      });
    }

    onNotification?.(
      'success',
      'Successful login with Microsoft authentication.'
    );

    return user;
  } catch (error) {
    // Handle specific error for account-exists-with-different-credential
    if (error.code === 'auth/account-exists-with-different-credential') {
      onNotification?.(
        'error',
        'Cannot use Microsoft login with your email, try using Google login instead.'
      );
    } else {
      onNotification?.(
        'error',
        `Unexpected error using Microsoft for login: ${error.message}`
      );
      console.error(error);
    }
    throw error;
  }
};

/**
 * Sign out the current user
 *
 * @param {Object} firebaseAuth - Firebase auth instance
 * @param {Function} [onAnalytics] - Optional analytics callback (eventName, properties)
 * @param {Function} [onNotification] - Optional notification callback (type, message)
 * @returns {Promise<void>}
 */
export const signOut = async (firebaseAuth, onAnalytics, onNotification) => {
  try {
    await firebaseSignOut(firebaseAuth);
    onAnalytics?.('sign_out_completed');
    onNotification?.('success', 'Successfully signed out');
  } catch (error) {
    onNotification?.('error', `Error signing out: ${error.message}`);
    console.error(error);
    throw error;
  }
};
