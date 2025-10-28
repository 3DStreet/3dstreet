/**
 * Image Generator ProfileButton - wraps shared ProfileButton with tooltip
 * Uses local Zustand store for modal management
 */
import {
  ProfileButton as SharedProfileButton,
  SignInModal,
  SharedProfileModal
} from '@shared/auth/components';
import { useAuthContext } from '../../editor/contexts';
import { auth } from '../../editor/services/firebase';
import useImageGenStore from '../store';
import posthog from 'posthog-js';

const ProfileButton = () => {
  const { currentUser, isLoading } = useAuthContext();
  const { modal, setModal } = useImageGenStore();

  const onClick = () => {
    if (isLoading) return;

    posthog.capture('profile_button_clicked', { is_logged_in: !!currentUser });

    if (currentUser) {
      setModal('profile');
    } else {
      setModal('signin');
    }
  };

  const handleAnalytics = (eventName, properties) => {
    posthog.capture(eventName, properties);
  };

  return (
    <>
      <SharedProfileButton
        currentUser={currentUser}
        isLoading={isLoading}
        onClick={onClick}
        tooltipSide="bottom"
      />

      <SignInModal
        isOpen={modal === 'signin'}
        onClose={() => setModal(null)}
        message="Sign in to use AI image generation."
        firebaseAuth={auth}
        onAnalytics={handleAnalytics}
      />

      <SharedProfileModal
        isOpen={modal === 'profile'}
        onClose={() => setModal(null)}
        showEscapeHatch={true}
      />
    </>
  );
};

export default ProfileButton;
