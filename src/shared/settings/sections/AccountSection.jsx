/**
 * My profile > account: who is signed in, with which provider, and log out.
 */
import { FormattedMessage } from 'react-intl';
import { signOut } from 'firebase/auth';
import posthog from 'posthog-js';
import { auth } from '@shared/services/firebase';
import { useAuthContext } from '@shared/contexts';
import { Button } from '@shared/components/Button';
import {
  renderProfileIcon,
  getAuthProviderName
} from '@shared/auth/components';
import { useSettingsHost } from '../SettingsHost';
import styles from '../SettingsModal.module.scss';

export function AccountSection() {
  const { currentUser, setCurrentUser } = useAuthContext();
  const { close } = useSettingsHost();

  const logOut = async () => {
    close();
    await signOut(auth);
    posthog.reset();
    setCurrentUser(null);
  };

  return (
    <>
      <h3 className={styles.sectionTitle}>
        <FormattedMessage
          id="profileModal.accountInformation"
          defaultMessage="Account Information"
        />
      </h3>
      <div className={styles.card}>
        <div className={styles.profile}>
          {renderProfileIcon(currentUser)}
          <div className={styles.credentials}>
            <span className={styles.name}>{currentUser?.displayName}</span>
            <span className={styles.muted}>{currentUser?.email}</span>
            <span className={styles.hint}>
              <FormattedMessage
                id="profileModal.signedInWith"
                defaultMessage="Signed in with {provider}"
                values={{ provider: getAuthProviderName(currentUser) }}
              />
            </span>
          </div>
        </div>
        <Button variant="outlined" onClick={logOut}>
          <FormattedMessage id="profileModal.logOut" defaultMessage="Log Out" />
        </Button>
      </div>
    </>
  );
}
