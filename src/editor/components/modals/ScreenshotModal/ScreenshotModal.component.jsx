import { useEffect, useState } from 'react';
import styles from './ScreenshotModal.module.scss';
import Modal from '@shared/components/Modal/Modal.jsx';
import posthog from 'posthog-js';
import useStore from '@/store';
import { Button } from '../../elements';
import { DownloadIcon } from '@shared/icons';
import { takeScreenshotWithOptions } from '../../../api/scene';
import {
  createSceneSnapshot,
  createSnapshotFromImageUrl,
  setSnapshotAsSceneThumbnail
} from '../../../api/snapshot';
import { functions } from '@shared/services/firebase';
import { useAuthContext } from '../../../contexts';
import { httpsCallable } from 'firebase/functions';
import { ImgComparisonSlider } from '@img-comparison-slider/react';
import 'img-comparison-slider/dist/styles.css';
import { canUseImageFeature } from '@shared/utils/tokens';
import { TokenDisplayInner } from '@shared/auth/components';
import { galleryServiceV2 } from '@shared/gallery';
import { REPLICATE_MODELS } from '@shared/constants/replicateModels.js';
import AIModelSelector from '@shared/components/AIModelSelector';

// Available AI models (use shared constants)
const AI_MODELS = REPLICATE_MODELS;

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
  const [selectedModel, setSelectedModel] = useState('kontext-realearth');
  const [renderMode, setRenderMode] = useState('1x'); // '1x' or '4x'
  const [aiImages, setAiImages] = useState({}); // Store multiple AI images with model keys
  const [renderTimers, setRenderTimers] = useState({}); // Individual timers for each model
  const [renderingStates, setRenderingStates] = useState({}); // Track which models are rendering
  const [renderErrors, setRenderErrors] = useState({}); // Track which models had errors
  const [useMixedModels, setUseMixedModels] = useState(true); // Toggle for model mixing
  const [customPrompt, setCustomPrompt] = useState(''); // Custom prompt text
  const [showOvertimeWarning, setShowOvertimeWarning] = useState(false); // Show overtime warning for 1x mode
  const [isClosing, setIsClosing] = useState(false); // Track closing animation

  // Get token cost for the selected model
  const getTokenCost = (modelKey) => {
    return AI_MODELS[modelKey]?.tokenCost || 1;
  };

  // Convert image to JPEG with specified quality
  const convertToJpeg = (dataUrl, quality = 0.9) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        // Convert to JPEG with specified quality (0.9 = 90%)
        const jpegDataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(jpegDataUrl);
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  };

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
    setAiImages({});
    setRenderTimers({});
    setRenderingStates({});
    setRenderErrors({});
    setCustomPrompt('');
    setShowOvertimeWarning(false);
    // Keep model selection and render mode when resetting
  };

  const handleClose = () => {
    // Check if any rendering is in progress (1x or 4x)
    const isAnyRendering =
      isGeneratingAI || Object.values(renderingStates).some((state) => state);

    if (isAnyRendering) {
      const confirmClose = window.confirm(
        'Rendering in progress. Are you sure you want to close? The render will be cancelled.'
      );
      if (!confirmClose) {
        return;
      }
    }

    // Trigger closing animation
    setIsClosing(true);

    // Wait for animation to complete, then close
    setTimeout(() => {
      // Reset all state when closing
      resetModalState();
      setIsClosing(false);
      setModal(null);
    }, 600); // Match animation duration
  };

  const handleDownloadScreenshot = async (imageUrl = null, modelKey = null) => {
    const targetImageUrl =
      imageUrl || (showOriginal ? originalImageUrl : aiImageUrl);
    if (!targetImageUrl) {
      STREET.notify.errorMessage('No image available to download');
      return;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const isOriginal = targetImageUrl === originalImageUrl;
    const modelName = modelKey
      ? AI_MODELS[modelKey.split('-')[0]]?.name || 'ai-render'
      : 'ai-render';

    const filename = isOriginal
      ? `3dstreet-screenshot-${timestamp}.jpg`
      : `3dstreet-${modelName.toLowerCase().replace(/\s+/g, '-')}-${timestamp}.jpg`;

    const link = document.createElement('a');
    link.href = targetImageUrl;
    link.target = '_blank';
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    posthog.capture('screenshot_downloaded', {
      scene_id: STREET.utils.getCurrentSceneId(),
      is_ai_render: !isOriginal,
      model: modelKey || selectedModel,
      render_mode: renderMode
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

  const handleGenerateAIImage = async (modelKey = null) => {
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

    const targetModel = modelKey || selectedModel;
    const startTime = Date.now();

    // Update rendering state for this specific model
    setRenderingStates((prev) => ({ ...prev, [targetModel]: true }));
    setRenderTimers((prev) => ({
      ...prev,
      [targetModel]: { startTime, elapsed: 0 }
    }));

    // For single render mode, set global states
    if (renderMode === '1x') {
      setIsGeneratingAI(true);
      setRenderProgress(0);
      setRenderStartTime(startTime);
      setElapsedTime(0);
    }

    try {
      // Simple approach: try the key as-is first, then try removing numeric suffix
      let selectedModelConfig = AI_MODELS[targetModel];
      let baseModelKey = targetModel;

      if (!selectedModelConfig) {
        // If direct lookup fails, try removing numeric suffix (for 4x compound keys)
        const parts = targetModel.split('-');
        const lastPart = parts[parts.length - 1];
        if (/^\d+$/.test(lastPart) && parts.length > 1) {
          baseModelKey = parts.slice(0, -1).join('-');
          selectedModelConfig = AI_MODELS[baseModelKey];
        }
      }

      if (!selectedModelConfig) {
        throw new Error(`Model configuration not found for: ${baseModelKey}`);
      }

      // Only allow custom prompts for Pro users
      const aiPrompt =
        (currentUser?.isPro && customPrompt.trim()) ||
        selectedModelConfig.prompt;

      const generateReplicateImage = httpsCallable(
        functions,
        'generateReplicateImage',
        {
          timeout: 300000 // 5 minutes in milliseconds
        }
      );

      const screentockImgElement = document.getElementById(
        'screentock-destination'
      );

      if (!screentockImgElement || !screentockImgElement.src) {
        // Fallback to originalImageUrl if the img element isn't available
        if (!originalImageUrl) {
          throw new Error('No image source available for rendering');
        }
      }

      let inputImageSrc = screentockImgElement?.src || originalImageUrl;

      // Convert to JPEG with 90% quality to reduce upload time
      if (inputImageSrc && inputImageSrc.startsWith('data:image/')) {
        try {
          inputImageSrc = await convertToJpeg(inputImageSrc, 0.9);
        } catch (error) {
          console.warn('Failed to convert to JPEG, using original:', error);
        }
      }

      const sceneId = STREET.utils.getCurrentSceneId();

      const result = await generateReplicateImage({
        prompt: aiPrompt,
        input_image: inputImageSrc,
        guidance: 2.5,
        num_inference_steps: 30,
        model_version: selectedModelConfig.version,
        scene_id: sceneId || null
      });

      if (result.data.success) {
        // Store image in the appropriate place based on render mode
        if (renderMode === '1x') {
          setAiImageUrl(result.data.image_url);
          setShowOriginal(false);
        } else {
          setAiImages((prev) => ({
            ...prev,
            [targetModel]: result.data.image_url
          }));
        }

        // Save AI render to gallery
        if (currentUser?.uid) {
          try {
            // Initialize gallery service V2 if needed
            await galleryServiceV2.init();

            await galleryServiceV2.addAsset(
              result.data.image_url,
              {
                timestamp: new Date().toISOString(),
                sceneId: sceneId || STREET.utils.getCurrentSceneId(),
                source: 'ai-render',
                model: selectedModelConfig.name,
                modelKey: baseModelKey,
                prompt: aiPrompt,
                renderMode: renderMode,
                isPro: currentUser?.isPro || false
              },
              'image', // type
              'ai-render', // category
              currentUser.uid // userId
            );
            console.log('AI render saved to gallery');
          } catch (error) {
            console.error('Failed to save AI render to gallery:', error);
          }
        }

        // Show appropriate success message based on user type
        if (currentUser?.isProTeam) {
          STREET.notify.successMessage(
            `AI render generated successfully! (${selectedModelConfig.name})`
          );
        } else if (result.data.remainingTokens !== undefined) {
          const message = currentUser?.isPro
            ? `AI render complete! ${result.data.remainingTokens} tokens remaining. (${selectedModelConfig.name})`
            : `AI render complete! ${result.data.remainingTokens} gen tokens remaining. (${selectedModelConfig.name})`;
          STREET.notify.successMessage(message);
        } else {
          STREET.notify.successMessage(
            `AI render generated successfully! (${selectedModelConfig.name})`
          );
        }

        // Refresh token profile to show updated count in UI
        await refreshTokenProfile();

        posthog.capture('ai_image_generated', {
          scene_id: STREET.utils.getCurrentSceneId(),
          prompt: aiPrompt,
          model: baseModelKey,
          render_mode: renderMode,
          is_pro_user: currentUser?.isPro || false,
          tokens_available: tokenProfile?.genToken || 0
        });

        // Funnel event: ai_render_used (standardized event for conversion funnel)
        posthog.capture('ai_render_used', {
          token_type: 'gen',
          model: baseModelKey,
          render_mode: renderMode,
          is_pro_user: currentUser?.isPro || false,
          scene_id: STREET.utils.getCurrentSceneId()
        });

        // Check if user just used their last gen token (track token_limit_reached)
        const remainingTokens = result.data.remainingTokens;
        if (
          !currentUser?.isPro &&
          remainingTokens !== undefined &&
          remainingTokens === 0
        ) {
          posthog.capture('token_limit_reached', {
            token_type: 'gen',
            scene_id: STREET.utils.getCurrentSceneId()
          });
        }
      } else {
        throw new Error('Failed to generate image');
      }
    } catch (error) {
      console.error('Error generating AI image:', error);
      const baseModelKey = targetModel.includes('-')
        ? targetModel.split('-').slice(0, -1).join('-')
        : targetModel;
      const modelName = AI_MODELS[baseModelKey]?.name || 'selected model';

      // Track error state for this model
      setRenderErrors((prev) => ({ ...prev, [targetModel]: true }));

      // Only show error notification for single renders or if all renders have completed
      if (renderMode === '1x') {
        STREET.notify.errorMessage(
          `Failed to generate AI render for ${modelName}. Please try again.`
        );
      }
    } finally {
      // Update rendering state for this specific model
      setRenderingStates((prev) => ({ ...prev, [targetModel]: false }));

      // For single render mode, clear global states
      if (renderMode === '1x') {
        setIsGeneratingAI(false);
        setRenderProgress(0);
        setRenderStartTime(null);
        setElapsedTime(0);
      }
    }
  };

  const handleGenerate4xRender = async () => {
    if (!originalImageUrl) {
      STREET.notify.errorMessage('No screenshot available to render');
      return;
    }

    // Filter models to only include those with includeIn4x: true
    const modelKeys = Object.keys(AI_MODELS).filter(
      (key) => AI_MODELS[key].includeIn4x === true
    );

    // Calculate total token cost for 4x render
    const totalTokenCost = useMixedModels
      ? modelKeys.reduce((sum, key) => sum + getTokenCost(key), 0)
      : getTokenCost(selectedModel) * 4;

    // Check if user has enough tokens for 4x render
    if (!tokenProfile || tokenProfile.genToken < totalTokenCost) {
      STREET.notify.errorMessage(
        `You need at least ${totalTokenCost} tokens for 4x render`
      );
      // Only prompt checkout for non-pro users
      if (!currentUser?.isPro && !currentUser?.isProTeam) {
        startCheckout('image');
      }
      return;
    }

    const modelsToRender = useMixedModels
      ? modelKeys
      : [selectedModel, selectedModel, selectedModel, selectedModel];

    // Generate renders for each model concurrently
    const renderPromises = modelsToRender.map((modelKey, index) =>
      handleGenerateAIImage(`${modelKey}-${index}`)
    );

    await Promise.allSettled(renderPromises);
  };

  // Progress bar animation effect for single render
  useEffect(() => {
    let progressInterval;

    if (isGeneratingAI && renderStartTime) {
      const estimatedTime = AI_MODELS[selectedModel]?.estimatedTime || 30;

      progressInterval = setInterval(() => {
        const elapsed = Date.now() - renderStartTime;
        const progress = Math.min(
          (elapsed / (estimatedTime * 1000)) * 100,
          100
        );
        const currentElapsed = Math.round(elapsed / 1000);

        setRenderProgress(progress);
        setElapsedTime(currentElapsed);

        // Show overtime warning if elapsed time is more than 10s over estimate
        if (currentElapsed > estimatedTime + 10) {
          setShowOvertimeWarning(true);
        } else {
          setShowOvertimeWarning(false);
        }
      }, 100); // Update every 100ms for smooth animation
    }

    return () => {
      if (progressInterval) {
        clearInterval(progressInterval);
      }
    };
  }, [isGeneratingAI, renderStartTime, selectedModel]);

  // Timer updates for individual renders in 4x mode
  useEffect(() => {
    const intervals = {};

    Object.keys(renderingStates).forEach((modelKey) => {
      if (renderingStates[modelKey] && renderTimers[modelKey]) {
        intervals[modelKey] = setInterval(() => {
          const elapsed = Math.round(
            (Date.now() - renderTimers[modelKey].startTime) / 1000
          );

          // Extract base model key to get estimated time
          const baseModelKey = modelKey.split('-').slice(0, -1).join('-');
          const estimatedTime = AI_MODELS[baseModelKey]?.estimatedTime || 30;
          const isOvertime = elapsed > estimatedTime + 10;

          setRenderTimers((prev) => ({
            ...prev,
            [modelKey]: { ...prev[modelKey], elapsed, isOvertime }
          }));
        }, 1000);
      }
    });

    return () => {
      Object.values(intervals).forEach((interval) => clearInterval(interval));
    };
  }, [renderingStates, renderTimers]);

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
      }).then(async () => {
        const imgElement = document.getElementById('screentock-destination');
        if (imgElement && imgElement.src) {
          setOriginalImageUrl(imgElement.src);

          // Save screenshot to gallery (async, don't block UI)
          if (currentUser?.uid) {
            // Upload to gallery in the background
            (async () => {
              try {
                // Load the image to get dimensions and convert to JPEG
                const img = new Image();
                img.src = imgElement.src;
                await new Promise((resolve) => {
                  img.onload = resolve;
                  // If already loaded, resolve immediately
                  if (img.complete) resolve();
                });

                // Convert PNG data URI to JPEG for smaller file size
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0);

                // Convert to JPEG at 95% quality (much smaller than PNG)
                const jpegDataUri = canvas.toDataURL('image/jpeg', 0.95);

                // Initialize gallery service V2 if needed
                await galleryServiceV2.init();

                console.log('Uploading screenshot to gallery (JPEG format)...');

                // Add to gallery using V2 API
                const assetId = await galleryServiceV2.addAsset(
                  jpegDataUri, // JPEG Data URI (will be auto-converted to blob)
                  {
                    timestamp: new Date().toISOString(),
                    sceneId: STREET.utils.getCurrentSceneId(),
                    source: 'screenshot',
                    model: 'Editor Snapshot',
                    width: img.width,
                    height: img.height,
                    isPro: isPro
                  },
                  'image', // type
                  'screenshot', // category
                  currentUser.uid // userId
                );
                console.log(`Screenshot saved to gallery with ID: ${assetId}`);
              } catch (error) {
                console.error('Failed to save screenshot to gallery:', error);
              }
            })();
          } else {
            console.log('User not logged in, skipping gallery save');
          }
        }
      });
    }
  }, [modal, currentUser?.isPro, currentUser?.uid]);

  return (
    <Modal
      className={`${styles.screenshotModalWrapper} ${isClosing ? styles.closing : ''}`}
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
          {/* Render Mode Tabs */}
          <div className={styles.renderModeTabs}>
            <button
              className={`${styles.tabButton} ${renderMode === '1x' ? styles.active : ''}`}
              onClick={() => setRenderMode('1x')}
              disabled={
                isGeneratingAI ||
                Object.values(renderingStates).some((state) => state)
              }
            >
              1x Render
            </button>
            <button
              className={`${styles.tabButton} ${renderMode === '4x' ? styles.active : ''}`}
              onClick={() => setRenderMode('4x')}
              disabled={
                isGeneratingAI ||
                Object.values(renderingStates).some((state) => state)
              }
            >
              4x Render
            </button>
          </div>

          <div className={styles.aiSection}>
            {renderMode === '1x' && (
              <div className={styles.modelSelector}>
                <label className={styles.modelLabel}>AI Model:</label>
                <AIModelSelector
                  value={selectedModel}
                  onChange={setSelectedModel}
                  disabled={
                    isGeneratingAI ||
                    Object.values(renderingStates).some((state) => state)
                  }
                />
              </div>
            )}

            {renderMode === '4x' && (
              <div className={styles.modelMixToggle}>
                <label className={styles.toggleLabel}>
                  <span className={styles.toggleText}>
                    {useMixedModels ? 'Mixed Models' : 'Same Model'}
                  </span>
                  <input
                    type="checkbox"
                    checked={useMixedModels}
                    onChange={(e) => setUseMixedModels(e.target.checked)}
                    disabled={Object.values(renderingStates).some(
                      (state) => state
                    )}
                  />
                  <div className={styles.toggleSwitch}></div>
                </label>
                {!useMixedModels && (
                  <AIModelSelector
                    value={selectedModel}
                    onChange={setSelectedModel}
                    disabled={Object.values(renderingStates).some(
                      (state) => state
                    )}
                  />
                )}
              </div>
            )}

            {/* Custom Prompt Input - Only show for Pro users */}
            {currentUser?.isPro && (
              <div className={styles.promptSection}>
                <label htmlFor="custom-prompt" className={styles.promptLabel}>
                  Custom Prompt (optional):
                </label>
                <textarea
                  id="custom-prompt"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder={
                    renderMode === '1x' && selectedModel
                      ? AI_MODELS[selectedModel]?.prompt ||
                        'Enter custom prompt...'
                      : 'Enter custom prompt...'
                  }
                  className={styles.promptTextarea}
                  disabled={
                    isGeneratingAI ||
                    Object.values(renderingStates).some((state) => state)
                  }
                  rows={3}
                  maxLength={500}
                />
              </div>
            )}
            {/* Render Buttons */}
            {renderMode === '1x' ? (
              <Button
                onClick={() => handleGenerateAIImage()}
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
                      {`${elapsedTime}/${AI_MODELS[selectedModel]?.estimatedTime || 30}s`}
                    </span>
                    {showOvertimeWarning && (
                      <span className={styles.overtimeText}>
                        Generation taking longer than expected.
                      </span>
                    )}
                  </div>
                ) : (
                  <span
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    <span>Generate Render</span>
                    {tokenProfile && (
                      <TokenDisplayInner
                        count={getTokenCost(selectedModel)}
                        inline={true}
                      />
                    )}
                  </span>
                )}
              </Button>
            ) : (
              <Button
                onClick={handleGenerate4xRender}
                variant="filled"
                className={styles.aiButton}
                disabled={
                  Object.values(renderingStates).some((state) => state) ||
                  !currentUser
                }
                title={`Generate 4 renders simultaneously (uses ${
                  useMixedModels
                    ? Object.keys(AI_MODELS)
                        .filter((key) => AI_MODELS[key].includeIn4x === true)
                        .reduce((sum, key) => sum + getTokenCost(key), 0)
                    : getTokenCost(selectedModel) * 4
                } tokens)`}
              >
                <span
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <span>Generate Renders</span>
                  {tokenProfile && (
                    <TokenDisplayInner
                      count={
                        useMixedModels
                          ? Object.keys(AI_MODELS)
                              .filter(
                                (key) => AI_MODELS[key].includeIn4x === true
                              )
                              .reduce((sum, key) => sum + getTokenCost(key), 0)
                          : getTokenCost(selectedModel) * 4
                      }
                      inline={true}
                    />
                  )}
                </span>
              </Button>
            )}
            {!currentUser && (
              <p className={styles.loginPrompt}>
                Please log in to use AI rendering
              </p>
            )}
          </div>

          {/* Token Display at bottom of sidebar */}
          {tokenProfile && (
            <div className={styles.sidebarTokenDisplay}>
              <TokenDisplayInner showLabel={true} />
            </div>
          )}

          {renderMode === '1x' && aiImageUrl && (
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
          {/* Always render the screentock-destination img for screenshot functionality */}
          <img
            id="screentock-destination"
            src={originalImageUrl}
            alt="Screenshot destination"
            style={{ display: 'none', position: 'absolute' }}
          />

          {renderMode === '1x' ? (
            comparisonMode && aiImageUrl ? (
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
                  onClick={() => handleDownloadScreenshot()}
                  title="Download image"
                  aria-label="Download image"
                >
                  <DownloadIcon />
                  <span>Download</span>
                </button>
              </div>
            )
          ) : (
            // 4x Mode Display Logic
            <>
              {/* Show original screenshot if no renders are in progress and no completed renders and no errors */}
              {!Object.values(renderingStates).some((state) => state) &&
              Object.keys(aiImages).length === 0 &&
              Object.keys(renderErrors).length === 0 ? (
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
                  <img src={originalImageUrl} alt="Original Screenshot" />
                  <button
                    className={styles.downloadButton}
                    onClick={() => handleDownloadScreenshot()}
                    title="Download image"
                    aria-label="Download image"
                  >
                    <DownloadIcon />
                    <span>Download</span>
                  </button>
                </div>
              ) : (
                // 4x Render Grid - show when renders are in progress or completed
                <div className={styles.renderGrid}>
                  {Array.from({ length: 4 }, (_, index) => {
                    // Filter models to only include those with includeIn4x: true
                    const modelKeys = Object.keys(AI_MODELS).filter(
                      (key) => AI_MODELS[key].includeIn4x === true
                    );
                    const modelKey = useMixedModels
                      ? index < modelKeys.length
                        ? `${modelKeys[index]}-${index}`
                        : null
                      : `${selectedModel}-${index}`;
                    const baseModelKey = modelKey
                      ? modelKey.split('-').slice(0, -1).join('-')
                      : null;
                    const modelConfig = baseModelKey
                      ? AI_MODELS[baseModelKey]
                      : null;
                    const imageUrl = modelKey ? aiImages[modelKey] : null;
                    const isRendering = modelKey
                      ? renderingStates[modelKey]
                      : false;
                    const hasError = modelKey ? renderErrors[modelKey] : false;
                    const timer = modelKey ? renderTimers[modelKey] : null;

                    return (
                      <div key={index} className={styles.renderSlot}>
                        {modelKey && modelConfig ? (
                          <>
                            <div className={styles.renderOverlay}>
                              <div className={styles.modelName}>
                                {modelConfig.name}
                              </div>
                              <div
                                className={`${styles.timeOverlay} ${hasError ? styles.errorOverlay : ''} ${isRendering && timer?.isOvertime ? styles.overtimeOverlay : ''}`}
                              >
                                {isRendering
                                  ? `${timer?.elapsed || 0}s`
                                  : imageUrl
                                    ? `${timer?.elapsed || 0}s`
                                    : '—'}
                              </div>
                            </div>
                            {isRendering ? (
                              <div className={styles.renderingPlaceholder}>
                                <div className={styles.spinner}></div>
                                <span>Rendering...</span>
                              </div>
                            ) : imageUrl ? (
                              <>
                                <img
                                  src={imageUrl}
                                  alt={`AI Render - ${modelConfig.name}`}
                                  className={styles.renderImage}
                                />
                                <button
                                  className={styles.slotDownloadButton}
                                  onClick={() =>
                                    handleDownloadScreenshot(imageUrl, modelKey)
                                  }
                                  title="Download image"
                                  aria-label="Download image"
                                >
                                  <DownloadIcon />
                                </button>
                              </>
                            ) : hasError ? (
                              <div className={styles.errorSlot}>
                                <span>Error</span>
                              </div>
                            ) : (
                              <div className={styles.emptySlot}>
                                <span>Ready</span>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className={styles.emptySlot}>
                            <span>Empty</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

export { ScreenshotModal };
