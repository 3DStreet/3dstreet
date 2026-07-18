/**
 * Generator Tab Base Class
 * Shared functionality for the Image tab (and other GeneratorTabBase tabs)
 */

import FluxUI from './main.js';
import useImageGenStore from './store.js';
import ImageUploadUtils from './image-upload-utils.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@shared/services/firebase.js';
import { REPLICATE_MODELS } from '@shared/constants/replicateModels.js';
import {
  getStyleSentence,
  describeStyleText,
  composePrompt
} from '@shared/constants/renderStyles.js';
import { mountModelSelector } from './mount-model-selector.js';
import { syncJobNotifyEmail } from './job-notify.js';
import { mountStyleSelector } from './mount-style-selector.js';
import promptFieldStyles from '@shared/styles/promptFields.module.scss';
import posthog from 'posthog-js';

/**
 * Build estimated times object from all models
 */
const buildEstimatedTimes = () => {
  const times = {};

  Object.entries(REPLICATE_MODELS).forEach(([key, model]) => {
    times[key] = model.estimatedTime;
  });

  return times;
};

/**
 * Base class for generator tabs
 */
class GeneratorTabBase {
  constructor(config) {
    // Configuration
    this.config = {
      tabId: config.tabId, // 'create' or 'modify'
      tabType: config.tabType, // 'create' or 'modify'
      requiresSourceImage: config.requiresSourceImage || false,
      showImagePromptUI: config.showImagePromptUI || false,
      // Optional source image: show the upload with an amber (recommended, not
      // required) indicator and nudge the user toward providing one, but allow
      // text-only generation.
      optionalSourceImage: config.optionalSourceImage || false,
      title: config.title || 'Image Generator',
      description: config.description || 'Generate images with AI'
    };

    // Tab state
    this.imagePromptData = null;
    this.currentParams = {};
    this.currentImageUrl = '';
    this.selectedOrientation = 'portrait';
    this.selectedDimension = '1024x1440';
    this.selectedModel = 'nano-banana-pro'; // Default model

    // Timer state
    this.renderStartTime = null;
    this.elapsedTime = 0;
    this.renderProgress = 0;
    this.timerInterval = null;

    // Job-status poll state (see pollImageStatus). Images are async jobs now
    // (#1835): submit returns a jobId and this poll drives the live UI, while
    // completion (gallery save) happens server-side.
    this.pollTimeout = null; // setTimeout handle for the status poll loop
    this.pollDeadline = 0; // wall-clock ms after which we stop polling
    this.activeJobId = null; // in-flight job — target of the email toggle
    // Most image renders finish in seconds; 15 min is generous headroom before
    // we give up locally (the job still finishes server-side regardless — the
    // image lands in the gallery either way).
    this.POLL_INTERVAL_MS = 3000;
    this.POLL_MAX_MS = 15 * 60 * 1000;

    // Estimated generation times (in seconds) - built from shared constants
    this.estimatedTimes = buildEstimatedTimes();

    // DOM Elements
    this.elements = {};

    // React component instances
    this.modelSelectorInstance = null;
    this.styleSelectorInstance = null;
  }

  /**
   * Get element ID with tab prefix
   */
  getElementId(baseName) {
    return `${this.config.tabId}-${baseName}`;
  }

  /**
   * Define dimensions grouped by orientation
   */
  get dimensionsByOrientation() {
    return {
      square: ['512x512', '1024x1024', '1440x1440'],
      landscape: ['768x512', '1024x576', '1024x768', '1440x768', '1440x1024'],
      portrait: ['512x768', '576x1024', '768x1024', '1024x1440', '768x1440']
    };
  }

  /**
   * Initialize the tab
   */
  init() {
    const tabContainer = document.getElementById(`${this.config.tabId}-tab`);
    if (!tabContainer) {
      console.error(`${this.config.tabType} Tab: Container element not found!`);
      return;
    }

    this.createTabContent(tabContainer);
    this.getElements();
    this.prefillPromptDefaults();
    this.mountModelSelectorComponent();
    this.mountStyleSelectorComponent();
    this.updateModelParams();
    this.setupEventListeners();

    // Register this module with the main UI
    FluxUI.tabModules[this.config.tabType] = this;

    this.checkForPendingGalleryItem();
  }

  /**
   * Check for pending gallery item from cross-app communication
   */
  checkForPendingGalleryItem() {
    try {
      const pendingItemJson = localStorage.getItem('pendingAssetItem');
      if (!pendingItemJson) return;

      const pendingItem = JSON.parse(pendingItemJson);

      if (
        pendingItem.targetTab === this.config.tabType &&
        Date.now() - pendingItem.timestamp < 10000
      ) {
        console.log(
          `Loading pending gallery item for ${this.config.tabType} tab:`,
          pendingItem
        );

        if (
          pendingItem.imageDataUrl &&
          typeof pendingItem.imageDataUrl === 'string'
        ) {
          this.setImagePrompt(
            pendingItem.imageDataUrl,
            `Gallery Item ${pendingItem.id}`
          );
        }

        localStorage.removeItem('pendingAssetItem');
      }
    } catch (error) {
      console.error('Failed to load pending gallery item:', error);
      localStorage.removeItem('pendingAssetItem');
    }
  }

  /**
   * Get all DOM elements after content is created
   */
  getElements() {
    const getId = (name) => this.getElementId(name);

    // Model Selection - React component container
    this.elements.modelSelectorContainer = document.getElementById(
      getId('model-selector-container')
    );

    // Render Style - React component container
    this.elements.styleSelectorContainer = document.getElementById(
      getId('style-selector-container')
    );

    // Prompt and dimensions
    this.elements.promptInput = document.getElementById(getId('prompt-input'));
    this.elements.styleInput = document.getElementById(getId('style-input'));
    this.elements.dimensionsGroup = document.getElementById(
      getId('dimensions-group')
    );
    this.elements.orientationButtons = document.getElementById(
      getId('orientation-buttons')
    );
    this.elements.dimensionsGrid = document.getElementById(
      getId('dimensions-grid')
    );
    this.elements.aspectRatioSelector = document.getElementById(
      getId('aspect-ratio-selector')
    );

    // Image prompt (if applicable)
    if (this.config.showImagePromptUI) {
      this.elements.imagePromptInput =
        document.getElementById('source-image-input');
      this.elements.imagePromptName =
        document.getElementById('source-image-name');
      this.elements.imagePromptUploadLabel = document.getElementById(
        'source-image-upload-label'
      );
      this.elements.imagePromptPreviewContainer = document.getElementById(
        'source-image-preview-container'
      );
      this.elements.imagePromptPreview = document.getElementById(
        'source-image-preview'
      );
      this.elements.imagePromptClear =
        document.getElementById('source-image-clear');
      this.elements.imagePromptStrength = document.getElementById(
        'source-image-strength'
      );
      this.elements.imagePromptStrengthValue = document.getElementById(
        'source-image-strength-value'
      );
      this.elements.imagePromptStrengthContainer = document.getElementById(
        'source-image-strength-container'
      );
    }

    // Groups
    this.elements.dimensionsGroup = document.getElementById(
      getId('dimensions-group')
    );
    this.elements.aspectRatioGroup = document.getElementById(
      getId('aspect-ratio-group')
    );
    if (this.config.showImagePromptUI) {
      this.elements.imagePromptGroup =
        document.getElementById('source-image-group');
    }

    // Preview
    this.elements.previewContainer = document.getElementById(
      getId('preview-container')
    );
    this.elements.previewImage = document.getElementById(
      getId('preview-image')
    );
    this.elements.generationPlaceholder = document.getElementById(
      getId('generation-placeholder')
    );
    this.elements.loadingIndicator = document.getElementById(
      getId('loading-indicator')
    );
    this.elements.loadingText = document.getElementById(getId('loading-text'));

    // Timer elements
    this.elements.progressBar = document.getElementById(
      getId('generator-progress-bar')
    );
    this.elements.overtimeText = document.getElementById(
      getId('generator-overtime-text')
    );

    // Action buttons
    this.elements.actionButtons = document.getElementById(
      getId('action-buttons')
    );
    this.elements.copyParamsBtn = document.getElementById(
      getId('copy-params-btn')
    );
    this.elements.openImageBtn = document.getElementById(
      getId('open-image-btn')
    );
    this.elements.downloadImageBtn = document.getElementById(
      getId('download-image-btn')
    );
    this.elements.copyImageUrlBtn = document.getElementById(
      getId('copy-image-url-btn')
    );

    // Generate button
    this.elements.generateBtn = document.getElementById(getId('generate-btn'));
    this.elements.generateSpinner = document.getElementById(
      getId('generate-spinner')
    );
    this.elements.generateText = document.getElementById(
      getId('generate-text')
    );
    this.elements.tokenCost = document.getElementById(getId('token-cost'));
    this.elements.notifyEmail = document.getElementById(getId('notify-email'));
    this.elements.notifyEmailRow = document.getElementById(
      getId('notify-email-row')
    );

    // Verify critical elements
    const missingElements = [];
    [
      'modelSelectorContainer',
      'promptInput',
      'styleInput',
      'generateBtn'
    ].forEach((elem) => {
      if (!this.elements[elem]) {
        missingElements.push(elem);
      }
    });

    if (missingElements.length > 0) {
      console.error(
        'Generator Tab: Critical elements not found:',
        missingElements
      );
    }
  }

