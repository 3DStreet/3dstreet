import styles from './ProfileModal.module.scss';
import { useState, useEffect } from 'react';

import Modal from '../Modal.jsx';
import { Button, UsernameEditor } from '../../elements';
import { useAuthContext } from '../../../contexts';
import { signOut } from 'firebase/auth';
import { auth, functions } from '../../../services/firebase';
import { Loader } from '../../../icons';
import { httpsCallable } from 'firebase/functions';
import posthog from 'posthog-js';
import { renderProfileIcon } from '../../elements/ProfileButton';
import useStore from '@/store';
import {
  getUserProfile,
  generateAndSaveUsername
} from '../../../utils/username';

const ProfileModal = () => {
  const { currentUser, setCurrentUser, tokenProfile } = useAuthContext();
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);

  const [isLoading, setIsLoading] = useState(false);
  const [username, setUsername] = useState(null);
  const [isLoadingUsername, setIsLoadingUsername] = useState(false);

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
    setIsLoading(true);
    const {
      data: { url }
    } = await httpsCallable(
      functions,
      'createStripeBillingPortal'
    )({
      // user_id is now set server-side from authenticated context for security
      return_url: `${location.origin}/#/modal/payment`
    });
    setIsLoading(false);
    window.open(url, '_blank');
  };

  return (
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
                    background: '#374151',
                    border: '1px solid #4b5563',
                    borderRadius: '6px',
                    padding: '8px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  <span>Plan: Free</span>
                </div>
                <div
                  style={{
                    background: '#374151',
                    border: '1px solid #4b5563',
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
                        background: '#1f2937',
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
                    <span style={{ fontSize: '14px' }}>Free Image Tokens</span>
                  </span>
                </div>
                <div
                  style={{
                    background: '#374151',
                    border: '1px solid #4b5563',
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
                        background: '#1f2937',
                        borderRadius: '4px',
                        padding: '2px 8px 2px 4px',
                        marginRight: '8px'
                      }}
                    >
                      <img
                        src="/ui_assets/token-geo.png"
                        alt="Geo Token"
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
                        {tokenProfile.geoToken}
                      </span>
                    </span>
                    <span style={{ fontSize: '14px' }}>Free Geo Tokens</span>
                  </span>
                </div>
              </div>
            )}

            {currentUser?.isPro ? (
              <div>
                <div className={styles.tokenUsage}>
                  <div
                    style={{
                      background: '#374151',
                      border: '1px solid #4b5563',
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
                  </div>
                  {tokenProfile && (
                    <div
                      style={{
                        background: '#374151',
                        border: '1px solid #4b5563',
                        borderRadius: '6px',
                        padding: '8px 12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginTop: '8px'
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center' }}>
                        <span
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            background: '#1f2937',
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
                          <span
                            style={{ color: '#6b7280', marginRight: '4px' }}
                          >
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
                        <span style={{ fontSize: '14px' }}>Image Tokens</span>
                      </span>
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
                  <div
                    style={{
                      background: '#374151',
                      border: '1px solid #4b5563',
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
                          background: '#1f2937',
                          borderRadius: '4px',
                          padding: '2px 8px 2px 4px',
                          marginRight: '8px'
                        }}
                      >
                        <img
                          src="/ui_assets/token-geo.png"
                          alt="Geo Token"
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
                          ∞
                        </span>
                      </span>
                      <span style={{ fontSize: '14px' }}>
                        Unlimited Geo Tokens
                      </span>
                    </span>
                  </div>
                </div>
                {!currentUser?.isProTeam && (
                  <div
                    className={styles.manageBillingCard}
                    style={{ marginTop: '12px' }}
                  >
                    <div>
                      {isLoading ? (
                        <div className={styles.loadingSpinner}>
                          <Loader className={styles.spinner} />
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          className={styles.manageSubscription}
                          onClick={manageSubscription}
                        >
                          Manage subscription
                        </Button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.subscribeCard}>
                <div className={styles.about}>
                  <h3 className={styles.cardTitle}>
                    Unlock Geospatial Features with 3DStreet Pro
                  </h3>
                  <span>
                    Create with unlimited geospatial map access, and share your
                    vision in augmented reality with 3DStreet Pro.
                  </span>
                </div>

                <div className={styles.controlButtons}>
                  <Button
                    onClick={() => {
                      onClose();
                      setModal('payment');
                    }}
                    type="filled"
                    target="_blank"
                  >
                    Subscribe
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
};

export { ProfileModal };
