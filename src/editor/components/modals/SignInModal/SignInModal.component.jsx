/**
 * Editor-specific wrapper for shared SignInModal
 * Integrates with editor's Zustand store, scene saving, and notification system
 */

import { SignInModal as SharedSignInModal } from '@/shared/auth/components';
import useStore from '@/store';
import { saveSceneWithScreenshot } from '@/editor/lib/SceneUtils';
import { auth } from '@/editor/services/firebase';
import { SavingModal } from '../SavingModal';

const SignInModal = () => {
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);

  const onClose = () => {
    setModal(null);
  };

  const handleNotification = (type, message) => {
    if (type === 'success') {
      STREET.notify.successMessage(message);
    } else if (type === 'error') {
      STREET.notify.errorMessage(message);
    }
  };

  const handleSuccess = async () => {
    // Save scene after successful sign-in if there's an active scene
    if (STREET.utils.getCurrentSceneId() !== null) {
      await saveSceneWithScreenshot(auth.currentUser, true);
    }
  };

  return (
    <SharedSignInModal
      isOpen={modal === 'signin'}
      onClose={onClose}
      message="Sign in to save and share scenes."
      firebaseAuth={auth}
      onNotification={handleNotification}
      onSuccess={handleSuccess}
      LoadingComponent={() => <SavingModal action="Signing in" />}
    />
  );
};

export { SignInModal };
