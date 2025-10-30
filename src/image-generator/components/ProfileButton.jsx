/**
 * Image Generator ProfileButton - wraps shared ProfileButton with hover card
 * Click or hover to open profile card, click to sign in if not logged in
 */
import {
  ProfileButton as SharedProfileButton,
  SignInModal
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

    // If not logged in, open sign in modal
    if (!currentUser) {
      setModal('signin');
    }
    // If logged in, the hover card will handle the interaction
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
      />

      <SignInModal
        isOpen={modal === 'signin'}
        onClose={() => setModal(null)}
        message="Sign in to use AI image generation."
        firebaseAuth={auth}
        onAnalytics={handleAnalytics}
      />
    </>
  );
};

export default ProfileButton;
