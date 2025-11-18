/**
 * Flux Image Generator - Create Tab
 * Image creation functionality (source image is optional)
 */

import FluxUI from './main.js';
import FluxAPI from './api.js';
import { galleryService } from './mount-gallery.js';
import useImageGenStore from './store.js';
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

// Create tab module
const CreateTab = {
  // Tab state
  imagePromptData: null,
  currentParams: {},
  currentImageUrl: '',
  selectedOrientation: 'portrait', // Default orientation
  selectedDimension: '1024x1440', // Default dimension

  // Timer state
  renderStartTime: null,
  elapsedTime: 0,
  renderProgress: 0,
  timerInterval: null,

  // Estimated generation times for Replicate models (in seconds)
  estimatedTimes: {
    'kontext-realearth': 25,
    'nano-banana': 20,
    'seedream-4': 25
  },

  // DOM Elements
  elements: {},

  // Initialize the tab
  init: function () {
    // Get tab container
    const tabContainer = document.getElementById('create-tab');
    if (!tabContainer) {
      console.error('Create Tab: Container element not found!');
      return;
    }

    // Create the HTML content
    this.createTabContent(tabContainer);

    // Now that content is created, get all the necessary elements
    this.getElements();

    // Initialize model parameters (which includes populating the initial dimension grid)
    this.updateModelParams();

    // Setup event listeners
    this.setupEventListeners();

    // Generate an initial random seed on load
    this.generateRandomSeed();

    // Register this module with the main UI for updates
    FluxUI.tabModules.create = this;

    // Check for pending gallery item from editor
    this.checkForPendingGalleryItem();
  },

  // Check for pending gallery item from cross-app communication
  checkForPendingGalleryItem: function () {
    try {
      const pendingItemJson = localStorage.getItem('pendingGalleryItem');
      if (!pendingItemJson) return;

      const pendingItem = JSON.parse(pendingItemJson);

      // Check if this item is for this tab and is recent (within 10 seconds)
      if (
        pendingItem.targetTab === 'create' &&
        Date.now() - pendingItem.timestamp < 10000
      ) {
        console.log(
          'Loading pending gallery item for create tab:',
          pendingItem
        );

        // Load the data URL
        if (
          pendingItem.imageDataUrl &&
          typeof pendingItem.imageDataUrl === 'string'
        ) {
          this.setImagePrompt(
            pendingItem.imageDataUrl,
            `Gallery Item ${pendingItem.id}`
          );
        }

        // Clear the pending item after loading
        localStorage.removeItem('pendingGalleryItem');
      }
    } catch (error) {
      console.error('Failed to load pending gallery item:', error);
      // Clear invalid data
      localStorage.removeItem('pendingGalleryItem');
    }
  },

  // Get all DOM elements after content is created
  getElements: function () {
    // Model Selection
    this.elements.modelSelector = document.getElementById(
      'create-model-selector'
    );

    // Prompt and dimensions
    this.elements.promptInput = document.getElementById('create-prompt-input');
    this.elements.dimensionsGroup = document.getElementById(
      'create-dimensions-group'
    );
    this.elements.orientationButtons = document.getElementById(
      'create-orientation-buttons'
    );
    this.elements.dimensionsGrid = document.getElementById(
      'create-dimensions-grid'
    );
    this.elements.aspectRatioSelector = document.getElementById(
      'create-aspect-ratio-selector'
    );

    // Parameters
    this.elements.stepsSlider = document.getElementById('create-steps-slider');
    this.elements.stepsValue = document.getElementById('create-steps-value');
    this.elements.guidanceSlider = document.getElementById(
      'create-guidance-slider'
    );
    this.elements.guidanceValue = document.getElementById(
      'create-guidance-value'
    );
    this.elements.safetySlider = document.getElementById(
      'create-safety-slider'
    );
    this.elements.safetyValue = document.getElementById('create-safety-value');
    this.elements.seedInput = document.getElementById('create-seed-input');
    this.elements.randomSeedBtn = document.getElementById(
      'create-random-seed-btn'
    );
    this.elements.randomizeSeedCheckbox = document.getElementById(
      'create-randomize-seed-checkbox'
    );
    this.elements.promptUpsampling = document.getElementById(
      'create-prompt-upsampling'
    );
    this.elements.rawMode = document.getElementById('create-raw-mode');
    this.elements.intervalSlider = document.getElementById(
      'create-interval-slider'
    );
    this.elements.intervalValue = document.getElementById(
      'create-interval-value'
    );
    this.elements.formatJpeg = document.getElementById('create-format-jpeg');
    this.elements.formatPng = document.getElementById('create-format-png');

    // Groups
    this.elements.dimensionsGroup = document.getElementById(
      'create-dimensions-group'
    );
    this.elements.aspectRatioGroup = document.getElementById(
      'create-aspect-ratio-group'
    );
    this.elements.stepsGroup = document.getElementById('create-steps-group');
    this.elements.guidanceGroup = document.getElementById(
      'create-guidance-group'
    );
    this.elements.rawModeGroup = document.getElementById(
      'create-raw-mode-group'
    );
    this.elements.intervalGroup = document.getElementById(
      'create-interval-group'
    );
    this.elements.promptUpsamplingGroup = document.getElementById(
      'create-prompt-upsampling-group'
    );
    this.elements.safetyGroup = document.getElementById('create-safety-group');

    // Advanced options
    this.elements.advancedToggle = document.getElementById(
      'create-advanced-toggle'
    );
    this.elements.advancedOptions = document.getElementById(
      'create-advanced-options'
    );
    this.elements.advancedIcon = document.getElementById(
      'create-advanced-icon'
    );

    // Preview
    this.elements.previewContainer = document.getElementById(
      'create-preview-container'
    );
    this.elements.previewImage = document.getElementById(
      'create-preview-image'
    );
    this.elements.generationPlaceholder = document.getElementById(
      'create-generation-placeholder'
    );
    this.elements.loadingIndicator = document.getElementById(
      'create-loading-indicator'
    );
    this.elements.loadingText = document.getElementById('create-loading-text');

    // Timer elements
    this.elements.progressBar = document.getElementById(
      'create-generator-progress-bar'
    );
    this.elements.overtimeText = document.getElementById(
      'create-generator-overtime-text'
    );

    // Action buttons
    this.elements.actionButtons = document.getElementById(
      'create-action-buttons'
    );
    this.elements.copyParamsBtn = document.getElementById(
      'create-copy-params-btn'
    );
    this.elements.openImageBtn = document.getElementById(
      'create-open-image-btn'
    );
    this.elements.downloadImageBtn = document.getElementById(
      'create-download-image-btn'
    );
    this.elements.copyImageUrlBtn = document.getElementById(
      'create-copy-image-url-btn'
    );

    // Generate button
    this.elements.generateBtn = document.getElementById('create-generate-btn');
    this.elements.generateSpinner = document.getElementById(
      'create-generate-spinner'
    );
    this.elements.generateText = document.getElementById(
      'create-generate-text'
    );

    // Verify critical elements
    let missingElements = [];
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
  },

  // Define dimensions grouped by orientation
  dimensionsByOrientation: {
    square: ['512x512', '1024x1024', '1440x1440'],
    landscape: ['768x512', '1024x576', '1024x768', '1440x768', '1440x1024'],
    portrait: ['512x768', '576x1024', '768x1024', '1024x1440', '768x1440']
  },

  // Create the tab content HTML
  createTabContent: function (container) {
    container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- Parameters Column -->
                <div class="lg:col-span-1 bg-white rounded-lg shadow p-6">
                    <h2 class="text-lg font-medium mb-1">Create Image Settings</h2>
                    <p class="text-sm text-gray-500 mb-4">Generate a new image from a text prompt.</p>

                    <!-- Model Selection -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Model</label>
                        <select id="create-model-selector" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="flux-pro-1.1">Flux Pro 1.1</option>
                            <option value="flux-dev">Flux Dev</option>
                            <!-- <option value="flux-pro-1.1-ultra">Flux Ultra</option> -->
                            <option value="flux-kontext-pro" selected>Flux Kontext Pro</option>
                            <!-- <option value="flux-kontext-max">Flux Kontext Max</option> -->
                            <option value="nano-banana">Nano Banana</option>
                            <option value="seedream-4">Seedream</option>
                        </select>
                    </div>

                    <!-- Prompt -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Prompt <span class="text-red-500">*</span></label>
                        <textarea id="create-prompt-input" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  placeholder="Describe what to generate..."></textarea>
                    </div>

                    <!-- Image Dimensions -->
                    <div id="create-dimensions-group" class="mb-4 param-group">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Dimensions</label>
                        <!-- Orientation Selection -->
                        <div id="create-orientation-buttons" class="flex space-x-2 mb-3">
                            <button type="button" data-orientation="square" class="orientation-button flex-1 px-3 py-1 border border-gray-300 bg-white text-gray-700 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500">Square</button>
                            <button type="button" data-orientation="landscape" class="orientation-button flex-1 px-3 py-1 border border-gray-300 bg-white text-gray-700 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500">Landscape</button>
                            <button type="button" data-orientation="portrait" class="orientation-button flex-1 px-3 py-1 border border-indigo-500 bg-indigo-50 text-indigo-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 selected-orientation">Portrait</button> <!-- Default -->
                        </div>
                        <!-- Dimension Grid (Populated Dynamically) -->
                        <div id="create-dimensions-grid" class="grid grid-cols-3 sm:grid-cols-4 gap-2">
                            <!-- Dimension buttons will be added here by JS -->
                        </div>
                    </div>

                    <!-- Aspect Ratio (for Ultra model) -->
                    <div id="create-aspect-ratio-group" class="mb-4 param-group hidden">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Aspect Ratio</label>
                        <select id="create-aspect-ratio-selector" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
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
                        <div class="flex justify-between items-center cursor-pointer" id="create-advanced-toggle">
                            <span class="text-sm font-medium text-gray-700">Advanced Options</span>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" id="create-advanced-icon">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>

                        <div class="mt-2 hidden" id="create-advanced-options">
                            <!-- Steps -->
                            <div class="mb-3 param-group" id="create-steps-group">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Steps: <span id="create-steps-value">40</span></label>
                                <input type="range" id="create-steps-slider" min="1" max="50" value="40" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                            </div>

                            <!-- Guidance Scale -->
                            <div class="mb-3 param-group" id="create-guidance-group">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Guidance Scale: <span id="create-guidance-value">2.5</span></label>
                                <input type="range" id="create-guidance-slider" min="1.5" max="5" step="0.1" value="2.5" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                            </div>

                            <!-- Safety Tolerance -->
                            <div class="mb-3 param-group opacity-50 cursor-not-allowed" id="create-safety-group">
                                <label class="block text-sm font-medium text-gray-500 mb-1">Safety Tolerance: <span id="create-safety-value">2</span></label>
                                <input type="range" id="create-safety-slider" min="0" max="6" step="1" value="2" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-not-allowed pointer-events-none" disabled>
                                <p class="text-xs text-gray-500 mt-1">Higher values are less strict (0 = most strict, 6 = least strict)</p>
                            </div>

                            <!-- Seed -->
                            <div class="mb-3 param-group">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Seed</label>
                                <div class="flex">
                                    <input type="number" id="create-seed-input" placeholder="Random" class="w-full px-3 py-2 border border-gray-300 rounded-l-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                                    <button id="create-random-seed-btn" class="px-3 py-2 bg-gray-100 border border-gray-300 border-l-0 rounded-r-md hover:bg-gray-200">
                                        🎲
                                    </button>
                                </div>
                                <!-- Randomize Seed Checkbox -->
                                <div class="mt-2 flex items-center">
                                    <input type="checkbox" id="create-randomize-seed-checkbox" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                                    <label for="create-randomize-seed-checkbox" class="ml-2 block text-sm text-gray-700">Randomize seed before each generation</label>
                                </div>
                            </div>

                            <!-- Prompt Upsampling -->
                            <div class="mb-3 param-group" id="create-prompt-upsampling-group">
                                <div class="flex items-center">
                                    <input type="checkbox" id="create-prompt-upsampling" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                                    <label for="create-prompt-upsampling" class="ml-2 block text-sm text-gray-700">Prompt Upsampling</label>
                                </div>
                                <p class="text-xs text-gray-500 mt-1">Automatically enhances prompt with additional details</p>
                            </div>

                            <!-- Raw Mode (Ultra only) -->
                            <div class="mb-3 param-group hidden" id="create-raw-mode-group">
                                <div class="flex items-center">
                                    <input type="checkbox" id="create-raw-mode" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                                    <label for="create-raw-mode" class="ml-2 block text-sm text-gray-700">Raw Mode</label>
                                </div>
                                <p class="text-xs text-gray-500 mt-1">Generate less processed, more natural-looking images</p>
                            </div>

                            <!-- Interval (Pro only) -->
                            <div class="mb-3 param-group hidden" id="create-interval-group">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Interval: <span id="create-interval-value">2.0</span></label>
                                <input type="range" id="create-interval-slider" min="1" max="4" step="0.1" value="2.0" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                                <p class="text-xs text-gray-500 mt-1">Parameter for guidance control</p>
                            </div>

                            <!-- Output Format -->
                            <div class="mb-3">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Output Format</label>
                                <div class="flex space-x-4">
                                    <div class="flex items-center">
                                        <input type="radio" id="create-format-jpeg" name="create-output-format" value="jpeg" checked class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                        <label for="create-format-jpeg" class="ml-2 block text-sm text-gray-700">JPEG</label>
                                    </div>
                                    <div class="flex items-center">
                                        <input type="radio" id="create-format-png" name="create-output-format" value="png" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                        <label for="create-format-png" class="ml-2 block text-sm text-gray-700">PNG</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Generate Button -->
                    <button id="create-generate-btn" class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 flex items-center justify-center gap-2">
                        <svg id="create-generate-spinner" class="hidden animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span id="create-generate-text">Generate Image</span>
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
                    <div class="p-6 flex flex-col items-center justify-center min-h-[500px]" id="create-preview-container">
                        <div id="create-generation-placeholder" class="text-center text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <p>Your generated image will appear here</p>
                        </div>
                        <img id="create-preview-image" class="max-w-full max-h-[500px] hidden rounded-lg shadow-lg" alt="Generated image">
                        <div id="create-loading-indicator" class="hidden flex flex-col items-center w-full max-w-md">
                            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                            <div class="generator-rendering-content">
                                <div class="generator-progress-container">
                                    <div class="generator-progress-bar" id="create-generator-progress-bar" style="width: 0%;"></div>
                                    <div class="generator-progress-stripes"></div>
                                </div>
                                <span class="generator-progress-text" id="create-loading-text">Generating your image...</span>
                                <span class="generator-progress-text hidden" id="create-generator-overtime-text" style="margin-top: 4px; color: #fbbf24;">Generation taking longer than expected.</span>
                            </div>
                        </div>
                    </div>
                    <div class="px-6 pb-6">
                        <div class="flex flex-wrap justify-center gap-2 mt-4" id="create-action-buttons">
                            <button id="create-copy-params-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Copy Parameters
                            </button>
                            <button id="create-open-image-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Open Image
                            </button>
                            <button id="create-download-image-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Download Image
                            </button>
                            <button id="create-copy-image-url-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Copy Image URL
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
  },

  // Setup event listeners
  setupEventListeners: function () {
    if (!this.elements.modelSelector) {
      console.error(
        'Generator Tab: Cannot set up event listeners, elements not found'
      );
      return;
    }

    // Model selector
    this.elements.modelSelector.addEventListener(
      'change',
      this.updateModelParams.bind(this)
    );

    // Advanced toggle
    this.elements.advancedToggle.addEventListener(
      'click',
      this.toggleAdvancedOptions.bind(this)
    );

    // Random seed button
    this.elements.randomSeedBtn.addEventListener(
      'click',
      this.generateRandomSeed.bind(this)
    );

    // Generate button
    this.elements.generateBtn.addEventListener(
      'click',
      this.generateImage.bind(this)
    );

    // Keyboard shortcut for prompt input (Cmd+Enter on Mac, Ctrl+Enter on PC)
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

    // Setup orientation button listener
    // Setup orientation button listener
    if (this.elements.orientationButtons) {
      this.elements.orientationButtons.addEventListener(
        'click',
        this.handleOrientationSelection.bind(this)
      );
    }

    // Setup dimension grid listener (delegated)
    if (this.elements.dimensionsGrid) {
      this.elements.dimensionsGrid.addEventListener(
        'click',
        this.handleDimensionSelection.bind(this)
      );
    }

    // Setup action buttons - Add defensive checks
    if (this.elements.openImageBtn) {
      // Use renamed ID
      this.elements.openImageBtn.addEventListener(
        'click',
        this.openImage.bind(this)
      );
    }

    if (this.elements.downloadImageBtn) {
      // Use renamed ID
      this.elements.downloadImageBtn.addEventListener(
        'click',
        this.downloadImage.bind(this)
      );
    }

    if (this.elements.copyImageUrlBtn) {
      // Use renamed ID
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
  },

  // Update the dimension grid based on selected orientation
  updateDimensionGrid: function (orientation) {
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

    this.elements.dimensionsGrid.innerHTML = ''; // Clear existing buttons
    const dimensions = this.dimensionsByOrientation[orientation];
    let foundDefault = false;

    dimensions.forEach((dim) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.dimension = dim;
      button.textContent = dim;
      button.className =
        'dimension-button border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 px-2 py-1 rounded-md text-xs text-center focus:outline-none focus:ring-2 focus:ring-indigo-500';

      // Select the default dimension or the first one if default isn't in this orientation
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

    // If the previously selected dimension wasn't found (e.g., switching orientation), select the first one
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
      this.selectedDimension = firstButton.dataset.dimension; // Update state
    }
  },

  // Update model parameters based on selected model
  updateModelParams: function () {
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
    let showSafetyTolerance = true;

    // Update slider ranges and visibility based on model
    switch (model) {
      case 'flux-pro-1.1-ultra':
        showDimensions = false;
        showAspectRatio = true;
        showRaw = true;
        showSteps = false; // Ultra doesn't use steps/guidance
        showGuidance = false;
        break;

      case 'flux-pro':
        // Set Pro specific ranges
        // Set Pro specific ranges/defaults
        this.elements.guidanceSlider.min = '1.5';
        this.elements.guidanceSlider.max = '5.0';
        this.elements.guidanceSlider.value = '2.5';
        this.elements.guidanceValue.textContent = '2.5';
        this.elements.stepsSlider.min = '1';
        this.elements.stepsSlider.max = '50';
        this.elements.stepsSlider.value = '40';
        this.elements.stepsValue.textContent = '40';
        showInterval = true; // Pro uses interval
        break;

      case 'flux-dev':
        // Set Dev specific ranges
        // Set Dev specific ranges/defaults
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
        // Pro 1.1 doesn't use guidance or steps
        showSteps = false;
        showGuidance = false;
        break;
      // Add cases for new Kontext models
      case 'flux-kontext-pro':
      case 'flux-kontext-max':
        showDimensions = false;
        showAspectRatio = true;
        showRaw = false;
        showSteps = false;
        showGuidance = false;
        // Show prompt upsampling for Kontext models
        this.elements.promptUpsamplingGroup.classList.remove('hidden');
        break;

      // Add cases for Replicate models (text-to-image capable)
      case 'nano-banana':
      case 'seedream-4':
        showDimensions = false;
        showAspectRatio = false;
        showRaw = false;
        showSteps = false;
        showGuidance = false;
        showSafetyTolerance = false;
        // Hide prompt upsampling for Replicate models
        this.elements.promptUpsamplingGroup.classList.add('hidden');
        break;
    }

    // Apply visibility based on the model logic above
    this.elements.dimensionsGroup.classList.toggle('hidden', !showDimensions);
    this.elements.aspectRatioGroup.classList.toggle('hidden', !showAspectRatio);
    this.elements.stepsGroup.classList.toggle('hidden', !showSteps);
    this.elements.guidanceGroup.classList.toggle('hidden', !showGuidance);
    this.elements.rawModeGroup.classList.toggle('hidden', !showRaw);
    this.elements.intervalGroup.classList.toggle('hidden', !showInterval);
    this.elements.safetyGroup.classList.toggle('hidden', !showSafetyTolerance);
    this.elements.promptUpsamplingGroup.classList.remove('hidden');

    // Update dimension grid if dimensions are visible for this model
    if (showDimensions) {
      this.updateDimensionGrid(this.selectedOrientation);
    }
  },

  // Handle orientation button selection
  handleOrientationSelection: function (e) {
    if (e.target.classList.contains('orientation-button')) {
      const selectedButton = e.target;
      const orientation = selectedButton.dataset.orientation;

      if (orientation === this.selectedOrientation) return; // No change

      this.selectedOrientation = orientation;

      // Update button styles
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

      // Update the dimension grid
      this.updateDimensionGrid(orientation);
    }
  },

  // Handle dimension button selection (within the grid)
  handleDimensionSelection: function (e) {
    // Use closest to handle clicks inside the button potentially
    const selectedButton = e.target.closest('.dimension-button');
    if (
      selectedButton &&
      this.elements.dimensionsGrid.contains(selectedButton)
    ) {
      const dimension = selectedButton.dataset.dimension;

      if (dimension === this.selectedDimension) return; // No change

      this.selectedDimension = dimension; // Update state

      // Remove selected style from all buttons in the grid
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

      // Add selected style to the clicked button
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
  },

  // Toggle advanced options visibility
  toggleAdvancedOptions: function () {
    this.elements.advancedOptions.classList.toggle('hidden');
    const isVisible =
      !this.elements.advancedOptions.classList.contains('hidden');
    if (isVisible) {
      this.elements.advancedIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />`;
    } else {
      this.elements.advancedIcon.innerHTML = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />`;
    }
  },

  // Setup range sliders
  setupSlider: function (slider, valueDisplay) {
    if (slider && valueDisplay) {
      slider.addEventListener('input', () => {
        valueDisplay.textContent = slider.value;
      });
    }
  },

  // Generate a random seed
  generateRandomSeed: function () {
    this.elements.seedInput.value = Math.floor(Math.random() * 1000000);
  },

  // Handle image prompt file upload
  handleImagePromptUpload: function (e) {
    const file = e.target.files[0];
    if (!file) return;

    this.elements.imagePromptName.textContent = file.name;

    const reader = new FileReader();
    reader.onload = (event) => {
      // Store base64 data
      this.imagePromptData = event.target.result.split(',')[1];

      // Show preview
      this.showImagePromptPreview(event.target.result);

      // Show image prompt strength control only if model is Ultra
      if (this.elements.modelSelector.value === 'flux-pro-1.1-ultra') {
        this.elements.imagePromptStrengthContainer.classList.remove('hidden');
      } else {
        this.elements.imagePromptStrengthContainer.classList.add('hidden');
      }
    };
    reader.readAsDataURL(file);
  },

  // Set image prompt from gallery or other source
  setImagePrompt: function (imageDataUrl, imageName = 'From Gallery') {
    this.imagePromptData = imageDataUrl.split(',')[1];
    this.elements.imagePromptName.textContent = imageName;

    // Show preview
    this.showImagePromptPreview(imageDataUrl);

    if (this.elements.modelSelector.value === 'flux-pro-1.1-ultra') {
      this.elements.imagePromptStrengthContainer.classList.remove('hidden');
    } else {
      this.elements.imagePromptStrengthContainer.classList.add('hidden');
    }
  },

  // Show image prompt preview
  showImagePromptPreview: function (imageDataUrl) {
    if (
      !this.elements.imagePromptPreview ||
      !this.elements.imagePromptPreviewContainer ||
      !this.elements.imagePromptUploadLabel
    ) {
      return;
    }

    // Set the preview image source
    this.elements.imagePromptPreview.src = imageDataUrl;

    // Hide upload label and show preview container
    this.elements.imagePromptUploadLabel.classList.add('hidden');
    this.elements.imagePromptPreviewContainer.classList.remove('hidden');
  },

  // Clear image prompt
  clearImagePrompt: function () {
    // Clear stored data
    this.imagePromptData = null;

    // Reset UI elements
    if (this.elements.imagePromptPreview) {
      this.elements.imagePromptPreview.src = '';
    }
    if (this.elements.imagePromptName) {
      this.elements.imagePromptName.textContent = 'No file selected';
    }
    if (this.elements.imagePromptInput) {
      this.elements.imagePromptInput.value = '';
    }

    // Hide preview and show upload label
    if (this.elements.imagePromptPreviewContainer) {
      this.elements.imagePromptPreviewContainer.classList.add('hidden');
    }
    if (this.elements.imagePromptUploadLabel) {
      this.elements.imagePromptUploadLabel.classList.remove('hidden');
    }

    // Hide strength container
    if (this.elements.imagePromptStrengthContainer) {
      this.elements.imagePromptStrengthContainer.classList.add('hidden');
    }
  },

  // Generate an image
  generateImage: async function () {
    // Check if prompt is provided (required for Create tab)
    const prompt = this.elements.promptInput.value.trim();
    if (!prompt) {
      FluxUI.showNotification(
        'Prompt is required. Please enter a text prompt to create an image.',
        'error'
      );
      return;
    }

    // Check if user is authenticated
    if (!window.authState || !window.authState.isAuthenticated) {
      useImageGenStore.getState().setModal('signin');
      return;
    }

    // Check if user has tokens
    const hasTokens = window.authState.tokenProfile?.genToken > 0;
    if (!hasTokens) {
      // Show purchase modal instead of just disabling button
      window.dispatchEvent(
        new CustomEvent('openPurchaseModal', {
          detail: { tokenType: 'genToken' }
        })
      );
      return;
    }

    // Get model type and prepare parameters
    const model = this.elements.modelSelector.value;

    // Check if this is a Replicate model
    const isReplicateModel = REPLICATE_MODELS[model];

    if (isReplicateModel) {
      // Use Replicate API for these models
      this.generateReplicateImage(model);
    } else {
      // Use BFL API for Flux models
      const params = this.buildRequestParams(model);

      if (!params) {
        // buildRequestParams will show error notification if needed
        return;
      }

      // Store current parameters for later use
      this.currentParams = params;

      // Show loading state
      this.toggleLoading(true);

      // Make the API request using the model endpoint
      FluxAPI.makeRequest(model, params)
        .then((response) => {
          if (response.id) {
            // Pass the model used for the request to pollForResult
            this.pollForResult(response.id, model);

            // Dispatch custom event to refresh token count in UI
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
  },

  // Generate image using Replicate API
  generateReplicateImage: async function (model) {
    const modelConfig = REPLICATE_MODELS[model];
    if (!modelConfig) {
      FluxUI.showNotification('Invalid model selected', 'error');
      return;
    }

    // Source image is optional in create tab - will use null if not provided

    // Show loading state
    this.toggleLoading(true);

    // Start timer for Replicate models
    this.startTimer(model);

    try {
      const generateReplicateImage = httpsCallable(
        functions,
        'generateReplicateImage',
        {
          timeout: 300000 // 5 minutes in milliseconds
        }
      );

      // Use custom prompt if provided, otherwise use default model prompt
      const prompt =
        this.elements.promptInput.value.trim() || modelConfig.prompt;

      const result = await generateReplicateImage({
        prompt: prompt,
        guidance: 2.5,
        num_inference_steps: 30,
        model_version: modelConfig.version,
        scene_id: null
      });

      if (result.data.success) {
        const imageUrl = result.data.image_url;

        // Store current parameters for copying
        this.currentParams = {
          model: model,
          model_name: modelConfig.name,
          prompt: prompt,
          timestamp: new Date().toISOString()
        };

        // Display the image
        this.currentImageUrl = imageUrl;
        this.displayImage(imageUrl);

        // Automatically save to gallery
        this.saveToGallery(imageUrl);

        // Stop timer
        this.stopTimer();

        this.toggleLoading(false);

        // Show success message with remaining tokens
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

        // Dispatch custom event to refresh token count in UI
        window.dispatchEvent(new CustomEvent('tokenCountChanged'));
      } else {
        throw new Error('Failed to generate image');
      }
    } catch (error) {
      console.error('Error generating Replicate image:', error);

      // Stop timer on error
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
  },

  // Get selected dimension (now stored in state)
  getSelectedDimension: function () {
    // Ensure the selected dimension is valid for the current orientation, fallback if needed
    const currentValidDimensions =
      this.dimensionsByOrientation[this.selectedOrientation];
    if (
      currentValidDimensions &&
      currentValidDimensions.includes(this.selectedDimension)
    ) {
      return this.selectedDimension;
    } else if (currentValidDimensions && currentValidDimensions.length > 0) {
      this.selectedDimension = currentValidDimensions[0]; // Fallback to first valid
      // Optionally update UI selection here too
      this.updateDimensionGrid(this.selectedOrientation);
      return this.selectedDimension;
    } else {
      console.error(
        `No valid dimensions found for orientation ${this.selectedOrientation}. Falling back to default.`
      );
      return '1024x768'; // Absolute fallback
    }
  },

  // Build request parameters
  buildRequestParams: function (model) {
    // Common parameters for all models
    const params = {
      safety_tolerance: parseInt(this.elements.safetySlider.value),
      output_format: this.elements.formatJpeg.checked ? 'jpeg' : 'png',
      prompt_upsampling: this.elements.promptUpsampling.checked
    };

    // Add prompt (required for create tab - validation already done in generateImage)
    const prompt = this.elements.promptInput.value.trim();
    params.prompt = prompt;

    // Check if seed should be randomized before generation
    if (this.elements.randomizeSeedCheckbox.checked) {
      this.generateRandomSeed(); // Update the input field with a new random seed
    }

    // Add seed if provided (will now use the potentially newly randomized seed)
    if (this.elements.seedInput.value) {
      params.seed = parseInt(this.elements.seedInput.value);
    }

    // Add model-specific parameters
    switch (model) {
      case 'flux-pro-1.1-ultra': {
        // Ultra uses aspect ratio instead of dimensions
        params.aspect_ratio = this.elements.aspectRatioSelector.value;

        // Add raw mode if enabled
        if (this.elements.rawMode.checked) {
          params.raw = true;
        }
        break;
      }

      case 'flux-pro-1.1': {
        // Add dimensions from grid
        const [width, height] = this.getSelectedDimension()
          .split('x')
          .map(Number);
        params.width = width;
        params.height = height;
        break;
      }

      case 'flux-pro': {
        // Add dimensions from grid
        const [proWidth, proHeight] = this.getSelectedDimension()
          .split('x')
          .map(Number);
        params.width = proWidth;
        params.height = proHeight;

        // Add Pro-specific parameters
        params.steps = parseInt(this.elements.stepsSlider.value);
        params.guidance = parseFloat(this.elements.guidanceSlider.value);

        // Make sure interval is included for Flux Pro
        params.interval = parseFloat(this.elements.intervalSlider.value);
        break;
      }

      case 'flux-dev': {
        // Add dimensions from grid
        const [devWidth, devHeight] = this.getSelectedDimension()
          .split('x')
          .map(Number);
        params.width = devWidth;
        params.height = devHeight;

        // Add Dev-specific parameters
        params.steps = parseInt(this.elements.stepsSlider.value);
        params.guidance = parseFloat(this.elements.guidanceSlider.value);
        break;
      }

      // Add cases for Kontext models
      case 'flux-kontext-pro':
      case 'flux-kontext-max': {
        // Kontext models use aspect ratio
        params.aspect_ratio = this.elements.aspectRatioSelector.value;
        break;
      }

      // Note: Replicate models (nano-banana, seedream-4) don't use this function
      // They're handled entirely in generateReplicateImage() instead
    }

    return params;
  },

  // Poll for task result (now accepts apiEndpoint used)
  pollForResult: function (taskId, apiEndpoint) {
    this.elements.loadingText.textContent = 'Generating your image...';
    FluxAPI.pollForResult(
      taskId,
      // Progress callback
      (progress) => {
        this.elements.loadingText.textContent = `Generating your image... ${Math.round(progress * 100)}%`;
      },
      // Success callback
      (imageUrl, result) => {
        // Store the original URL for reference
        this.currentImageUrl = imageUrl; // Store original for potential direct use if needed

        // Update currentParams with actual parameters used, especially the seed
        if (result.details && result.details.request_params) {
          // Merge received params, prioritizing the received seed
          this.currentParams = {
            ...this.currentParams, // Keep originally sent params as fallback
            ...result.details.request_params, // Overwrite with actual params used
            seed: result.details.request_params.seed ?? this.currentParams.seed // Prioritize received seed
          };
        }
        // Ensure model info is stored correctly in currentParams
        // Use the passed apiEndpoint parameter as fallback
        this.currentParams.model = result.details?.model_id || apiEndpoint;
        this.currentParams.timestamp = new Date().toISOString();

        // Use our proxy server to bypass CORS for display and gallery saving
        const proxiedUrl = FluxAPI.getProxiedImageUrl(imageUrl); // Display the image using the proxied URL
        this.displayImage(proxiedUrl);

        // Automatically save to gallery (live update without page refresh)
        this.saveToGallery(proxiedUrl);

        this.toggleLoading(false);
        FluxUI.showNotification('Image generated successfully!', 'success');
      },
      // Error callback
      (error) => {
        console.error('Error polling for result:', error);
        this.toggleLoading(false);
        FluxUI.showNotification(
          `Failed to get result: ${error.message}`,
          'error'
        );
      }
    );
  },

  // Display the generated image
  displayImage: function (imageUrl) {
    // Show image
    this.elements.previewImage.src = imageUrl;
    this.elements.previewImage.classList.remove('hidden');
    this.elements.generationPlaceholder.classList.add('hidden');

    // Show action buttons
    this.elements.copyParamsBtn.classList.remove('hidden');
    this.elements.openImageBtn.classList.remove('hidden'); // Use renamed ID
    this.elements.downloadImageBtn.classList.remove('hidden'); // Use renamed ID
    this.elements.copyImageUrlBtn.classList.remove('hidden'); // Use renamed ID

    // Add fallback in case the image doesn't load
    this.elements.previewImage.onerror = () => {
      console.error(
        'Failed to load image through proxy. Creating direct link instead.'
      );

      // Create a fallback button
      const fallbackButton = document.createElement('div');
      fallbackButton.className = 'text-center mt-4';
      fallbackButton.innerHTML = `
                <p class="mb-2 text-sm text-gray-600">Unable to display image directly:</p>
                <a href="${this.currentImageUrl}" target="_blank" class="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700">
                    Open Image in New Tab
                </a>
            `;

      // Hide the image
      this.elements.previewImage.classList.add('hidden');

      // Remove any existing fallback
      const existingFallback =
        this.elements.previewContainer.querySelector('.text-center.mt-4');
      if (existingFallback) {
        this.elements.previewContainer.removeChild(existingFallback);
      }

      this.elements.previewContainer.appendChild(fallbackButton);
    };
  },

  // Toggle loading state
  toggleLoading: function (isLoading) {
    if (isLoading) {
      this.elements.loadingIndicator.classList.remove('hidden');
      this.elements.generationPlaceholder.classList.add('hidden');
      this.elements.previewImage.classList.add('hidden');
      this.elements.generateBtn.disabled = true;
      this.elements.generateBtn.classList.add(
        'opacity-50',
        'cursor-not-allowed'
      );

      // Show spinner, update button text
      if (this.elements.generateSpinner) {
        this.elements.generateSpinner.classList.remove('hidden');
      }
      if (this.elements.generateText) {
        this.elements.generateText.textContent = 'Generating...';
      }

      // Hide action buttons
      this.elements.copyParamsBtn.classList.add('hidden');
      this.elements.openImageBtn.classList.add('hidden'); // Use renamed ID
      this.elements.downloadImageBtn.classList.add('hidden'); // Use renamed ID
      this.elements.copyImageUrlBtn.classList.add('hidden'); // Use renamed ID

      // Remove any fallback buttons
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

      // Hide spinner, restore button text
      if (this.elements.generateSpinner) {
        this.elements.generateSpinner.classList.add('hidden');
      }
      if (this.elements.generateText) {
        this.elements.generateText.textContent = 'Generate Image';
      }
    }
  },

  // Open the image in a new tab
  openImage: function () {
    if (!this.currentImageUrl) {
      FluxUI.showNotification('No image to open', 'error');
      return;
    }
    window.open(this.currentImageUrl, '_blank');
    FluxUI.showNotification('Image opened in new tab!', 'success');
  },

  // Download the image
  downloadImage: function () {
    if (!this.currentImageUrl) {
      FluxUI.showNotification('No image to download', 'error');
      return;
    }

    // Determine if this is a Replicate image (doesn't need BFL proxy)
    const isReplicateImage =
      this.currentImageUrl.includes('replicate.delivery') ||
      this.currentImageUrl.includes('pbxt.replicate.delivery');

    // Use fetch to get the image as a blob
    const fetchUrl = isReplicateImage
      ? this.currentImageUrl
      : FluxAPI.getProxiedImageUrl(this.currentImageUrl);

    fetch(fetchUrl)
      .then((response) => response.blob())
      .then((blob) => {
        // Create a blob URL
        const blobUrl = URL.createObjectURL(blob);

        // Create download link
        const downloadLink = document.createElement('a');
        downloadLink.href = blobUrl;

        // Generate a filename based on the model and time
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

        // Append to body, click and remove
        document.body.appendChild(downloadLink);
        downloadLink.click();

        // Clean up
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
  },

  // Copy the image URL to clipboard
  copyImageUrl: function () {
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
  },

  // Copy parameters to clipboard
  copyParams: function () {
    if (Object.keys(this.currentParams).length === 0) {
      FluxUI.showNotification('No parameters to copy', 'error');
      return;
    }

    // Add the model info to the parameters
    const paramsToCopy = { ...this.currentParams };
    // Ensure 'model' reflects the actual endpoint used if available in currentParams, else fallback
    paramsToCopy.model =
      this.currentParams.model || this.elements.modelSelector.value;

    // Remove potentially sensitive or internal details before copying if needed
    // delete paramsToCopy.someInternalDetail;

    const paramsWithModel = {
      ...paramsToCopy
    };

    // Format params as JSON string with indentation
    const paramsString = JSON.stringify(paramsWithModel, null, 2);
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
  },

  // Save the generated image to the gallery
  saveToGallery: function (imageUrl) {
    // Check if gallery service is available
    if (!galleryService) {
      return;
    }

    // Convert the proxied image URL to a Data URL so gallery can store as Blob
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
        // Get actual image dimensions from the data URL
        const imageDimensions = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            resolve({ width: img.width, height: img.height });
          };
          img.onerror = () => {
            // Fallback to undefined if image fails to load
            resolve({ width: undefined, height: undefined });
          };
          img.src = dataUrl;
        });

        // Build comprehensive metadata to enable desktop/mobile modal features
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
  },

  // Start the timer
  startTimer: function (modelName) {
    this.renderStartTime = Date.now();
    this.elapsedTime = 0;
    this.updateTimerDisplay();

    // Update timer every second
    this.timerInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - this.renderStartTime) / 1000);
      this.elapsedTime = elapsed;
      this.updateTimerDisplay();
    }, 1000);
  },

  // Stop the timer
  stopTimer: function () {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.renderStartTime = null;
    this.elapsedTime = 0;
    this.renderProgress = 0;

    // Reset progress bar
    if (this.elements.progressBar) {
      this.elements.progressBar.style.width = '0%';
    }

    // Hide overtime warning
    if (this.elements.overtimeText) {
      this.elements.overtimeText.classList.add('hidden');
    }
  },

  // Update timer display
  updateTimerDisplay: function () {
    const modelName = this.elements.modelSelector.value;
    const estimatedTime = this.estimatedTimes[modelName] || 30;

    // Calculate progress percentage
    this.renderProgress = Math.min(
      (this.elapsedTime / estimatedTime) * 100,
      100
    );

    // Update progress bar width
    if (this.elements.progressBar) {
      this.elements.progressBar.style.width = `${this.renderProgress}%`;
    }

    // Update text (always show in seconds format)
    this.elements.loadingText.textContent = `${this.elapsedTime}s/${estimatedTime}s`;

    // Show overtime warning if elapsed time is more than 10s over estimate
    if (this.elements.overtimeText) {
      if (this.elapsedTime > estimatedTime + 10) {
        this.elements.overtimeText.classList.remove('hidden');
      } else {
        this.elements.overtimeText.classList.add('hidden');
      }
    }
  }
};

export default CreateTab;
