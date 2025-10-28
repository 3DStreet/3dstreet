/**
 * Flux Image Generator - Generator Tab
 * Original image generation functionality
 */

import FluxUI from './main.js';
import FluxAPI from './api.js';
import FluxGallery from './gallery.js';
import useImageGenStore from './store.js';
import ImageUploadUtils from './image-upload-utils.js';

// Generator tab module
const GeneratorTab = {
  // Tab state
  imagePromptData: null,
  currentParams: {},
  currentImageUrl: '',
  selectedOrientation: 'portrait', // Default orientation
  selectedDimension: '1024x1440', // Default dimension

  // DOM Elements
  elements: {},

  // Initialize the tab
  init: function () {
    // Get tab container
    const tabContainer = document.getElementById('generator-tab');
    if (!tabContainer) {
      console.error('Generator Tab: Container element not found!');
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
    FluxUI.tabModules.generator = this;
  },

  // Get all DOM elements after content is created
  getElements: function () {
    // Model Selection
    this.elements.modelSelector = document.getElementById('model-selector');

    // Prompt and dimensions
    this.elements.promptInput = document.getElementById('prompt-input');
    this.elements.dimensionsGroup = document.getElementById('dimensions-group');
    this.elements.orientationButtons = document.getElementById(
      'orientation-buttons'
    );
    this.elements.dimensionsGrid = document.getElementById('dimensions-grid');
    this.elements.aspectRatioSelector = document.getElementById(
      'aspect-ratio-selector'
    );

    // Parameters
    this.elements.stepsSlider = document.getElementById('steps-slider');
    this.elements.stepsValue = document.getElementById('steps-value');
    this.elements.guidanceSlider = document.getElementById('guidance-slider');
    this.elements.guidanceValue = document.getElementById('guidance-value');
    this.elements.safetySlider = document.getElementById('safety-slider');
    this.elements.safetyValue = document.getElementById('safety-value');
    this.elements.seedInput = document.getElementById('seed-input');
    this.elements.randomSeedBtn = document.getElementById('random-seed-btn');
    this.elements.randomizeSeedCheckbox = document.getElementById(
      'randomize-seed-checkbox'
    ); // New checkbox
    this.elements.promptUpsampling =
      document.getElementById('prompt-upsampling');
    this.elements.rawMode = document.getElementById('raw-mode');
    this.elements.intervalSlider = document.getElementById('interval-slider');
    this.elements.intervalValue = document.getElementById('interval-value');
    this.elements.formatJpeg = document.getElementById('format-jpeg');
    this.elements.formatPng = document.getElementById('format-png');

    // Image prompt
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

    // Groups
    this.elements.dimensionsGroup = document.getElementById('dimensions-group');
    this.elements.aspectRatioGroup =
      document.getElementById('aspect-ratio-group');
    this.elements.stepsGroup = document.getElementById('steps-group');
    this.elements.guidanceGroup = document.getElementById('guidance-group');
    this.elements.imagePromptGroup =
      document.getElementById('image-prompt-group');
    this.elements.rawModeGroup = document.getElementById('raw-mode-group');
    this.elements.intervalGroup = document.getElementById('interval-group');
    this.elements.promptUpsamplingGroup = document.getElementById(
      'prompt-upsampling-group'
    );

    // Advanced options
    this.elements.advancedToggle = document.getElementById('advanced-toggle');
    this.elements.advancedOptions = document.getElementById('advanced-options');
    this.elements.advancedIcon = document.getElementById('advanced-icon');

    // Preview
    this.elements.previewContainer =
      document.getElementById('preview-container');
    this.elements.previewImage = document.getElementById('preview-image');
    this.elements.generationPlaceholder = document.getElementById(
      'generation-placeholder'
    );
    this.elements.loadingIndicator =
      document.getElementById('loading-indicator');
    this.elements.loadingText = document.getElementById('loading-text');

    // Action buttons
    this.elements.actionButtons = document.getElementById('action-buttons');
    this.elements.copyParamsBtn = document.getElementById('copy-params-btn');
    this.elements.openImageBtn = document.getElementById('open-image-btn'); // Renamed ID
    this.elements.downloadImageBtn =
      document.getElementById('download-image-btn'); // Renamed ID
    this.elements.copyImageUrlBtn =
      document.getElementById('copy-image-url-btn'); // Renamed ID

    // Generate button
    this.elements.generateBtn = document.getElementById('generate-btn');

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
                    <h2 class="text-lg font-medium mb-4">Generation Settings</h2>
                    
                    <!-- Model Selection -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Model</label>
                        <select id="model-selector" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="flux-pro-1.1">Flux Pro 1.1</option>
                            <option value="flux-pro">Flux Pro</option>
                            <option value="flux-dev">Flux Dev</option>
                            <option value="flux-pro-1.1-ultra">Flux Ultra</option>
                            <option value="flux-kontext-pro" selected>Flux Kontext Pro</option>
                            <option value="flux-kontext-max">Flux Kontext Max</option>
                        </select>
                    </div>
                    
                    <!-- Prompt -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
                        <textarea id="prompt-input" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" 
                                  placeholder="Describe what you want to generate..."></textarea>
                    </div>
                    
                    <!-- Image Dimensions -->
                    <div id="dimensions-group" class="mb-4 param-group">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Dimensions</label>
                        <!-- Orientation Selection -->
                        <div id="orientation-buttons" class="flex space-x-2 mb-3">
                            <button type="button" data-orientation="square" class="orientation-button flex-1 px-3 py-1 border border-gray-300 bg-white text-gray-700 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500">Square</button>
                            <button type="button" data-orientation="landscape" class="orientation-button flex-1 px-3 py-1 border border-gray-300 bg-white text-gray-700 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500">Landscape</button>
                            <button type="button" data-orientation="portrait" class="orientation-button flex-1 px-3 py-1 border border-indigo-500 bg-indigo-50 text-indigo-700 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 selected-orientation">Portrait</button> <!-- Default -->
                        </div>
                        <!-- Dimension Grid (Populated Dynamically) -->
                        <div id="dimensions-grid" class="grid grid-cols-3 sm:grid-cols-4 gap-2">
                            <!-- Dimension buttons will be added here by JS -->
                        </div>
                    </div>
                    
                    <!-- Aspect Ratio (for Ultra model) -->
                    <div id="aspect-ratio-group" class="mb-4 param-group hidden">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Aspect Ratio</label>
                        <select id="aspect-ratio-selector" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="1:1">1:1 (Square)</option>
                            <option value="4:3">4:3</option>
                            <option value="16:9" selected>16:9</option>
                            <option value="21:9">21:9 (Ultra-wide)</option>
                            <option value="3:4">3:4</option>
                            <option value="9:16">9:16</option>
                            <option value="9:21">9:21</option>
                        </select>
                    </div>
                    
                    <!-- Image Prompt (for remix) -->
                    <div id="image-prompt-group" class="mb-4 param-group">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Image Prompt</label>
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
                    
                    <!-- Steps -->
                    <div class="mb-4 param-group" id="steps-group">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Steps: <span id="steps-value">40</span></label>
                        <input type="range" id="steps-slider" min="1" max="50" value="40" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                    </div>
                    
                    <!-- Guidance Scale -->
                    <div class="mb-4 param-group" id="guidance-group">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Guidance Scale: <span id="guidance-value">2.5</span></label>
                        <input type="range" id="guidance-slider" min="1.5" max="5" step="0.1" value="2.5" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                    </div>

                    <!-- Advanced Options -->
                    <div class="mb-4">
                        <div class="flex justify-between items-center cursor-pointer" id="advanced-toggle">
                            <span class="text-sm font-medium text-gray-300">Advanced Options</span>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" id="advanced-icon">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                        
                        <div class="mt-2 hidden" id="advanced-options">
                            <!-- Safety Tolerance -->
                            <div class="mb-3 param-group opacity-50 cursor-not-allowed">
                                <label class="block text-sm font-medium text-gray-500 mb-1">Safety Tolerance: <span id="safety-value">2</span></label>
                                <input type="range" id="safety-slider" min="0" max="6" step="1" value="2" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-not-allowed pointer-events-none" disabled>
                                <p class="text-xs text-gray-500 mt-1">Higher values are less strict (0 = most strict, 6 = least strict)</p>
                            </div>

                            <!-- Seed -->
                            <div class="mb-3 param-group">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Seed</label>
                                <div class="flex">
                                    <input type="number" id="seed-input" placeholder="Random" class="w-full px-3 py-2 border border-gray-300 rounded-l-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                                    <button id="random-seed-btn" class="px-3 py-2 bg-gray-100 border border-gray-300 border-l-0 rounded-r-md hover:bg-gray-200">
                                        🎲
                                    </button>
                                </div>
                                <!-- Randomize Seed Checkbox -->
                                <div class="mt-2 flex items-center">
                                    <input type="checkbox" id="randomize-seed-checkbox" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                                    <label for="randomize-seed-checkbox" class="ml-2 block text-sm text-gray-700">Randomize seed before each generation</label>
                                </div>
                            </div>

                            <!-- Prompt Upsampling -->
                            <div class="mb-3 param-group" id="prompt-upsampling-group">
                                <div class="flex items-center">
                                    <input type="checkbox" id="prompt-upsampling" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                                    <label for="prompt-upsampling" class="ml-2 block text-sm text-gray-700">Prompt Upsampling</label>
                                </div>
                                <p class="text-xs text-gray-500 mt-1">Automatically enhances prompt with additional details</p>
                            </div>

                            <!-- Raw Mode (Ultra only) -->
                            <div class="mb-3 param-group hidden" id="raw-mode-group">
                                <div class="flex items-center">
                                    <input type="checkbox" id="raw-mode" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                                    <label for="raw-mode" class="ml-2 block text-sm text-gray-700">Raw Mode</label>
                                </div>
                                <p class="text-xs text-gray-500 mt-1">Generate less processed, more natural-looking images</p>
                            </div>

                            <!-- Interval (Pro only) -->
                            <div class="mb-3 param-group hidden" id="interval-group">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Interval: <span id="interval-value">2.0</span></label>
                                <input type="range" id="interval-slider" min="1" max="4" step="0.1" value="2.0" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                                <p class="text-xs text-gray-500 mt-1">Parameter for guidance control</p>
                            </div>

                            <!-- Output Format -->
                            <div class="mb-3">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Output Format</label>
                                <div class="flex space-x-4">
                                    <div class="flex items-center">
                                        <input type="radio" id="format-jpeg" name="output-format" value="jpeg" checked class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                        <label for="format-jpeg" class="ml-2 block text-sm text-gray-700">JPEG</label>
                                    </div>
                                    <div class="flex items-center">
                                        <input type="radio" id="format-png" name="output-format" value="png" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                        <label for="format-png" class="ml-2 block text-sm text-gray-700">PNG</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Generate Button -->
                    <button id="generate-btn" class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 flex items-center justify-center gap-2">
                        <span>Generate Image</span>
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
                    <div class="p-6 flex flex-col items-center justify-center min-h-[500px]" id="preview-container">
                        <div id="generation-placeholder" class="text-center text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <p>Your generated image will appear here</p>
                        </div>
                        <img id="preview-image" class="max-w-full max-h-[500px] hidden rounded-lg shadow-lg" alt="Generated image">
                        <div id="loading-indicator" class="hidden flex flex-col items-center">
                            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                            <p class="text-gray-600" id="loading-text">Generating your image...</p>
                        </div>
                    </div>
                    <div class="px-6 pb-6">
                        <div class="flex flex-wrap justify-center gap-2 mt-4" id="action-buttons">
                            <button id="copy-params-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Copy Parameters
                            </button>
                            <button id="open-image-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Open Image
                            </button>
                            <button id="download-image-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Download Image
                            </button>
                            <button id="copy-image-url-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
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
    this.setupSlider(
      this.elements.imagePromptStrength,
      this.elements.imagePromptStrengthValue
    );

    // Setup image prompt
    this.elements.imagePromptInput.addEventListener(
      'change',
      this.handleImagePromptUpload.bind(this)
    );

    // Setup drag and drop for image prompt
    ImageUploadUtils.setupDragAndDrop(
      this.elements.imagePromptUploadLabel,
      this.elements.imagePromptInput,
      (dataUrl, fileName) => {
        this.elements.imagePromptName.textContent = fileName;
        // Store base64 data
        this.imagePromptData = dataUrl.split(',')[1];
        // Show preview
        this.showImagePromptPreview(dataUrl);
        // Show image prompt strength control only if model is Ultra
        if (this.elements.modelSelector.value === 'flux-pro-1.1-ultra') {
          this.elements.imagePromptStrengthContainer.classList.remove('hidden');
        } else {
          this.elements.imagePromptStrengthContainer.classList.add('hidden');
        }
      }
    );

    // Setup clear image button
    if (this.elements.imagePromptClear) {
      this.elements.imagePromptClear.addEventListener(
        'click',
        this.clearImagePrompt.bind(this)
      );
    }

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
    let showImagePrompt = true; // New variable for controlling image prompt visibility

    // Show image prompt strength only if there's an image AND it's Ultra model
    const showImageStrength =
      this.imagePromptData && model === 'flux-pro-1.1-ultra';
    this.elements.imagePromptStrengthContainer.classList.toggle(
      'hidden',
      !showImageStrength
    );

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
        showImagePrompt = true; // Show image prompt for Kontext models
        // Show prompt upsampling for Kontext models
        this.elements.promptUpsamplingGroup.classList.remove('hidden');
        break;
    }

    // Apply visibility based on the model logic above
    this.elements.dimensionsGroup.classList.toggle('hidden', !showDimensions);
    this.elements.aspectRatioGroup.classList.toggle('hidden', !showAspectRatio);
    this.elements.stepsGroup.classList.toggle('hidden', !showSteps);
    this.elements.guidanceGroup.classList.toggle('hidden', !showGuidance);
    this.elements.rawModeGroup.classList.toggle('hidden', !showRaw);
    this.elements.intervalGroup.classList.toggle('hidden', !showInterval);

    // Control image prompt visibility based on model
    this.elements.imagePromptGroup.classList.toggle('hidden', !showImagePrompt);
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
  generateImage: function () {
    // Check if user is authenticated
    if (!window.authState || !window.authState.isAuthenticated) {
      useImageGenStore.getState().setModal('signin');
      return;
    }

    // Get model type and prepare parameters
    // Get model
    const model = this.elements.modelSelector.value; // Build parameters
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
          // The server deducts tokens and returns remainingTokens, but we need
          // to trigger a refresh of the TokenDisplay component
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

    // Add prompt if not empty
    const prompt = this.elements.promptInput.value.trim();
    if (prompt) {
      params.prompt = prompt;
    } else if (model !== 'flux-pro-1.1-ultra') {
      // Ultra model can work without prompt, others require it
      FluxUI.showNotification('Please enter a prompt', 'error');
      return null;
    }

    // Check if seed should be randomized before generation
    if (this.elements.randomizeSeedCheckbox.checked) {
      this.generateRandomSeed(); // Update the input field with a new random seed
    }

    // Add seed if provided (will now use the potentially newly randomized seed)
    if (this.elements.seedInput.value) {
      params.seed = parseInt(this.elements.seedInput.value);
    }

    // Add image prompt if uploaded
    if (this.imagePromptData) {
      // Kontext models use 'input_image' parameter instead of 'image_prompt'
      if (model === 'flux-kontext-pro' || model === 'flux-kontext-max') {
        params.input_image = this.imagePromptData;
      } else {
        params.image_prompt = this.imagePromptData;

        // Add image prompt strength for Ultra model
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
    } // Use fetch to get the image as a blob
    fetch(FluxAPI.getProxiedImageUrl(this.currentImageUrl))
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
    // Check if gallery module is available
    if (!FluxGallery) {
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
          await FluxGallery.addImage(dataUrl, metadata);
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
};

export default GeneratorTab;
