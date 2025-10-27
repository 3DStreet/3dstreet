/**
 * Simplified ProfileModal for Image Generator
 * No dependencies on complex store or 3DStreet-specific features
 */

import { signOut } from 'firebase/auth';
import { auth } from '../../editor/services/firebase';
import { useAuthContext } from '../../editor/contexts';
import Modal from '../../editor/components/modals/Modal.jsx';
import { Button } from '../../editor/components/elements/Button/Button.component.jsx';
import styles from '../../editor/components/modals/ProfileModal/ProfileModal.module.scss';
import posthog from 'posthog-js';
import { renderProfileIcon } from '@shared/auth/components';
import { TokenDisplayInner } from './TokenDisplay.jsx';

const ProfileModal = ({ isOpen, onClose }) => {
  const { currentUser, setCurrentUser, tokenProfile } = useAuthContext();

  const logOutHandler = async () => {
    onClose();
    await signOut(auth);
    posthog.reset();
    setCurrentUser(null);
  };

  return (
    <Modal className={styles.modalWrapper} isOpen={isOpen} onClose={onClose}>
      <div className={styles.contentWrapper}>
        <h2 className={styles.title}>Account</h2>
        <div className={styles.content}>
          {/* Auth Info Section */}
          <div className={styles.authSection}>
            <h3 className={styles.sectionTitle}>Account Information</h3>
            <div className={styles.authInfo}>
              <div className={styles.profile}>
                {renderProfileIcon(currentUser)}
                <div className={styles.credentials}>
                  <span className={styles.name}>
                    {currentUser?.displayName}
                  </span>
                  <span className={styles.email}>{currentUser?.email}</span>
                </div>
              </div>
              <Button
                type="outlined"
                className={styles.logOut}
                onClick={logOutHandler}
              >
                Log Out
              </Button>
            </div>
          </div>

          {/* Token Usage Display */}
          {tokenProfile && (
            <>
              <hr className={styles.divider} />
              <div className={styles.subscriptionSection}>
                <h3 className={styles.sectionTitle}>Tokens</h3>
                <div className={styles.tokenUsage}>
                  <TokenDisplayInner showLabel={true} useContainer={true} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default ProfileModal;
