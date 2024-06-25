import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
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
    console.error(error);
  }
};

export { signIn };
