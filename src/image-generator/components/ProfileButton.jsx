/**
 * Simplified ProfileButton for Image Generator
 * Manages modal state locally without Zustand store
 */

import { useState } from 'react';
import { useAuthContext } from '../../editor/contexts';
import { Button } from '../../editor/components/elements/Button/Button.component.jsx';
import { Profile32Icon } from '../../editor/components/elements/ProfileButton/icons.jsx';
import MsftProfileImg from '../../../ui_assets/profile-microsoft.png';
import SignInModal from './SignInModal.jsx';
import ProfileModal from './ProfileModal.jsx';
import styles from '../../editor/components/elements/ProfileButton/ProfileButton.module.scss';

const renderProfileIcon = (currentUser) => {
  const isGoogle = currentUser?.providerData[0]?.providerId === 'google.com';
  const isMicrosoft =
    currentUser?.providerData[0]?.providerId === 'microsoft.com';

  if (isGoogle && currentUser?.photoURL) {
    return (
      <img
        className={styles.photoURL}
        src={currentUser.photoURL}
        alt="userPhoto"
        referrerPolicy="no-referrer"
      />
    );
  } else if (isMicrosoft) {
    return (
      <img
        src={MsftProfileImg}
        alt="Microsoft Profile"
        height="40"
        width="40"
      />
    );
  } else {
    return Profile32Icon;
  }
};

const ProfileButton = () => {
  const { currentUser } = useAuthContext();
  const [showSignIn, setShowSignIn] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  const onClick = () => {
    if (currentUser) {
      setShowProfile(true);
    } else {
      setShowSignIn(true);
    }
  };

  return (
    <>
      <Button
        className={styles.profileButton}
        onClick={onClick}
        variant="toolbtn"
      >
        {renderProfileIcon(currentUser)}
      </Button>

      <SignInModal isOpen={showSignIn} onClose={() => setShowSignIn(false)} />

      <ProfileModal
        isOpen={showProfile}
        onClose={() => setShowProfile(false)}
      />
    </>
  );
};

export default ProfileButton;
