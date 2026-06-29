import { useEffect, useRef } from 'react';
import { FormattedMessage } from 'react-intl';
import useStore from '@/store';
import { Loader } from '@shared/icons';
import styles from './LoadingSceneModal.module.scss';
import { commonMessages } from '@/editor/i18n/commonMessages';

const TIMEOUT_MS = 30000;

const LoadingSceneModal = () => {
  const isLoadingScene = useStore((state) => state.isLoadingScene);
  const progress = useStore((state) => state.loadingSceneProgress);
  const message = useStore((state) => state.loadingSceneMessage);
  const error = useStore((state) => state.loadingSceneError);
  const timeoutRef = useRef(null);

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

  return (
    <div className={styles.loadingModalWrapper}>
      {error ? (
        <div className={styles.errorContent}>
          <span className={styles.errorMessage}>{error}</span>
          <div className={styles.errorButtons}>
            <button className={styles.retryButton} onClick={handleRetry}>
              <FormattedMessage {...commonMessages.retry} />
            </button>
            <button className={styles.dismissButton} onClick={handleDismiss}>
              <FormattedMessage
                id="loadingSceneModal.dismiss"
                defaultMessage="Dismiss"
              />
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className={styles.spinnerBox}>
            <Loader className={styles.spinner} />
          </div>
          <div className={styles.progressBarContainer}>
            <div
              className={styles.progressBar}
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className={styles.message}>{message}</span>
        </>
      )}
    </div>
  );
};

export { LoadingSceneModal };
