import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '../services/firebase';
import { sendMetric } from '../services/ga';
import posthog from 'posthog-js';

const signIn = async () => {
  try {
    const { user } = await signInWithPopup(auth, new GoogleAuthProvider());
    posthog.identify(user.uid, {
      email: user.email,
      name: user.displayName
    });
    // first signIn to ga
    if (user.metadata.creationTime !== user.metadata.lastSignInTime) return;
    sendMetric('Auth', 'newAccountCreation');
  } catch (error) {
    console.error(error);
  }
};

export { signIn };
