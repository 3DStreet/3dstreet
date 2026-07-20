import { useEffect, useRef } from 'react';
import useStore from '@/store';
import { Loader } from '@shared/icons';
import styles from './ExportingSceneModal.module.scss';

const TIMEOUT_MS = 60000;

/**
 * Full-screen blocking indicator shown while a GLB/glTF export is running
 * (issue #1797). Same saving/loading style as LoadingSceneModal. Export runs
 * on the main thread and can take several seconds on large scenes; this keeps
 * the user informed and prevents interaction with a scene that has been
 * temporarily mutated for export (helpers hidden, BatchedMeshes expanded).
 */
const ExportingSceneModal = () => {
  const isExportingScene = useStore((state) => state.isExportingScene);
  const message = useStore((state) => state.exportingSceneMessage);
  const timeoutRef = useRef(null);

  useEffect(() => {
    if (isExportingScene) {
      // Safety valve: if the exporter never fires either callback, quietly
      // dismiss so the UI is never permanently blocked.
      timeoutRef.current = setTimeout(() => {
        useStore.getState().finishExportingScene();
      }, TIMEOUT_MS);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [isExportingScene]);

  if (!isExportingScene) return null;

  return (
    <div className={styles.exportingModalWrapper}>
      <div className={styles.spinnerBox}>
        <Loader className={styles.spinner} />
      </div>
      <span className={styles.message}>{message}</span>
    </div>
  );
};

export { ExportingSceneModal };
