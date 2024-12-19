import { GoogleSignInButtonSVG, SignInMicrosoftIconSVG } from '../../../icons';
import Modal from '../Modal.jsx';
import styles from './SignInModal.module.scss';
import { signIn, signInMicrosoft } from '../../../api';
import useStore from '@/store';
import { saveSceneWithScreenshot } from '@/editor/lib/SceneUtils';
import { auth } from '@/editor/services/firebase';
const SignInModal = () => {
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);

  const onClose = () => {
    setModal(null);
  };

  const onSignInClick = async (provider = 'google') => {
    if (provider === 'google') {
      await signIn();
    } else if (provider === 'microsoft') {
      await signInMicrosoft();
    }
    if (STREET.utils.getCurrentSceneId() !== null) {
      await saveSceneWithScreenshot(auth.currentUser, true);
    }
    onClose();
  };
  return (
    <Modal
      className={styles.modalWrapper}
      isOpen={modal === 'signin'}
      onClose={onClose}
    >
      <div className={styles.contentWrapper}>
        <h2 className={styles.title}>Sign in</h2>
        <div className={styles.content}>
          <p className={styles.p1}>Sign in to save your project.</p>
        </div>
        <div
          onClick={() => {
            onSignInClick('google');
          }}
          alt="Sign In with Google Button"
          className={styles.signInButton}
        >
          <GoogleSignInButtonSVG />
        </div>
        <div
          onClick={() => {
            onSignInClick('microsoft');
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
};

export { SignInModal };
