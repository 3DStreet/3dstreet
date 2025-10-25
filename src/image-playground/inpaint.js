/**
 * Flux Image Generator - Inpaint Tab
 * Functionality for image inpainting using /v1/flux-pro-1.0-fill
 */

import FluxUI from './main.js';
import FluxAPI from './api.js';
import FluxGallery from './gallery.js';

// Inpaint tab module
const InpaintTab = {
  // Tab state
  imageData: null, // Base64 data URL of the source image
  maskData: null, // Base64 data URL of the generated mask
  currentParams: {}, // Parameters used for the last successful generation
  currentImageUrl: '', // Proxied URL of the last generated image
  isDrawing: false,
  lastX: 0,
  lastY: 0,
  brushSize: 20, // Default brush size
  originalWidth: 0,
  originalHeight: 0,
  displayCanvasScale: 1, // Scale factor of the display canvas vs original image
  maskLayerCanvas: null, // Hidden canvas for the actual mask data
  maskLayerCtx: null, // Context for the hidden mask canvas
  selectedFinetune: null, // Store selected finetune ID
  // Elements cache
  elements: {},

  // Initialize the tab
  init: function () {
    console.log('Initializing Inpaint Tab');
    const inpaintContainer = document.getElementById('inpaint-tab');
    if (!inpaintContainer) {
      console.error('Inpaint Tab: Container element not found');
      return;
    }
    this.elements.inpaintContainer = inpaintContainer;
    this.createTabContent();
    this.getElements(); // Get elements after creating content
    this.setupEventListeners();

    // Generate an initial random seed on load
    this.generateRandomSeed();

    // Listen for finetune list updates from the FinetuneTab
    document.addEventListener('finetunesListUpdated', (event) => {
      console.log(
        'Inpaint Tab received finetunesListUpdated event:',
        event.detail
      );
      this.updateFinetuneOptions(event.detail);
    });

    // Register this module with the main UI for updates
    FluxUI.tabModules.inpaint = this;

    console.log('Inpaint Tab initialized');
  },

  // Create the tab content HTML (aligned with generator.js structure)
  createTabContent: function () {
    this.elements.inpaintContainer.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- Left Column: Input, Masking, Parameters -->
                <div class="lg:col-span-1 bg-white rounded-lg shadow p-6">
                    <h2 class="text-lg font-medium mb-4">Inpaint Settings</h2>

                    <!-- Image Input -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Source Image</label>
                        <label class="flex items-center justify-center w-full h-20 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer hover:bg-gray-50">
                            <div class="flex flex-col items-center">
                                <p class="text-sm text-gray-500">Click to upload or use Gallery</p>
                                <p id="inpaint-file-name" class="text-xs text-gray-400 mt-1">No file selected</p>
                            </div>
                            <input id="inpaint-file-input" type="file" class="hidden" accept="image/png, image/jpeg, image/jpg" />
                        </label>
                    </div>

                    <!-- Masking Area -->
                    <div class="mb-4 relative" id="inpaint-canvas-container" style="display: none;">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Draw Mask (White areas will be inpainted):</label>
                        <canvas id="inpaint-mask-canvas" class="border border-gray-300 rounded-md cursor-crosshair w-full bg-gray-100"></canvas>
                        <img id="inpaint-source-image" style="display: none;" /> <!-- Hidden image element to hold source -->

                        <!-- Brush Controls -->
                        <div class="absolute top-0 right-0 mt-2 mr-2 flex items-center space-x-2 bg-white bg-opacity-80 p-1 rounded shadow">
                             <label for="inpaint-brush-size" class="text-xs">Brush: <span id="inpaint-brush-size-label" class="font-medium">${this.brushSize}</span></label>
                             <input type="range" id="inpaint-brush-size" min="5" max="100" value="${this.brushSize}" class="w-20 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                             <button id="inpaint-clear-mask" title="Clear Mask" class="p-1 hover:bg-gray-200 rounded">
                                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                  <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                             </button>
                        </div>
                    </div>

                    <!-- Prompt -->
                    <div class="mb-4">
                        <label for="inpaint-prompt" class="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
                        <textarea id="inpaint-prompt" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Describe what to generate in the masked area..."></textarea>
                    </div>
                    
                    <!-- Finetune Selection -->
                    <div class="mb-4">
                        <label for="inpaint-finetune-selector" class="block text-sm font-medium text-gray-700 mb-1">Finetune Model (Optional)</label>
                        <select id="inpaint-finetune-selector" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="">None</option>
                            <!-- Options populated by JS -->
                        </select>
                    </div>
                    
                    <!-- Finetune Strength (Hidden by default) -->
                    <div id="inpaint-finetune-strength-container" class="mb-4 hidden">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Finetune Strength: <span id="inpaint-finetune-strength-value">1.1</span></label>
                        <input type="range" id="inpaint-finetune-strength-slider" min="0" max="2" step="0.05" value="1.1" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                        <p class="text-xs text-gray-500 mt-1">Controls the influence of the finetuned model (0 = none, 1 = full, >1 = amplified)</p>
                    </div>

                    <!-- Parameters -->
                    <div class="mb-4 param-group">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Steps: <span id="inpaint-steps-value">50</span></label>
                        <input type="range" id="inpaint-steps-slider" min="15" max="50" value="50" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                    </div>

                    <div class="mb-4 param-group">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Guidance Scale: <span id="inpaint-guidance-value">60</span></label>
                        <input type="range" id="inpaint-guidance-slider" min="1.5" max="100" step="0.5" value="60" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                    </div>

                    <div class="mb-4 param-group">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Safety Tolerance: <span id="inpaint-safety-value">2</span></label>
                        <input type="range" id="inpaint-safety-slider" min="0" max="6" step="1" value="2" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                        <p class="text-xs text-gray-500 mt-1">Higher values are less strict</p>
                    </div>

                    <div class="mb-4 param-group">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Seed</label>
                        <div class="flex">
                            <input type="number" id="inpaint-seed-input" placeholder="Random" class="w-full px-3 py-2 border border-gray-300 rounded-l-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <button id="inpaint-random-seed-btn" class="px-3 py-2 bg-gray-100 border border-gray-300 border-l-0 rounded-r-md hover:bg-gray-200">
                                🎲
                            </button>
                        </div>
                        <!-- Randomize Seed Checkbox -->
                        <div class="mt-2 flex items-center">
                            <input type="checkbox" id="inpaint-randomize-seed-checkbox" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                            <label for="inpaint-randomize-seed-checkbox" class="ml-2 block text-sm text-gray-700">Randomize seed before each generation</label>
                        </div>
                    </div>

                    <!-- Advanced Options -->
                     <div class="mb-4">
                        <div class="flex justify-between items-center cursor-pointer" id="inpaint-advanced-toggle">
                            <span class="text-sm font-medium text-gray-700">Advanced Options</span>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" id="inpaint-advanced-icon">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                        <div class="mt-2 hidden" id="inpaint-advanced-options">
                            <div class="mb-3 param-group">
                                <div class="flex items-center">
                                    <input type="checkbox" id="inpaint-prompt-upsampling" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                                    <label for="inpaint-prompt-upsampling" class="ml-2 block text-sm text-gray-700">Prompt Upsampling</label>
                                </div>
                                <p class="text-xs text-gray-500 mt-1">Enhances prompt with details</p>
                            </div>
                            <div class="mb-3">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Output Format</label>
                                <div class="flex space-x-4">
                                    <div class="flex items-center">
                                        <input type="radio" id="inpaint-format-jpeg" name="inpaint-output-format" value="jpeg" checked class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                        <label for="inpaint-format-jpeg" class="ml-2 block text-sm text-gray-700">JPEG</label>
                                    </div>
                                    <div class="flex items-center">
                                        <input type="radio" id="inpaint-format-png" name="inpaint-output-format" value="png" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                        <label for="inpaint-format-png" class="ml-2 block text-sm text-gray-700">PNG</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>


                    <!-- Generate Button -->
                    <button id="inpaint-generate-btn" class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50" disabled>
                        Generate Inpaint
                    </button>
                </div>

                <!-- Right Column: Output -->
                <div class="lg:col-span-2 bg-white rounded-lg shadow">
                     <div class="p-6 border-b border-gray-200">
                        <h2 class="text-lg font-medium">Result</h2>
                    </div>
                    <div class="p-6 flex flex-col items-center justify-center min-h-[500px]" id="inpaint-output-container">
                        <div id="inpaint-output-placeholder" class="text-center text-gray-400">
                             <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            <p>Load an image and draw a mask</p>
                        </div>
                        <img id="inpaint-output-image" class="max-w-full max-h-[500px] hidden rounded-lg shadow-lg" alt="Inpainted Image">
                        <div id="inpaint-loading-indicator" class="hidden flex flex-col items-center">
                            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                            <p class="text-gray-600" id="inpaint-loading-text">Generating...</p>
                        </div>
                    </div>
                     <div class="px-6 pb-6">
                        <div class="flex flex-wrap justify-center gap-2 mt-4" id="inpaint-action-buttons">
                            <!-- Add to Gallery button removed as it's now automatic -->
                             <button id="inpaint-copy-params-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Copy Parameters
                            </button>
                            <button id="inpaint-download-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Download Image
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
  },

  // Get all DOM elements after content is created
  getElements: function () {
    this.elements.fileInput = this.elements.inpaintContainer.querySelector(
      '#inpaint-file-input'
    );
    this.elements.fileNameLabel =
      this.elements.inpaintContainer.querySelector('#inpaint-file-name');
    this.elements.canvasContainer =
      this.elements.inpaintContainer.querySelector('#inpaint-canvas-container');
    this.elements.canvas = this.elements.inpaintContainer.querySelector(
      '#inpaint-mask-canvas'
    );
    this.elements.ctx = this.elements.canvas.getContext('2d');
    this.elements.sourceImage = this.elements.inpaintContainer.querySelector(
      '#inpaint-source-image'
    );

    // Brush controls
    this.elements.brushSizeSlider =
      this.elements.inpaintContainer.querySelector('#inpaint-brush-size');
    this.elements.brushSizeLabel = this.elements.inpaintContainer.querySelector(
      '#inpaint-brush-size-label'
    );
    this.elements.clearMaskBtn = this.elements.inpaintContainer.querySelector(
      '#inpaint-clear-mask'
    );

    // Parameters
    this.elements.promptInput =
      this.elements.inpaintContainer.querySelector('#inpaint-prompt');
    this.elements.stepsSlider = this.elements.inpaintContainer.querySelector(
      '#inpaint-steps-slider'
    );
    this.elements.stepsValue = this.elements.inpaintContainer.querySelector(
      '#inpaint-steps-value'
    );
    this.elements.guidanceSlider = this.elements.inpaintContainer.querySelector(
      '#inpaint-guidance-slider'
    );
    this.elements.guidanceValue = this.elements.inpaintContainer.querySelector(
      '#inpaint-guidance-value'
    );
    this.elements.safetySlider = this.elements.inpaintContainer.querySelector(
      '#inpaint-safety-slider'
    );
    this.elements.safetyValue = this.elements.inpaintContainer.querySelector(
      '#inpaint-safety-value'
    );
    this.elements.seedInput = this.elements.inpaintContainer.querySelector(
      '#inpaint-seed-input'
    );
    this.elements.randomSeedBtn = this.elements.inpaintContainer.querySelector(
      '#inpaint-random-seed-btn'
    );
    this.elements.randomizeSeedCheckbox =
      this.elements.inpaintContainer.querySelector(
        '#inpaint-randomize-seed-checkbox'
      ); // New checkbox

    // Advanced
    this.elements.advancedToggle = this.elements.inpaintContainer.querySelector(
      '#inpaint-advanced-toggle'
    );
    this.elements.advancedOptions =
      this.elements.inpaintContainer.querySelector('#inpaint-advanced-options');
    this.elements.advancedIcon = this.elements.inpaintContainer.querySelector(
      '#inpaint-advanced-icon'
    );
    this.elements.promptUpsamplingInput =
      this.elements.inpaintContainer.querySelector(
        '#inpaint-prompt-upsampling'
      );
    this.elements.formatJpeg = this.elements.inpaintContainer.querySelector(
      '#inpaint-format-jpeg'
    );
    this.elements.formatPng = this.elements.inpaintContainer.querySelector(
      '#inpaint-format-png'
    );

    // Output
    this.elements.outputContainer =
      this.elements.inpaintContainer.querySelector('#inpaint-output-container');
    this.elements.outputPlaceholder =
      this.elements.inpaintContainer.querySelector(
        '#inpaint-output-placeholder'
      );
    this.elements.outputImage = this.elements.inpaintContainer.querySelector(
      '#inpaint-output-image'
    );
    this.elements.loadingIndicator =
      this.elements.inpaintContainer.querySelector(
        '#inpaint-loading-indicator'
      );
    this.elements.loadingText = this.elements.inpaintContainer.querySelector(
      '#inpaint-loading-text'
    );

    // Buttons
    this.elements.generateBtn = this.elements.inpaintContainer.querySelector(
      '#inpaint-generate-btn'
    );
    this.elements.actionButtons = this.elements.inpaintContainer.querySelector(
      '#inpaint-action-buttons'
    );
    // this.elements.addToGalleryBtn = this.elements.inpaintContainer.querySelector('#inpaint-add-to-gallery-btn'); // Removed
    this.elements.copyParamsBtn = this.elements.inpaintContainer.querySelector(
      '#inpaint-copy-params-btn'
    );
    this.elements.downloadBtn = this.elements.inpaintContainer.querySelector(
      '#inpaint-download-btn'
    );

    // Finetune elements
    this.elements.finetuneSelector =
      this.elements.inpaintContainer.querySelector(
        '#inpaint-finetune-selector'
      );
    this.elements.finetuneStrengthContainer =
      this.elements.inpaintContainer.querySelector(
        '#inpaint-finetune-strength-container'
      );
    this.elements.finetuneStrengthSlider =
      this.elements.inpaintContainer.querySelector(
        '#inpaint-finetune-strength-slider'
      );
    this.elements.finetuneStrengthValue =
      this.elements.inpaintContainer.querySelector(
        '#inpaint-finetune-strength-value'
      );
  },

  // Setup event listeners
  setupEventListeners: function () {
    // File input change
    this.elements.fileInput.addEventListener('change', (event) => {
      const file = event.target.files[0];
      if (file) {
        this.elements.fileNameLabel.textContent = file.name;
        const reader = new FileReader();
        reader.onload = (e) => {
          this.setInputImage(e.target.result);
        };
        reader.readAsDataURL(file);
      }
    });

    // Canvas drawing listeners
    this.elements.canvas.addEventListener(
      'mousedown',
      this.startDrawing.bind(this)
    );
    this.elements.canvas.addEventListener(
      'mouseup',
      this.stopDrawing.bind(this)
    );
    this.elements.canvas.addEventListener(
      'mouseout',
      this.stopDrawing.bind(this)
    );
    this.elements.canvas.addEventListener('mousemove', this.draw.bind(this));
    // Touch events
    this.elements.canvas.addEventListener(
      'touchstart',
      this.startDrawing.bind(this),
      { passive: false }
    );
    this.elements.canvas.addEventListener(
      'touchend',
      this.stopDrawing.bind(this)
    );
    this.elements.canvas.addEventListener(
      'touchcancel',
      this.stopDrawing.bind(this)
    );
    this.elements.canvas.addEventListener('touchmove', this.draw.bind(this), {
      passive: false
    });

    // Sliders
    this.setupSlider(
      this.elements.brushSizeSlider,
      this.elements.brushSizeLabel,
      (value) => {
        this.brushSize = parseInt(value, 10);
      }
    );
    this.setupSlider(this.elements.stepsSlider, this.elements.stepsValue);
    this.setupSlider(this.elements.guidanceSlider, this.elements.guidanceValue);
    this.setupSlider(this.elements.safetySlider, this.elements.safetyValue);
    this.setupSlider(
      this.elements.finetuneStrengthSlider,
      this.elements.finetuneStrengthValue
    ); // Setup finetune slider

    // Clear mask button
    this.elements.clearMaskBtn.addEventListener(
      'click',
      this.clearMask.bind(this)
    );

    // Random seed button
    this.elements.randomSeedBtn.addEventListener(
      'click',
      this.generateRandomSeed.bind(this)
    );

    // Advanced toggle
    this.elements.advancedToggle.addEventListener(
      'click',
      this.toggleAdvancedOptions.bind(this)
    );

    // Finetune selector listener
    this.elements.finetuneSelector.addEventListener(
      'change',
      this.handleFinetuneSelection.bind(this)
    );

    // Generate button click
    this.elements.generateBtn.addEventListener(
      'click',
      this.generateInpaint.bind(this)
    );

    // Action buttons
    // this.elements.addToGalleryBtn.addEventListener('click', this.addToGallery.bind(this)); // Removed
    this.elements.copyParamsBtn.addEventListener(
      'click',
      this.copyParams.bind(this)
    );
    this.elements.downloadBtn.addEventListener(
      'click',
      this.downloadImage.bind(this)
    );

    // Ensure generate button is disabled initially
    this.elements.generateBtn.disabled = true;
  },

  // Setup a range slider to update its value display and optionally a callback
  setupSlider: function (slider, valueDisplay, callback) {
    if (slider && valueDisplay) {
      slider.addEventListener('input', () => {
        valueDisplay.textContent = slider.value;
        if (callback) {
          callback(slider.value);
        }
      });
      // Initialize display
      valueDisplay.textContent = slider.value;
      if (callback) {
        callback(slider.value);
      }
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

  // Generate a random seed
  generateRandomSeed: function () {
    this.elements.seedInput.value = Math.floor(Math.random() * 1000000);
  },

  // Set input image from gallery or file upload
  setInputImage: function (imageDataUrl) {
    console.log('Setting input image for inpainting');
    this.imageData = imageDataUrl; // Store the data URL
    this.elements.sourceImage.src = ''; // Clear previous src to ensure onload triggers reliably
    this.elements.sourceImage.onload = () => {
      // Ensure image is loaded before drawing to canvas
      console.log('Source image loaded, initializing canvas');
      this.originalWidth = this.elements.sourceImage.naturalWidth;
      this.originalHeight = this.elements.sourceImage.naturalHeight;
      this.initializeCanvas();
      this.elements.canvasContainer.style.display = 'block';
      this.elements.generateBtn.disabled = false; // Enable generate button
      this.resetOutput(); // Clear previous output
      this.elements.outputPlaceholder.textContent = 'Draw mask on the image';
      this.elements.outputPlaceholder.classList.remove('hidden');
      this.elements.loadingIndicator.classList.add('hidden');
      this.elements.outputImage.classList.add('hidden');
      // Update file name label if it wasn't a file upload
      if (
        !this.elements.fileInput.files ||
        this.elements.fileInput.files.length === 0
      ) {
        this.elements.fileNameLabel.textContent = `Image (${this.originalWidth}x${this.originalHeight})`;
      }
    };
    this.elements.sourceImage.onerror = () => {
      this.elements.generateBtn.disabled = true; // Disable if image fails to load
      this.elements.canvasContainer.style.display = 'none';
      this.imageData = null;
      this.elements.fileNameLabel.textContent = 'No file selected';
      FluxUI.showNotification('Failed to load image for inpainting.', 'error');
    };
    this.elements.sourceImage.src = imageDataUrl; // Set src AFTER defining onload/onerror
  },

  // Initialize the masking canvas (visible) and the hidden mask layer
  initializeCanvas: function () {
    const img = this.elements.sourceImage;
    const displayCanvas = this.elements.canvas;
    const displayCtx = this.elements.ctx;

    // --- Initialize Visible Display Canvas ---
    const containerWidth = this.elements.canvasContainer.offsetWidth || 512; // Default if not rendered yet
    const scale = Math.min(1, containerWidth / img.naturalWidth);
    displayCanvas.width = img.naturalWidth * scale;
    displayCanvas.height = img.naturalHeight * scale;
    this.displayCanvasScale = scale; // Store the scale factor

    // Draw the image onto the display canvas as background
    displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
    displayCtx.drawImage(img, 0, 0, displayCanvas.width, displayCanvas.height);

    // Prepare for drawing the preview mask on the display canvas
    displayCtx.fillStyle = 'rgba(255, 255, 255, 0.5)'; // Semi-transparent white for mask preview
    displayCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)'; // Use semi-transparent for stroke too
    displayCtx.lineWidth = this.brushSize;
    displayCtx.lineCap = 'round';
    displayCtx.lineJoin = 'round';

    // --- Initialize Hidden Mask Layer Canvas ---
    if (!this.maskLayerCanvas) {
      this.maskLayerCanvas = document.createElement('canvas');
    }
    this.maskLayerCanvas.width = this.originalWidth;
    this.maskLayerCanvas.height = this.originalHeight;
    this.maskLayerCtx = this.maskLayerCanvas.getContext('2d');

    // Initialize mask layer to black
    this.maskLayerCtx.fillStyle = 'black';
    this.maskLayerCtx.fillRect(
      0,
      0,
      this.maskLayerCanvas.width,
      this.maskLayerCanvas.height
    );

    // Prepare mask layer context for drawing (solid white)
    this.maskLayerCtx.strokeStyle = 'white';
    this.maskLayerCtx.fillStyle = 'white';
    this.maskLayerCtx.lineWidth = this.brushSize / this.displayCanvasScale; // Scale brush size for original resolution
    this.maskLayerCtx.lineCap = 'round';
    this.maskLayerCtx.lineJoin = 'round';

    // Clear any previous mask data URL
    this.maskData = null;
    console.log(
      `Display Canvas initialized: ${displayCanvas.width}x${displayCanvas.height}, Scale: ${this.displayCanvasScale}`
    );
    console.log(
      `Mask Layer Canvas initialized: ${this.maskLayerCanvas.width}x${this.maskLayerCanvas.height}`
    );
  },

  // Get mouse/touch position relative to canvas
  getCanvasPosition: function (event) {
    const canvas = this.elements.canvas;
    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if (event.touches && event.touches.length > 0) {
      clientX = event.touches[0].clientX;
      clientY = event.touches[0].clientY;
      event.preventDefault(); // Prevent scrolling while drawing
    } else {
      clientX = event.clientX;
      clientY = event.clientY;
    }

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    return {
      x: (clientX - rect.left) * scaleX,
      y: (clientY - rect.top) * scaleY
    };
  },

  // Start drawing mask
  startDrawing: function (event) {
    this.isDrawing = true;
    const pos = this.getCanvasPosition(event); // Position on display canvas
    [this.lastX, this.lastY] = [pos.x, pos.y];

    // Calculate position and brush size for the hidden mask layer (original resolution)
    const maskX = pos.x / this.displayCanvasScale;
    const maskY = pos.y / this.displayCanvasScale;
    const maskBrushSize = this.brushSize / this.displayCanvasScale;

    // Draw preview dot on visible canvas
    this.elements.ctx.beginPath();
    this.elements.ctx.arc(pos.x, pos.y, this.brushSize / 2, 0, Math.PI * 2);
    this.elements.ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    this.elements.ctx.fill();

    // Draw solid white dot on hidden mask canvas
    this.maskLayerCtx.beginPath();
    this.maskLayerCtx.arc(maskX, maskY, maskBrushSize / 2, 0, Math.PI * 2);
    this.maskLayerCtx.fillStyle = 'white';
    this.maskLayerCtx.fill();
  },

  // Stop drawing mask
  stopDrawing: function () {
    if (this.isDrawing) {
      this.isDrawing = false;
      this.elements.ctx.beginPath(); // Reset display path
      this.maskLayerCtx.beginPath(); // Reset mask path
    }
  },

  // Draw mask on canvas
  draw: function (event) {
    if (!this.isDrawing) return;

    const pos = this.getCanvasPosition(event); // Position on display canvas
    const displayCtx = this.elements.ctx;
    const maskCtx = this.maskLayerCtx;

    // Calculate position and brush size for the hidden mask layer
    const maskX = pos.x / this.displayCanvasScale;
    const maskY = pos.y / this.displayCanvasScale;
    const lastMaskX = this.lastX / this.displayCanvasScale;
    const lastMaskY = this.lastY / this.displayCanvasScale;
    const maskBrushSize = this.brushSize / this.displayCanvasScale;

    // Draw preview line on visible canvas
    displayCtx.lineWidth = this.brushSize;
    displayCtx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    displayCtx.beginPath();
    displayCtx.moveTo(this.lastX, this.lastY);
    displayCtx.lineTo(pos.x, pos.y);
    displayCtx.stroke();

    // Draw solid white line on hidden mask canvas
    maskCtx.lineWidth = maskBrushSize;
    maskCtx.strokeStyle = 'white';
    maskCtx.beginPath();
    maskCtx.moveTo(lastMaskX, lastMaskY);
    maskCtx.lineTo(maskX, maskY);
    maskCtx.stroke();

    [this.lastX, this.lastY] = [pos.x, pos.y];
  },

  // Clear the mask drawing
  clearMask: function () {
    if (!this.imageData) return; // Don't clear if no image loaded
    const displayCanvas = this.elements.canvas;
    const displayCtx = this.elements.ctx;
    const maskCanvas = this.maskLayerCanvas;
    const maskCtx = this.maskLayerCtx;

    // Clear the visible display canvas and redraw the image
    displayCtx.clearRect(0, 0, displayCanvas.width, displayCanvas.height);
    displayCtx.drawImage(
      this.elements.sourceImage,
      0,
      0,
      displayCanvas.width,
      displayCanvas.height
    );

    // Clear the hidden mask canvas (fill with black)
    if (maskCtx) {
      maskCtx.fillStyle = 'black';
      maskCtx.fillRect(0, 0, maskCanvas.width, maskCanvas.height);
    }

    this.maskData = null; // Reset mask data URL
    console.log('Mask cleared (display and hidden layer)');
  },

  // Get mask data as base64 string (black and white)
  // Get mask data as base64 string (black and white) from the hidden mask layer
  getMaskDataURL: function () {
    if (!this.maskLayerCanvas) {
      console.error('Mask layer canvas not initialized.');
      return null;
    }
    // Optional: Check if the mask is empty before returning?
    // const maskPixelData = this.maskLayerCtx.getImageData(0, 0, this.maskLayerCanvas.width, this.maskLayerCanvas.height).data;
    // let hasWhitePixels = false;
    // for (let i = 0; i < maskPixelData.length; i += 4) {
    //     if (maskPixelData[i] === 255) { // Check Red channel for white
    //         hasWhitePixels = true;
    //         break;
    //     }
    // }
    // if (!hasWhitePixels) {
    //     console.warn("Mask layer is empty (all black).");
    //     // Return null or the all-black mask depending on desired behavior
    // }

    // Return the data URL (base64 encoded PNG) of the hidden mask layer
    return this.maskLayerCanvas.toDataURL('image/png');
  },

  // Reset output area to initial state
  resetOutput: function () {
    this.elements.outputImage.classList.add('hidden');
    this.elements.outputImage.src = '';
    this.elements.loadingIndicator.classList.add('hidden');
    this.elements.outputPlaceholder.textContent = this.imageData
      ? 'Draw mask on the image'
      : 'Load an image and draw a mask';
    this.elements.outputPlaceholder.classList.remove('hidden');
    this.elements.actionButtons.classList.add('hidden'); // Hide all action buttons initially
    this.currentImageUrl = '';
    this.currentParams = {};
  },

  // Show loading state
  showLoading: function (message = 'Generating...') {
    this.elements.outputPlaceholder.classList.add('hidden');
    this.elements.outputImage.classList.add('hidden');
    this.elements.loadingText.textContent = message;
    this.elements.loadingIndicator.classList.remove('hidden');
    this.elements.actionButtons.classList.add('hidden');
  },

  // Show progress during polling
  showProgress: function (progress) {
    const percentage = Math.round(progress * 100);
    this.showLoading(`Generating... ${percentage}%`);
  },

  // Handle successful generation
  handleSuccess: function (imageUrl, resultData) {
    this.elements.loadingIndicator.classList.add('hidden');
    this.elements.outputImage.src = FluxAPI.getProxiedImageUrl(imageUrl); // Use proxy
    this.elements.outputImage.classList.remove('hidden');
    this.elements.actionButtons.classList.remove('hidden'); // Show action buttons
    // this.elements.addToGalleryBtn.classList.remove('hidden'); // Removed
    this.elements.copyParamsBtn.classList.remove('hidden');
    this.elements.downloadBtn.classList.remove('hidden');
    this.elements.generateBtn.disabled = false;
    this.currentImageUrl = this.elements.outputImage.src; // Store proxied URL

    // Store parameters used for this generation
    this.currentParams =
      resultData.details?.request_params || this.currentParams; // Store request params if available
    this.currentParams.model =
      resultData.details?.model_id ||
      (this.selectedFinetune
        ? 'flux-pro-1.0-fill-finetuned'
        : 'flux-pro-1.0-fill'); // Add model info (actual endpoint used)
    // Ensure finetune details are stored if they were used and returned
    if (resultData.details?.request_params?.finetune_id) {
      this.currentParams.finetune_id =
        resultData.details.request_params.finetune_id;
      this.currentParams.finetune_strength =
        resultData.details.request_params.finetune_strength;
    } else {
      delete this.currentParams.finetune_id;
      delete this.currentParams.finetune_strength;
    }
    this.currentParams.timestamp = new Date().toISOString();

    // Automatically add to gallery
    this.addToGallery();

    FluxUI.showNotification('Inpainting successful!', 'success');
  },

  // Handle generation error
  handleError: function (error) {
    console.error('Inpaint Error:', error);
    this.elements.loadingIndicator.classList.add('hidden');
    this.elements.outputPlaceholder.textContent = `Error: ${error.message}`;
    this.elements.outputPlaceholder.classList.remove('hidden');
    this.elements.generateBtn.disabled = false;
    this.elements.actionButtons.classList.add('hidden');
    FluxUI.showNotification(`Inpaint failed: ${error.message}`, 'error');
  },

  // Generate inpaint image
  generateInpaint: async function () {
    if (!this.imageData) {
      FluxUI.showNotification('Please load an image first.', 'warning');
      return;
    }

    // Get mask data (ensuring it's generated at original resolution)
    this.maskData = this.getMaskDataURL();
    if (!this.maskData) {
      FluxUI.showNotification('Could not generate mask data.', 'error');
      return;
    }

    // Optional: Basic check if mask is empty (can be done within getMaskDataURL or here)
    // This simplified check assumes getMaskDataURL provides a valid data URL
    if (this.maskData.length < 100) {
      // Very basic check for empty data URL possibility
      FluxUI.showNotification(
        'Mask data seems empty. Please draw a mask.',
        'warning'
      );
      return;
    }
    // More robust check (optional): Load maskData to check for white pixels if needed
    // const checkMask = async () => { ... code similar to removed block ... };
    // await checkMask(); // If you want to keep the explicit check

    // --- Proceed with generation ---
    // Removed the complex async validation block that loaded the mask image
    // as the new getMaskDataURL is more reliable.
    (async () => {
      // Wrap the rest in an async IIFE to keep structure
      this.elements.generateBtn.disabled = true;
      this.showLoading('Starting generation...');

      const prompt = this.elements.promptInput.value.trim();
      const selectedFormat = this.elements.inpaintContainer.querySelector(
        'input[name="inpaint-output-format"]:checked'
      );

      // Check if seed should be randomized before generation
      if (this.elements.randomizeSeedCheckbox.checked) {
        this.generateRandomSeed(); // Update the input field with a new random seed
      }

      const params = {
        image: this.imageData.split(',')[1], // Send base64 part only
        mask: this.maskData.split(',')[1], // Send base64 part only
        prompt: prompt || '', // Send empty string if no prompt
        steps: parseInt(this.elements.stepsSlider.value) || 50,
        guidance: parseFloat(this.elements.guidanceSlider.value) || 60,
        seed: this.elements.seedInput.value
          ? parseInt(this.elements.seedInput.value)
          : null, // Use potentially randomized seed
        prompt_upsampling: this.elements.promptUpsamplingInput.checked,
        output_format: selectedFormat ? selectedFormat.value : 'jpeg',
        safety_tolerance: parseInt(this.elements.safetySlider.value) || 2
      };

      // Determine API endpoint and add finetune params if selected
      let apiEndpoint = 'flux-pro-1.0-fill';
      const finetuneId = this.elements.finetuneSelector.value;
      if (finetuneId) {
        apiEndpoint = 'flux-pro-1.0-fill-finetuned';
        params.finetune_id = finetuneId;
        params.finetune_strength = parseFloat(
          this.elements.finetuneStrengthSlider.value
        );
      }

      // Store params for potential gallery add / copy
      this.currentParams = { ...params };
      // Remove base64 data before storing potentially large strings
      delete this.currentParams.image;
      delete this.currentParams.mask;

      try {
        const response = await FluxAPI.makeRequest(apiEndpoint, params);
        console.log('Inpaint API Response:', response);

        if (response.id) {
          this.showLoading('Task submitted, waiting for result...');
          FluxAPI.pollForResult(
            response.id,
            this.showProgress.bind(this),
            this.handleSuccess.bind(this),
            this.handleError.bind(this)
          );
        } else {
          throw new Error('Invalid API response, missing task ID.');
        }
      } catch (error) {
        this.handleError(error);
      }
    })(); // End of async IIFE
  },

  // Add generated image to gallery
  addToGallery: function () {
    if (this.currentImageUrl && FluxGallery) {
      // Fetch the actual image data from the proxied URL to store in gallery
      fetch(this.currentImageUrl)
        .then((response) => response.blob())
        .then((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64data = reader.result;
            // Add necessary metadata
            const metadata = {
              ...this.currentParams, // Include parameters used
              prompt: this.elements.promptInput.value.trim(), // Get latest prompt value
              // Extract width/height from the loaded image if possible
              width: this.elements.outputImage.naturalWidth || null,
              height: this.elements.outputImage.naturalHeight || null,
              seed: this.currentParams.seed || 'N/A', // Ensure seed is captured
              model: this.currentParams.model // Use the stored model/endpoint name
            };
            FluxGallery.addImage(base64data, metadata);
            FluxUI.showNotification('Image added to gallery!', 'success');
          };
          reader.readAsDataURL(blob);
        })
        .catch((error) => {
          console.error('Error fetching image blob for gallery:', error);
          FluxUI.showNotification(
            'Failed to add image to gallery: ' + error.message,
            'error'
          ); // Add user notification with error message
        });
    } else {
      FluxUI.showNotification(
        'No image generated yet or gallery not available.',
        'warning'
      );
    }
  },

  // Copy parameters to clipboard
  copyParams: function () {
    if (!this.currentImageUrl || Object.keys(this.currentParams).length === 0) {
      FluxUI.showNotification('No parameters available to copy.', 'warning');
      return;
    }
    const paramsToCopy = {
      ...this.currentParams, // Includes finetune details if used
      prompt: this.elements.promptInput.value.trim(), // Ensure latest prompt is copied
      model: this.currentParams.model // Use the stored model/endpoint name
    };
    navigator.clipboard
      .writeText(JSON.stringify(paramsToCopy, null, 2))
      .then(() => FluxUI.showNotification('Parameters copied!', 'success'))
      .catch((err) => {
        console.error('Failed to copy parameters:', err);
        FluxUI.showNotification('Failed to copy parameters.', 'error');
      });
  },

  // Download the generated image
  downloadImage: function () {
    if (!this.currentImageUrl) {
      FluxUI.showNotification('No image available to download.', 'warning');
      return;
    }
    const link = document.createElement('a');
    link.href = this.currentImageUrl; // Use the proxied URL directly if possible, or fetch blob
    const format = this.currentParams.output_format || 'jpeg';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.download = `flux-inpaint-${timestamp}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    FluxUI.showNotification('Image download started.', 'success');
  },

  // Handle finetune selection change
  handleFinetuneSelection: function () {
    const selectedValue = this.elements.finetuneSelector.value;
    this.selectedFinetune = selectedValue || null; // Store null if "None" is selected

    // Show/hide strength slider
    this.elements.finetuneStrengthContainer.classList.toggle(
      'hidden',
      !this.selectedFinetune
    );

    // Set default strength when a finetune is selected (Inpaint uses 1.1 default)
    if (this.selectedFinetune) {
      const defaultStrength = 1.1;
      this.elements.finetuneStrengthSlider.value = defaultStrength;
      this.elements.finetuneStrengthValue.textContent = defaultStrength;
    }

    console.log('Inpaint Finetune selected:', this.selectedFinetune);
  },

  // Update finetune options in the dropdown using the detailed list
  updateFinetuneOptions: function (detailedFinetunesList) {
    if (!this.elements.finetuneSelector) {
      console.warn('Inpaint Tab: Finetune selector element not found.');
      return;
    }

    // Remember the currently selected value
    const currentSelection = this.elements.finetuneSelector.value;

    // Clear existing options (keep "None")
    while (this.elements.finetuneSelector.options.length > 1) {
      this.elements.finetuneSelector.remove(1);
    }

    // Add new options from the detailed list
    if (detailedFinetunesList && detailedFinetunesList.length > 0) {
      // The list should already be sorted by comment in FinetuneTab
      detailedFinetunesList.forEach((ft) => {
        const option = document.createElement('option');
        option.value = ft.id; // Use the ID as the value
        option.textContent = ft.comment; // Display the comment (or ID fallback)
        option.title = `ID: ${ft.id}`; // Add title attribute for full ID tooltip
        // Optionally add type info if available in ft.details
        // const type = ft.details?.finetune_details?.finetune_type;
        // if (type) {
        //     option.textContent += ` (${type.charAt(0).toUpperCase() + type.slice(1)})`;
        // }
        this.elements.finetuneSelector.appendChild(option);
      });
    }

    // Try to restore previous selection
    this.elements.finetuneSelector.value = currentSelection;

    // If the previous selection is no longer valid (e.g., finetune deleted), reset to "None"
    if (this.elements.finetuneSelector.value !== currentSelection) {
      this.elements.finetuneSelector.value = '';
    }

    // Trigger change handler to update UI (e.g., hide/show strength slider)
    this.handleFinetuneSelection();

    console.log(
      'Finetune options updated in Inpaint tab based on detailed list.'
    );
  }
};

export default InpaintTab;
