import { useEffect, useRef } from 'react';
import useStore from '@/store';
import { Loader } from '@shared/icons';
import styles from './LoadingSceneModal.module.scss';

const TIMEOUT_MS = 30000;

const LoadingSceneModal = () => {
  const isLoadingScene = useStore((state) => state.isLoadingScene);
  const progress = useStore((state) => state.loadingSceneProgress);
  const message = useStore((state) => state.loadingSceneMessage);
  const error = useStore((state) => state.loadingSceneError);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (isLoadingScene && !error) {
      timeoutRef.current = setTimeout(() => {
        useStore
          .getState()
          .errorLoadingScene('Loading timed out. The scene may be too large.');
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
              Retry
            </button>
            <button className={styles.dismissButton} onClick={handleDismiss}>
              Dismiss
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
