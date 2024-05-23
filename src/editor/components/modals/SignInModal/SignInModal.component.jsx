import { GoogleSignInButtonSVG } from '../../../icons';
import Modal from '../Modal.jsx';
import styles from './SignInModal.module.scss';
import { signIn } from '../../../api';

const SignInModal = ({ isOpen, onClose }) => (
  <Modal
    className={styles.modalWrapper}
    isOpen={isOpen}
    onClose={onClose}
    extraCloseKeyCode={72}
  >
    <div className={styles.contentWrapper}>
      <h2 className={styles.title}>Sign in to 3DStreet Cloud</h2>
      <div className={styles.content}>
        <p className={styles.p1}>
          Save and share your street scenes with 3DStreet Cloud.{' '}
        </p>
        <p className={styles.p1}>
          <a
            className={styles.docsLink}
            href="https://www.3dstreet.org/docs/3dstreet-editor/saving-and-loading-scenes/#3dstreet-cloud-account"
            target="_blank"
            rel="noreferrer"
          >
            This is beta software which may not work as expected.{' '}
          </a>
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
    </div>
  </Modal>
);

export { SignInModal };
