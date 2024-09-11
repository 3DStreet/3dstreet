import { GoogleSignInButtonSVG, SignInMicrosoftIconSVG } from '../../../icons';
import Modal from '../Modal.jsx';
import styles from './SignInModal.module.scss';
import { signIn, signInMicrosoft } from '../../../api';

const SignInModal = ({ isOpen, onClose }) => (
  <Modal className={styles.modalWrapper} isOpen={isOpen} onClose={onClose}>
    <div className={styles.contentWrapper}>
      <h2 className={styles.title}>Sign in to 3DStreet Cloud</h2>
      <div className={styles.content}>
        <p className={styles.p1}>
          Save and share your street scenes by clicking on a provider below to
          log-in or automatically create a{' '}
          <a
            href="https://www.3dstreet.org/docs/3dstreet-editor/saving-and-loading-scenes"
            target="_blank"
            rel="noopener noreferrer"
          >
            3DStreet Cloud account
          </a>{' '}
          if you don&apos;t already have one.
        </p>
      </div>
      <div
        onClick={() => {
          signIn();
          onClose();
        }}
        alt="Sign In with Google Button"
        className={styles.signInButton}
      >
        <GoogleSignInButtonSVG />
      </div>
      <div
        onClick={() => {
          signInMicrosoft();
          onClose();
        }}
        alt="Sign In with Microsoft Button"
        className={styles.signInButton}
        style={{ transform: 'scale(0.85)' }}
      >
        <SignInMicrosoftIconSVG />
      </div>
    </div>
  </Modal>
);

export { SignInModal };
