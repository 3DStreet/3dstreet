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
import MsftProfileImg from '../../../ui_assets/profile-microsoft.png';
import profileButtonStyles from '../../editor/components/elements/ProfileButton/ProfileButton.module.scss';

// Render profile icon based on provider
const renderProfileIcon = (currentUser) => {
  const isGoogle = currentUser?.providerData[0]?.providerId === 'google.com';
  const isMicrosoft =
    currentUser?.providerData[0]?.providerId === 'microsoft.com';

  if (isGoogle && currentUser?.photoURL) {
    return (
      <img
        className={profileButtonStyles.photoURL}
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
    // Default icon SVG
    return (
      <svg
        width="32"
        height="32"
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="16" cy="10" r="6" fill="currentColor" />
        <path
          d="M4 28c0-6.627 5.373-12 12-12s12 5.373 12 12"
          fill="currentColor"
        />
      </svg>
    );
  }
};

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
                  <div
                    style={{
                      background: '#2a2a2a',
                      border: '1px solid #404040',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      display: 'flex',
                      alignItems: 'center',
                      marginTop: '8px'
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                      <span
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          background: '#1a1a1a',
                          borderRadius: '4px',
                          padding: '2px 8px 2px 4px',
                          marginRight: '8px'
                        }}
                      >
                        <img
                          src="/ui_assets/token-image.png"
                          alt="Image Token"
                          style={{
                            width: '20px',
                            height: '20px',
                            marginRight: '4px',
                            display: 'inline-block',
                            verticalAlign: 'middle'
                          }}
                        />
                        <span style={{ color: '#6b7280', marginRight: '4px' }}>
                          ×
                        </span>
                        <span
                          style={{
                            fontSize: '16px',
                            fontWeight: '500',
                            color: '#ffffff'
                          }}
                        >
                          {tokenProfile.genToken}
                        </span>
                      </span>
                      <span style={{ fontSize: '14px' }}>
                        AI Generation Tokens
                      </span>
                    </span>
                  </div>
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
