import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { auth } from '../services/firebase';
import { sendMetric } from '../services/ga';
import posthog from 'posthog-js';

const signIn = async () => {
  try {
    const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
    // first signIn to ga
    if (user.metadata.creationTime !== user.metadata.lastSignInTime) return;
    sendMetric('Auth', 'newAccountCreation');
    posthog.capture('user_signed_up', {
      email: user.email,
      name: user.displayName
    });
  } catch (error) {
    // handle specific error for `auth/account-exists-with-different-credential`
    if (error.code === 'auth/account-exists-with-different-credential') {
      // handle the error
      STREET.notify.errorMessage(
        `Cannot use Google login with your email, try using Microsoft login instead.`
      );
      console.log(
        'Cannot use Google login with your email, try using Microsoft login instead.'
      );
    } else {
      STREET.notify.errorMessage(
        `Unexpected error using Google for login: ${error}.`
      );
      console.error(error);
    }
  }
};

const signInMicrosoft = async () => {
  try {
    const provider = new OAuthProvider('microsoft.com');
    const { user } = await signInWithPopup(auth, provider);
    // first signIn to ga
    if (user.metadata.creationTime !== user.metadata.lastSignInTime) return;
    sendMetric('Auth', 'newAccountCreation');
    posthog.capture('user_signed_up', {
      email: user.email,
      name: user.displayName
    });
  } catch (error) {
    // handle specific error for `auth/account-exists-with-different-credential`
    if (error.code === 'auth/account-exists-with-different-credential') {
      // handle the error
      STREET.notify.errorMessage(
        `Cannot use Microsoft login with your email, try using Google login instead.`
      );
      console.log(
        'Cannot use Microsoft login with your email, try using Google login instead.'
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
