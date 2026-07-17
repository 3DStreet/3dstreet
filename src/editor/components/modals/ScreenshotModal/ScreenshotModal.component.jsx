import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import styles from './ScreenshotModal.module.scss';
import Modal from '@shared/components/Modal/Modal.jsx';
import posthog from 'posthog-js';
import useStore from '@/store';
import { Button } from '../../elements';
import { DownloadIcon } from '@shared/icons';
import { getCurrentCameraState } from '../../../lib/cameraUtils';
import {
  captureScreenshotAsJpeg,
  createSceneSnapshot,
  createSnapshotFromImageUrl,
  saveScreenshotToGallery,
  setSnapshotAsSceneThumbnail
} from '../../../api/snapshot';
import { functions } from '@shared/services/firebase';
import { useAuthContext } from '../../../contexts';
import { httpsCallable } from 'firebase/functions';
import { ImgComparisonSlider } from '@img-comparison-slider/react';
import 'img-comparison-slider/dist/styles.css';
import { canUseImageFeature } from '@shared/utils/tokens';
import { TokenDisplayInner } from '@shared/auth/components';
import { assetsService } from '@shared/assets';
import { REPLICATE_MODELS } from '@shared/constants/replicateModels.js';
import {
  DEFAULT_RENDER_STYLE_ID,
  buildStyledPrompt
} from '@shared/constants/renderStyles.js';
import AIModelSelector from '@shared/components/AIModelSelector';
import RenderStyleSelector from '@shared/components/RenderStyleSelector';

// Available AI models (use shared constants)
const AI_MODELS = REPLICATE_MODELS;

