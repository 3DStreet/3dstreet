/**
 * Shared ProfileModal component
 * Simple profile modal with account info, logout, and token display
 * Can be used by both image-generator and 3dstreet apps
 *
 * @author 3DStreet Team
 * @category Shared Components
 */

import { signOut } from 'firebase/auth';
import { auth } from '../../../editor/services/firebase';
import { useAuthContext } from '../../../editor/contexts';
import Modal from '../../../editor/components/modals/Modal.jsx';
import { Button } from '../../../editor/components/elements/Button/Button.component.jsx';
import styles from '../../../editor/components/modals/ProfileModal/ProfileModal.module.scss';
import posthog from 'posthog-js';
import { renderProfileIcon, TokenDisplayInner } from './index';

const SharedProfileModal = ({ isOpen, onClose, showEscapeHatch = false }) => {
  const { currentUser, setCurrentUser, tokenProfile } = useAuthContext();

  const logOutHandler = async () => {
    onClose();
    await signOut(auth);
    posthog.reset();
    setCurrentUser(null);
  };

  const handleOpenFullProfile = () => {
    // Open 3DStreet editor with profile modal hash
    const editorUrl = `${window.location.origin}/#/modal/profile`;
    window.open(editorUrl, '_blank');
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

          {/* Escape hatch to full profile in 3DStreet editor */}
          {showEscapeHatch && (
            <>
              <hr className={styles.divider} />
              <div style={{ textAlign: 'center', marginTop: '16px' }}>
                <Button
                  type="outlined"
                  onClick={handleOpenFullProfile}
                  style={{
                    width: '100%',
                    padding: '8px 16px',
                    fontSize: '14px'
                  }}
                >
                  Open full account settings in 3DStreet Editor
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default SharedProfileModal;
