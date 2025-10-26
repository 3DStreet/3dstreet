/**
 * Image generator auth API - simple wrapper around shared auth
 */
import { signInWithGoogle, signInWithMicrosoft } from '@shared/auth/api/auth';
import { auth } from '../../editor/services/firebase';
import posthog from 'posthog-js';

const signIn = async () => {
  const onAnalytics = (eventName, properties) => {
    posthog.capture(eventName, properties);
  };

  const onNotification = (type, message) => {
    console.log(`[${type}] ${message}`);
  };

  return await signInWithGoogle(auth, onAnalytics, onNotification);
};

const signInMicrosoft = async () => {
  const onAnalytics = (eventName, properties) => {
    posthog.capture(eventName, properties);
  };

  const onNotification = (type, message) => {
    console.log(`[${type}] ${message}`);
  };

  return await signInWithMicrosoft(auth, onAnalytics, onNotification);
};

export { signIn, signInMicrosoft };
