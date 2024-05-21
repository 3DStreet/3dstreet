import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '../services/firebase';
import { sendMetric } from '../services/ga';

const signIn = async () => {
  try {
    const {
      user: {
        metadata: { creationTime, lastSignInTime }
      }
    } = await signInWithPopup(auth, new GoogleAuthProvider());

    // first signIn to ga
    if (creationTime !== lastSignInTime) return;
    sendMetric('Auth', 'newAccountCreation');
  } catch (error) {
    console.error(error);
  }
};

export { signIn };