function ScreenshotModal() {
  const intl = useIntl();
  const setModal = useStore((state) => state.setModal);
  const modal = useStore((state) => state.modal);
  const startCheckout = useStore((state) => state.startCheckout);
  const watermarkUpsellShown = useStore((state) => state.watermarkUpsellShown);
  const setWatermarkUpsellShown = useStore(
    (state) => state.setWatermarkUpsellShown
  );
  const setPendingPostCheckoutAction = useStore(
    (state) => state.setPendingPostCheckoutAction
  );
  const { currentUser, tokenProfile, refreshTokenProfile } = useAuthContext();
  // Pro entitlement for feature gating — true for both subscription Pro and
  // ProTeam (team membership). Analytics fields elsewhere intentionally use
  // currentUser.isPro alone to distinguish the two.
  const isPro = currentUser?.isPro || currentUser?.isProTeam;
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
  const [selectedModel, setSelectedModel] = useState('nano-banana-pro');
  const [renderStyle, setRenderStyle] = useState(DEFAULT_RENDER_STYLE_ID); // Render style preset
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
        intl.formatMessage({
          id: 'screenshotModal.confirmClose',
          defaultMessage:
            'Rendering in progress. Are you sure you want to close? The render will be cancelled.'
        })
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

  const performDownloadScreenshot = (targetImageUrl, modelKey) => {
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

  const handleDownloadScreenshot = async (imageUrl = null, modelKey = null) => {
    const targetImageUrl =
      imageUrl || (showOriginal ? originalImageUrl : aiImageUrl);
    if (!targetImageUrl) {
      STREET.notify.errorMessage(
        intl.formatMessage({
          id: 'screenshotModal.noImageToDownload',
          defaultMessage: 'No image available to download'
        })
      );
      return;
    }

    // First-of-session watermark paywall: non-Pro users see the upsell once
    // per page load before their first download. The "Continue free with
    // watermark" CTA reuses pendingPostCheckoutAction to run this exact
    // download in one click. Subsequent downloads bypass the modal.
    if (!isPro && !watermarkUpsellShown) {
      setWatermarkUpsellShown(true);
      setPendingPostCheckoutAction(() =>
        performDownloadScreenshot(targetImageUrl, modelKey)
      );
      startCheckout('watermark');
      return;
    }

    performDownloadScreenshot(targetImageUrl, modelKey);
  };

  const handleSetAsSceneThumbnail = async () => {
    const sceneId = STREET.utils.getCurrentSceneId();
    const authorId = STREET.utils.getAuthorId();

    if (!sceneId) {
      STREET.notify.errorMessage(
        intl.formatMessage({
          id: 'screenshotModal.saveSceneFirst',
          defaultMessage: 'Please save your scene first'
        })
      );
      return;
    }

    if (!currentUser || currentUser.uid !== authorId) {
      STREET.notify.errorMessage(
        intl.formatMessage({
          id: 'screenshotModal.onlyAuthorCanSetThumbnail',
          defaultMessage: 'Only the scene author can set the thumbnail'
        })
      );
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

      STREET.notify.successMessage(
        intl.formatMessage({
          id: 'screenshotModal.thumbnailSaved',
          defaultMessage: 'Scene thumbnail saved successfully!'
        })
      );

      posthog.capture('scene_thumbnail_set', {
        scene_id: sceneId,
        is_ai_generated: isAIImage
      });
    } catch (error) {
      console.error('Error setting scene thumbnail:', error);
      STREET.notify.errorMessage(
        intl.formatMessage({
          id: 'screenshotModal.thumbnailFailed',
          defaultMessage: 'Failed to set scene thumbnail. Please try again.'
        })
      );
    } finally {
      setIsSavingSnapshot(false);
    }
  };

  const handleGenerateAIImage = async (modelKey = null) => {
    if (!originalImageUrl) {
      STREET.notify.errorMessage(
        intl.formatMessage({
          id: 'screenshotModal.noScreenshotToRender',
          defaultMessage: 'No screenshot available to render'
        })
      );
      return;
    }

    const targetModel = modelKey || selectedModel;

    // Guard against re-entry (e.g. double-click before state flushes)
    if (
      renderingStates[targetModel] ||
      (renderMode === '1x' && isGeneratingAI)
    ) {
      return;
    }

    // Pre-flight token check for non-Pro users. Mirrors the 4x path so 1x
    // users hit the paywall up front instead of round-tripping to the cloud
    // function and surfacing a toast on rejection. Pro/ProTeam users skip
    // this gate — canUseImageFeature below handles their monthly auto-refill.
    const tokenCost = getTokenCost(targetModel);
    if (!isPro && (tokenProfile?.genToken ?? 0) < tokenCost) {
      startCheckout('image');
      return;
    }

    // Clear any previous error state for this model
    setRenderErrors((prev) => {
      const next = { ...prev };
      delete next[targetModel];
      return next;
    });

    // Update rendering state immediately (no timer yet — show "Sending...")
    setRenderingStates((prev) => ({ ...prev, [targetModel]: true }));

    // For single render mode, set global states (no timer yet)
    if (renderMode === '1x') {
      setIsGeneratingAI(true);
      setRenderProgress(0);
      setRenderStartTime(null);
      setElapsedTime(0);
    }

    // Pro/ProTeam path: triggers the monthly token auto-refill side-effect.
    // Non-Pro users were already gated above against the selected model's cost.
    const canUse = await canUseImageFeature(currentUser);
    if (!canUse) {
      // Reset states before returning
      setRenderingStates((prev) => ({ ...prev, [targetModel]: false }));
      if (renderMode === '1x') {
        setIsGeneratingAI(false);
        setRenderStartTime(null);
      }
      startCheckout('image');
      return;
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

      // Only allow custom prompts for Pro users (subscription or team).
      // Style presets are available to everyone: the selected style is
      // appended to the user's custom prompt or, if none, replaces/extends
      // the model's default (photorealistic) prompt.
      const aiPrompt = buildStyledPrompt({
        userPrompt: isPro ? customPrompt : '',
        modelDefaultPrompt: selectedModelConfig.prompt,
        styleId: renderStyle
      });

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

      // Now that image is prepared and ready to send, start the timer
      const startTime = Date.now();
      setRenderTimers((prev) => ({
        ...prev,
        [targetModel]: { startTime, elapsed: 0 }
      }));
      if (renderMode === '1x') {
        setRenderStartTime(startTime);
      }

      // Route to the correct cloud function based on model type
      let result;
      if (selectedModelConfig.type === 'fal') {
        const generateFalImage = httpsCallable(functions, 'generateFalImage', {
          timeout: 300000
        });
        result = await generateFalImage({
          prompt: aiPrompt,
          input_image: inputImageSrc,
          model_id: baseModelKey,
          scene_id: sceneId || null,
          source: 'editor'
        });
      } else {
        const generateReplicateImage = httpsCallable(
          functions,
          'generateReplicateImage',
          { timeout: 300000 }
        );
        result = await generateReplicateImage({
          prompt: aiPrompt,
          input_image: inputImageSrc,
          guidance: 2.5,
          num_inference_steps: 30,
          model_version: selectedModelConfig.version,
          model_id: baseModelKey,
          scene_id: sceneId || null
        });
      }

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
            await assetsService.init();

            await assetsService.addAsset(
              result.data.image_url,
              {
                timestamp: new Date().toISOString(),
                sceneId: sceneId || STREET.utils.getCurrentSceneId(),
                sceneTitle: useStore.getState().sceneTitle || 'Untitled',
                source: 'ai-render',
                model: selectedModelConfig.name,
                modelKey: baseModelKey,
                prompt: aiPrompt,
                renderStyle: renderStyle,
                renderMode: renderMode,
                // The camera hasn't moved since the base capture, so this is
                // the render's vantage — persist it for the focus button (#1605).
                cameraState: getCurrentCameraState(),
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
            intl.formatMessage(
              {
                id: 'screenshotModal.aiRenderSuccess',
                defaultMessage:
                  'AI render generated successfully! ({modelName})'
              },
              { modelName: selectedModelConfig.name }
            )
          );
        } else if (result.data.remainingTokens !== undefined) {
          const message = currentUser?.isPro
            ? intl.formatMessage(
                {
                  id: 'screenshotModal.aiRenderCompleteTokens',
                  defaultMessage:
                    'AI render complete! {remainingTokens} tokens remaining. ({modelName})'
                },
                {
                  remainingTokens: result.data.remainingTokens,
                  modelName: selectedModelConfig.name
                }
              )
            : intl.formatMessage(
                {
                  id: 'screenshotModal.aiRenderCompleteGenTokens',
                  defaultMessage:
                    'AI render complete! {remainingTokens} gen tokens remaining. ({modelName})'
                },
                {
                  remainingTokens: result.data.remainingTokens,
                  modelName: selectedModelConfig.name
                }
              );
          STREET.notify.successMessage(message);
        } else {
          STREET.notify.successMessage(
            intl.formatMessage(
              {
                id: 'screenshotModal.aiRenderSuccess',
                defaultMessage:
                  'AI render generated successfully! ({modelName})'
              },
              { modelName: selectedModelConfig.name }
            )
          );
        }

        // Refresh token profile to show updated count in UI
        await refreshTokenProfile();

        posthog.capture('ai_image_generated', {
          scene_id: STREET.utils.getCurrentSceneId(),
          prompt: aiPrompt,
          model: baseModelKey,
          render_style: renderStyle,
          render_mode: renderMode,
          is_pro_user: currentUser?.isPro || false,
          tokens_available: tokenProfile?.genToken || 0
        });

        // Funnel event: ai_render_used (standardized event for conversion funnel)
        posthog.capture('ai_render_used', {
          token_type: 'gen',
          model: baseModelKey,
          render_style: renderStyle,
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
      const modelName =
        AI_MODELS[baseModelKey]?.name ||
        intl.formatMessage({
          id: 'screenshotModal.selectedModelFallback',
          defaultMessage: 'selected model'
        });

      // Track error state for this model
      setRenderErrors((prev) => ({ ...prev, [targetModel]: true }));

      // Only show error notification for single renders or if all renders have completed
      if (renderMode === '1x') {
        STREET.notify.errorMessage(
          intl.formatMessage(
            {
              id: 'screenshotModal.aiRenderFailed',
              defaultMessage:
                'Failed to generate AI render for {modelName}. Please try again.'
            },
            { modelName }
          )
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
      STREET.notify.errorMessage(
        intl.formatMessage({
          id: 'screenshotModal.noScreenshotToRender',
          defaultMessage: 'No screenshot available to render'
        })
      );
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

    // Check if user has enough tokens for 4x render. Non-Pro users see the
    // paywall (custom 'image' surface communicates the gap); Pro/ProTeam users
    // who've exhausted their monthly allowance get a toast since there's no
    // further upsell to offer.
    if (!tokenProfile || tokenProfile.genToken < totalTokenCost) {
      if (!isPro) {
        startCheckout('image');
      } else {
        STREET.notify.errorMessage(
          intl.formatMessage(
            {
              id: 'screenshotModal.insufficientTokens4x',
              defaultMessage:
                'You need at least {totalTokenCost} tokens for 4x render'
            },
            { totalTokenCost }
          )
        );
      }
      return;
    }

    // Clear previous render states before starting new batch
    setRenderErrors({});
    setAiImages({});

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
      // Shared capture + gallery-save pipeline (also used by the
      // viewer's snapshot button) — see editor/api/snapshot.js.
      captureScreenshotAsJpeg(isPro)
        .then(({ dataUrl, width, height, pngSrc }) => {
          setOriginalImageUrl(pngSrc);
          if (!currentUser?.uid) {
            console.log('User not logged in, skipping gallery save');
            return;
          }
          // Save to gallery in the background (never blocks the UI)
          saveScreenshotToGallery(
            dataUrl,
            {
              source: 'screenshot',
              model: 'Editor Snapshot',
              width,
              height,
              isPro
            },
            currentUser.uid
          )
            .then((assetId) => {
              console.log(`Screenshot saved to gallery with ID: ${assetId}`);
            })
            .catch((error) => {
              console.error('Failed to save screenshot to gallery:', error);
            });
        })
        .catch((error) => {
          console.error('Screenshot capture failed:', error);
        });
    }
  }, [modal, isPro, currentUser?.uid]);

  return (
    <Modal
      className={`${styles.screenshotModalWrapper} ${isClosing ? styles.closing : ''}`}
      isOpen={modal === 'screenshot'}
      onClose={handleClose}
      titleElement={
        <div className="flex pr-4 pt-5">
          <div className="font-large text-center text-2xl">
            <FormattedMessage
              id="screenshotModal.title"
              defaultMessage="Screenshot & Render"
            />
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
              <FormattedMessage
                id="screenshotModal.render1x"
                defaultMessage="1x Render"
              />
            </button>
            <button
              className={`${styles.tabButton} ${renderMode === '4x' ? styles.active : ''}`}
              onClick={() => setRenderMode('4x')}
              disabled={
                isGeneratingAI ||
                Object.values(renderingStates).some((state) => state)
              }
            >
              <FormattedMessage
                id="screenshotModal.render4x"
                defaultMessage="4x Render"
              />
            </button>
          </div>

          <div className={styles.aiSection}>
            {renderMode === '1x' && (
              <div className={styles.modelSelector}>
                <label className={styles.modelLabel}>
                  <FormattedMessage
                    id="screenshotModal.aiModelLabel"
                    defaultMessage="AI Model:"
                  />
                </label>
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
                    {useMixedModels ? (
                      <FormattedMessage
                        id="screenshotModal.mixedModels"
                        defaultMessage="Mixed Models"
                      />
                    ) : (
                      <FormattedMessage
                        id="screenshotModal.sameModel"
                        defaultMessage="Same Model"
                      />
                    )}
                  </span>
                  <input
                    type="checkbox"
                    checked={useMixedModels}
                    onChange={(e) => setUseMixedModels(e.target.checked)}
                    disabled={
                      isGeneratingAI ||
                      Object.values(renderingStates).some((state) => state)
                    }
                  />
                  <div className={styles.toggleSwitch}></div>
                </label>
                {!useMixedModels && (
                  <AIModelSelector
                    value={selectedModel}
                    onChange={setSelectedModel}
                    disabled={
                      isGeneratingAI ||
                      Object.values(renderingStates).some((state) => state)
                    }
                  />
                )}
              </div>
            )}

            {/* Render Style Presets - available to all users */}
            <div className={styles.promptSection}>
              <label className={styles.promptLabel}>
                <FormattedMessage
                  id="screenshotModal.renderStyleLabel"
                  defaultMessage="Render Style:"
                />
              </label>
              <RenderStyleSelector
                value={renderStyle}
                onChange={setRenderStyle}
                disabled={
                  isGeneratingAI ||
                  Object.values(renderingStates).some((state) => state)
                }
              />
            </div>

            {/* Custom Prompt Input - Only show for Pro users (subscription or team) */}
            {isPro && (
              <div className={styles.promptSection}>
                <label htmlFor="custom-prompt" className={styles.promptLabel}>
                  <FormattedMessage
                    id="screenshotModal.customPromptLabel"
                    defaultMessage="Custom Prompt (optional):"
                  />
                </label>
                <textarea
                  id="custom-prompt"
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder={
                    renderMode === '1x' && selectedModel
                      ? AI_MODELS[selectedModel]?.prompt ||
                        intl.formatMessage({
                          id: 'screenshotModal.customPromptPlaceholder',
                          defaultMessage: 'Enter custom prompt...'
                        })
                      : intl.formatMessage({
                          id: 'screenshotModal.customPromptPlaceholder',
                          defaultMessage: 'Enter custom prompt...'
                        })
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
                    {renderStartTime ? (
                      <>
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
                            <FormattedMessage
                              id="screenshotModal.overtimeWarning"
                              defaultMessage="Generation taking longer than expected."
                            />
                          </span>
                        )}
                      </>
                    ) : (
                      <span className={styles.progressText}>
                        <FormattedMessage
                          id="screenshotModal.sendingRequest"
                          defaultMessage="Sending request..."
                        />
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
                    <span>
                      <FormattedMessage
                        id="screenshotModal.generateRender"
                        defaultMessage="Generate Render"
                      />
                    </span>
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
                title={intl.formatMessage(
                  {
                    id: 'screenshotModal.generate4xTooltip',
                    defaultMessage:
                      'Generate 4 renders simultaneously (uses {tokens} tokens)'
                  },
                  {
                    tokens: useMixedModels
                      ? Object.keys(AI_MODELS)
                          .filter((key) => AI_MODELS[key].includeIn4x === true)
                          .reduce((sum, key) => sum + getTokenCost(key), 0)
                      : getTokenCost(selectedModel) * 4
                  }
                )}
              >
                <span
                  style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                >
                  <span>
                    <FormattedMessage
                      id="screenshotModal.generateRenders"
                      defaultMessage="Generate Renders"
                    />
                  </span>
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
                <FormattedMessage
                  id="screenshotModal.loginPrompt"
                  defaultMessage="Please log in to use AI rendering"
                />
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
                  <FormattedMessage
                    id="screenshotModal.showOriginal"
                    defaultMessage="Show Original"
                  />
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
                  <FormattedMessage
                    id="screenshotModal.showRender"
                    defaultMessage="Show Render"
                  />
                </Button>
                <Button
                  variant={comparisonMode ? 'filled' : 'outline'}
                  onClick={() => setComparisonMode(!comparisonMode)}
                  size="small"
                >
                  <FormattedMessage
                    id="screenshotModal.compareAB"
                    defaultMessage="Compare A/B"
                  />
                </Button>
              </div>
            </div>
          )}

          {!isPro && (
            <div className={styles.upsellSection}>
              <Button
                variant="toolbtn"
                className={styles.upsellButton}
                onClick={() => startCheckout('watermark')}
              >
                <FormattedMessage
                  id="screenshotModal.upgradeToPro"
                  defaultMessage="Upgrade to Pro to hide 3DStreet Free watermark"
                />
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
                      title={intl.formatMessage({
                        id: 'screenshotModal.setAsThumbnailTooltip',
                        defaultMessage: 'Set as scene thumbnail'
                      })}
                      aria-label={intl.formatMessage({
                        id: 'screenshotModal.setAsThumbnailTooltip',
                        defaultMessage: 'Set as scene thumbnail'
                      })}
                    >
                      {isSavingSnapshot ? (
                        <span>
                          <FormattedMessage
                            id="screenshotModal.saving"
                            defaultMessage="Saving..."
                          />
                        </span>
                      ) : (
                        <>
                          <span>📌</span>
                          <span>
                            <FormattedMessage
                              id="screenshotModal.setAsThumbnail"
                              defaultMessage="Set as Scene Thumbnail"
                            />
                          </span>
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
                  title={intl.formatMessage({
                    id: 'screenshotModal.downloadImage',
                    defaultMessage: 'Download image'
                  })}
                  aria-label={intl.formatMessage({
                    id: 'screenshotModal.downloadImage',
                    defaultMessage: 'Download image'
                  })}
                >
                  <DownloadIcon />
                  <span>
                    <FormattedMessage
                      id="screenshotModal.download"
                      defaultMessage="Download"
                    />
                  </span>
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
                        title={intl.formatMessage({
                          id: 'screenshotModal.setAsThumbnailTooltip',
                          defaultMessage: 'Set as scene thumbnail'
                        })}
                        aria-label={intl.formatMessage({
                          id: 'screenshotModal.setAsThumbnailTooltip',
                          defaultMessage: 'Set as scene thumbnail'
                        })}
                      >
                        {isSavingSnapshot ? (
                          <span>
                            <FormattedMessage
                              id="screenshotModal.saving"
                              defaultMessage="Saving..."
                            />
                          </span>
                        ) : (
                          <>
                            <span>📌</span>
                            <span>
                              <FormattedMessage
                                id="screenshotModal.setAsThumbnail"
                                defaultMessage="Set as Scene Thumbnail"
                              />
                            </span>
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
                                <span>
                                  {timer?.startTime ? (
                                    <FormattedMessage
                                      id="screenshotModal.rendering"
                                      defaultMessage="Rendering..."
                                    />
                                  ) : (
                                    <FormattedMessage
                                      id="screenshotModal.sending"
                                      defaultMessage="Sending..."
                                    />
                                  )}
                                </span>
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
                                  title={intl.formatMessage({
                                    id: 'screenshotModal.downloadImage',
                                    defaultMessage: 'Download image'
                                  })}
                                  aria-label={intl.formatMessage({
                                    id: 'screenshotModal.downloadImage',
                                    defaultMessage: 'Download image'
                                  })}
                                >
                                  <DownloadIcon />
                                </button>
                              </>
                            ) : hasError ? (
                              <div className={styles.errorSlot}>
                                <span>
                                  <FormattedMessage
                                    id="screenshotModal.error"
                                    defaultMessage="Error"
                                  />
                                </span>
                              </div>
                            ) : (
                              <div className={styles.emptySlot}>
                                <span>
                                  <FormattedMessage
                                    id="screenshotModal.ready"
                                    defaultMessage="Ready"
                                  />
                                </span>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className={styles.emptySlot}>
                            <span>
                              <FormattedMessage
                                id="screenshotModal.empty"
                                defaultMessage="Empty"
                              />
                            </span>
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
