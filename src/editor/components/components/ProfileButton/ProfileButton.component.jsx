import styles from './ProfileButton.module.scss';

import { Button } from '../Button';
import Events from '../../../lib/Events.js';
import { Profile32Icon } from './icons.jsx';
import { useAuthContext } from '../../../contexts';
import posthog from 'posthog-js';

/**
 * ProfileButton component.
 *
 * @author Rostyslav Nahornyi
 * @category Components.
 */
const ProfileButton = () => {
  const { currentUser } = useAuthContext();

  const onClick = async () => {
    posthog.capture('profile_button_clicked', { is_logged_in: !!currentUser });
    if (currentUser) {
      return Events.emit('openprofilemodal');
    }

    return Events.emit('opensigninmodal');
  };

  return (
    <Button
      className={styles.profileButton}
      onClick={onClick}
      variant="toolbtn"
    >
      {currentUser ? (
        <img
          className={styles.photoURL}
          src={currentUser.photoURL}
          alt="userPhoto"
          referrerPolicy="no-referrer"
        />
      ) : (
        Profile32Icon
      )}
    </Button>
  );
};
export { ProfileButton };
