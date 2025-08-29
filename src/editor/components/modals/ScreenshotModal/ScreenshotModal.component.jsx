import { useEffect, useState } from 'react';
import styles from './ScreenshotModal.module.scss';
import Modal from '../Modal.jsx';
import posthog from 'posthog-js';
import useStore from '@/store';
import { Button } from '../../elements';
import { DownloadIcon } from '../../../icons';
import { takeScreenshotWithOptions } from '../../../api/scene';
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
        STREET.notify.successMessage('AI render generated successfully!');

        // Refresh token profile to get updated count
        await refreshTokenProfile();

        // Show remaining tokens if not pro
        if (!currentUser?.isPro && result.data.remainingTokens !== undefined) {
          STREET.notify.successMessage(
            `AI render complete! ${result.data.remainingTokens} image tokens remaining.`
          );
        }

        posthog.capture('ai_image_generated', {
          scene_id: STREET.utils.getCurrentSceneId(),
          prompt: aiPrompt,
          is_pro_user: currentUser?.isPro || false,
          tokens_available: tokenProfile?.imageToken || 0
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
    }
  };

  useEffect(() => {
    if (modal === 'screenshot') {
      posthog.capture('screenshot_modal_opened', {
        scene_id: STREET.utils.getCurrentSceneId()
      });
    }
  }, [modal]);

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
      onClose={() => setModal(null)}
      titleElement={
        <div className="flex pr-4 pt-5">
          <div className="font-large text-center text-2xl">
            Screenshot & AI Render
          </div>
        </div>
      }
    >
      <div className={styles.modalContainer}>
        <div className={styles.wrapper}>
          <div className={styles.details}>
            <div className={styles.aiSection}>
              <Button
                onClick={handleGenerateAIImage}
                variant="filled"
                className={styles.aiButton}
                disabled={isGeneratingAI || !currentUser}
              >
                {isGeneratingAI ? (
                  'Generating AI Render...'
                ) : (
                  <span>
                    <span>🤖</span>
                    <span>
                      Generate AI Render
                      {!currentUser?.isPro && tokenProfile && (
                        <span className={styles.tokenBadge}>
                          {tokenProfile.imageToken || 0} tokens
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
                tokenProfile?.imageToken === 0 && (
                  <p className={styles.noTokensWarning}>
                    No image tokens remaining. Upgrade to Pro for unlimited AI
                    renders.
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
                    Show AI Render
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

          <div className={styles.mainContent}>
            <div className={styles.imageWrapper}>
              <div className={styles.screenshotWrapper}>
                {comparisonMode && aiImageUrl ? (
                  <div className={styles.comparisonContainer}>
                    <ImgComparisonSlider>
                      <img
                        slot="first"
                        src={originalImageUrl}
                        alt="Original Screenshot"
                      />
                      <img
                        slot="second"
                        src={aiImageUrl}
                        alt="AI Rendered Image"
                      />
                    </ImgComparisonSlider>
                  </div>
                ) : (
                  <>
                    <img
                      id="screentock-destination"
                      src={
                        showOriginal || !aiImageUrl
                          ? originalImageUrl
                          : aiImageUrl
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
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export { ScreenshotModal };
