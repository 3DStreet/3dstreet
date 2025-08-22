import { useEffect, useState } from 'react';
import styles from './ScreenshotModal.module.scss';
import Modal from '../Modal.jsx';
import posthog from 'posthog-js';
import useStore from '@/store';
import { Button } from '../../elements';
import { Save24Icon } from '../../../icons';
import { takeScreenshotWithOptions } from '../../../api/scene';
import {
  createSceneSnapshot,
  createSnapshotFromImageUrl,
  setSnapshotAsSceneThumbnail
} from '../../../api/snapshot';
import { doc, getDoc } from 'firebase/firestore';
import { db, functions } from '../../../services/firebase';
import { useAuthContext } from '../../../contexts';
import { httpsCallable } from 'firebase/functions';

function ScreenshotModal() {
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);
  const { currentUser } = useAuthContext();
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiPrompt, setAiPrompt] = useState(
    'Transform satellite image into high-quality drone shot'
  );
  const [snapshots, setSnapshots] = useState([]);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState(null);

  const loadSnapshots = async () => {
    const sceneId = STREET.utils.getCurrentSceneId();
    if (!sceneId) return;

    try {
      const sceneDocRef = doc(db, 'scenes', sceneId);
      const sceneSnapshot = await getDoc(sceneDocRef);

      if (sceneSnapshot.exists()) {
        const sceneData = sceneSnapshot.data();
        const sceneSnapshots = sceneData.memory?.snapshots || [];
        setSnapshots(
          sceneSnapshots.sort(
            (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
          )
        );
      }
    } catch (error) {
      console.error('Error loading snapshots:', error);
    }
  };

  const handleDownloadScreenshot = async (type) => {
    const isPro = currentUser?.isPro;

    await takeScreenshotWithOptions({
      type: type,
      showLogo: !isPro,
      showWatermark: !isPro,
      imgElementSelector: type === 'img' ? '#screentock-destination' : null
    });
  };

  const handleSetAsSceneThumbnail = async () => {
    const sceneId = STREET.utils.getCurrentSceneId();
    const authorId = STREET.utils.getAuthorId();

    if (!sceneId) {
      STREET.notify.errorMessage('Please save your scene first');
      return;
    }

    if (!currentUser || currentUser.uid !== authorId) {
      STREET.notify.errorMessage('Only the scene author can set the thumbnail');
      return;
    }

    setIsSavingSnapshot(true);

    try {
      // Check if a snapshot is selected (AI-generated or existing snapshot)
      if (selectedSnapshotId) {
        // Use the existing snapshot as the scene thumbnail
        await setSnapshotAsSceneThumbnail(sceneId, selectedSnapshotId);
        STREET.notify.successMessage('Scene thumbnail set successfully!');

        // Reload snapshots to update the default indicator
        await loadSnapshots();

        posthog.capture('scene_thumbnail_set_from_snapshot', {
          scene_id: sceneId,
          snapshot_id: selectedSnapshotId
        });
      } else {
        // Create a new snapshot from the current canvas view
        await createSceneSnapshot(sceneId, true, 'Scene Thumbnail');
        STREET.notify.successMessage('Scene thumbnail saved successfully!');

        // Reload snapshots to show the new one
        await loadSnapshots();

        posthog.capture('scene_thumbnail_set', {
          scene_id: sceneId
        });
      }
    } catch (error) {
      console.error('Error setting scene thumbnail:', error);
      // Check if it's a CORS error
      if (error.message && error.message.includes('tainted canvas')) {
        STREET.notify.errorMessage(
          'Cannot export AI-generated image. Please select it from the snapshots gallery below.'
        );
      } else {
        STREET.notify.errorMessage(
          'Failed to set scene thumbnail. Please try again.'
        );
      }
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  const handleGenerateAIImage = async () => {
    const sceneId = STREET.utils.getCurrentSceneId();
    const authorId = STREET.utils.getAuthorId();

    if (!sceneId) {
      STREET.notify.errorMessage('Please save your scene first');
      return;
    }

    if (!currentUser || currentUser.uid !== authorId) {
      STREET.notify.errorMessage(
        'Only the scene author can generate AI images'
      );
      return;
    }

    const screentockImgElement = document.getElementById(
      'screentock-destination'
    );
    if (!screentockImgElement || !screentockImgElement.src) {
      STREET.notify.errorMessage(
        'No screenshot available. Please generate a preview first.'
      );
      return;
    }

    setIsGeneratingAI(true);

    try {
      // Call the cloud function
      const generateReplicateImage = httpsCallable(
        functions,
        'generateReplicateImage'
      );
      const result = await generateReplicateImage({
        prompt: aiPrompt,
        input_image: screentockImgElement.src,
        guidance: 2.5,
        num_inference_steps: 30
      });

      if (result.data.success) {
        // Create a snapshot from the generated image
        const newSnapshot = await createSnapshotFromImageUrl(
          sceneId,
          result.data.image_url,
          `AI: ${aiPrompt}`
        );

        STREET.notify.successMessage(
          'AI image generated and snapshot created!'
        );

        // Reload snapshots to show the new AI-generated one
        await loadSnapshots();

        // Select the newly created AI snapshot and display it
        setSelectedSnapshotId(newSnapshot.id);
        const screentockImgElement = document.getElementById(
          'screentock-destination'
        );
        if (screentockImgElement) {
          // Use high-res version if available, otherwise use standard resolution
          const imageUrl = newSnapshot.imagePathHD || newSnapshot.imagePath;
          screentockImgElement.src = imageUrl;
        }

        posthog.capture('ai_image_generated', {
          scene_id: sceneId,
          prompt: aiPrompt
        });
      } else {
        throw new Error('Failed to generate image');
      }
    } catch (error) {
      console.error('Error generating AI image:', error);
      STREET.notify.errorMessage(
        'Failed to generate AI image. Please try again.'
      );
    } finally {
      setIsGeneratingAI(false);
    }
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
      // Load existing snapshots
      loadSnapshots();
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
      <div className={styles.modalContainer}>
        <div className={styles.wrapper}>
          <div className={styles.details}>
            <div className={styles.downloadSection}>
              <Button
                leadingIcon={<Save24Icon />}
                onClick={() => handleDownloadScreenshot('jpg')}
                variant="filled"
                className={styles.downloadButton}
              >
                Download JPEG
              </Button>
              {/* Set as Scene Thumbnail button - only show for scene authors */}
              {currentUser &&
                STREET.utils.getCurrentSceneId() &&
                currentUser.uid === STREET.utils.getAuthorId() && (
                  <Button
                    onClick={handleSetAsSceneThumbnail}
                    variant="outlined"
                    className={styles.thumbnailButton}
                    disabled={isSavingSnapshot}
                  >
                    {isSavingSnapshot ? (
                      'Saving...'
                    ) : (
                      <span>
                        <span>📸</span>
                        <span>Set as Scene Thumbnail</span>
                      </span>
                    )}
                  </Button>
                )}
            </div>
            {/* AI Generation Section - only show for scene authors */}
            {currentUser &&
              STREET.utils.getCurrentSceneId() &&
              currentUser.uid === STREET.utils.getAuthorId() && (
                <div className={styles.aiSection}>
                  <h3>AI Image Generation</h3>
                  <div className={styles.promptSection}>
                    <input
                      type="text"
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="Enter prompt for AI image generation..."
                      className={styles.promptInput}
                      disabled={isGeneratingAI}
                    />
                    <Button
                      onClick={handleGenerateAIImage}
                      variant="filled"
                      className={styles.aiButton}
                      disabled={isGeneratingAI || !aiPrompt.trim()}
                    >
                      {isGeneratingAI ? (
                        'Generating...'
                      ) : (
                        <span>
                          <span>🤖</span>
                          <span>Generate AI Image & Create Snapshot</span>
                        </span>
                      )}
                    </Button>
                  </div>
                </div>
              )}
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
        {/* Snapshots Gallery - Full Width at Bottom */}
        {snapshots.length > 0 && (
          <div className={styles.snapshotGalleryBottom}>
            <h3>Scene Snapshots</h3>
            <div className={styles.snapshotRow}>
              {snapshots.map((snapshot, index) => (
                <div
                  key={snapshot.id}
                  className={`${styles.snapshotThumbnail} ${snapshot.isDefault ? styles.defaultSnapshot : ''} ${selectedSnapshotId === snapshot.id ? styles.selectedSnapshot : ''}`}
                  onClick={() => {
                    // Load the clicked snapshot into the main image area
                    const screentockImgElement = document.getElementById(
                      'screentock-destination'
                    );
                    if (screentockImgElement) {
                      // Use high-res version if available, otherwise use standard resolution
                      const imageUrl =
                        snapshot.imagePathHD || snapshot.imagePath;
                      screentockImgElement.src = imageUrl;
                    }

                    // Set as selected for visual feedback
                    setSelectedSnapshotId(snapshot.id);

                    // Optional: Load this snapshot's camera state in the future
                    console.log('Loaded snapshot:', snapshot.label);
                  }}
                  title={snapshot.label}
                >
                  <img
                    src={snapshot.imagePath}
                    alt={snapshot.label}
                    loading="lazy"
                  />
                  {snapshot.isDefault && (
                    <div className={styles.defaultBadge}>Default</div>
                  )}
                  <div className={styles.snapshotLabel}>
                    {snapshot.label.length > 25
                      ? `${snapshot.label.substring(0, 25)}...`
                      : snapshot.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export { ScreenshotModal };
