import { useEffect, useState } from 'react';
import styles from './ScreenshotModal.module.scss';
import Modal from '../Modal.jsx';
import posthog from 'posthog-js';
import useStore from '@/store';
import { Button } from '../../elements';
import { DownloadIcon } from '../../../icons';
import { takeScreenshotWithOptions } from '../../../api/scene';
import {
  createSceneSnapshot,
  createSnapshotFromImageUrl,
  setSnapshotAsSceneThumbnail
} from '../../../api/snapshot';
import { functions } from '../../../services/firebase';
import { useAuthContext } from '../../../contexts';
import { httpsCallable } from 'firebase/functions';
import { ImgComparisonSlider } from '@img-comparison-slider/react';
import 'img-comparison-slider/dist/styles.css';
import { canUseImageFeature } from '../../../utils/tokens';

function ScreenshotModal() {
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);
  const startCheckout = useStore((state) => state.startCheckout);
  const { currentUser, tokenProfile, refreshTokenProfile } = useAuthContext();
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [originalImageUrl, setOriginalImageUrl] = useState(null);
  const [aiImageUrl, setAiImageUrl] = useState(null);
  const [showOriginal, setShowOriginal] = useState(true);
  const [comparisonMode, setComparisonMode] = useState(false);
  const [isSavingSnapshot, setIsSavingSnapshot] = useState(false);
  const [currentSceneId, setCurrentSceneId] = useState(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderStartTime, setRenderStartTime] = useState(null);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Ensure token profile is loaded when modal opens
  useEffect(() => {
    if (currentUser && !tokenProfile) {
      refreshTokenProfile();
    }
  }, [currentUser, tokenProfile, refreshTokenProfile]);

  const resetModalState = () => {
    setOriginalImageUrl(null);
    setAiImageUrl(null);
    setShowOriginal(true);
    setComparisonMode(false);
    setIsGeneratingAI(false);
    setIsSavingSnapshot(false);
    setRenderProgress(0);
    setRenderStartTime(null);
    setElapsedTime(0);
  };

  const handleClose = () => {
    // Check if rendering is in progress
    if (isGeneratingAI) {
      const confirmClose = window.confirm(
        'Rendering in progress. Are you sure you want to close? The render will be cancelled.'
      );
      if (!confirmClose) {
        return;
      }
    } else if (aiImageUrl && !showOriginal) {
      // Check if there's an unsaved AI render
      const confirmClose = window.confirm(
        'You have an unsaved AI render. Are you sure you want to close? The AI render will be lost.'
      );
      if (!confirmClose) {
        return;
      }
    }

    // Reset all state when closing
    resetModalState();
    setModal(null);
  };

  const handleDownloadScreenshot = async () => {
    const imageUrl = showOriginal ? originalImageUrl : aiImageUrl;
    if (!imageUrl) {
      STREET.notify.errorMessage('No image available to download');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = showOriginal
      ? `3dstreet-screenshot-${timestamp}.jpg`
      : `3dstreet-ai-render-${timestamp}.jpg`;

    const link = document.createElement('a');
    link.href = imageUrl;
    link.target = '_blank';
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    posthog.capture('screenshot_downloaded', {
      scene_id: STREET.utils.getCurrentSceneId(),
      is_ai_render: !showOriginal
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
      // Check if we're currently showing an AI-generated image
      const currentImageUrl =
        showOriginal || !aiImageUrl ? originalImageUrl : aiImageUrl;
      const isAIImage =
        !showOriginal && aiImageUrl && currentImageUrl === aiImageUrl;

      if (isAIImage) {
        // For AI images, create a new snapshot from the URL to avoid tainted canvas
        const snapshot = await createSnapshotFromImageUrl(
          sceneId,
          aiImageUrl,
          'AI Generated Thumbnail'
        );
        // Set this new snapshot as the scene thumbnail
        await setSnapshotAsSceneThumbnail(sceneId, snapshot.id);
      } else {
        // For original screenshots, use the existing method
        await createSceneSnapshot(sceneId, true, 'Scene Thumbnail');
      }

      STREET.notify.successMessage('Scene thumbnail saved successfully!');

      posthog.capture('scene_thumbnail_set', {
        scene_id: sceneId,
        is_ai_generated: isAIImage
      });
    } catch (error) {
      console.error('Error setting scene thumbnail:', error);
      STREET.notify.errorMessage(
        'Failed to set scene thumbnail. Please try again.'
      );
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  const handleGenerateAIImage = async () => {
    if (!originalImageUrl) {
      STREET.notify.errorMessage('No screenshot available to render');
      return;
    }

    // Check if user can use image feature
    const canUse = await canUseImageFeature(currentUser);
    if (!canUse) {
      startCheckout('image');
      return;
    }

    setIsGeneratingAI(true);
    setRenderProgress(0);
    setRenderStartTime(Date.now());
    setElapsedTime(0);

    try {
      const aiPrompt = 'Transform satellite image into high-quality drone shot';

      const generateReplicateImage = httpsCallable(
        functions,
        'generateReplicateImage'
      );

      const screentockImgElement = document.getElementById(
        'screentock-destination'
      );
      const result = await generateReplicateImage({
        prompt: aiPrompt,
        input_image: screentockImgElement.src,
        guidance: 2.5,
        num_inference_steps: 30
      });

      if (result.data.success) {
        setAiImageUrl(result.data.image_url);
        setShowOriginal(false);

        // Show appropriate success message based on user type
        if (currentUser?.isProTeam) {
          // Team users - simple success message only
          STREET.notify.successMessage('AI render generated successfully!');
        } else if (result.data.remainingTokens !== undefined) {
          // Pro/Free users - show token count
          const message = currentUser?.isPro
            ? `AI render complete! ${result.data.remainingTokens} tokens remaining.`
            : `AI render complete! ${result.data.remainingTokens} gen tokens remaining.`;
          STREET.notify.successMessage(message);
        } else {
          // Fallback message
          STREET.notify.successMessage('AI render generated successfully!');
        }

        // Refresh token profile to show updated count in UI
        await refreshTokenProfile();

        posthog.capture('ai_image_generated', {
          scene_id: STREET.utils.getCurrentSceneId(),
          prompt: aiPrompt,
          is_pro_user: currentUser?.isPro || false,
          tokens_available: tokenProfile?.genToken || 0
        });
      } else {
        throw new Error('Failed to generate image');
      }
    } catch (error) {
      console.error('Error generating AI image:', error);
      STREET.notify.errorMessage(
        'Failed to generate AI render. Please try again.'
      );
    } finally {
      setIsGeneratingAI(false);
      setRenderProgress(0);
      setRenderStartTime(null);
      setElapsedTime(0);
    }
  };

  // Progress bar animation effect
  useEffect(() => {
    let progressInterval;

    if (isGeneratingAI && renderStartTime) {
      progressInterval = setInterval(() => {
        const elapsed = Date.now() - renderStartTime;
        const progress = Math.min((elapsed / 20000) * 100, 100); // 20 seconds = 100%
        const currentElapsed = Math.round(elapsed / 1000);

        setRenderProgress(progress);
        setElapsedTime(currentElapsed);
      }, 100); // Update every 100ms for smooth animation
    }

    return () => {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
    };
  }, [isGeneratingAI, renderStartTime]);

  useEffect(() => {
    if (modal === 'screenshot') {
      const sceneId = STREET.utils.getCurrentSceneId();

      // Reset state if scene has changed or modal is opening fresh
      if (sceneId !== currentSceneId) {
        resetModalState();
        setCurrentSceneId(sceneId);
      }

      posthog.capture('screenshot_modal_opened', {
        scene_id: sceneId
      });
    }
  }, [modal, currentSceneId]);

  useEffect(() => {
    if (modal === 'screenshot') {
      const isPro = currentUser?.isPro;
      takeScreenshotWithOptions({
        type: 'img',
        showLogo: !isPro,
        showWatermark: !isPro,
        imgElementSelector: '#screentock-destination'
      }).then(() => {
        const imgElement = document.getElementById('screentock-destination');
        if (imgElement && imgElement.src) {
          setOriginalImageUrl(imgElement.src);
        }
      });
    }
  }, [modal, currentUser?.isPro]);

  return (
    <Modal
      className={styles.screenshotModalWrapper}
      isOpen={modal === 'screenshot'}
      onClose={handleClose}
      titleElement={
        <div className="flex pr-4 pt-5">
          <div className="font-large text-center text-2xl">
            Screenshot & Render
          </div>
        </div>
      }
    >
      <div className={styles.modalContent}>
        <div className={styles.sidebar}>
          <div className={styles.aiSection}>
            <Button
              onClick={handleGenerateAIImage}
              variant="filled"
              className={`${styles.aiButton} ${isGeneratingAI ? styles.renderingButton : ''}`}
              disabled={isGeneratingAI || !currentUser}
            >
              {isGeneratingAI ? (
                <div className={styles.renderingContent}>
                  <div className={styles.progressContainer}>
                    <div
                      className={styles.progressBar}
                      style={{ width: `${renderProgress}%` }}
                    />
                    <div className={styles.progressStripes} />
                  </div>
                  <span className={styles.progressText}>
                    {`${elapsedTime}/20s`}
                  </span>
                </div>
              ) : (
                <span>
                  <span>✨</span>
                  <span>
                    Generate Render
                    {tokenProfile && (
                      <span className={styles.tokenBadge}>
                        {tokenProfile.genToken || 0 || 0}{' '}
                        {currentUser?.isPro ? 'tokens' : 'free'}
                      </span>
                    )}
                  </span>
                </span>
              )}
            </Button>
            {!currentUser && (
              <p className={styles.loginPrompt}>
                Please log in to use AI rendering
              </p>
            )}
            {currentUser &&
              !currentUser.isPro &&
              tokenProfile?.genToken === 0 && (
                <p className={styles.noTokensWarning}>
                  No gen tokens remaining. Upgrade to Pro for 100 tokens
                  refilled monthly.
                </p>
              )}
          </div>

          {aiImageUrl && (
            <div className={styles.viewControls}>
              <div className={styles.toggleButtons}>
                <Button
                  variant={
                    showOriginal && !comparisonMode ? 'filled' : 'outline'
                  }
                  onClick={() => {
                    setShowOriginal(true);
                    setComparisonMode(false);
                  }}
                  size="small"
                >
                  Show Original
                </Button>
                <Button
                  variant={
                    !showOriginal && !comparisonMode ? 'filled' : 'outline'
                  }
                  onClick={() => {
                    setShowOriginal(false);
                    setComparisonMode(false);
                  }}
                  size="small"
                >
                  Show Render
                </Button>
                <Button
                  variant={comparisonMode ? 'filled' : 'outline'}
                  onClick={() => setComparisonMode(!comparisonMode)}
                  size="small"
                >
                  Compare A/B
                </Button>
              </div>
            </div>
          )}

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

        <div className={styles.imageContainer}>
          {comparisonMode && aiImageUrl ? (
            <div className={styles.comparisonContainer}>
              <ImgComparisonSlider>
                <img
                  slot="first"
                  src={originalImageUrl}
                  alt="Original Screenshot"
                />
                <img slot="second" src={aiImageUrl} alt="AI Rendered Image" />
              </ImgComparisonSlider>
            </div>
          ) : (
            <div className={styles.imageContent}>
              {/* Set as Scene Thumbnail button - only show for scene authors */}
              {currentUser &&
                STREET.utils.getCurrentSceneId() &&
                currentUser.uid === STREET.utils.getAuthorId() && (
                  <button
                    className={styles.thumbnailButton}
                    onClick={handleSetAsSceneThumbnail}
                    disabled={isSavingSnapshot}
                    title="Set as scene thumbnail"
                    aria-label="Set as scene thumbnail"
                  >
                    {isSavingSnapshot ? (
                      <span>Saving...</span>
                    ) : (
                      <>
                        <span>📌</span>
                        <span>Set as Scene Thumbnail</span>
                      </>
                    )}
                  </button>
                )}
              <img
                id="screentock-destination"
                src={
                  showOriginal || !aiImageUrl ? originalImageUrl : aiImageUrl
                }
                alt={
                  showOriginal || !aiImageUrl
                    ? 'Original Screenshot'
                    : 'AI Rendered Image'
                }
              />
              <button
                className={styles.downloadButton}
                onClick={handleDownloadScreenshot}
                title="Download image"
                aria-label="Download image"
              >
                <DownloadIcon />
                <span>Download</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

export { ScreenshotModal };
