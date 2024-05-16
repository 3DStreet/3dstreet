import React from 'react';
import styles from './ProfileModal.module.scss';

import Modal from '../Modal.jsx';
import { Button } from '../../components';
import { useAuthContext } from '../../../contexts';
import { signOut } from 'firebase/auth';
import { auth } from '../../../services/firebase';
import { Download32Icon } from './icons.jsx';

const ProfileModal = ({ isOpen, onClose }) => {
  const { currentUser, setCurrentUser } = useAuthContext();

  const logOutHandler = async () => {
    onClose();
    await signOut(auth);
    setCurrentUser(null);
  };

  const editProfileHandler = () => {
    // TODO: navigate to edit section
  };

  return (
    <Modal
      className={styles.modalWrapper}
      isOpen={isOpen}
      onClose={onClose}
      extraCloseKeyCode={72}
    >
      <div className={styles.contentWrapper}>
        <h2 className={styles.title}>Account</h2>
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
          {/* <div className={styles.scenesWrapper}>
            <h3>Recent scenes</h3>
            <div className={styles.scenes}>
              <div className={styles.dropzone}>
                <div className={styles.icon}>{Download32Icon}</div>
                <span className={styles.main}>Drag a file over here or</span>
                <a className={styles.streetmix}>Import Streetmix</a>
                <a className={styles.json}>Import 3DStreet JSON</a>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
              <div role="button" tabIndex={0} className={styles.scene}>
                <img className={styles.img} src="" alt="" />
                <span className={styles.name}>Scene Name</span>
                <span className={styles.date}>Last opened 2 days ago</span>
              </div>
            </div>
          </div> */}
        </div>
      </div>
    </Modal>
  );
};

export { ProfileModal };