  /**
   * Whether a source image is required for the current selection. On the Image
   * tab this is model-aware (some models cannot run without one); legacy tabs
   * fall back to the tab-level requiresSourceImage flag.
   */
  sourceImageRequired() {
    if (this.config.optionalSourceImage) {
      return !!REPLICATE_MODELS[this.selectedModel]?.requiresSourceImage;
    }
    return this.config.requiresSourceImage;
  }

  /**
   * Generate HTML for the source-image section. The `*` indicator is amber when
   * an image is merely recommended and red when the selected model requires one
   * (updated live by updateSourceImageIndicator on model change).
   */
  getImagePromptHTML() {
    if (!this.config.showImagePromptUI) return '';

    const labelText = this.config.optionalSourceImage
      ? 'Reference Image'
      : 'Source Image';
    const required = this.sourceImageRequired();
    const indicator = `<span id="source-image-indicator" style="color: ${
      required ? '#ef4444' : '#F5A623'
    };" title="${
      required ? 'Required for this model' : 'Recommended for better results'
    }">*</span>`;

    return `
                    <!-- Source Image -->
                    <div id="source-image-group" class="mb-4 param-group">
                        <label class="block text-sm font-medium text-gray-700 mb-1">${labelText} ${indicator}</label>
                        <div class="flex flex-col space-y-2">
                            <label id="source-image-upload-label" class="flex items-center justify-center w-full h-20 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer hover:bg-gray-50">
                                <div class="flex flex-col items-center">
                                    <p class="text-sm text-gray-500">Click to upload an image</p>
                                    <p id="source-image-name" class="text-xs text-gray-400 mt-1">No file selected</p>
                                </div>
                                <input id="source-image-input" type="file" class="hidden" accept="image/png, image/jpeg, image/jpg" />
                            </label>
                            <div id="source-image-preview-container" class="hidden relative">
                                <img id="source-image-preview" class="w-full rounded-lg border border-gray-300" alt="Selected image">
                                <button id="source-image-clear" class="absolute top-2 right-2 p-1 bg-white bg-opacity-80 rounded-full hover:bg-opacity-100 hover:bg-red-50 shadow hover:shadow-lg transition-all duration-200" title="Clear image">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-600 hover:text-red-600 transition-colors duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                            <div class="hidden" id="source-image-strength-container">
                                <label class="block text-xs font-medium text-gray-700 mb-1">Image Strength: <span id="source-image-strength-value">0.3</span></label>
                                <input type="range" id="source-image-strength" min="0" max="1" step="0.05" value="0.3" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                            </div>
                        </div>
                    </div>
    `;
  }

  /**
   * Get prompt label. A non-empty composed prompt is always required
   * (validateGeneration), so the required marker is unconditional.
   */
  getPromptLabel() {
    return 'Prompt <span class="text-red-500">*</span>';
  }

  /**
   * Get instructions placeholder based on tab type. Both fields start empty
   * (helptext only); validateGeneration rejects an all-empty composed prompt.
   */
  getPromptPlaceholder() {
    if (this.config.tabType === 'create') {
      return 'Describe what to generate';
    }
    return 'Describe what to generate or how to change the source image';
  }

  /**
   * Mount the ModelSelector React component
   */
  mountModelSelectorComponent() {
    const container = this.elements.modelSelectorContainer;
    if (!container) {
      console.error('Model selector container not found');
      return;
    }

    this.modelSelectorInstance = mountModelSelector(container, {
      value: this.selectedModel,
      // The Image tab (optionalSourceImage) shows all models at all times,
      // regardless of whether an image is present. Legacy tabs key off
      // showImagePromptUI to hide edit-only models when there's no image.
      hasSourceImage: this.config.optionalSourceImage
        ? true
        : this.config.showImagePromptUI,
      onChange: (modelId) => {
        this.selectedModel = modelId;
        this.updateModelParams();
        // Re-render the component with the new value
        if (this.modelSelectorInstance) {
          this.modelSelectorInstance.update({ value: modelId });
        }
      },
      disabled: false
    });
  }

  /**
   * Both fields start empty in the generator — helptext placeholders carry
   * the guidance, and what's sent is always exactly what's visible (no
   * hidden fallback prompt). Styling is opt-in via the chips.
   */
  prefillPromptDefaults() {
    if (this.elements.promptInput) {
      this.elements.promptInput.value = '';
    }
    if (this.elements.styleInput) {
      this.elements.styleInput.value = '';
    }
    this.updatePromptTint();
  }

  /**
   * Text levels, shared with the editor (promptFields.module.scss):
   * helptext placeholder (italic, darkest gray), preset style text
   * (middle gray), and user-authored text (white via .userText).
   */
  updatePromptTint() {
    const setTint = (el, isUserText) => {
      if (!el) return;
      el.classList.toggle(promptFieldStyles.userText, isUserText);
    };
    setTint(this.elements.promptInput, !!this.elements.promptInput?.value);
    setTint(
      this.elements.styleInput,
      describeStyleText(this.elements.styleInput?.value) === 'custom'
    );
  }

