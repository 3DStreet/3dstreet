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

  const lookupMsAzureProfilePhoto = (accessToken) => {
    fetch('https://graph.microsoft.com/v1.0/me/photo/$value', {
      // this results in 401 error if a user hasn't set a profile photo
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'image/jpg'
      }
    })
      .then(async function (response) {
        return await response.blob();
      })
      .then(function (blob) {
        const imageObjectURL = URL.createObjectURL(blob);
        // imageObjectURL will be e.g. blob:http://localhost:3000/f123c12a-1234-4e30-4321-af32f2c5e5bc
        // so updating the <img scr=""> will present the image correctly after
        // this function runs
        // setProfilePicUrl(imageObjectURL);
        return imageObjectURL;
      })
      .catch((e) => console.log('error injecting photo'));
  };

  const getCurrentUserProfilePhotoURL = (currentUser) => {
    if (!currentUser) {
      return;
    }
    // check if currentUser is not null, then check if photoURL is null
    console.log(currentUser);
    if (currentUser.photoURL) {
      return currentUser.photoURL;
    } else if (currentUser.providerData[0].providerId === 'microsoft.com') {
      console.log('microsoft.com', currentUser);
      console.log(currentUser.accessToken);
      const imageObjectURLResponse = lookupMsAzureProfilePhoto(
        currentUser.accessToken
      );
      console.log(imageObjectURLResponse);
      return imageObjectURLResponse;
      // getRedirectResult(auth)
      //   .then(result => {
      //     const accessToken = result.credential.accessToken;
      //     localStorage.set('accessToken', accessToken);
      //     console.log(accessToken);
      //   });
    }
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
          src={getCurrentUserProfilePhotoURL(currentUser)}
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
