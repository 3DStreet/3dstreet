/**
 * Generator Tab Base Class
 * Shared functionality for Create and Modify tabs
 */

import FluxUI from './main.js';
import FluxAPI from './api.js';
import { galleryService } from './mount-gallery.js';
import useImageGenStore from './store.js';
import ImageUploadUtils from './image-upload-utils.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@shared/services/firebase.js';

// Replicate AI model configurations
const REPLICATE_MODELS = {
  'kontext-realearth': {
    name: 'Kontext Real Earth',
    version: '2af4da47bcb7b55a0705b0de9933701f7607531d763ae889241f827a648c1755',
    prompt: 'Transform satellite image into high-quality drone shot'
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
      requiresPrompt: config.requiresPrompt || false,
      showImagePromptUI: config.showImagePromptUI || false,
      defaultPrompt: config.defaultPrompt || null,
      title: config.title || 'Image Generator',
      description: config.description || 'Generate images with AI'
    };

    // Tab state
    this.imagePromptData = null;
    this.currentParams = {};
    this.currentImageUrl = '';
    this.selectedOrientation = 'portrait';
    this.selectedDimension = '1024x1440';

    // Timer state
    this.renderStartTime = null;
    this.elapsedTime = 0;
    this.renderProgress = 0;
    this.timerInterval = null;

    // Estimated generation times for Replicate models (in seconds)
    this.estimatedTimes = {
      'kontext-realearth': 25,
      'nano-banana': 20,
      'seedream-4': 25
    };

    // DOM Elements
    this.elements = {};
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
    this.updateModelParams();
    this.setupEventListeners();
    this.generateRandomSeed();

    // Register this module with the main UI
    FluxUI.tabModules[this.config.tabType] = this;

    this.checkForPendingGalleryItem();
  }

  /**
   * Check for pending gallery item from cross-app communication
   */
  checkForPendingGalleryItem() {
    try {
      const pendingItemJson = localStorage.getItem('pendingGalleryItem');
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

        localStorage.removeItem('pendingGalleryItem');
      }
    } catch (error) {
      console.error('Failed to load pending gallery item:', error);
      localStorage.removeItem('pendingGalleryItem');
    }
  }

  /**
   * Get all DOM elements after content is created
   */
  getElements() {
    const getId = (name) => this.getElementId(name);

    // Model Selection
    this.elements.modelSelector = document.getElementById(
      getId('model-selector')
    );

    // Prompt and dimensions
    this.elements.promptInput = document.getElementById(getId('prompt-input'));
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

    // Parameters
    this.elements.stepsSlider = document.getElementById(getId('steps-slider'));
    this.elements.stepsValue = document.getElementById(getId('steps-value'));
    this.elements.guidanceSlider = document.getElementById(
      getId('guidance-slider')
    );
    this.elements.guidanceValue = document.getElementById(
      getId('guidance-value')
    );
    this.elements.safetySlider = document.getElementById(
      getId('safety-slider')
    );
    this.elements.safetyValue = document.getElementById(getId('safety-value'));
    this.elements.seedInput = document.getElementById(getId('seed-input'));
    this.elements.randomSeedBtn = document.getElementById(
      getId('random-seed-btn')
    );
    this.elements.randomizeSeedCheckbox = document.getElementById(
      getId('randomize-seed-checkbox')
    );
    this.elements.promptUpsampling = document.getElementById(
      getId('prompt-upsampling')
    );
    this.elements.rawMode = document.getElementById(getId('raw-mode'));
    this.elements.intervalSlider = document.getElementById(
      getId('interval-slider')
    );
    this.elements.intervalValue = document.getElementById(
      getId('interval-value')
    );
    this.elements.formatJpeg = document.getElementById(getId('format-jpeg'));
    this.elements.formatPng = document.getElementById(getId('format-png'));

    // Image prompt (if applicable)
    if (this.config.showImagePromptUI) {
      this.elements.imagePromptInput =
        document.getElementById('image-prompt-input');
      this.elements.imagePromptName =
        document.getElementById('image-prompt-name');
      this.elements.imagePromptUploadLabel = document.getElementById(
        'image-prompt-upload-label'
      );
      this.elements.imagePromptPreviewContainer = document.getElementById(
        'image-prompt-preview-container'
      );
      this.elements.imagePromptPreview = document.getElementById(
        'image-prompt-preview'
      );
      this.elements.imagePromptClear =
        document.getElementById('image-prompt-clear');
      this.elements.imagePromptStrength = document.getElementById(
        'image-prompt-strength'
      );
      this.elements.imagePromptStrengthValue = document.getElementById(
        'image-prompt-strength-value'
      );
      this.elements.imagePromptStrengthContainer = document.getElementById(
        'image-prompt-strength-container'
      );
    }

    // Groups
    this.elements.dimensionsGroup = document.getElementById(
      getId('dimensions-group')
    );
    this.elements.aspectRatioGroup = document.getElementById(
      getId('aspect-ratio-group')
    );
    this.elements.stepsGroup = document.getElementById(getId('steps-group'));
    this.elements.guidanceGroup = document.getElementById(
      getId('guidance-group')
    );
    if (this.config.showImagePromptUI) {
      this.elements.imagePromptGroup =
        document.getElementById('image-prompt-group');
    }
    this.elements.rawModeGroup = document.getElementById(
      getId('raw-mode-group')
    );
    this.elements.intervalGroup = document.getElementById(
      getId('interval-group')
    );
    this.elements.promptUpsamplingGroup = document.getElementById(
      getId('prompt-upsampling-group')
    );
    this.elements.safetyGroup = document.getElementById(getId('safety-group'));
    this.elements.seedGroup = document.getElementById(getId('seed-group'));

    // Advanced options
    this.elements.advancedToggle = document.getElementById(
      getId('advanced-toggle')
    );
    this.elements.advancedOptions = document.getElementById(
      getId('advanced-options')
    );
    this.elements.advancedIcon = document.getElementById(
      getId('advanced-icon')
    );

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

    // Verify critical elements
    const missingElements = [];
    ['modelSelector', 'promptInput', 'generateBtn'].forEach((elem) => {
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
   * Generate HTML for image prompt section (for modify tab)
   */
  getImagePromptHTML() {
    if (!this.config.showImagePromptUI) return '';

    return `
                    <!-- Image Prompt (for remix) -->
                    <div id="image-prompt-group" class="mb-4 param-group">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Source Image <span class="text-red-500">*</span></label>
                        <div class="flex flex-col space-y-2">
                            <label id="image-prompt-upload-label" class="flex items-center justify-center w-full h-20 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer hover:bg-gray-50">
                                <div class="flex flex-col items-center">
                                    <p class="text-sm text-gray-500">Click to upload an image</p>
                                    <p id="image-prompt-name" class="text-xs text-gray-400 mt-1">No file selected</p>
                                </div>
                                <input id="image-prompt-input" type="file" class="hidden" accept="image/png, image/jpeg, image/jpg" />
                            </label>
                            <div id="image-prompt-preview-container" class="hidden relative">
                                <img id="image-prompt-preview" class="w-full rounded-lg border border-gray-300" alt="Selected image">
                                <button id="image-prompt-clear" class="absolute top-2 right-2 p-1 bg-white bg-opacity-80 rounded-full hover:bg-opacity-100 hover:bg-red-50 shadow hover:shadow-lg transition-all duration-200" title="Clear image">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-600 hover:text-red-600 transition-colors duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                            <div class="hidden" id="image-prompt-strength-container">
                                <label class="block text-xs font-medium text-gray-700 mb-1">Image Strength: <span id="image-prompt-strength-value">0.3</span></label>
                                <input type="range" id="image-prompt-strength" min="0" max="1" step="0.05" value="0.3" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                            </div>
                        </div>
                    </div>
    `;
  }

  /**
   * Get prompt label based on tab type
   */
  getPromptLabel() {
    if (this.config.requiresPrompt) {
      return 'Prompt <span class="text-red-500">*</span>';
    }
    return 'Prompt (Optional)';
  }

  /**
   * Get prompt placeholder based on tab type
   */
  getPromptPlaceholder() {
    if (this.config.tabType === 'create') {
      return 'Describe what to generate...';
    }
    return 'create a photorealistic render of an urban street scene with accurate shading and lighting';
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
                        <select id="${getId('model-selector')}" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="flux-pro-1.1">Flux Pro 1.1</option>
                            <option value="flux-dev">Flux Dev</option>
                            <option value="flux-kontext-pro" selected>Flux Kontext Pro</option>
                            ${
                              this.config.showImagePromptUI
                                ? '<option value="kontext-realearth">Kontext Real Earth</option>'
                                : ''
                            }
                            <option value="nano-banana">Nano Banana</option>
                            <option value="seedream-4">Seedream</option>
                        </select>
                    </div>

                    ${this.getImagePromptHTML()}

                    <!-- Prompt -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">${this.getPromptLabel()}</label>
                        <textarea id="${getId('prompt-input')}" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  placeholder="${this.getPromptPlaceholder()}"></textarea>
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

                    <!-- Advanced Options -->
                    <div class="mb-4">
                        <div class="flex justify-between items-center cursor-pointer" id="${getId('advanced-toggle')}">
                            <span class="text-sm font-medium text-gray-700">Advanced Options</span>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" id="${getId('advanced-icon')}">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>

                        <div class="mt-2 hidden" id="${getId('advanced-options')}">
                            <!-- Steps -->
                            <div class="mb-3 param-group" id="${getId('steps-group')}">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Steps: <span id="${getId('steps-value')}">40</span></label>
                                <input type="range" id="${getId('steps-slider')}" min="1" max="50" value="40" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                            </div>

                            <!-- Guidance Scale -->
                            <div class="mb-3 param-group" id="${getId('guidance-group')}">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Guidance Scale: <span id="${getId('guidance-value')}">2.5</span></label>
                                <input type="range" id="${getId('guidance-slider')}" min="1.5" max="5" step="0.1" value="2.5" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                            </div>

                            <!-- Safety Tolerance -->
                            <div class="mb-3 param-group opacity-50 cursor-not-allowed" id="${getId('safety-group')}">
                                <label class="block text-sm font-medium text-gray-500 mb-1">Safety Tolerance: <span id="${getId('safety-value')}">2</span></label>
                                <input type="range" id="${getId('safety-slider')}" min="0" max="6" step="1" value="2" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-not-allowed pointer-events-none" disabled>
                                <p class="text-xs text-gray-500 mt-1">Higher values are less strict (0 = most strict, 6 = least strict)</p>
                            </div>

                            <!-- Seed -->
                            <div class="mb-3 param-group" id="${getId('seed-group')}">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Seed</label>
                                <div class="flex">
                                    <input type="number" id="${getId('seed-input')}" placeholder="Random" class="w-full px-3 py-2 border border-gray-300 rounded-l-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                                    <button id="${getId('random-seed-btn')}" class="px-3 py-2 bg-gray-100 border border-gray-300 border-l-0 rounded-r-md hover:bg-gray-200">
                                        🎲
                                    </button>
                                </div>
                                <!-- Randomize Seed Checkbox -->
                                <div class="mt-2 flex items-center">
                                    <input type="checkbox" id="${getId('randomize-seed-checkbox')}" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded" checked>
                                    <label for="${getId('randomize-seed-checkbox')}" class="ml-2 block text-sm text-gray-700">Randomize seed before each generation</label>
                                </div>
                            </div>

                            <!-- Prompt Upsampling -->
                            <div class="mb-3 param-group" id="${getId('prompt-upsampling-group')}">
                                <div class="flex items-center">
                                    <input type="checkbox" id="${getId('prompt-upsampling')}" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                                    <label for="${getId('prompt-upsampling')}" class="ml-2 block text-sm text-gray-700">Prompt Upsampling</label>
                                </div>
                                <p class="text-xs text-gray-500 mt-1">Automatically enhances prompt with additional details</p>
                            </div>

                            <!-- Raw Mode (Ultra only) -->
                            <div class="mb-3 param-group hidden" id="${getId('raw-mode-group')}">
                                <div class="flex items-center">
                                    <input type="checkbox" id="${getId('raw-mode')}" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                                    <label for="${getId('raw-mode')}" class="ml-2 block text-sm text-gray-700">Raw Mode</label>
                                </div>
                                <p class="text-xs text-gray-500 mt-1">Generate less processed, more natural-looking images</p>
                            </div>

                            <!-- Interval (Pro only) -->
                            <div class="mb-3 param-group hidden" id="${getId('interval-group')}">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Interval: <span id="${getId('interval-value')}">2.0</span></label>
                                <input type="range" id="${getId('interval-slider')}" min="1" max="4" step="0.1" value="2.0" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                                <p class="text-xs text-gray-500 mt-1">Parameter for guidance control</p>
                            </div>

                            <!-- Output Format -->
                            <div class="mb-3">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Output Format</label>
                                <div class="flex space-x-4">
                                    <div class="flex items-center">
                                        <input type="radio" id="${getId('format-jpeg')}" name="${getId('output-format')}" value="jpeg" checked class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                        <label for="${getId('format-jpeg')}" class="ml-2 block text-sm text-gray-700">JPEG</label>
                                    </div>
                                    <div class="flex items-center">
                                        <input type="radio" id="${getId('format-png')}" name="${getId('output-format')}" value="png" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                        <label for="${getId('format-png')}" class="ml-2 block text-sm text-gray-700">PNG</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Generate Button -->
                    <button id="${getId('generate-btn')}" class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 flex items-center justify-center gap-2">
                        <svg id="${getId('generate-spinner')}" class="hidden animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span id="${getId('generate-text')}">Generate Image</span>
                        <span class="inline-flex items-center rounded" style="background: rgba(0, 0, 0, 0.15); padding: 6px 8px; gap: 2px;">
                            <img src="/ui_assets/token-image.png" alt="Token" class="w-5 h-5" />
                            <span class="text-sm" style="opacity: 0.9; margin-right: 1px;">×</span>
                            <span class="text-sm font-medium">1</span>
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
    if (!this.elements.modelSelector) {
      console.error(
        'Generator Tab: Cannot set up event listeners, elements not found'
      );
      return;
    }

    this.elements.modelSelector.addEventListener(
      'change',
      this.updateModelParams.bind(this)
    );

    this.elements.advancedToggle.addEventListener(
      'click',
      this.toggleAdvancedOptions.bind(this)
    );

    this.elements.randomSeedBtn.addEventListener(
      'click',
      this.generateRandomSeed.bind(this)
    );

    this.elements.generateBtn.addEventListener(
      'click',
      this.generateImage.bind(this)
    );

    // Keyboard shortcut for prompt input
    this.elements.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.elements.generateBtn.click();
      }
    });

    // Setup sliders
    this.setupSlider(this.elements.stepsSlider, this.elements.stepsValue);
    this.setupSlider(this.elements.guidanceSlider, this.elements.guidanceValue);
    this.setupSlider(this.elements.safetySlider, this.elements.safetyValue);
    this.setupSlider(this.elements.intervalSlider, this.elements.intervalValue);

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
          if (this.elements.modelSelector.value === 'flux-pro-1.1-ultra') {
            this.elements.imagePromptStrengthContainer.classList.remove(
              'hidden'
            );
          } else {
            this.elements.imagePromptStrengthContainer.classList.add('hidden');
          }
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
    if (!this.elements.modelSelector) {
      console.error('Generator Tab: modelSelector not found');
      return;
    }

    const model = this.elements.modelSelector.value;

    // Default visibility states
    let showDimensions = true;
    let showAspectRatio = false;
    let showSteps = true;
    let showGuidance = true;
    let showRaw = false;
    let showInterval = false;
    let showImagePrompt = this.config.showImagePromptUI;
    let showSafetyTolerance = true;
    let showSeed = true;

    // Show image prompt strength only if there's an image AND it's Ultra model
    if (this.config.showImagePromptUI) {
      const showImageStrength =
        this.imagePromptData && model === 'flux-pro-1.1-ultra';
      this.elements.imagePromptStrengthContainer.classList.toggle(
        'hidden',
        !showImageStrength
      );
    }

    // Update slider ranges and visibility based on model
    switch (model) {
      case 'flux-pro-1.1-ultra':
        showDimensions = false;
        showAspectRatio = true;
        showRaw = true;
        showSteps = false;
        showGuidance = false;
        break;

      case 'flux-pro':
        this.elements.guidanceSlider.min = '1.5';
        this.elements.guidanceSlider.max = '5.0';
        this.elements.guidanceSlider.value = '2.5';
        this.elements.guidanceValue.textContent = '2.5';
        this.elements.stepsSlider.min = '1';
        this.elements.stepsSlider.max = '50';
        this.elements.stepsSlider.value = '40';
        this.elements.stepsValue.textContent = '40';
        showInterval = true;
        break;

      case 'flux-dev':
        this.elements.guidanceSlider.min = '1.5';
        this.elements.guidanceSlider.max = '5.0';
        this.elements.guidanceSlider.value = '3.0';
        this.elements.guidanceValue.textContent = '3.0';
        this.elements.stepsSlider.min = '1';
        this.elements.stepsSlider.max = '50';
        this.elements.stepsSlider.value = '28';
        this.elements.stepsValue.textContent = '28';
        break;

      case 'flux-pro-1.1':
        showSteps = false;
        showGuidance = false;
        break;

      case 'flux-kontext-pro':
      case 'flux-kontext-max':
        showDimensions = false;
        showAspectRatio = true;
        showRaw = false;
        showSteps = false;
        showGuidance = false;
        this.elements.promptUpsamplingGroup.classList.remove('hidden');
        break;

      case 'kontext-realearth':
      case 'nano-banana':
      case 'seedream-4':
        showDimensions = false;
        showAspectRatio = false;
        showRaw = false;
        showSteps = false;
        showGuidance = false;
        showSafetyTolerance = false;
        showSeed = false;
        this.elements.promptUpsamplingGroup.classList.add('hidden');
        break;
    }

    // Apply visibility
    this.elements.dimensionsGroup.classList.toggle('hidden', !showDimensions);
    this.elements.aspectRatioGroup.classList.toggle('hidden', !showAspectRatio);
    this.elements.stepsGroup.classList.toggle('hidden', !showSteps);
    this.elements.guidanceGroup.classList.toggle('hidden', !showGuidance);
    this.elements.rawModeGroup.classList.toggle('hidden', !showRaw);
    this.elements.intervalGroup.classList.toggle('hidden', !showInterval);
    this.elements.safetyGroup.classList.toggle('hidden', !showSafetyTolerance);
    this.elements.seedGroup.classList.toggle('hidden', !showSeed);

    if (this.config.showImagePromptUI) {
      this.elements.imagePromptGroup.classList.toggle(
        'hidden',
        !showImagePrompt
      );
    }

    this.elements.promptUpsamplingGroup.classList.remove('hidden');

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
   * Toggle advanced options visibility
   */
  toggleAdvancedOptions() {
    this.elements.advancedOptions.classList.toggle('hidden');
    const isVisible =
      !this.elements.advancedOptions.classList.contains('hidden');
    if (isVisible) {
      this.elements.advancedIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />`;
    } else {
      this.elements.advancedIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />`;
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
   * Generate a random seed
   */
  generateRandomSeed() {
    this.elements.seedInput.value = Math.floor(Math.random() * 1000000);
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

      if (this.elements.modelSelector.value === 'flux-pro-1.1-ultra') {
        this.elements.imagePromptStrengthContainer.classList.remove('hidden');
      } else {
        this.elements.imagePromptStrengthContainer.classList.add('hidden');
      }
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

    if (
      this.config.showImagePromptUI &&
      this.elements.modelSelector.value === 'flux-pro-1.1-ultra'
    ) {
      this.elements.imagePromptStrengthContainer.classList.remove('hidden');
    } else if (this.config.showImagePromptUI) {
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

    // Check prompt requirement
    if (this.config.requiresPrompt) {
      const prompt = this.elements.promptInput.value.trim();
      if (!prompt) {
        FluxUI.showNotification(
          'Prompt is required. Please enter a text prompt to create an image.',
          'error'
        );
        return false;
      }
    }

    // Check source image requirement
    if (this.config.requiresSourceImage) {
      if (!this.imagePromptData) {
        FluxUI.showNotification(
          'Source image is required. Please upload an image to modify.',
          'error'
        );
        return false;
      }
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

    const model = this.elements.modelSelector.value;
    const isReplicateModel = REPLICATE_MODELS[model];

    if (isReplicateModel) {
      this.generateReplicateImage(model);
    } else {
      const params = this.buildRequestParams(model);

      if (!params) {
        return;
      }

      this.currentParams = params;
      this.toggleLoading(true);

      FluxAPI.makeRequest(model, params)
        .then((response) => {
          if (response.id) {
            this.pollForResult(response.id, model);
            window.dispatchEvent(new CustomEvent('tokenCountChanged'));
          } else {
            throw new Error('No task ID returned from API');
          }
        })
        .catch((error) => {
          console.error('Generation error:', error);
          FluxUI.showNotification(
            error.message || 'Failed to generate image',
            'error'
          );
          this.toggleLoading(false);
        });
    }
  }

  /**
   * Generate image using Replicate API
   */
  async generateReplicateImage(model) {
    const modelConfig = REPLICATE_MODELS[model];
    if (!modelConfig) {
      FluxUI.showNotification('Invalid model selected', 'error');
      return;
    }

    // For modify tab, check image requirement
    if (this.config.requiresSourceImage && !this.imagePromptData) {
      FluxUI.showNotification(
        'Source image is required for this model',
        'error'
      );
      return;
    }

    this.toggleLoading(true);
    this.startTimer(model);

    try {
      const generateReplicateImage = httpsCallable(
        functions,
        'generateReplicateImage',
        {
          timeout: 300000
        }
      );

      const prompt =
        this.elements.promptInput.value.trim() || modelConfig.prompt;

      // Prepare input image if available
      let inputImageSrc = null;
      if (this.imagePromptData) {
        inputImageSrc = this.imagePromptData.startsWith('data:')
          ? this.imagePromptData
          : `data:image/jpeg;base64,${this.imagePromptData}`;
      }

      const result = await generateReplicateImage({
        prompt: prompt,
        input_image: inputImageSrc,
        guidance: 2.5,
        num_inference_steps: 30,
        model_version: modelConfig.version,
        scene_id: null
      });

      if (result.data.success) {
        const imageUrl = result.data.image_url;

        this.currentParams = {
          model: model,
          model_name: modelConfig.name,
          prompt: prompt,
          timestamp: new Date().toISOString()
        };

        this.currentImageUrl = imageUrl;
        this.displayImage(imageUrl);
        this.saveToGallery(imageUrl);
        this.stopTimer();
        this.toggleLoading(false);

        if (result.data.remainingTokens !== undefined) {
          FluxUI.showNotification(
            `Image generated successfully! ${result.data.remainingTokens} gen tokens remaining. (${modelConfig.name})`,
            'success'
          );
        } else {
          FluxUI.showNotification(
            `Image generated successfully! (${modelConfig.name})`,
            'success'
          );
        }

        window.dispatchEvent(new CustomEvent('tokenCountChanged'));
      } else {
        throw new Error('Failed to generate image');
      }
    } catch (error) {
      console.error('Error generating Replicate image:', error);
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
   * Build request parameters
   */
  buildRequestParams(model) {
    const params = {
      safety_tolerance: parseInt(this.elements.safetySlider.value),
      output_format: this.elements.formatJpeg.checked ? 'jpeg' : 'png',
      prompt_upsampling: this.elements.promptUpsampling.checked
    };

    // Add prompt
    const prompt = this.elements.promptInput.value.trim();
    if (prompt) {
      params.prompt = prompt;
    } else if (this.config.defaultPrompt) {
      params.prompt = this.config.defaultPrompt;
    }

    // Randomize seed if checked
    if (this.elements.randomizeSeedCheckbox.checked) {
      this.generateRandomSeed();
    }

    // Add seed if provided
    if (this.elements.seedInput.value) {
      params.seed = parseInt(this.elements.seedInput.value);
    }

    // Add image prompt if uploaded
    if (this.imagePromptData) {
      if (model === 'flux-kontext-pro' || model === 'flux-kontext-max') {
        params.input_image = this.imagePromptData;
      } else {
        params.image_prompt = this.imagePromptData;

        if (model === 'flux-pro-1.1-ultra') {
          params.image_prompt_strength = parseFloat(
            this.elements.imagePromptStrength.value
          );
        }
      }
    }

    // Add model-specific parameters
    switch (model) {
      case 'flux-pro-1.1-ultra': {
        params.aspect_ratio = this.elements.aspectRatioSelector.value;
        if (this.elements.rawMode.checked) {
          params.raw = true;
        }
        break;
      }

      case 'flux-pro-1.1': {
        const [width, height] = this.getSelectedDimension()
          .split('x')
          .map(Number);
        params.width = width;
        params.height = height;
        break;
      }

      case 'flux-pro': {
        const [proWidth, proHeight] = this.getSelectedDimension()
          .split('x')
          .map(Number);
        params.width = proWidth;
        params.height = proHeight;
        params.steps = parseInt(this.elements.stepsSlider.value);
        params.guidance = parseFloat(this.elements.guidanceSlider.value);
        params.interval = parseFloat(this.elements.intervalSlider.value);
        break;
      }

      case 'flux-dev': {
        const [devWidth, devHeight] = this.getSelectedDimension()
          .split('x')
          .map(Number);
        params.width = devWidth;
        params.height = devHeight;
        params.steps = parseInt(this.elements.stepsSlider.value);
        params.guidance = parseFloat(this.elements.guidanceSlider.value);
        break;
      }

      case 'flux-kontext-pro':
      case 'flux-kontext-max': {
        params.aspect_ratio = this.elements.aspectRatioSelector.value;
        break;
      }

      case 'kontext-realearth':
      case 'nano-banana':
      case 'seedream-4': {
        if (!this.imagePromptData) {
          FluxUI.showNotification(
            'Source image is required for this model',
            'error'
          );
          return null;
        }
        break;
      }
    }

    return params;
  }

  /**
   * Poll for task result
   */
  pollForResult(taskId, apiEndpoint) {
    this.elements.loadingText.textContent = 'Generating your image...';
    FluxAPI.pollForResult(
      taskId,
      (progress) => {
        this.elements.loadingText.textContent = `Generating your image... ${Math.round(progress * 100)}%`;
      },
      (imageUrl, result) => {
        this.currentImageUrl = imageUrl;

        if (result.details && result.details.request_params) {
          this.currentParams = {
            ...this.currentParams,
            ...result.details.request_params,
            seed: result.details.request_params.seed ?? this.currentParams.seed
          };
        }

        this.currentParams.model = result.details?.model_id || apiEndpoint;
        this.currentParams.timestamp = new Date().toISOString();

        const proxiedUrl = FluxAPI.getProxiedImageUrl(imageUrl);
        this.displayImage(proxiedUrl);
        this.saveToGallery(proxiedUrl);
        this.toggleLoading(false);
        FluxUI.showNotification('Image generated successfully!', 'success');
      },
      (error) => {
        console.error('Error polling for result:', error);
        this.toggleLoading(false);
        FluxUI.showNotification(
          `Failed to get result: ${error.message}`,
          'error'
        );
      }
    );
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

    const isReplicateImage =
      this.currentImageUrl.includes('replicate.delivery') ||
      this.currentImageUrl.includes('pbxt.replicate.delivery');

    const fetchUrl = isReplicateImage
      ? this.currentImageUrl
      : FluxAPI.getProxiedImageUrl(this.currentImageUrl);

    fetch(fetchUrl)
      .then((response) => response.blob())
      .then((blob) => {
        const blobUrl = URL.createObjectURL(blob);
        const downloadLink = document.createElement('a');
        downloadLink.href = blobUrl;

        const modelName = this.elements.modelSelector.value.replace(
          'flux-',
          ''
        );
        const timestamp = new Date()
          .toISOString()
          .replace(/[:.]/g, '-')
          .slice(0, 19);
        const fileExtension = this.elements.formatJpeg.checked ? 'jpg' : 'png';
        const filename = `flux-${modelName}-${timestamp}.${fileExtension}`;

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
    paramsToCopy.model =
      this.currentParams.model || this.elements.modelSelector.value;

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

  /**
   * Save the generated image to the gallery
   */
  saveToGallery(imageUrl) {
    if (!galleryService) {
      return;
    }

    fetch(imageUrl)
      .then((response) => response.blob())
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          })
      )
      .then(async (dataUrl) => {
        const imageDimensions = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            resolve({ width: img.width, height: img.height });
          };
          img.onerror = () => {
            resolve({ width: undefined, height: undefined });
          };
          img.src = dataUrl;
        });

        const metadata = {
          model: this.currentParams.model || this.elements.modelSelector.value,
          prompt: this.elements.promptInput.value,
          seed: this.currentParams.seed,
          width: this.currentParams.width || imageDimensions.width,
          height: this.currentParams.height || imageDimensions.height,
          output_format:
            this.currentParams.output_format ||
            (this.elements.formatJpeg?.checked ? 'jpeg' : 'png'),
          ...(this.currentParams.aspect_ratio && {
            aspect_ratio: this.currentParams.aspect_ratio
          }),
          ...(this.currentParams.steps && { steps: this.currentParams.steps }),
          ...(this.currentParams.guidance && {
            guidance: this.currentParams.guidance
          }),
          ...(this.currentParams.interval && {
            interval: this.currentParams.interval
          }),
          ...(this.currentParams.raw && { raw: this.currentParams.raw }),
          ...(this.currentParams.prompt_upsampling !== undefined && {
            prompt_upsampling: this.currentParams.prompt_upsampling
          })
        };

        try {
          await galleryService.addImage(dataUrl, metadata, 'ai-render');
          FluxUI.showNotification('Image saved to gallery!', 'success');
        } catch (e) {
          console.error('Gallery addImage error:', e);
          FluxUI.showNotification('Failed to save image to gallery.', 'error');
        }
      })
      .catch((error) => {
        console.error('Error saving to gallery:', error);
        FluxUI.showNotification(
          'Failed to save image to gallery: ' + error.message,
          'error'
        );
      });
  }

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
    const modelName = this.elements.modelSelector.value;
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