  /**
   * Mount the RenderStyleSelector React component. Chips write only the
   * style field: clicking one replaces the style sentence (the 'none' chip
   * clears it) while the instructions field is untouched. A chip stays
   * highlighted only while its unedited sentence is in the style field.
   */
  mountStyleSelectorComponent() {
    const container = this.elements.styleSelectorContainer;
    if (!container) {
      console.error('Style selector container not found');
      return;
    }

    this._lastActiveStyleId = describeStyleText(
      this.elements.styleInput?.value
    );
    this.styleSelectorInstance = mountStyleSelector(container, {
      activeStyleId: this._lastActiveStyleId,
      onSelect: (styleId) => {
        this.elements.styleInput.value = getStyleSentence(styleId);
        this.refreshStyleHighlight();
      },
      disabled: false
    });
  }

  /**
   * Sync chip highlighting with the style field contents. Called on chip
   * click and on manual edits; edited text highlights no chip ('custom'),
   * an empty field highlights the 'none' chip. Skips the React re-render
   * when the highlight didn't change (typing custom text stays 'custom').
   */
  refreshStyleHighlight() {
    this.updatePromptTint();
    if (!this.styleSelectorInstance) return;
    const activeStyleId = describeStyleText(this.elements.styleInput?.value);
    if (activeStyleId === this._lastActiveStyleId) return;
    this._lastActiveStyleId = activeStyleId;
    this.styleSelectorInstance.update({ activeStyleId });
  }

  /**
   * Create the tab content HTML
   * This method generates the complete HTML structure for the tab
   */
  createTabContent(container) {
    const getId = (name) => this.getElementId(name);

    container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- Parameters Column -->
                <div class="lg:col-span-1 bg-white rounded-lg shadow p-6">
                    <h2 class="text-lg font-medium mb-1">${this.config.title}</h2>
                    <p class="text-sm text-gray-500 mb-4">${this.config.description}</p>

                    <!-- Model Selection -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Model</label>
                        <div id="${getId('model-selector-container')}"></div>
                    </div>

                    ${this.getImagePromptHTML()}

                    <!-- Prompt: two stacked fields sent as one string
                         (instructions + style sentence, joined verbatim).
                         Style chips write only the style field. -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">${this.getPromptLabel()}</label>
                        <div class="${promptFieldStyles.fieldGroup}">
                            <label for="${getId('prompt-input')}" class="${promptFieldStyles.fieldLabel}">Instructions</label>
                            <textarea id="${getId('prompt-input')}" rows="3" class="${promptFieldStyles.textarea}"
                                      placeholder="${this.getPromptPlaceholder()}"></textarea>
                            <label for="${getId('style-input')}" class="${promptFieldStyles.fieldLabel}">Style</label>
                            <div id="${getId('style-selector-container')}"></div>
                            <textarea id="${getId('style-input')}" rows="2" class="${promptFieldStyles.textarea}"
                                      placeholder="No style change, use instructions only"></textarea>
                        </div>
                    </div>

                    <!-- Image Dimensions -->
                    <div id="${getId('dimensions-group')}" class="mb-4 param-group">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Dimensions</label>
                        <!-- Orientation Selection -->
                        <div id="${getId('orientation-buttons')}" class="flex space-x-2 mb-3">
                            <button type="button" data-orientation="square" class="orientation-button flex-1 px-3 py-1 border border-gray-300 bg-white text-gray-700 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500">Square</button>
                            <button type="button" data-orientation="landscape" class="orientation-button flex-1 px-3 py-1 border border-gray-300 bg-white text-gray-700 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500">Landscape</button>
                            <button type="button" data-orientation="portrait" class="orientation-button flex-1 px-3 py-1 border border-indigo-500 bg-indigo-50 text-indigo-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 selected-orientation">Portrait</button>
                        </div>
                        <!-- Dimension Grid (Populated Dynamically) -->
                        <div id="${getId('dimensions-grid')}" class="grid grid-cols-3 sm:grid-cols-4 gap-2">
                            <!-- Dimension buttons will be added here by JS -->
                        </div>
                    </div>

                    <!-- Aspect Ratio (for Ultra model) -->
                    <div id="${getId('aspect-ratio-group')}" class="mb-4 param-group hidden">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Aspect Ratio</label>
                        <select id="${getId('aspect-ratio-selector')}" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="1:1">1:1 (Square)</option>
                            <option value="4:3">4:3</option>
                            <option value="16:9" selected>16:9</option>
                            <option value="21:9">21:9 (Ultra-wide)</option>
                            <option value="3:4">3:4</option>
                            <option value="9:16">9:16</option>
                            <option value="9:21">9:21</option>
                        </select>
                    </div>

                    <!-- Generate Button -->
                    <button id="${getId('generate-btn')}" class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 flex items-center justify-center gap-2">
                        <svg id="${getId('generate-spinner')}" class="hidden animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span id="${getId('generate-text')}">Generate Image</span>
                        <span class="inline-flex items-center rounded" style="background: rgba(0, 0, 0, 0.15); padding: 6px 8px; gap: 4px;">
                            <img src="/ui_assets/token-image.png" alt="Token" class="w-5 h-5" />
                            <span id="${getId('token-cost')}" class="text-sm font-medium">1</span>
                        </span>
                    </button>

                </div>

                <!-- Preview Column -->
                <div class="lg:col-span-2 bg-white rounded-lg shadow">
                    <div class="p-6 border-b border-gray-200">
                        <h2 class="text-lg font-medium">Preview</h2>
                    </div>
                    <div class="p-6 flex flex-col items-center justify-center min-h-[500px]" id="${getId('preview-container')}">
                        <div id="${getId('generation-placeholder')}" class="text-center text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <p>Your generated image will appear here</p>
                        </div>
                        <img id="${getId('preview-image')}" class="max-w-full max-h-[500px] hidden rounded-lg shadow-lg" alt="Generated image">
                        <div id="${getId('loading-indicator')}" class="hidden flex flex-col items-center w-full max-w-md">
                            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                            <div class="generator-rendering-content">
                                <div class="generator-progress-container">
                                    <div class="generator-progress-bar" id="${getId('generator-progress-bar')}" style="width: 0%;"></div>
                                    <div class="generator-progress-stripes"></div>
                                </div>
                                <span class="generator-progress-text" id="${getId('loading-text')}">Generating your image...</span>
                                <span class="generator-progress-text hidden" id="${getId('generator-overtime-text')}" style="margin-top: 4px; color: #fbbf24;">Generation taking longer than expected.</span>
                            </div>
                            <!-- Email when done. Hidden until the submit
                                 returns a jobId — mid-render it's the "you
                                 can close this tab" affordance. Toggling
                                 writes through to the job doc
                                 (setGenerationJobNotify); suppressed
                                 server-side if this tab is still open when
                                 the job finishes. -->
                            <label id="${getId('notify-email-row')}" class="hidden flex items-center gap-2 mt-4 text-sm text-gray-600 cursor-pointer select-none">
                                <input id="${getId('notify-email')}" type="checkbox" checked
                                    class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
                                Email me when my image is ready (you can close this tab)
                            </label>
                        </div>
                    </div>
                    <div class="px-6 pb-6">
                        <div class="flex flex-wrap justify-center gap-2 mt-4" id="${getId('action-buttons')}">
                            <button id="${getId('copy-params-btn')}" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Copy Parameters
                            </button>
                            <button id="${getId('open-image-btn')}" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Open Image
                            </button>
                            <button id="${getId('download-image-btn')}" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Download Image
                            </button>
                            <button id="${getId('copy-image-url-btn')}" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Copy Image URL
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    if (!this.elements.modelSelectorContainer) {
      console.error(
        'Generator Tab: Cannot set up event listeners, elements not found'
      );
      return;
    }

    // Model selector is now handled by React component
    // No need for manual event listener

    this.elements.generateBtn.addEventListener(
      'click',
      this.generateImage.bind(this)
    );

    // Keyboard shortcut for both prompt fields
    const generateOnCmdEnter = (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.elements.generateBtn.click();
      }
    };
    this.elements.promptInput.addEventListener('keydown', generateOnCmdEnter);
    this.elements.styleInput.addEventListener('keydown', generateOnCmdEnter);

