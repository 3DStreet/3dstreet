import { useEffect } from 'react';
import { ScreenshotProperties } from './ScreenshotProperties.component.jsx';
import styles from './ScreenshotModal.module.scss';
import Modal from '../Modal.jsx';
import posthog from 'posthog-js';
import useStore from '@/store';

function ScreenshotModal() {
  // Get the entity that has the screentock component
  const getScreentockEntity = () => {
    const screenshotEl = document.getElementById('screenshot');
    if (!screenshotEl.isPlaying) {
      screenshotEl.play();
    }
    return screenshotEl;
  };
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);

  // Track when screenshot modal opens for camera positioning
  useEffect(() => {
    if (modal === 'screenshot') {
      posthog.capture('screenshot_modal_opened', {
        scene_id: STREET.utils.getCurrentSceneId()
      });
    }
  }, [modal]);

  return (
    <Modal
      className={styles.screenshotModalWrapper}
      isOpen={modal === 'screenshot'}
      onClose={() => setModal(null)}
      titleElement={
        <div className="flex pr-4 pt-5">
          <div className="font-large text-center text-2xl">
            Snapshot & Render
          </div>
        </div>
      }
    >
      <div className={styles.wrapper}>
        <div className="details">
          <ScreenshotProperties entity={getScreentockEntity()} />
        </div>
        <div className={styles.mainContent}>
          <div className={styles.imageWrapper}>
            <div className={styles.screenshotWrapper}>
              <img id="screentock-destination" />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { ScreenshotModal };
