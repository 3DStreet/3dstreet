/**
 * Simplified auth API for Image Generator
 * No dependencies on STREET global
 */

import {
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { auth } from '../../editor/services/firebase';
import posthog from 'posthog-js';

const signIn = async () => {
  const { user } = await signInWithPopup(auth, new GoogleAuthProvider());

  // Check if this is a new user (sign up) or existing user (sign in)
  const isNewUser = user.metadata.creationTime === user.metadata.lastSignInTime;

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

  return user;
};

const signInMicrosoft = async () => {
  const provider = new OAuthProvider('microsoft.com');
  const { user } = await signInWithPopup(auth, provider);

  // Check if this is a new user (sign up) or existing user (sign in)
  const isNewUser = user.metadata.creationTime === user.metadata.lastSignInTime;

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

  return user;
};

export { signIn, signInMicrosoft };
