import styles from './ProfileButton.module.scss';

import { Button } from '../Button';
import { Profile32Icon } from './icons.jsx';
import { useAuthContext } from '../../../contexts';
import posthog from 'posthog-js';
import MsftProfileImg from '../../../../../ui_assets/profile-microsoft.png';
import useStore from '@/store';
/**
 * ProfileButton component.
 *
 * @author Rostyslav Nahornyi
 * @category Components.
 */
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
  const setModal = useStore((state) => state.setModal);
  const onClick = async () => {
    posthog.capture('profile_button_clicked', { is_logged_in: !!currentUser });
    if (currentUser) {
      setModal('profile');
    } else {
      setModal('signin');
    }
  };

  return (
    <Button
      className={styles.profileButton}
      onClick={onClick}
      variant="toolbtn"
    >
      {renderProfileIcon(currentUser)}
    </Button>
  );
};
export { ProfileButton, renderProfileIcon };
