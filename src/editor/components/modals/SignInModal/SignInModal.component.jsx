import { GoogleSignInButtonSVG, SignInMicrosoftIconSVG } from '../../../icons';
import Modal from '../Modal.jsx';
import styles from './SignInModal.module.scss';
import { signIn, signInMicrosoft } from '../../../api';
import useStore from '@/store';
import { saveSceneWithScreenshot } from '@/editor/lib/SceneUtils';
import { auth } from '@/editor/services/firebase';
import { useState } from 'react';
import { SavingModal } from '../SavingModal';

const SignInModal = () => {
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const onClose = () => {
    setModal(null);
  };

  const onSignInClick = async (provider = 'google') => {
    setIsAuthenticating(true);
    try {
      if (provider === 'google') {
        await signIn();
        // Add success message for Google authentication
        STREET.notify.successMessage('Successfully signed in with Google!');
      } else if (provider === 'microsoft') {
        await signInMicrosoft();
        // Microsoft already has a success message in the signInMicrosoft function
      }
      if (STREET.utils.getCurrentSceneId() !== null) {
        await saveSceneWithScreenshot(auth.currentUser, true);
      }
    } catch (error) {
      console.error('Authentication error:', error);
    } finally {
      setIsAuthenticating(false);
      onClose();
    }
  };
  return (
    <>
      <Modal
        className={styles.modalWrapper}
        isOpen={modal === 'signin'}
        onClose={onClose}
      >
        <div className={styles.contentWrapper}>
          <h2 className={styles.title}>Sign in</h2>
          <div className={styles.content}>
            <p className={styles.p1}>Sign in to save and share scenes.</p>
          </div>
          <div
            onClick={() => {
              onSignInClick('google');
            }}
            alt="Sign In with Google Button"
            className={styles.signInButton}
          >
            <GoogleSignInButtonSVG />
          </div>
          <div
            onClick={() => {
              onSignInClick('microsoft');
            }}
            alt="Sign In with Microsoft Button"
            className={styles.signInButton}
            style={{ transform: 'scale(0.85)' }}
          >
            <SignInMicrosoftIconSVG />
          </div>
        </div>
      </Modal>
      {isAuthenticating && <SavingModal action="Signing in" />}
    </>
  );
};

export { SignInModal };
