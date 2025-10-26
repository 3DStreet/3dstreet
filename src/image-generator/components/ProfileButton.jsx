/**
 * Image Generator ProfileButton - wraps shared ProfileButton with tooltip
 * Uses local Zustand store for modal management
 */
import { ProfileButton as SharedProfileButton } from '@shared/auth/components';
import { useAuthContext } from '../../editor/contexts';
import useImageGenStore from '../store';
import posthog from 'posthog-js';
import SignInModal from './SignInModal.jsx';
import ProfileModal from './ProfileModal.jsx';

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

  return (
    <>
      <SharedProfileButton
        currentUser={currentUser}
        isLoading={isLoading}
        onClick={onClick}
        tooltipSide="bottom"
      />

      <SignInModal isOpen={modal === 'signin'} onClose={() => setModal(null)} />

      <ProfileModal
        isOpen={modal === 'profile'}
        onClose={() => setModal(null)}
      />
    </>
  );
};

export default ProfileButton;
