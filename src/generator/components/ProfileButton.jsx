/**
 * Image Generator ProfileButton - wraps shared ProfileButton with hover card
 * Click or hover to open profile card, click to sign in if not logged in
 */
import {
  ProfileButton as SharedProfileButton,
  SignInModal
} from '@shared/auth/components';
import { useAuthContext } from '../../editor/contexts';
import { auth } from '@shared/services/firebase';
import useImageGenStore from '../store';
import posthog from 'posthog-js';

const ProfileButton = () => {
  const { currentUser, isLoading } = useAuthContext();
  const { modal, setModal, returnToPreviousModal } = useImageGenStore();

  const onClick = () => {
    if (isLoading) return;
    // The profile menu (open/close, sign-in, language) is handled by the shared
    // component; this click just records the interaction.
    posthog.capture('profile_button_clicked', { is_logged_in: !!currentUser });
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
        showHoverCard={true}
        onSignIn={() => setModal('signin')}
      />

      <SignInModal
        isOpen={modal === 'signin'}
        onClose={returnToPreviousModal}
        message="Sign in to use AI image generation."
        firebaseAuth={auth}
        onAnalytics={handleAnalytics}
      />
    </>
  );
};

export default ProfileButton;
