/**
 * Editor-specific wrapper for shared SignInModal
 * Integrates with editor's Zustand store, scene saving, and notification system
 */

import { useIntl } from 'react-intl';
import { SignInModal as SharedSignInModal } from '@/shared/auth/components';
import useStore from '@/store';
import { saveSceneWithScreenshot } from '@/editor/lib/SceneUtils';
import { auth } from '@shared/services/firebase';
import { SavingModal } from '../SavingModal';
import posthog from 'posthog-js';

const SignInModal = () => {
  const intl = useIntl();
  const modal = useStore((state) => state.modal);
  const returnToPreviousModal = useStore(
    (state) => state.returnToPreviousModal
  );

  // Close → return to whatever modal opened sign-in (e.g. UpgradeModal).
  // If nothing opened it (the common case — direct profile-button entry),
  // returnToPreviousModal falls through to setting modal=null. So this is
  // safe to use across all entry points.
  const onClose = () => {
    useStore.setState({ saveAfterSignIn: false });
    returnToPreviousModal();
  };

  const handleNotification = (type, message) => {
    if (type === 'success') {
      STREET.notify.successMessage(message);
    } else if (type === 'error') {
      STREET.notify.errorMessage(message);
    }
  };

  const handleAnalytics = (eventName, properties) => {
    posthog.capture(eventName, properties);
  };

  const handleSuccess = async () => {
    // Save the scene only when sign-in was opened to save or share it
    // (openSignInToSave). saveScene saves a copy when the user isn't its
    // author, and a new scene when it was never saved.
    if (useStore.getState().saveAfterSignIn) {
      useStore.setState({ saveAfterSignIn: false });
      await saveSceneWithScreenshot(auth.currentUser, false);
    }
  };

  return (
    <SharedSignInModal
      isOpen={modal === 'signin'}
      onClose={onClose}
      message={intl.formatMessage({
        id: 'signInModal.message',
        defaultMessage: 'Sign in to save and share scenes.'
      })}
      firebaseAuth={auth}
      onAnalytics={handleAnalytics}
      onNotification={handleNotification}
      onSuccess={handleSuccess}
      LoadingComponent={() => (
        <SavingModal
          action={intl.formatMessage({
            id: 'signInModal.signingIn',
            defaultMessage: 'Signing in'
          })}
        />
      )}
    />
  );
};

export { SignInModal };
