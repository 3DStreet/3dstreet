import styles from './ProfileModal.module.scss';
import { useState, useEffect } from 'react';

import Modal from '../Modal.jsx';
import { Button, UsernameEditor } from '../../elements';
import { useAuthContext } from '../../../contexts';
import { SavingModal } from '../SavingModal/SavingModal.component.jsx';
import { signOut } from 'firebase/auth';
import { auth, functions } from '../../../services/firebase';
import { Loader } from '../../../icons';
import { httpsCallable } from 'firebase/functions';
import posthog from 'posthog-js';
import { renderProfileIcon, TokenDisplayInner } from '@shared/auth/components';
import useStore from '@/store';
import {
  getUserProfile,
  generateAndSaveUsername
} from '../../../utils/username';

const ProfileModal = () => {
  const { currentUser, setCurrentUser, tokenProfile } = useAuthContext();
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);

  const [username, setUsername] = useState(null);
  const [isLoadingUsername, setIsLoadingUsername] = useState(false);
  const [isManagingSubscription, setIsManagingSubscription] = useState(false);

  // Clear username when user changes (logout/login)
  useEffect(() => {
    if (!currentUser) {
      setUsername(null);
    }
  }, [currentUser]);

  // Load or generate username when modal opens
  useEffect(() => {
    const loadUsername = async () => {
      if (modal === 'profile' && currentUser?.uid) {
        setIsLoadingUsername(true);
        try {
          // Check if user already has a username
          const userProfile = await getUserProfile(currentUser.uid);

          if (userProfile?.username) {
            setUsername(userProfile.username);
          } else {
            // Generate and save a new username
            const newUsername = await generateAndSaveUsername(currentUser.uid);
            setUsername(newUsername);
          }
        } catch (error) {
          console.error('Error loading username:', error);
        }
        setIsLoadingUsername(false);
      }
    };

    loadUsername();
  }, [modal, currentUser]);

  const onClose = () => {
    setModal(null);
  };

  const logOutHandler = async () => {
    onClose();
    await signOut(auth);
    posthog.reset();
    setCurrentUser(null);
  };

  const manageSubscription = async () => {
    setIsManagingSubscription(true);
    const {
      data: { url }
    } = await httpsCallable(
      functions,
      'createStripeBillingPortal'
    )({
      // user_id is now set server-side from authenticated context for security
      return_url: `${location.origin}/#/modal/profile`
    });
    setIsManagingSubscription(false);
    window.location.href = url;
  };

  return (
    <>
      <Modal
        className={styles.modalWrapper}
        isOpen={modal === 'profile'}
        onClose={onClose}
      >
        <div className={styles.contentWrapper}>
          <h2 className={styles.title}>3DStreet Account</h2>
          <div className={styles.content}>
            {/* Private Auth Info Section */}
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

            <hr className={styles.divider} />

            {/* Public Profile Section */}
            <div className={styles.publicProfileSection}>
              <h3 className={styles.sectionTitle}>Public Profile</h3>
              <div className={styles.usernameSection}>
                {isLoadingUsername ? (
                  <div className={styles.loadingUsername}>
                    <Loader className={styles.spinner} />
                    <span>Loading username...</span>
                  </div>
                ) : username ? (
                  <UsernameEditor
                    currentUsername={username}
                    userId={currentUser?.uid}
                    onUpdate={(newUsername) => setUsername(newUsername)}
                  />
                ) : null}
              </div>
            </div>

            <hr className={styles.divider} />

            {/* Subscription Section */}
            <div className={styles.subscriptionSection}>
              <h3 className={styles.sectionTitle}>Subscription</h3>

              {/* Token Usage Display */}
              {!currentUser?.isPro && tokenProfile && (
                <div className={styles.tokenUsage}>
                  <div
                    style={{
                      background: '#2a2a2a',
                      border: '1px solid #404040',
                      borderRadius: '6px',
                      padding: '8px 12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <span>Plan: Free</span>
                    <Button
                      onClick={() => {
                        onClose();
                        setModal('payment');
                      }}
                      style={{
                        padding: '4px 12px',
                        fontSize: '12px',
                        background:
                          'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        marginLeft: '12px',
                        transition: 'all 0.3s ease',
                        boxShadow: '0 2px 8px rgba(102, 126, 234, 0.4)'
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.background =
                          'linear-gradient(135deg, #7c8ff8 0%, #8e5db4 100%)';
                        e.target.style.transform = 'translateY(-1px)';
                        e.target.style.boxShadow =
                          '0 4px 12px rgba(102, 126, 234, 0.6)';
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.background =
                          'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                        e.target.style.transform = 'translateY(0)';
                        e.target.style.boxShadow =
                          '0 2px 8px rgba(102, 126, 234, 0.4)';
                      }}
                    >
                      Upgrade to Pro
                    </Button>
                  </div>
                  <TokenDisplayInner showLabel={true} useContainer={true} />
                  <TokenDisplayInner
                    showLabel={true}
                    useContainer={true}
                    tokenType="geoToken"
                  />
                </div>
              )}

              {currentUser?.isPro ? (
                <div>
                  <div className={styles.tokenUsage}>
                    <div
                      style={{
                        background: '#2a2a2a',
                        border: '1px solid #404040',
                        borderRadius: '6px',
                        padding: '8px 12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center'
                      }}
                    >
                      <span>
                        {currentUser?.isProTeam
                          ? `Plan: Pro Team (${currentUser?.teamDomain})`
                          : 'Plan: Geospatial Pro'}
                      </span>
                      {!currentUser?.isProTeam && (
                        <Button
                          variant="ghost"
                          onClick={manageSubscription}
                          style={{
                            padding: '4px 12px',
                            fontSize: '12px',
                            background: 'transparent',
                            color: '#9ca3af',
                            border: '1px solid #404040',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            marginLeft: '12px',
                            transition: 'all 0.2s ease'
                          }}
                          onMouseEnter={(e) => {
                            e.target.style.background = '#404040';
                            e.target.style.color = '#ffffff';
                          }}
                          onMouseLeave={(e) => {
                            e.target.style.background = 'transparent';
                            e.target.style.color = '#9ca3af';
                          }}
                        >
                          Manage subscription
                        </Button>
                      )}
                    </div>
                    {tokenProfile && (
                      <div
                        style={{
                          background: '#2a2a2a',
                          border: '1px solid #404040',
                          borderRadius: '6px',
                          padding: '8px 12px',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginTop: '8px'
                        }}
                      >
                        <TokenDisplayInner showLabel={true} />
                        <span style={{ fontSize: '13px', color: '#9ca3af' }}>
                          Monthly Pro refill:{' '}
                          {new Date(
                            new Date().getFullYear(),
                            new Date().getMonth() + 1,
                            1
                          ).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric'
                          })}
                        </span>
                      </div>
                    )}
                    <TokenDisplayInner
                      showLabel={true}
                      useContainer={true}
                      tokenType="geoToken"
                      count="∞"
                      label="Unlimited Geo Tokens"
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </Modal>
      {isManagingSubscription && <SavingModal action="Managing subscription" />}
    </>
  );
};

export { ProfileModal };
