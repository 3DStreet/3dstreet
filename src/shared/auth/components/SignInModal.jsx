/**
 * Shared SignInModal component
 * Reusable sign-in modal for both main app and image generator
 *
 * @author 3DStreet Team
 * @category Shared Components
 */

import { useState } from 'react';
import {
  GoogleSignInButtonSVG,
  SignInMicrosoftIconSVG,
  SignInAppleIconSVG
} from '@shared/icons';
import Modal from '../../components/Modal/Modal.jsx';
import styles from './SignInModal.module.scss';
import {
  signInWithGoogle,
  signInWithMicrosoft,
  signInWithApple
} from '../api/auth';

/**
 * SignInModal Component
 *
 * @param {boolean} isOpen - Whether the modal is open
 * @param {Function} onClose - Callback when modal is closed
 * @param {string} [message] - Custom message to display (default: "Sign in to continue")
 * @param {Object} firebaseAuth - Firebase auth instance
 * @param {Function} [onAnalytics] - Optional analytics callback (eventName, properties)
 * @param {Function} [onNotification] - Optional notification callback (type, message)
 * @param {Function} [onSuccess] - Optional callback after successful sign-in
 * @param {React.Component} [LoadingComponent] - Optional custom loading component
 * @param {string} [loadingMessage] - Message to show while authenticating (default: "Signing in...")
 */
const SignInModal = ({
  isOpen,
  onClose,
  message = 'Sign in to continue',
  firebaseAuth,
  onAnalytics,
  onNotification,
  onSuccess,
  LoadingComponent,
  loadingMessage = 'Signing in...'
}) => {
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const onSignInClick = async (provider = 'google') => {
    setIsAuthenticating(true);
    try {
      if (provider === 'google') {
        await signInWithGoogle(firebaseAuth, onAnalytics, onNotification);
      } else if (provider === 'microsoft') {
        await signInWithMicrosoft(firebaseAuth, onAnalytics, onNotification);
      } else if (provider === 'apple') {
        await signInWithApple(firebaseAuth, onAnalytics, onNotification);
      }

      // Call optional success callback
      if (onSuccess) {
        await onSuccess();
      }

      // Successfully signed in, close modal
      onClose();
    } catch (error) {
      console.error('Authentication error:', error);
      // Don't close modal on error so user can retry
    } finally {
      setIsAuthenticating(false);
    }
  };

  return (
    <>
      <Modal className={styles.modalWrapper} isOpen={isOpen} onClose={onClose}>
        <div className={styles.contentWrapper}>
          <h2 className={styles.title}>Sign in</h2>
          <div className={styles.content}>
            <p className={styles.p1}>{message}</p>
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
          <div
            onClick={() => onSignInClick('apple')}
            alt="Sign In with Apple Button"
            className={styles.signInButton}
          >
            <SignInAppleIconSVG />
          </div>
          {isAuthenticating && !LoadingComponent && (
            <div style={{ marginTop: '20px', textAlign: 'center' }}>
              {loadingMessage}
            </div>
          )}
        </div>
      </Modal>
      {isAuthenticating && LoadingComponent && <LoadingComponent />}
    </>
  );
};

export { SignInModal };
