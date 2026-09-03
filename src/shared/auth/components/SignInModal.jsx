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
          {typeof window !== 'undefined' && window.__webmcpAgentActive && (
            <div className={styles.agentBrowserNote}>
              ⚠️ Sign-in may not work inside AI agent browsers (WebMCP clients),
              which often block third-party sign-in popups. This is a limitation
              of the embedded browser that 3DStreet cannot fix — please report
              it to the browser&apos;s developer. You can keep using 3DStreet
              without an account; premium features stay locked, and scene
              locations within California work without sign-in during the WebMCP
              preview.
            </div>
          )}
          <div
            onClick={() => onSignInClick('google')}
            onKeyDown={(e) => e.key === 'Enter' && onSignInClick('google')}
            role="button"
            tabIndex={0}
            aria-label="Sign in with Google"
            className={styles.signInButton}
          >
            <GoogleSignInButtonSVG />
          </div>
          <div
            onClick={() => onSignInClick('microsoft')}
            onKeyDown={(e) => e.key === 'Enter' && onSignInClick('microsoft')}
            role="button"
            tabIndex={0}
            aria-label="Sign in with Microsoft"
            className={styles.signInButton}
            style={{ transform: 'scale(0.85)' }}
          >
            <SignInMicrosoftIconSVG />
          </div>
          <div
            onClick={() => onSignInClick('apple')}
            onKeyDown={(e) => e.key === 'Enter' && onSignInClick('apple')}
            role="button"
            tabIndex={0}
            aria-label="Sign in with Apple"
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
