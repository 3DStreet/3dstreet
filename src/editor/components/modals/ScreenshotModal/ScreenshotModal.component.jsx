import { useEffect } from 'react';
import styles from './ScreenshotModal.module.scss';
import Modal from '../Modal.jsx';
import posthog from 'posthog-js';
import useStore from '@/store';
import { Button } from '../../elements';
import { Save24Icon } from '../../../icons';
import { takeScreenshotWithOptions } from '../../../api/scene';
import { useAuthContext } from '../../../contexts';

function ScreenshotModal() {
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);
  const { currentUser } = useAuthContext();

  const handleDownloadScreenshot = async (type) => {
    const isPro = currentUser?.isPro;

    await takeScreenshotWithOptions({
      type: type,
      showLogo: !isPro,
      showWatermark: !isPro,
      imgElementSelector: type === 'img' ? '#screentock-destination' : null
    });
  };

  // Track when screenshot modal opens for camera positioning
  useEffect(() => {
    if (modal === 'screenshot') {
      posthog.capture('screenshot_modal_opened', {
        scene_id: STREET.utils.getCurrentSceneId()
      });
    }
  }, [modal]);

  // Generate preview image when modal opens
  useEffect(() => {
    if (modal === 'screenshot') {
      // Generate preview with appropriate overlays
      handleDownloadScreenshot('img');
    }
  }, [modal, currentUser?.isPro]);

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
          <div className={styles.downloadSection}>
            <Button
              leadingIcon={<Save24Icon />}
              onClick={() => handleDownloadScreenshot('jpg')}
              variant="filled"
              className={styles.downloadButton}
            >
              Download JPEG
            </Button>
          </div>
          {/* Upsell button for free users */}
          {!currentUser?.isPro && (
            <div className={styles.upsellSection}>
              <Button
                variant="toolbtn"
                className={styles.upsellButton}
                onClick={() => setModal('payment')}
              >
                Upgrade to Pro to hide 3DStreet Free watermark
              </Button>
            </div>
          )}
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