    // Editing the style field clears (or restores) the chip highlight;
    // editing either field updates the default-vs-edited text tint
    this.elements.styleInput.addEventListener('input', () => {
      this.refreshStyleHighlight();
    });
    this.elements.promptInput.addEventListener('input', () => {
      this.updatePromptTint();
    });

    // Mid-render email opt-in writes through to the in-flight job doc
    this.elements.notifyEmail?.addEventListener('change', () => {
      this.syncJobNotify();
    });

    // Setup image prompt listeners (if applicable)
    if (this.config.showImagePromptUI) {
      this.setupSlider(
        this.elements.imagePromptStrength,
        this.elements.imagePromptStrengthValue
      );

      this.elements.imagePromptInput.addEventListener(
        'change',
        this.handleImagePromptUpload.bind(this)
      );

      ImageUploadUtils.setupDragAndDrop(
        this.elements.imagePromptUploadLabel,
        this.elements.imagePromptInput,
        (dataUrl, fileName) => {
          this.elements.imagePromptName.textContent = fileName;
          this.imagePromptData = dataUrl.split(',')[1];
          this.showImagePromptPreview(dataUrl);
          this.elements.imagePromptStrengthContainer.classList.add('hidden');
        }
      );

      if (this.elements.imagePromptClear) {
        this.elements.imagePromptClear.addEventListener(
          'click',
          this.clearImagePrompt.bind(this)
        );
      }
    }

    // Setup orientation and dimension listeners
    if (this.elements.orientationButtons) {
      this.elements.orientationButtons.addEventListener(
        'click',
        this.handleOrientationSelection.bind(this)
      );
    }

    if (this.elements.dimensionsGrid) {
      this.elements.dimensionsGrid.addEventListener(
        'click',
        this.handleDimensionSelection.bind(this)
      );
    }

    // Setup action buttons
    if (this.elements.openImageBtn) {
      this.elements.openImageBtn.addEventListener(
        'click',
        this.openImage.bind(this)
      );
    }

    if (this.elements.downloadImageBtn) {
      this.elements.downloadImageBtn.addEventListener(
        'click',
        this.downloadImage.bind(this)
      );
    }

    if (this.elements.copyImageUrlBtn) {
      this.elements.copyImageUrlBtn.addEventListener(
        'click',
        this.copyImageUrl.bind(this)
      );
    }

