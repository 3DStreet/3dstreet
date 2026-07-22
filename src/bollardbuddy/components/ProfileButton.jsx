/**
 * Bollard Buddy ProfileButton - wraps the shared ProfileButton + sign-in modal.
 * The profile icon opens the shared menu (profile/log out when signed in;
 * sign-in + language when signed out); onSignIn opens this app's SignInModal.
 */
import { useState } from 'react';
import {
  ProfileButton as SharedProfileButton,
  SignInModal
} from '@shared/auth/components';
import { useAuthContext } from '../../editor/contexts';
import { auth } from '@shared/services/firebase';
import { useSharedMessages } from '@shared/i18n/sharedMessages';

const ProfileButton = () => {
  const { currentUser, isLoading } = useAuthContext();
  const [showSignIn, setShowSignIn] = useState(false);
  const t = useSharedMessages();

  const handleAnalytics = (eventName, properties) => {
    console.log('Analytics:', eventName, properties);
  };

  return (
    <>
      <SharedProfileButton
        currentUser={currentUser}
        isLoading={isLoading}
        tooltipSide="bottom"
        showHoverCard={true}
        onSignIn={() => setShowSignIn(true)}
      />

      <SignInModal
        isOpen={showSignIn}
        onClose={() => setShowSignIn(false)}
        message={t('bbSignInMessage')}
        firebaseAuth={auth}
        onAnalytics={handleAnalytics}
      />
    </>
  );
};

export default ProfileButton;
