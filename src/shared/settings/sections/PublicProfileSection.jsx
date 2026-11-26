/**
 * Settings > Public profile: the @username shown on community and team
 * scenes. A user without one gets one generated the first time.
 */
import { useEffect, useState } from 'react';
import { FormattedMessage } from 'react-intl';
import { useAuthContext } from '@shared/contexts';
import { Loader } from '@shared/icons';
import { UsernameEditor } from '@shared/components/UsernameEditor';
import {
  getUserProfile,
  generateAndSaveUsername
} from '@shared/utils/username';
import styles from '../SettingsModal.module.scss';

export function PublicProfileSection() {
  const { currentUser } = useAuthContext();
  const [username, setUsername] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (!currentUser?.uid) return undefined;
    let cancelled = false;
    setIsLoading(true);
    (async () => {
      try {
        const profile = await getUserProfile(currentUser.uid);
        const name =
          profile?.username || (await generateAndSaveUsername(currentUser.uid));
        if (!cancelled) setUsername(name);
      } catch (error) {
        console.error('Error loading username:', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.uid]);

  return (
    <>
      <h3 className={styles.sectionTitle}>
        <FormattedMessage
          id="profileModal.publicProfile"
          defaultMessage="Public Profile"
        />
      </h3>
      {isLoading ? (
        <div className={styles.loading}>
          <Loader className={styles.spinner} />
          <FormattedMessage
            id="profileModal.loadingUsername"
            defaultMessage="Loading username..."
          />
        </div>
      ) : username ? (
        <UsernameEditor
          currentUsername={username}
          userId={currentUser?.uid}
          onUpdate={setUsername}
        />
      ) : null}
    </>
  );
}
