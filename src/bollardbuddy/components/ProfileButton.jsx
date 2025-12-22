/**
 * Bollard Buddy ProfileButton - wraps shared ProfileButton with sign in modal
 * Click to sign in if not logged in, hover card shows profile if logged in
 */
import { useState } from 'react';
import {
  ProfileButton as SharedProfileButton,
  SignInModal
} from '@shared/auth/components';
import { useAuthContext } from '../../editor/contexts';
import { auth } from '@shared/services/firebase';

const ProfileButton = () => {
  const { currentUser, isLoading } = useAuthContext();
  const [showSignIn, setShowSignIn] = useState(false);

  const onClick = () => {
    if (isLoading) return;

    // If not logged in, open sign in modal
    if (!currentUser) {
      setShowSignIn(true);
    }
    // If logged in, the hover card will handle the interaction
  };

  const handleAnalytics = (eventName, properties) => {
    console.log('Analytics:', eventName, properties);
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
        isOpen={showSignIn}
        onClose={() => setShowSignIn(false)}
        message="Sign in to save your scenes and access your gallery."
        firebaseAuth={auth}
        onAnalytics={handleAnalytics}
      />
    </>
  );
};

export default ProfileButton;