    if (this.elements.copyParamsBtn) {
      this.elements.copyParamsBtn.addEventListener(
        'click',
        this.copyParams.bind(this)
      );
    }
  }

  /**
   * Update dimension grid based on selected orientation
   */
  updateDimensionGrid(orientation) {
    if (
      !this.elements.dimensionsGrid ||
      !this.dimensionsByOrientation[orientation]
    ) {
      console.error(
        'Cannot update dimension grid for orientation:',
        orientation
      );
      return;
    }

    this.elements.dimensionsGrid.innerHTML = '';
    const dimensions = this.dimensionsByOrientation[orientation];
    let foundDefault = false;

    dimensions.forEach((dim) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.dimension = dim;
      button.textContent = dim;
      button.className =
        'dimension-button border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 px-2 py-1 rounded-md text-xs text-center focus:outline-none focus:ring-2 focus:ring-indigo-500';

      if (dim === this.selectedDimension) {
        button.classList.add(
          'selected-dimension',
          'border-indigo-500',
          'bg-indigo-50',
          'text-indigo-700'
        );
        button.classList.remove(
          'border-gray-300',
          'bg-white',
          'text-gray-700',
          'hover:bg-gray-50'
        );
        foundDefault = true;
      }

      this.elements.dimensionsGrid.appendChild(button);
    });

    if (!foundDefault && this.elements.dimensionsGrid.firstChild) {
      const firstButton = this.elements.dimensionsGrid.firstChild;
      firstButton.classList.add(
        'selected-dimension',
        'border-indigo-500',
        'bg-indigo-50',
        'text-indigo-700'
      );
      firstButton.classList.remove(
        'border-gray-300',
        'bg-white',
        'text-gray-700',
        'hover:bg-gray-50'
      );
      this.selectedDimension = firstButton.dataset.dimension;
    }
  }

  /**
   * Update model parameters based on selected model
   */
  updateModelParams() {
    const model = this.selectedModel;

    // Update token cost display based on selected model
    const modelConfig = REPLICATE_MODELS[model];
    if (modelConfig && this.elements.tokenCost) {
      this.elements.tokenCost.textContent = modelConfig.tokenCost || 1;
    } else if (this.elements.tokenCost) {
      // Default to 1 for non-Replicate models
      this.elements.tokenCost.textContent = 1;
    }

    // Keep the source-image `*` in sync: red when this model requires an image.
    this.updateSourceImageIndicator();

    // Default visibility states. All current models take a fixed size and
    // sampler settings server-side, so the per-model tuning UI (steps,
    // guidance, seed, …) is gone entirely; only dimensions/aspect-ratio
    // remain, for a future model that accepts them.
    let showDimensions = true;
    let showAspectRatio = false;
    let showImagePrompt = this.config.showImagePromptUI;

    if (this.config.showImagePromptUI) {
      this.elements.imagePromptStrengthContainer.classList.add('hidden');
    }

    switch (model) {
      case 'nano-banana-pro':
      case 'nano-banana-2':
      case 'seedream-4.5':
      case 'fal-flux-2-max-edit':
      case 'fal-flux-2-pro-edit':
        // These endpoints ignore dimensions (a fixed image_size is sent).
        showDimensions = false;
        showAspectRatio = false;
        break;
    }

    // Apply visibility
    this.elements.dimensionsGroup.classList.toggle('hidden', !showDimensions);
    this.elements.aspectRatioGroup.classList.toggle('hidden', !showAspectRatio);

    if (this.config.showImagePromptUI) {
      this.elements.imagePromptGroup.classList.toggle(
        'hidden',
        !showImagePrompt
      );
    }
    if (showDimensions) {
      this.updateDimensionGrid(this.selectedOrientation);
    }
  }

  /**
   * Handle orientation button selection
   */
  handleOrientationSelection(e) {
    if (e.target.classList.contains('orientation-button')) {
      const selectedButton = e.target;
      const orientation = selectedButton.dataset.orientation;

      if (orientation === this.selectedOrientation) return;

      this.selectedOrientation = orientation;

      this.elements.orientationButtons
        .querySelectorAll('.orientation-button')
        .forEach((btn) => {
          btn.classList.remove(
            'selected-orientation',
            'border-indigo-500',
            'bg-indigo-50',
            'text-indigo-700'
          );
          btn.classList.add(
            'border-gray-300',
            'bg-white',
            'text-gray-700',
            'hover:bg-gray-50'
          );
        });

      selectedButton.classList.add(
        'selected-orientation',
        'border-indigo-500',
        'bg-indigo-50',
        'text-indigo-700'
      );
      selectedButton.classList.remove(
        'border-gray-300',
        'bg-white',
        'text-gray-700',
        'hover:bg-gray-50'
      );

      this.updateDimensionGrid(orientation);
    }
  }

  /**
   * Handle dimension button selection
   */
  handleDimensionSelection(e) {
    const selectedButton = e.target.closest('.dimension-button');
    if (
      selectedButton &&
      this.elements.dimensionsGrid.contains(selectedButton)
    ) {
      const dimension = selectedButton.dataset.dimension;

      if (dimension === this.selectedDimension) return;

      this.selectedDimension = dimension;

      this.elements.dimensionsGrid
        .querySelectorAll('.dimension-button')
        .forEach((btn) => {
          btn.classList.remove(
            'selected-dimension',
            'border-indigo-500',
            'bg-indigo-50',
            'text-indigo-700'
          );
          btn.classList.add(
            'border-gray-300',
            'bg-white',
            'text-gray-700',
            'hover:bg-gray-50'
          );
        });

      selectedButton.classList.add(
        'selected-dimension',
        'border-indigo-500',
        'bg-indigo-50',
        'text-indigo-700'
      );
      selectedButton.classList.remove(
        'border-gray-300',
        'bg-white',
        'text-gray-700',
        'hover:bg-gray-50'
      );
    }
  }

  /**
   * Setup range sliders
   */
  setupSlider(slider, valueDisplay) {
    if (slider && valueDisplay) {
      slider.addEventListener('input', () => {
        valueDisplay.textContent = slider.value;
      });
    }
  }

  /**
   * Handle image prompt file upload
   */
  handleImagePromptUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    this.elements.imagePromptName.textContent = file.name;

    const reader = new FileReader();
    reader.onload = (event) => {
      this.imagePromptData = event.target.result.split(',')[1];
      this.showImagePromptPreview(event.target.result);
      this.elements.imagePromptStrengthContainer.classList.add('hidden');
    };
    reader.readAsDataURL(file);
  }

  /**
   * Set image prompt from gallery or other source
   */
  setImagePrompt(imageDataUrl, imageName = 'From Gallery') {
    this.imagePromptData = imageDataUrl.split(',')[1];
    if (this.elements.imagePromptName) {
      this.elements.imagePromptName.textContent = imageName;
    }

    this.showImagePromptPreview(imageDataUrl);

    if (this.config.showImagePromptUI) {
      this.elements.imagePromptStrengthContainer.classList.add('hidden');
    }
  }

  /**
   * Show image prompt preview
   */
  showImagePromptPreview(imageDataUrl) {
    if (
      !this.elements.imagePromptPreview ||
      !this.elements.imagePromptPreviewContainer ||
      !this.elements.imagePromptUploadLabel
    ) {
      return;
    }

    this.elements.imagePromptPreview.src = imageDataUrl;
    this.elements.imagePromptUploadLabel.classList.add('hidden');
    this.elements.imagePromptPreviewContainer.classList.remove('hidden');

    // An image is now present, so clear any lingering "add it here" hint.
    this.removeReferenceImageArrow();
  }

  /**
   * Clear image prompt
   */
  clearImagePrompt() {
    this.imagePromptData = null;

    if (this.elements.imagePromptPreview) {
      this.elements.imagePromptPreview.src = '';
    }
    if (this.elements.imagePromptName) {
      this.elements.imagePromptName.textContent = 'No file selected';
    }
    if (this.elements.imagePromptInput) {
      this.elements.imagePromptInput.value = '';
    }

    if (this.elements.imagePromptPreviewContainer) {
      this.elements.imagePromptPreviewContainer.classList.add('hidden');
    }
    if (this.elements.imagePromptUploadLabel) {
      this.elements.imagePromptUploadLabel.classList.remove('hidden');
    }

    if (this.elements.imagePromptStrengthContainer) {
      this.elements.imagePromptStrengthContainer.classList.add('hidden');
    }
  }

  /**
   * Validate generation parameters
   * Override this method in subclasses for custom validation
   */
  validateGeneration() {
    // Check authentication
    if (!window.authState || !window.authState.isAuthenticated) {
      useImageGenStore.getState().setModal('signin');
      return false;
    }

    // Check tokens
    const hasTokens = window.authState.tokenProfile?.genToken > 0;
    if (!hasTokens) {
      window.dispatchEvent(
        new CustomEvent('openPurchaseModal', {
          detail: { tokenType: 'genToken' }
        })
      );
      return false;
    }

    // Explicit prompts only: the two visible fields are the whole prompt,
    // with no hidden fallback, so an all-empty prompt has nothing to send.
    const prompt = composePrompt({
      instructions: this.elements.promptInput.value,
      style: this.elements.styleInput.value
    });
    if (!prompt) {
      FluxUI.showNotification(
        'Add instructions or pick a style to generate an image.',
        'error'
      );
      return false;
    }

    // Check source image requirement (tab-level or, on the Image tab,
    // model-level). Some models cannot run without a source image, so deny
    // hard at the client; there is no "generate anyway" bypass for these.
    if (this.sourceImageRequired() && !this.imagePromptData) {
      FluxUI.showNotification(
        'This model requires a source image. Please upload one to continue.',
        'error'
      );
      this.showReferenceImageArrow();
      return false;
    }

    return true;
  }

  /**
   * Generate an image
   */
  async generateImage() {
    // Validate before proceeding
    if (!this.validateGeneration()) {
      return;
    }

    // Optional-source-image tab: coax the user toward a reference image, but
    // let them proceed text-only via the nudge's "Generate anyway".
    if (
      this.config.optionalSourceImage &&
      !this.imagePromptData &&
      !this._proceedWithoutImage
    ) {
      this.showImageNudge();
      return;
    }
    this._proceedWithoutImage = false;

    const model = this.selectedModel;
    const modelConfig = REPLICATE_MODELS[model];

    // Check if this is a fal.ai model
    if (modelConfig && modelConfig.type === 'fal') {
      this.generateFalImage(model);
      return;
    }

    // Check if this is a Replicate model
    if (modelConfig && modelConfig.type === 'replicate') {
      this.generateReplicateImage(model);
      return;
    }

    FluxUI.showNotification('Invalid model selected', 'error');
  }

  /**
   * Empty-image nudge dialog (#1767): recommend a reference image without
   * disparaging text-only generation, with a proceed-anyway escape hatch.
   */
  showImageNudge() {
    const existing = document.getElementById('image-nudge-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'image-nudge-modal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content" style="max-width: 440px; padding: 1.5rem;">
        <h3 style="font-size: 1.125rem; font-weight: 600; margin-bottom: 0.5rem;">Add a reference image for better results</h3>
        <p style="font-size: 0.875rem; line-height: 1.55; color: #9ca3af; margin-bottom: 1.5rem;">
          A photo or reference image gives the AI real-world structure to match, producing far more accurate, usable results. Text-only generation works, but results are rougher and best for quick concepts.
        </p>
        <div style="display: flex; justify-content: flex-end; gap: 0.75rem;">
          <button id="image-nudge-generate" style="padding: 0.5rem 1rem; border: 1px solid #4b5563; background: transparent; color: #e5e7eb; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 500; cursor: pointer;">
            Generate anyway
          </button>
          <button id="image-nudge-goback" style="padding: 0.5rem 1rem; border: none; background: #4f46e5; color: #fff; border-radius: 0.375rem; font-size: 0.875rem; font-weight: 500; cursor: pointer;">
            Go back
          </button>
        </div>
      </div>
    `;

    const close = () => modal.remove();

    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    // "Go back" simply dismisses the dialog and points an arrow at the
    // reference-image upload area; it does not open the file chooser.
    modal.querySelector('#image-nudge-goback').addEventListener('click', () => {
      close();
      this.showReferenceImageArrow();
    });

    modal
      .querySelector('#image-nudge-generate')
      .addEventListener('click', () => {
        close();
        this._proceedWithoutImage = true;
        this.generateImage();
      });

    document.body.appendChild(modal);
  }

  /**
   * Point a left-facing arrow at the reference-image upload area so the user
   * knows where to add an image after dismissing the nudge. Auto-removes on a
   * timer or once an image is added.
   */
  showReferenceImageArrow() {
    this.removeReferenceImageArrow();

    const group = this.elements.imagePromptGroup;
    const label = this.elements.imagePromptUploadLabel;
    if (!group || !label) return;

    if (!document.getElementById('ref-arrow-style')) {
      const style = document.createElement('style');
      style.id = 'ref-arrow-style';
      style.textContent =
        '@keyframes ref-arrow-nudge{0%,100%{transform:translateY(-50%) translateX(0);}50%{transform:translateY(-50%) translateX(-7px);}}';
      document.head.appendChild(style);
    }

    group.style.position = 'relative';
    label.style.boxShadow = '0 0 0 2px #F5A623';
    label.style.borderColor = '#F5A623';

    const arrow = document.createElement('div');
    arrow.id = 'reference-image-arrow';
    arrow.style.cssText = `position:absolute;left:100%;top:${
      label.offsetTop + label.offsetHeight / 2
    }px;margin-left:0.5rem;display:flex;align-items:center;gap:0.375rem;color:#F5A623;font-size:0.8125rem;font-weight:600;white-space:nowrap;pointer-events:none;z-index:20;animation:ref-arrow-nudge 1s ease-in-out infinite;`;
    arrow.innerHTML = `
      <svg width="30" height="20" viewBox="0 0 30 20" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink:0;">
        <path d="M29 10H3M3 10L11 3M3 10L11 17" stroke="#F5A623" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>Add image here</span>
    `;
    group.appendChild(arrow);

    this._refArrowTimer = setTimeout(
      () => this.removeReferenceImageArrow(),
      8000
    );
  }

  removeReferenceImageArrow() {
    if (this._refArrowTimer) {
      clearTimeout(this._refArrowTimer);
      this._refArrowTimer = null;
    }
    const arrow = document.getElementById('reference-image-arrow');
    if (arrow) arrow.remove();
    const label = this.elements.imagePromptUploadLabel;
    if (label) {
      label.style.boxShadow = '';
      label.style.borderColor = '';
    }
  }

  /**
   * Refresh the source-image `*` color/tooltip for the current model: red when
   * the model requires an image, amber when it is only recommended.
   */
  updateSourceImageIndicator() {
    const el = document.getElementById('source-image-indicator');
    if (!el) return;
    const required = this.sourceImageRequired();
    el.style.color = required ? '#ef4444' : '#F5A623';
    el.title = required
      ? 'Required for this model'
      : 'Recommended for better results';
  }

  /**
   * Convert image to JPEG with specified quality
   */
  convertToJpeg(dataUrl, quality = 0.9) {
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
  }

  /**
   * Prepare the source image (if any) for submission: normalize to a data URL
   * and re-encode as JPEG at 90% quality to reduce upload time.
   */
  async prepareInputImage() {
    if (!this.imagePromptData) return null;

    let inputImageSrc = this.imagePromptData.startsWith('data:')
      ? this.imagePromptData
      : `data:image/jpeg;base64,${this.imagePromptData}`;

    if (inputImageSrc.startsWith('data:image/')) {
      try {
        inputImageSrc = await this.convertToJpeg(inputImageSrc, 0.9);
      } catch (error) {
        console.warn('Failed to convert to JPEG, using original:', error);
      }
    }
    return inputImageSrc;
  }

  /**
   * Generate image using Replicate API.
   *
   * Async, browser-independent flow since #1835 (mirrors video.js):
   * generateReplicateImage creates a generation job (with a webhook) and
   * returns its jobId immediately instead of holding the callable connection
   * open for the whole render. The server saves the finished image to the
   * gallery; this UI polls getGenerationJobStatus only to reflect progress
   * and show the result while open.
   */
  async generateReplicateImage(model) {
    const modelConfig = REPLICATE_MODELS[model];
    if (!modelConfig) {
      FluxUI.showNotification('Invalid model selected', 'error');
      return;
    }

    // Tab-level source-image requirement (legacy tabs)
    if (this.config.requiresSourceImage && !this.imagePromptData) {
      FluxUI.showNotification(
        'Source image is required for this model',
        'error'
      );
      return;
    }

    this.stopPolling();
    this.toggleLoading(true);
    this.startTimer(model);

    try {
      const generateReplicateImage = httpsCallable(
        functions,
        'generateReplicateImage',
        {
          // Submit-and-return; the render itself is async.
          timeout: 120000
        }
      );

      // The two visible fields are the whole prompt, joined verbatim — no
      // hidden fallback (validateGeneration rejects an all-empty prompt).
      const prompt = composePrompt({
        instructions: this.elements.promptInput.value,
        style: this.elements.styleInput.value
      });
      const promptStyle = describeStyleText(this.elements.styleInput.value);
      const inputImageSrc = await this.prepareInputImage();

      const result = await generateReplicateImage({
        prompt: prompt,
        input_image: inputImageSrc,
        guidance: 2.5,
        num_inference_steps: 30,
        model_version: modelConfig.version,
        model_id: model,
        scene_id: null,
        source: 'generator',
        // The gallery save happens server-side (#1835); ride the style label
        // on the job doc so it lands in the saved asset's metadata.
        gallery_metadata: { renderStyle: promptStyle },
        // Opt-in completion email, recorded on the job doc. The server only
        // sends it if this tab isn't around to ack the result (i.e. closed).
        notify: { email: !!this.elements.notifyEmail?.checked }
      });

      this.onImageJobSubmitted(result, model, modelConfig, prompt, promptStyle);
    } catch (error) {
      console.error('Error generating Replicate image:', error);
      this.handleGenerationError(error);
    }
  }

  /**
   * Generate image using fal.ai API. Same async job flow as
   * generateReplicateImage above — only the submit callable and its
   * model-specific parameters differ.
   */
  async generateFalImage(model) {
    const modelConfig = REPLICATE_MODELS[model];
    if (!modelConfig) {
      FluxUI.showNotification('Invalid model selected', 'error');
      return;
    }

    // Tab-level source-image requirement (legacy tabs)
    if (this.config.requiresSourceImage && !this.imagePromptData) {
      FluxUI.showNotification(
        'Source image is required for this model',
        'error'
      );
      return;
    }

    this.stopPolling();
    this.toggleLoading(true);
    this.startTimer(model);

    try {
      const generateFalImage = httpsCallable(functions, 'generateFalImage', {
        // Submit-and-return; the render itself is async.
        timeout: 120000
      });

      // The two visible fields are the whole prompt, joined verbatim — no
      // hidden fallback (validateGeneration rejects an all-empty prompt).
      const prompt = composePrompt({
        instructions: this.elements.promptInput.value,
        style: this.elements.styleInput.value
      });
      const promptStyle = describeStyleText(this.elements.styleInput.value);
      const inputImageSrc = await this.prepareInputImage();

      const result = await generateFalImage({
        prompt: prompt,
        input_image: inputImageSrc,
        model_id: model,
        image_size: { width: 1600, height: 900 }, // Max resolution (2048 limit per dimension)
        guidance_scale: 2.5,
        num_inference_steps: 28,
        scene_id: null,
        source: 'generator',
        // The gallery save happens server-side (#1835); ride the style label
        // on the job doc so it lands in the saved asset's metadata.
        gallery_metadata: { renderStyle: promptStyle },
        notify: { email: !!this.elements.notifyEmail?.checked }
      });

      this.onImageJobSubmitted(result, model, modelConfig, prompt, promptStyle);
    } catch (error) {
      console.error('Error generating fal.ai image:', error);
      this.handleGenerationError(error);
    }
  }

  /**
   * Shared post-submit handling: tokens are charged at submit (refunded on
   * failure), so reflect that immediately, record the funnel events, and
   * start the status poll that drives this tab's live UI. The job also shows
   * as a pending card in the assets sidebar via the live Firestore listener
   * on the job doc.
   */
  onImageJobSubmitted(result, model, modelConfig, prompt, promptStyle) {
    if (!result.data || !result.data.success || !result.data.jobId) {
      throw new Error(
        result.data?.message || 'Could not start image generation'
      );
    }

    this.currentParams = {
      model: model,
      model_name: modelConfig.name,
      prompt: prompt,
      render_style: promptStyle,
      timestamp: new Date().toISOString()
    };
    // Remembered for the success toast once the poll sees the job finish.
    this.lastRemainingTokens = result.data.remainingTokens;

    // The job is now really in flight — this is the moment the email opt-in
    // becomes meaningful (check it, close the tab, get the result by email).
    this.activeJobId = result.data.jobId;
    this.elements.notifyEmailRow?.classList.remove('hidden');

    window.dispatchEvent(new CustomEvent('tokenCountChanged'));

    // Funnel event: ai_render_used (for conversion funnel analysis)
    posthog.capture('ai_render_used', {
      token_type: 'gen',
      model: model,
      render_style: promptStyle,
      source: 'generator',
      is_pro_user: window.authState?.currentUser?.isPro || false
    });

    // Check if user just used their last gen token (track token_limit_reached)
    if (
      result.data.remainingTokens !== undefined &&
      result.data.remainingTokens === 0
    ) {
      posthog.capture('token_limit_reached', {
        token_type: 'gen',
        source: 'generator'
      });
    }

    this.pollDeadline = Date.now() + this.POLL_MAX_MS;
    this.pollImageStatus(result.data.jobId, modelConfig);
  }

  /**
   * Poll getGenerationJobStatus until the job is terminal. Re-schedules itself
   * with setTimeout (not setInterval) so a slow request can't overlap the next
   * tick. Any non-terminal status (queued|running|saving) just keeps polling.
   */
  async pollImageStatus(jobId, modelConfig) {
    const getGenerationJobStatus = httpsCallable(
      functions,
      'getGenerationJobStatus'
    );

    try {
      const { data } = await getGenerationJobStatus({ jobId });

      if (data.status === 'succeeded' && data.image_url) {
        // The image was saved to the gallery server-side (works even if this
        // tab had been closed). Just show it and refresh the gallery island so
        // the pending-job card hands its slot to the real asset.
        this.currentImageUrl = data.image_url;
        this.displayImage(data.image_url);
        this.stopTimer();
        this.toggleLoading(false);
        window.dispatchEvent(new Event('assets:refresh'));
        window.dispatchEvent(new CustomEvent('tokenCountChanged'));
        const remaining = this.lastRemainingTokens;
        FluxUI.showNotification(
          remaining !== undefined
            ? `Image generated and saved to your gallery! ${remaining} gen tokens remaining. (${modelConfig.name})`
            : `Image generated and saved to your gallery! (${modelConfig.name})`,
          'success'
        );
        return;
      }

      if (data.status === 'failed' || data.status === 'canceled') {
        // The server refunds on failure; refresh the displayed balance.
        window.dispatchEvent(new CustomEvent('tokenCountChanged'));
        this.stopTimer();
        this.toggleLoading(false);
        FluxUI.showNotification(
          data.error
            ? `Image generation failed: ${data.error}`
            : 'Image generation failed. Your tokens were refunded.',
          'error'
        );
        return;
      }

      // Still queued/running/saving — keep polling until the deadline.
      if (Date.now() > this.pollDeadline) {
        this.stopTimer();
        this.toggleLoading(false);
        FluxUI.showNotification(
          'Image generation is taking longer than expected. Check your gallery shortly — it will appear there when finished.',
          'error'
        );
        return;
      }
      this.pollTimeout = setTimeout(
        () => this.pollImageStatus(jobId, modelConfig),
        this.POLL_INTERVAL_MS
      );
    } catch (error) {
      console.error('Error polling image status:', error);
      // Transient poll error — retry until the deadline rather than failing
      // hard; the job is unaffected server-side.
      if (Date.now() > this.pollDeadline) {
        this.stopTimer();
        this.toggleLoading(false);
        FluxUI.showNotification(
          'Lost track of the image job. Check your gallery shortly — it will appear there when finished.',
          'error'
        );
        return;
      }
      this.pollTimeout = setTimeout(
        () => this.pollImageStatus(jobId, modelConfig),
        this.POLL_INTERVAL_MS
      );
    }
  }

  syncJobNotify() {
    syncJobNotifyEmail(this.activeJobId, this.elements.notifyEmail);
  }

  stopPolling() {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  }

  /**
   * Shared submit-failure handling (validation, auth, insufficient tokens…).
   */
  handleGenerationError(error) {
    this.stopTimer();

    let errorMessage = 'Failed to generate image';
    if (error.code === 'unauthenticated') {
      errorMessage = 'Please sign in to use image generation';
    } else if (error.code === 'resource-exhausted') {
      errorMessage =
        'No tokens available. Please purchase more tokens or upgrade to Pro.';
    } else if (error.message) {
      errorMessage = error.message;
    }

    FluxUI.showNotification(errorMessage, 'error');
    this.toggleLoading(false);
  }

  /**
   * Get selected dimension
   */
  getSelectedDimension() {
    const currentValidDimensions =
      this.dimensionsByOrientation[this.selectedOrientation];
    if (
      currentValidDimensions &&
      currentValidDimensions.includes(this.selectedDimension)
    ) {
      return this.selectedDimension;
    } else if (currentValidDimensions && currentValidDimensions.length > 0) {
      this.selectedDimension = currentValidDimensions[0];
      this.updateDimensionGrid(this.selectedOrientation);
      return this.selectedDimension;
    } else {
      console.error(
        `No valid dimensions found for orientation ${this.selectedOrientation}. Falling back to default.`
      );
      return '1024x768';
    }
  }

  /**
   * Display the generated image
   */
  displayImage(imageUrl) {
    this.elements.previewImage.src = imageUrl;
    this.elements.previewImage.classList.remove('hidden');
    this.elements.generationPlaceholder.classList.add('hidden');

    this.elements.copyParamsBtn.classList.remove('hidden');
    this.elements.openImageBtn.classList.remove('hidden');
    this.elements.downloadImageBtn.classList.remove('hidden');
    this.elements.copyImageUrlBtn.classList.remove('hidden');

    this.elements.previewImage.onerror = () => {
      console.error(
        'Failed to load image through proxy. Creating direct link instead.'
      );

      const fallbackButton = document.createElement('div');
      fallbackButton.className = 'text-center mt-4';
      fallbackButton.innerHTML = `
                <p class="mb-2 text-sm text-gray-600">Unable to display image directly:</p>
                <a href="${this.currentImageUrl}" target="_blank" class="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700">
                    Open Image in New Tab
                </a>
            `;

      this.elements.previewImage.classList.add('hidden');

      const existingFallback =
        this.elements.previewContainer.querySelector('.text-center.mt-4');
      if (existingFallback) {
        this.elements.previewContainer.removeChild(existingFallback);
      }

      this.elements.previewContainer.appendChild(fallbackButton);
    };
  }

  /**
   * Toggle loading state
   */
  toggleLoading(isLoading) {
    if (isLoading) {
      this.elements.loadingIndicator.classList.remove('hidden');
      this.elements.generationPlaceholder.classList.add('hidden');
      this.elements.previewImage.classList.add('hidden');
      this.elements.generateBtn.disabled = true;
      this.elements.generateBtn.classList.add(
        'opacity-50',
        'cursor-not-allowed'
      );

      if (this.elements.generateSpinner) {
        this.elements.generateSpinner.classList.remove('hidden');
      }
      if (this.elements.generateText) {
        this.elements.generateText.textContent = 'Generating...';
      }

      this.elements.copyParamsBtn.classList.add('hidden');
      this.elements.openImageBtn.classList.add('hidden');
      this.elements.downloadImageBtn.classList.add('hidden');
      this.elements.copyImageUrlBtn.classList.add('hidden');

      const fallbackButton =
        this.elements.previewContainer.querySelector('.text-center.mt-4');
      if (fallbackButton) {
        this.elements.previewContainer.removeChild(fallbackButton);
      }
    } else {
      // Terminal (or reset): the email toggle only applies to an in-flight
      // job, so it leaves with the loading state.
      this.activeJobId = null;
      this.elements.notifyEmailRow?.classList.add('hidden');
      this.elements.loadingIndicator.classList.add('hidden');
      this.elements.generateBtn.disabled = false;
      this.elements.generateBtn.classList.remove(
        'opacity-50',
        'cursor-not-allowed'
      );

      if (this.elements.generateSpinner) {
        this.elements.generateSpinner.classList.add('hidden');
      }
      if (this.elements.generateText) {
        this.elements.generateText.textContent = 'Generate Image';
      }
    }
  }

  /**
   * Open the image in a new tab
   */
  openImage() {
    if (!this.currentImageUrl) {
      FluxUI.showNotification('No image to open', 'error');
      return;
    }
    window.open(this.currentImageUrl, '_blank');
    FluxUI.showNotification('Image opened in new tab!', 'success');
  }

  /**
   * Download the image
   */
  downloadImage() {
    if (!this.currentImageUrl) {
      FluxUI.showNotification('No image to download', 'error');
      return;
    }

    fetch(this.currentImageUrl)
      .then((response) => response.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const downloadLink = document.createElement('a');
        downloadLink.href = blobUrl;

        const modelName = this.selectedModel.replace('flux-', '');
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, '-')
          .slice(0, 19);
        // All image endpoints return JPEG (hardcoded server-side)
        const filename = `flux-${modelName}-${timestamp}.jpg`;

        downloadLink.download = filename;
        document.body.appendChild(downloadLink);
        downloadLink.click();

        setTimeout(() => {
          document.body.removeChild(downloadLink);
          URL.revokeObjectURL(blobUrl);
        }, 100);

        FluxUI.showNotification('Image download started!', 'success');
      })
      .catch((error) => {
        console.error('Error downloading image:', error);
        FluxUI.showNotification(
          'Failed to download image: ' + error.message,
          'error'
        );
      });
  }

  /**
   * Copy the image URL to clipboard
   */
  copyImageUrl() {
    if (!this.currentImageUrl) {
      FluxUI.showNotification('No image URL to copy', 'error');
      return;
    }
    navigator.clipboard
      .writeText(this.currentImageUrl)
      .then(() => {
        FluxUI.showNotification('Image URL copied to clipboard!', 'success');
      })
      .catch((err) => {
        FluxUI.showNotification('Failed to copy URL: ' + err.message, 'error');
      });
  }

  /**
   * Copy parameters to clipboard
   */
  copyParams() {
    if (Object.keys(this.currentParams).length === 0) {
      FluxUI.showNotification('No parameters to copy', 'error');
      return;
    }

    const paramsToCopy = { ...this.currentParams };
    paramsToCopy.model = this.currentParams.model || this.selectedModel;

    const paramsString = JSON.stringify(paramsToCopy, null, 2);
    navigator.clipboard
      .writeText(paramsString)
      .then(() => {
        FluxUI.showNotification('Parameters copied to clipboard!', 'success');
      })
      .catch((err) => {
        FluxUI.showNotification(
          'Failed to copy parameters: ' + err.message,
          'error'
        );
      });
  }

  // NOTE: the old client-side saveToGallery was removed — the image is now
  // persisted to the gallery server-side by the generation job's terminal
  // processor (public/functions/replicate.js:saveImageToGallery), so it saves
  // even if this tab is closed mid-render (#1835).

  /**
   * Start the timer
   */
  startTimer(modelName) {
    this.renderStartTime = Date.now();
    this.elapsedTime = 0;
    this.updateTimerDisplay();

    this.timerInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - this.renderStartTime) / 1000);
      this.elapsedTime = elapsed;
      this.updateTimerDisplay();
    }, 1000);
  }

  /**
   * Stop the timer
   */
  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.renderStartTime = null;
    this.elapsedTime = 0;
    this.renderProgress = 0;

    if (this.elements.progressBar) {
      this.elements.progressBar.style.width = '0%';
    }

    if (this.elements.overtimeText) {
      this.elements.overtimeText.classList.add('hidden');
    }
  }

  /**
   * Update timer display
   */
  updateTimerDisplay() {
    const modelName = this.selectedModel;
    const estimatedTime = this.estimatedTimes[modelName] || 30;

    this.renderProgress = Math.min(
      (this.elapsedTime / estimatedTime) * 100,
      100
    );

    if (this.elements.progressBar) {
      this.elements.progressBar.style.width = `${this.renderProgress}%`;
    }

    this.elements.loadingText.textContent = `${this.elapsedTime}s/${estimatedTime}s`;

    if (this.elements.overtimeText) {
      if (this.elapsedTime > estimatedTime + 10) {
        this.elements.overtimeText.classList.remove('hidden');
      } else {
        this.elements.overtimeText.classList.add('hidden');
      }
    }
  }
}

export default GeneratorTabBase;
