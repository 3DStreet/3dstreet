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

// Available AI models
const AI_MODELS = {
  'kontext-realearth': {
    name: 'Kontext Real Earth',
    version: '2af4da47bcb7b55a0705b0de9933701f7607531d763ae889241f827a648c1755',
    prompt: 'Transform satellite image into high-quality drone shot'
  },
  'flux-kontext-pro': {
    name: 'Flux Kontext Pro',
    version: 'aa776ca45ce7f7d185418f700df8ec6ca6cb367bfd88e9cd225666c4c179d1d7',
    prompt:
      'photorealistic street view, professional photography, high detail, natural lighting, clear and sharp'
  },
  'nano-banana': {
    name: 'Nano Banana',
    version: 'f0a9d34b12ad1c1cd76269a844b218ff4e64e128ddaba93e15891f47368958a0',
    prompt:
      'photorealistic street view, professional photography, high detail, natural lighting, clear and sharp'
  },
  'seedream-4': {
    name: 'Seedream',
    version: '254faac883c3a411e95cc95d0fb02274a81e388aaa4394b3ce5b7d2a9f7a6569',
    prompt:
      'photorealistic street view, professional photography, high detail, natural lighting, clear and sharp'
  }
};

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
    } else if (
      (aiImageUrl && !showOriginal) ||
      Object.keys(aiImages).length > 0
    ) {
      // Check if there are any unsaved AI renders (1x or 4x)
      const confirmClose = window.confirm(
        'You have unsaved AI renders. Are you sure you want to close? The AI renders will be lost.'
      );
      if (!confirmClose) {
        return;
      }
    }

    // Reset all state when closing
    resetModalState();
    setModal(null);
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
        'generateReplicateImage'
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

      const inputImageSrc = screentockImgElement?.src || originalImageUrl;

      const result = await generateReplicateImage({
        prompt: aiPrompt,
        input_image: inputImageSrc,
        guidance: 2.5,
        num_inference_steps: 30,
        model_version: selectedModelConfig.version
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

    // Check if user has enough tokens for 4x render (need 4 tokens)
    // Pro users also need 4 tokens for 4x render
    if (!tokenProfile || tokenProfile.genToken < 4) {
      STREET.notify.errorMessage('You need at least 4 tokens for 4x render');
      // Only prompt checkout for non-pro users
      if (!currentUser?.isPro && !currentUser?.isProTeam) {
        startCheckout('image');
      }
      return;
    }

    const modelKeys = Object.keys(AI_MODELS);
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

  // Timer updates for individual renders in 4x mode
  useEffect(() => {
    const intervals = {};

    Object.keys(renderingStates).forEach((modelKey) => {
      if (renderingStates[modelKey] && renderTimers[modelKey]) {
        intervals[modelKey] = setInterval(() => {
          const elapsed = Math.round(
            (Date.now() - renderTimers[modelKey].startTime) / 1000
          );
          setRenderTimers((prev) => ({
            ...prev,
            [modelKey]: { ...prev[modelKey], elapsed }
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
                <label htmlFor="model-select" className={styles.modelLabel}>
                  AI Model:
                </label>
                <select
                  id="model-select"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className={styles.modelSelect}
                  disabled={
                    isGeneratingAI ||
                    Object.values(renderingStates).some((state) => state)
                  }
                >
                  {Object.entries(AI_MODELS).map(([key, model]) => (
                    <option key={key} value={key}>
                      {model.name}
                    </option>
                  ))}
                </select>
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
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className={styles.modelSelect}
                    disabled={Object.values(renderingStates).some(
                      (state) => state
                    )}
                  >
                    {Object.entries(AI_MODELS).map(([key, model]) => (
                      <option key={key} value={key}>
                        {model.name}
                      </option>
                    ))}
                  </select>
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
                          {tokenProfile.genToken || 0}{' '}
                          {currentUser?.isPro ? 'tokens' : 'free'}
                        </span>
                      )}
                    </span>
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
                title="Generate 4 renders simultaneously (uses 4 tokens)"
              >
                <span>
                  <span>✨</span>
                  <span>
                    Generate 4x Renders
                    {tokenProfile && (
                      <span className={styles.tokenBadge}>
                        {tokenProfile.genToken || 0}{' '}
                        {currentUser?.isPro ? 'tokens' : 'free'}
                      </span>
                    )}
                  </span>
                </span>
              </Button>
            )}
            {!currentUser && (
              <p className={styles.loginPrompt}>
                Please log in to use AI rendering
              </p>
            )}
          </div>

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
                    const modelKeys = Object.keys(AI_MODELS);
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
                                className={`${styles.timeOverlay} ${hasError ? styles.errorOverlay : ''}`}
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
