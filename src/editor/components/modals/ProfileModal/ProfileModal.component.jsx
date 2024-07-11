import styles from './ProfileModal.module.scss';
import { useState } from 'react';

import Modal from '../Modal.jsx';
import { Button } from '../../components';
import { useAuthContext } from '../../../contexts';
import { signOut } from 'firebase/auth';
import { auth, functions } from '../../../services/firebase';
import Events from '../../../lib/Events.js';
import { Action24, Loader } from '../../../icons';
import { httpsCallable } from 'firebase/functions';
import posthog from 'posthog-js';

const ProfileModal = ({ isOpen, onClose }) => {
  const { currentUser, setCurrentUser } = useAuthContext();
  const [isLoading, setIsLoading] = useState(false);

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
      user_id: currentUser.uid,
      return_url: `${location.origin}/#/modal/payment`
    });
    setIsLoading(false);
    window.open(url, '_blank');
    // Replace 'https://example.com' with your desired URL
  };

  return (
    <Modal
      className={styles.modalWrapper}
      isOpen={isOpen}
      onClose={onClose}
      extraCloseKeyCode={72}
    >
      <div className={styles.contentWrapper}>
        <h2 className={styles.title}>3DStreet Cloud Account</h2>
        <div className={styles.content}>
          <div className={styles.header}>
            <div className={styles.profile}>
              <img
                className={'photoURL'}
                src={currentUser?.photoURL}
                alt="userPhoto"
                referrerPolicy="no-referrer"
              />
              <div className={styles.credentials}>
                <span className={styles.name}>{currentUser?.displayName}</span>
                <span className={styles.email}>{currentUser?.email}</span>
              </div>
            </div>
            <div className={styles.controlButtons}>
              {/* <Button type="filled" onClick={editProfileHandler}>
                Edit Profile
              </Button> */}
              <Button
                type="outlined"
                className={styles.logOut}
                onClick={logOutHandler}
              >
                Log Out
              </Button>
            </div>
          </div>
          <hr />

          {currentUser?.isPro ? (
            <div className={styles.manageBillingCard}>
              <p>
                <Action24 /> Plan: Geospatial Pro
              </p>
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
          ) : (
            <div className={styles.subscribeCard}>
              <div className={styles.about}>
                <h3 className={styles.cardTitle}>
                  Unlock Geospatial Features with 3DStreet Pro
                </h3>
                <span>
                  Create with geospatial maps and share your vision in augmented
                  reality with 3DStreet Pro.
                </span>
              </div>

              <div className={styles.controlButtons}>
                {/* <a
                href="http://"
                target="_blank"
                rel="noopener noreferrer"
                > */}

                <Button
                  onClick={() => {
                    onClose();
                    Events.emit('openpaymentmodal');
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
    </Modal>
  );
};

export { ProfileModal };
