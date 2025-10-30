/**
 * Editor auth API - thin wrapper around shared auth with STREET notifications
 */
import { signInWithGoogle, signInWithMicrosoft } from '@shared/auth/api/auth';
import { auth } from '../services/firebase';
import posthog from 'posthog-js';

const signIn = async () => {
  const onAnalytics = (eventName, properties) => {
    posthog.capture(eventName, properties);
  };

  const onNotification = (type, message) => {
    if (type === 'success') {
      STREET.notify.successMessage(message);
    } else if (type === 'error') {
      STREET.notify.errorMessage(message);
    }
  };

  return await signInWithGoogle(auth, onAnalytics, onNotification);
};

const signInMicrosoft = async () => {
  const onAnalytics = (eventName, properties) => {
    posthog.capture(eventName, properties);
  };

  const onNotification = (type, message) => {
    if (type === 'success') {
      STREET.notify.successMessage(message);
    } else if (type === 'error') {
      STREET.notify.errorMessage(message);
    }
  };

  return await signInWithMicrosoft(auth, onAnalytics, onNotification);
};

export { signIn, signInMicrosoft };
