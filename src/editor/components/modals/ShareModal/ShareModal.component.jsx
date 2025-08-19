import { useState, useEffect } from 'react';
import styles from './ShareModal.module.scss';
import { useAuthContext } from '../../../contexts';
import { Copy32Icon } from '../../../icons';
import { Button } from '../../elements';
import Modal from '../Modal.jsx';
import posthog from 'posthog-js';
import useStore from '@/store';
import { getDoc, doc } from 'firebase/firestore';
import { db } from '../../../services/firebase';
import ScenePlaceholder from '../../../../../ui_assets/ScenePlaceholder.svg';

function ShareModal() {
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);
  const { currentUser } = useAuthContext();

  const [sceneData, setSceneData] = useState(null);

  // Get current scene data
  useEffect(() => {
    const fetchSceneData = async () => {
      const sceneId = STREET.utils.getCurrentSceneId();
      if (!sceneId || !currentUser) {
        setSceneData(null);
        return;
      }

      try {
        const sceneDocRef = doc(db, 'scenes', sceneId);
        const sceneSnapshot = await getDoc(sceneDocRef);
        if (sceneSnapshot.exists()) {
          setSceneData(sceneSnapshot.data());
        } else {
          setSceneData(null);
        }
      } catch (error) {
        console.error('Error fetching scene data:', error);
        setSceneData(null);
      }
    };

    if (modal === 'share') {
      fetchSceneData();
    }
  }, [modal, currentUser]);

  // Track when share modal opens for camera positioning
  useEffect(() => {
    if (modal === 'share') {
      posthog.capture('share_modal_opened', {
        scene_id: STREET.utils.getCurrentSceneId()
      });
    }
  }, [modal]);

  const copyToClipboard = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      STREET.notify.successMessage('Scene URL copied to clipboard');
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const getShareUrl = () => {
    const sceneId = STREET.utils.getCurrentSceneId();
    if (sceneId) {
      return `https://3dstreet.app/#/scenes/${sceneId}`;
    }
    return window.location.href;
  };

  const sceneId = STREET.utils.getCurrentSceneId();
  const shareUrl = getShareUrl();
  const canShare = currentUser && sceneId;

  return (
    <Modal
      className={styles.shareModalWrapper}
      isOpen={modal === 'share'}
      onClose={() => setModal(null)}
      titleElement={
        <div className="flex pr-4 pt-4">
          <div className="font-large text-center text-2xl">Share Scene</div>
        </div>
      }
    >
      <div className={styles.wrapper}>
        <div className="details">
          {!canShare ? (
            <div className="w-full max-w-xs">
              <h3>
                {!currentUser
                  ? 'Please sign in to share your scene'
                  : 'Please save your scene to share it'}
              </h3>
              <Button onClick={() => setModal('signin')}>
                {!currentUser ? 'Sign in to 3DStreet Cloud' : 'Save Scene'}
              </Button>
            </div>
          ) : (
            <>
              {/* URL sharing section */}
              <div className="mb-6">
                <h4 className="mb-3 text-lg font-semibold">Share URL</h4>
                <div className="flex gap-2">
                  <textarea
                    readOnly
                    value={shareUrl}
                    className="flex-1 resize-none rounded border p-2"
                    rows={2}
                    style={{ fontSize: '14px' }}
                  />
                  <Button
                    onClick={() => copyToClipboard(shareUrl)}
                    leadingIcon={<Copy32Icon />}
                    variant="toolbtn"
                  >
                    Copy URL
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
        <div className={styles.mainContent}>
          <div className={styles.imageWrapper}>
            <div className={styles.screenshotWrapper}>
              {canShare && sceneData?.imagePath ? (
                <img
                  src={sceneData.imagePath}
                  alt="Scene preview"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }}
                />
              ) : (
                <img
                  src={ScenePlaceholder}
                  alt="Scene placeholder"
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { ShareModal };
