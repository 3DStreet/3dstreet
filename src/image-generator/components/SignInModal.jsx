/**
 * Simplified SignInModal for Image Generator
 * No dependencies on STREET global, scene utils, or complex store
 */

import { useState } from 'react';
import { signIn, signInMicrosoft } from '../api/auth';
import {
  GoogleSignInButtonSVG,
  SignInMicrosoftIconSVG
} from '../../editor/icons';
import Modal from '../../editor/components/modals/Modal.jsx';
import styles from '../../editor/components/modals/SignInModal/SignInModal.module.scss';

const SignInModal = ({ isOpen, onClose }) => {
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const onSignInClick = async (provider = 'google') => {
    setIsAuthenticating(true);
    try {
      if (provider === 'google') {
        await signIn();
      } else if (provider === 'microsoft') {
        await signInMicrosoft();
      }
      // Successfully signed in, close modal
      onClose();
    } catch (error) {
      console.error('Authentication error:', error);
      alert('Sign in failed: ' + error.message);
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <Modal className={styles.modalWrapper} isOpen={isOpen} onClose={onClose}>
      <div className={styles.contentWrapper}>
        <h2 className={styles.title}>Sign in</h2>
        <div className={styles.content}>
          <p className={styles.p1}>Sign in to use AI image generation.</p>
        </div>
        <div
          onClick={() => onSignInClick('google')}
          alt="Sign In with Google Button"
          className={styles.signInButton}
        >
          <GoogleSignInButtonSVG />
        </div>
        <div
          onClick={() => onSignInClick('microsoft')}
          alt="Sign In with Microsoft Button"
          className={styles.signInButton}
          style={{ transform: 'scale(0.85)' }}
        >
          <SignInMicrosoftIconSVG />
        </div>
        {isAuthenticating && (
          <div style={{ marginTop: '20px', textAlign: 'center' }}>
            Signing in...
          </div>
        )}
      </div>
    </Modal>
  );
};

export default SignInModal;
