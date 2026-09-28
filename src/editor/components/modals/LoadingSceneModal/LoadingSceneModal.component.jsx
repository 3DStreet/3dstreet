import { useEffect, useRef } from 'react';
import { useIntl } from 'react-intl';
import useStore from '@/store';
import { Loader } from '@shared/icons';
import { ConfirmModal } from '@shared/components/ConfirmModal';
import styles from './LoadingSceneModal.module.scss';
import { commonMessages } from '@/editor/i18n/commonMessages';

const TIMEOUT_MS = 30000;

const LoadingSceneModal = () => {
  const isLoadingScene = useStore((state) => state.isLoadingScene);
  const progress = useStore((state) => state.loadingSceneProgress);
  const message = useStore((state) => state.loadingSceneMessage);
  const error = useStore((state) => state.loadingSceneError);
  const timeoutRef = useRef(null);
  const intl = useIntl();

  useEffect(() => {
    if (isLoadingScene && !error) {
      // Optimistic loading: if we never receive a completion signal (e.g. a
      // heavy splat still streaming, or a missing newScene finalize), quietly
      // dismiss the spinner and assume the scene loaded. Genuine fetch/parse
      // failures call errorLoadingScene() explicitly (see fetchJSON in
      // json-utils) and still surface the error modal — only the silent
      // timeout path is treated as success.
      timeoutRef.current = setTimeout(() => {
        useStore.getState().finishLoadingScene();
      }, TIMEOUT_MS);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [isLoadingScene, error]);

  if (!isLoadingScene) return null;

  const handleRetry = () => {
    useStore.getState().finishLoadingScene();
    window.location.reload();
  };

  const handleDismiss = () => {
    useStore.getState().finishLoadingScene();
  };

  if (error) {
    // Genuine fetch/parse failure: use the themed dialog rather than bare text
    // on the loading overlay.
    return (
      <ConfirmModal
        isOpen
        title={intl.formatMessage({
          id: 'loadingSceneModal.errorTitle',
          defaultMessage: 'Could not load scene'
        })}
        message={error}
        confirmLabel={intl.formatMessage(commonMessages.retry)}
        cancelLabel={intl.formatMessage({
          id: 'loadingSceneModal.dismiss',
          defaultMessage: 'Dismiss'
        })}
        onConfirm={handleRetry}
        onCancel={handleDismiss}
      />
    );
  }

  return (
    <div className={styles.loadingModalWrapper}>
      <div className={styles.spinnerBox}>
        <Loader className={styles.spinner} />
      </div>
      <div className={styles.progressBarContainer}>
        <div className={styles.progressBar} style={{ width: `${progress}%` }} />
      </div>
      <span className={styles.message}>{message}</span>
    </div>
  );
};

export { LoadingSceneModal };
