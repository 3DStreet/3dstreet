/**
 * Flux Image Generator - Outpaint Tab
 * Functionality for image outpainting (expansion) using /v1/flux-pro-1.0-expand
 */

import FluxUI from './main.js';
import FluxAPI from './api.js';
import FluxGallery from './gallery.js';
import useImageGenStore from './store.js';
import ImageUploadUtils from './image-upload-utils.js';

// Outpaint tab module
const OutpaintTab = {
  // Tab state
  imageData: null, // Base64 data URL of the source image
  currentParams: {}, // Parameters used for the last successful generation
  currentImageUrl: '', // Proxied URL of the last generated image
  originalWidth: 0,
  originalHeight: 0,

  // Elements cache
  elements: {},

  // Initialize the tab
  init: function () {
    const outpaintContainer = document.getElementById('outpaint-tab');
    if (!outpaintContainer) {
      console.error('Outpaint Tab: Container element not found');
      return;
    }
    this.elements.outpaintContainer = outpaintContainer;
    this.createTabContent();
    this.getElements(); // Get elements after creating content
    this.setupEventListeners();
    // Generate an initial random seed on load
    this.generateRandomSeed();
  },

  // Create the tab content HTML (aligned with generator.js structure)
  createTabContent: function () {
    this.elements.outpaintContainer.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- Left Column: Input, Parameters -->
                <div class="lg:col-span-1 bg-white rounded-lg shadow p-6">
                    <h2 class="text-lg font-medium mb-4">Outpaint Settings</h2>

                    <!-- Image Input -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Source Image</label>
                         <label class="flex items-center justify-center w-full h-20 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer hover:bg-gray-50">
                            <div class="flex flex-col items-center">
                                <p class="text-sm text-gray-500">Click to upload or use Gallery</p>
                                <p id="outpaint-file-name" class="text-xs text-gray-400 mt-1">No file selected</p>
                            </div>
                            <input id="outpaint-file-input" type="file" class="hidden" accept="image/png, image/jpeg, image/jpg" />
                        </label>
                    </div>

                    <!-- Image Preview -->
                    <div class="mb-4" id="outpaint-preview-container" style="display: none;">
                         <label class="block text-sm font-medium text-gray-700 mb-1">Image to Expand:</label>
                         <div class="max-w-md mx-auto border border-gray-300 rounded-md overflow-hidden bg-gray-100">
                            <img id="outpaint-preview-image" class="block w-full h-auto" />
                         </div>
                         <p id="outpaint-original-size" class="text-xs text-gray-500 mt-1 text-center"></p>
                    </div>
                    <img id="outpaint-source-image" style="display: none;" /> <!-- Hidden image element to hold source -->


                    <!-- Expansion Pixels -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Pixels to Add (Max 2048 each):</label>
                        <div class="grid grid-cols-2 gap-x-4 gap-y-2">
                            <div>
                                <label for="outpaint-top" class="block text-xs font-medium text-gray-700">Top:</label>
                                <input type="number" id="outpaint-top" value="0" min="0" max="2048" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            </div>
                            <div>
                                <label for="outpaint-bottom" class="block text-xs font-medium text-gray-700">Bottom:</label>
                                <input type="number" id="outpaint-bottom" value="0" min="0" max="2048" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            </div>
                            <div>
                                <label for="outpaint-left" class="block text-xs font-medium text-gray-700">Left:</label>
                                <input type="number" id="outpaint-left" value="0" min="0" max="2048" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            </div>
                            <div>
                                <label for="outpaint-right" class="block text-xs font-medium text-gray-700">Right:</label>
                                <input type="number" id="outpaint-right" value="0" min="0" max="2048" class="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            </div>
                        </div>
                        <p id="outpaint-new-size" class="text-xs text-gray-500 mt-2 text-center"></p>
                    </div>


                    <!-- Prompt -->
                    <div class="mb-4">
                        <label for="outpaint-prompt" class="block text-sm font-medium text-gray-700 mb-1">Prompt (Optional)</label>
                        <textarea id="outpaint-prompt" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" placeholder="Describe the scene for expanded areas..."></textarea>
                    </div>

                    <!-- Parameters -->
                     <div class="mb-4 param-group">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Steps: <span id="outpaint-steps-value">50</span></label>
                        <input type="range" id="outpaint-steps-slider" min="15" max="50" value="50" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                    </div>

                    <div class="mb-4 param-group">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Guidance Scale: <span id="outpaint-guidance-value">60</span></label>
                        <input type="range" id="outpaint-guidance-slider" min="1.5" max="100" step="0.5" value="60" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer">
                    </div>

                    <!-- Advanced Options -->
                     <div class="mb-4">
                        <div class="flex justify-between items-center cursor-pointer" id="outpaint-advanced-toggle">
                            <span class="text-sm font-medium text-gray-300">Advanced Options</span>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" id="outpaint-advanced-icon">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                        <div class="mt-2 hidden" id="outpaint-advanced-options">
                            <!-- Safety Tolerance -->
                            <div class="mb-3 param-group opacity-50 cursor-not-allowed">
                                <label class="block text-sm font-medium text-gray-500 mb-1">Safety Tolerance: <span id="outpaint-safety-value">2</span></label>
                                <input type="range" id="outpaint-safety-slider" min="0" max="6" step="1" value="2" class="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-not-allowed pointer-events-none" disabled>
                                <p class="text-xs text-gray-500 mt-1">Higher values are less strict (0 = most strict, 6 = least strict)</p>
                            </div>

                            <!-- Seed -->
                            <div class="mb-3 param-group">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Seed</label>
                                <div class="flex">
                                    <input type="number" id="outpaint-seed-input" placeholder="Random" class="w-full px-3 py-2 border border-gray-300 rounded-l-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                                    <button id="outpaint-random-seed-btn" class="px-3 py-2 bg-gray-100 border border-gray-300 border-l-0 rounded-r-md hover:bg-gray-200">
                                        🎲
                                    </button>
                                </div>
                                <!-- Randomize Seed Checkbox -->
                                <div class="mt-2 flex items-center">
                                    <input type="checkbox" id="outpaint-randomize-seed-checkbox" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                                    <label for="outpaint-randomize-seed-checkbox" class="ml-2 block text-sm text-gray-700">Randomize seed before each generation</label>
                                </div>
                            </div>

                            <div class="mb-3 param-group">
                                <div class="flex items-center">
                                    <input type="checkbox" id="outpaint-prompt-upsampling" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                                    <label for="outpaint-prompt-upsampling" class="ml-2 block text-sm text-gray-700">Prompt Upsampling</label>
                                </div>
                                <p class="text-xs text-gray-500 mt-1">Enhances prompt with details</p>
                            </div>
                            <div class="mb-3">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Output Format</label>
                                <div class="flex space-x-4">
                                    <div class="flex items-center">
                                        <input type="radio" id="outpaint-format-jpeg" name="outpaint-output-format" value="jpeg" checked class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                        <label for="outpaint-format-jpeg" class="ml-2 block text-sm text-gray-700">JPEG</label>
                                    </div>
                                    <div class="flex items-center">
                                        <input type="radio" id="outpaint-format-png" name="outpaint-output-format" value="png" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                        <label for="outpaint-format-png" class="ml-2 block text-sm text-gray-700">PNG</label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Generate Button -->
                    <button id="outpaint-generate-btn" class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 flex items-center justify-center gap-2" disabled>
                        <span>Generate Outpaint</span>
                        <span class="inline-flex items-center rounded" style="background: rgba(0, 0, 0, 0.15); padding: 6px 8px; gap: 2px;">
                            <img src="/ui_assets/token-image.png" alt="Token" class="w-5 h-5" />
                            <span class="text-sm" style="opacity: 0.9; margin-right: 1px;">×</span>
                            <span class="text-sm font-medium">1</span>
                        </span>
                    </button>
                </div>

                <!-- Right Column: Output -->
                <div class="lg:col-span-2 bg-white rounded-lg shadow">
                     <div class="p-6 border-b border-gray-200">
                        <h2 class="text-lg font-medium">Result</h2>
                    </div>
                    <div class="p-6 flex flex-col items-center justify-center min-h-[500px]" id="outpaint-output-container">
                        <div id="outpaint-output-placeholder" class="text-center text-gray-400">
                             <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                             </svg>
                            <p>Load an image and set expansion</p>
                        </div>
                        <img id="outpaint-output-image" class="max-w-full max-h-[500px] hidden rounded-lg shadow-lg" alt="Outpainted Image">
                        <div id="outpaint-loading-indicator" class="hidden flex flex-col items-center">
                            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                            <p class="text-gray-600" id="outpaint-loading-text">Generating...</p>
                        </div>
                    </div>
                     <div class="px-6 pb-6">
                        <div class="flex flex-wrap justify-center gap-2 mt-4" id="outpaint-action-buttons">
                            <!-- Add to Gallery button removed as it's now automatic -->
                             <button id="outpaint-copy-params-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Copy Parameters
                            </button>
                            <button id="outpaint-download-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
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
    this.elements.fileInput = this.elements.outpaintContainer.querySelector(
      '#outpaint-file-input'
    );
    this.elements.fileNameLabel = this.elements.outpaintContainer.querySelector(
      '#outpaint-file-name'
    );
    this.elements.previewContainer =
      this.elements.outpaintContainer.querySelector(
        '#outpaint-preview-container'
      );
    this.elements.previewImage = this.elements.outpaintContainer.querySelector(
      '#outpaint-preview-image'
    );
    this.elements.sourceImage = this.elements.outpaintContainer.querySelector(
      '#outpaint-source-image'
    );
    this.elements.originalSizeLabel =
      this.elements.outpaintContainer.querySelector('#outpaint-original-size');
    this.elements.newSizeLabel =
      this.elements.outpaintContainer.querySelector('#outpaint-new-size');

    // Expansion inputs
    this.elements.topInput =
      this.elements.outpaintContainer.querySelector('#outpaint-top');
    this.elements.bottomInput =
      this.elements.outpaintContainer.querySelector('#outpaint-bottom');
    this.elements.leftInput =
      this.elements.outpaintContainer.querySelector('#outpaint-left');
    this.elements.rightInput =
      this.elements.outpaintContainer.querySelector('#outpaint-right');
    this.elements.expansionInputs = [
      this.elements.topInput,
      this.elements.bottomInput,
      this.elements.leftInput,
      this.elements.rightInput
    ];

    // Parameters
    this.elements.promptInput =
      this.elements.outpaintContainer.querySelector('#outpaint-prompt');
    this.elements.stepsSlider = this.elements.outpaintContainer.querySelector(
      '#outpaint-steps-slider'
    );
    this.elements.stepsValue = this.elements.outpaintContainer.querySelector(
      '#outpaint-steps-value'
    );
    this.elements.guidanceSlider =
      this.elements.outpaintContainer.querySelector(
        '#outpaint-guidance-slider'
      );
    this.elements.guidanceValue = this.elements.outpaintContainer.querySelector(
      '#outpaint-guidance-value'
    );
    this.elements.safetySlider = this.elements.outpaintContainer.querySelector(
      '#outpaint-safety-slider'
    );
    this.elements.safetyValue = this.elements.outpaintContainer.querySelector(
      '#outpaint-safety-value'
    );
    this.elements.seedInput = this.elements.outpaintContainer.querySelector(
      '#outpaint-seed-input'
    );
    this.elements.randomSeedBtn = this.elements.outpaintContainer.querySelector(
      '#outpaint-random-seed-btn'
    );
    this.elements.randomizeSeedCheckbox =
      this.elements.outpaintContainer.querySelector(
        '#outpaint-randomize-seed-checkbox'
      ); // New checkbox

    // Advanced
    this.elements.advancedToggle =
      this.elements.outpaintContainer.querySelector(
        '#outpaint-advanced-toggle'
      );
    this.elements.advancedOptions =
      this.elements.outpaintContainer.querySelector(
        '#outpaint-advanced-options'
      );
    this.elements.advancedIcon = this.elements.outpaintContainer.querySelector(
      '#outpaint-advanced-icon'
    );
    this.elements.promptUpsamplingInput =
      this.elements.outpaintContainer.querySelector(
        '#outpaint-prompt-upsampling'
      );
    this.elements.formatJpeg = this.elements.outpaintContainer.querySelector(
      '#outpaint-format-jpeg'
    );
    this.elements.formatPng = this.elements.outpaintContainer.querySelector(
      '#outpaint-format-png'
    );

    // Output
    this.elements.outputContainer =
      this.elements.outpaintContainer.querySelector(
        '#outpaint-output-container'
      );
    this.elements.outputPlaceholder =
      this.elements.outpaintContainer.querySelector(
        '#outpaint-output-placeholder'
      );
    this.elements.outputImage = this.elements.outpaintContainer.querySelector(
      '#outpaint-output-image'
    );
    this.elements.loadingIndicator =
      this.elements.outpaintContainer.querySelector(
        '#outpaint-loading-indicator'
      );
    this.elements.loadingText = this.elements.outpaintContainer.querySelector(
      '#outpaint-loading-text'
    );

    // Buttons
    this.elements.generateBtn = this.elements.outpaintContainer.querySelector(
      '#outpaint-generate-btn'
    );
    this.elements.actionButtons = this.elements.outpaintContainer.querySelector(
      '#outpaint-action-buttons'
    );
    // this.elements.addToGalleryBtn = this.elements.outpaintContainer.querySelector('#outpaint-add-to-gallery-btn'); // Removed
    this.elements.copyParamsBtn = this.elements.outpaintContainer.querySelector(
      '#outpaint-copy-params-btn'
    );
    this.elements.downloadBtn = this.elements.outpaintContainer.querySelector(
      '#outpaint-download-btn'
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

    // Setup drag and drop for file input
    const uploadLabel = this.elements.fileInput.parentElement;
    ImageUploadUtils.setupDragAndDrop(
      uploadLabel,
      this.elements.fileInput,
      (dataUrl, fileName) => {
        this.elements.fileNameLabel.textContent = fileName;
        this.setInputImage(dataUrl);
      }
    );

    // Expansion input changes -> update new size label
    this.elements.expansionInputs.forEach((input) => {
      input.addEventListener('input', this.updateNewSizeLabel.bind(this));
    });

    // Sliders
    this.setupSlider(this.elements.stepsSlider, this.elements.stepsValue);
    this.setupSlider(this.elements.guidanceSlider, this.elements.guidanceValue);
    this.setupSlider(this.elements.safetySlider, this.elements.safetyValue);

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

    // Generate button click
    this.elements.generateBtn.addEventListener(
      'click',
      this.generateOutpaint.bind(this)
    );

    // Keyboard shortcut for prompt input (Cmd+Enter on Mac, Ctrl+Enter on PC)
    this.elements.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.elements.generateBtn.click();
      }
    });

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

  // Setup a range slider to update its value display
  setupSlider: function (slider, valueDisplay) {
    if (slider && valueDisplay) {
      slider.addEventListener('input', () => {
        valueDisplay.textContent = slider.value;
      });
      // Initialize display
      valueDisplay.textContent = slider.value;
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
    this.imageData = imageDataUrl; // Store the data URL
    this.elements.previewImage.src = ''; // Clear previous src
    this.elements.sourceImage.src = ''; // Clear previous src

    this.elements.sourceImage.onload = () => {
      // Ensure image is loaded before using dimensions      this.originalWidth = this.elements.sourceImage.naturalWidth;
      this.originalHeight = this.elements.sourceImage.naturalHeight;
      this.elements.originalSizeLabel.textContent = `Original: ${this.originalWidth} × ${this.originalHeight} px`;
      this.updateNewSizeLabel(); // Update size label initially
      this.elements.previewImage.src = imageDataUrl; // Now set the preview src
      this.elements.previewContainer.style.display = 'block';
      this.elements.generateBtn.disabled = false; // Enable generate button
      this.resetOutput(); // Clear previous output
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
      this.elements.previewContainer.style.display = 'none';
      this.imageData = null;
      this.originalWidth = 0;
      this.originalHeight = 0;
      this.elements.fileNameLabel.textContent = 'No file selected';
      this.elements.originalSizeLabel.textContent = '';
      this.elements.newSizeLabel.textContent = '';
      FluxUI.showNotification('Failed to load image for outpainting.', 'error');
    };
    this.elements.sourceImage.src = imageDataUrl; // Set src AFTER defining onload/onerror
  },

  // Update the label showing the calculated new image size
  updateNewSizeLabel: function () {
    if (!this.originalWidth || !this.originalHeight) {
      this.elements.newSizeLabel.textContent = '';
      return;
    }

    const top = parseInt(this.elements.topInput.value) || 0;
    const bottom = parseInt(this.elements.bottomInput.value) || 0;
    const left = parseInt(this.elements.leftInput.value) || 0;
    const right = parseInt(this.elements.rightInput.value) || 0;

    const newWidth = this.originalWidth + left + right;
    const newHeight = this.originalHeight + top + bottom;

    if (newWidth > this.originalWidth || newHeight > this.originalHeight) {
      this.elements.newSizeLabel.textContent = `New Size: ${newWidth} × ${newHeight} px`;
    } else {
      this.elements.newSizeLabel.textContent = ''; // Hide if no expansion
    }
  },

  // Reset output area to initial state
  resetOutput: function () {
    this.elements.outputImage.classList.add('hidden');
    this.elements.outputImage.src = '';
    this.elements.loadingIndicator.classList.add('hidden');
    this.elements.outputPlaceholder.textContent = this.imageData
      ? 'Set expansion dimensions'
      : 'Load an image and set expansion';
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
    // Disable generate button with visual feedback
    this.elements.generateBtn.disabled = true;
    this.elements.generateBtn.classList.add('opacity-50', 'cursor-not-allowed');
  },

  // Show progress during polling
  showProgress: function (progress) {
    const percentage = Math.round(progress * 100);
    this.showLoading(`Generating... ${percentage}%`);
  },

  // Handle successful generation - FIX: Ensure image display works
  handleSuccess: function (imageUrl, resultData) {
    this.elements.loadingIndicator.classList.add('hidden');
    this.elements.outputPlaceholder.classList.add('hidden'); // Hide placeholder

    // Set the src for the output image using the proxy
    const proxiedUrl = FluxAPI.getProxiedImageUrl(imageUrl);
    this.elements.outputImage.src = proxiedUrl;
    this.elements.outputImage.classList.remove('hidden'); // Make image visible

    this.elements.actionButtons.classList.remove('hidden'); // Show action buttons
    // this.elements.addToGalleryBtn.classList.remove('hidden'); // Removed
    this.elements.copyParamsBtn.classList.remove('hidden');
    this.elements.downloadBtn.classList.remove('hidden');
    // Re-enable generate button and remove visual feedback
    this.elements.generateBtn.disabled = false;
    this.elements.generateBtn.classList.remove(
      'opacity-50',
      'cursor-not-allowed'
    );
    this.currentImageUrl = proxiedUrl; // Store proxied URL

    // Store parameters used for this generation
    this.currentParams =
      resultData.details?.request_params || this.currentParams; // Store request params if available
    this.currentParams.model =
      resultData.details?.model_id || 'flux-pro-1.0-expand'; // Add model info
    this.currentParams.timestamp = new Date().toISOString();

    // Automatically add to gallery
    this.addToGallery();

    FluxUI.showNotification('Outpainting successful!', 'success');
  },

  // Handle generation error
  handleError: function (error) {
    console.error('Outpaint Error:', error);
    this.elements.loadingIndicator.classList.add('hidden');
    this.elements.outputPlaceholder.textContent = `Error: ${error.message}`;
    this.elements.outputPlaceholder.classList.remove('hidden');
    // Re-enable generate button and remove visual feedback
    this.elements.generateBtn.disabled = false;
    this.elements.generateBtn.classList.remove(
      'opacity-50',
      'cursor-not-allowed'
    );
    this.elements.actionButtons.classList.add('hidden');
    FluxUI.showNotification(`Outpaint failed: ${error.message}`, 'error');
  },

  // Generate outpaint image
  generateOutpaint: async function () {
    // Check if user is authenticated
    if (!window.authState || !window.authState.isAuthenticated) {
      useImageGenStore.getState().setModal('signin');
      return;
    }

    if (!this.imageData) {
      FluxUI.showNotification('Please load an image first.', 'warning');
      return;
    }

    const top = parseInt(this.elements.topInput.value) || 0;
    const bottom = parseInt(this.elements.bottomInput.value) || 0;
    const left = parseInt(this.elements.leftInput.value) || 0;
    const right = parseInt(this.elements.rightInput.value) || 0;

    if (top === 0 && bottom === 0 && left === 0 && right === 0) {
      FluxUI.showNotification(
        'Please enter pixels to add in at least one direction.',
        'warning'
      );
      return;
    }
    if (top < 0 || bottom < 0 || left < 0 || right < 0) {
      FluxUI.showNotification(
        'Expansion values cannot be negative.',
        'warning'
      );
      return;
    }
    if (top > 2048 || bottom > 2048 || left > 2048 || right > 2048) {
      FluxUI.showNotification(
        'Expansion values cannot exceed 2048.',
        'warning'
      );
      return;
    }

    this.showLoading('Starting generation...');

    const prompt = this.elements.promptInput.value.trim();
    const selectedFormat = this.elements.outpaintContainer.querySelector(
      'input[name="outpaint-output-format"]:checked'
    );

    // Check if seed should be randomized before generation
    if (this.elements.randomizeSeedCheckbox.checked) {
      this.generateRandomSeed(); // Update the input field with a new random seed
    }

    const params = {
      image: this.imageData.split(',')[1], // Send base64 part only
      top: top,
      bottom: bottom,
      left: left,
      right: right,
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

    // Store params for potential gallery add / copy
    this.currentParams = { ...params };
    // Remove base64 data before storing potentially large strings
    delete this.currentParams.image;

    try {
      const response = await FluxAPI.makeRequest('flux-pro-1.0-expand', params);
      if (response.id) {
        this.showLoading('Task submitted, waiting for result...');
        FluxAPI.pollForResult(
          response.id,
          this.showProgress.bind(this),
          this.handleSuccess.bind(this),
          this.handleError.bind(this)
        );

        // Dispatch custom event to refresh token count in UI
        window.dispatchEvent(new CustomEvent('tokenCountChanged'));
      } else {
        throw new Error('Invalid API response, missing task ID.');
      }
    } catch (error) {
      this.handleError(error);
    }
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
              model: 'flux-pro-1.0-expand' // Explicitly set model
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
      ...this.currentParams,
      prompt: this.elements.promptInput.value.trim(), // Ensure latest prompt is copied
      model: 'flux-pro-1.0-expand'
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
    link.href = this.currentImageUrl; // Use the proxied URL
    const format = this.currentParams.output_format || 'jpeg';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.download = `flux-outpaint-${timestamp}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    FluxUI.showNotification('Image download started.', 'success');
  }
};

export default OutpaintTab;
