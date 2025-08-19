import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { auth } from '../services/firebase';
import posthog from 'posthog-js';

const signIn = async () => {
  try {
    const { user } = await signInWithPopup(auth, new GoogleAuthProvider());

    // Check if this is a new user (sign up) or existing user (sign in)
    const isNewUser =
      user.metadata.creationTime === user.metadata.lastSignInTime;

    if (isNewUser) {
      posthog.capture('user_signed_up', {
        email: user.email,
        name: user.displayName,
        provider: 'google.com',
        user_id: user.uid
      });
    } else {
      posthog.capture('sign_in_completed', {
        email: user.email,
        name: user.displayName,
        provider: 'google.com',
        user_id: user.uid
      });
    }
  } catch (error) {
    // handle specific error for `auth/account-exists-with-different-credential`
    if (error.code === 'auth/account-exists-with-different-credential') {
      // handle the error
      STREET.notify.errorMessage(
        `Cannot use Google login with your email, try using Microsoft login instead.`
      );
    } else {
      STREET.notify.errorMessage(
        `Unexpected error using Google for login: ${error}.`
      );
      console.error(error);
    }
    throw error;
  }
};

const signInMicrosoft = async () => {
  try {
    const provider = new OAuthProvider('microsoft.com');
    const { user } = await signInWithPopup(auth, provider);
    STREET.notify.successMessage(
      `Successful login with Microsoft authentication.`
    );

    // Check if this is a new user (sign up) or existing user (sign in)
    const isNewUser =
      user.metadata.creationTime === user.metadata.lastSignInTime;

    if (isNewUser) {
      posthog.capture('user_signed_up', {
        email: user.email,
        name: user.displayName,
        provider: 'microsoft.com',
        user_id: user.uid
      });
    } else {
      posthog.capture('sign_in_completed', {
        email: user.email,
        name: user.displayName,
        provider: 'microsoft.com',
        user_id: user.uid
      });
    }
  } catch (error) {
    // handle specific error for `auth/account-exists-with-different-credential`
    if (error.code === 'auth/account-exists-with-different-credential') {
      // handle the error
      STREET.notify.errorMessage(
        `Cannot use Microsoft login with your email, try using Google login instead.`
      );
    } else {
      STREET.notify.errorMessage(
        `Unexpected error using Microsoft for login: ${error}.`
      );
      console.error(error);
    }
  }
};

export { signIn, signInMicrosoft };
