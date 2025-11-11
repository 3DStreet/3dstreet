/**
 * Video Generator - Video Tab
 * Video generation functionality using Replicate API
 */

import FluxUI from './main.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@shared/services/firebase.js';
import useImageGenStore from './store.js';
import ImageUploadUtils from './image-upload-utils.js';

// Video tab module
const VideoTab = {
  // Tab state
  currentParams: {},
  currentVideoUrl: '',
  selectedAspectRatio: '16:9', // Default aspect ratio
  selectedDuration: 5, // Default duration in seconds (5 or 10)
  imageData: null, // Base64 image data for video generation

  // DOM Elements
  elements: {},

  // Initialize the tab
  init: function () {
    // Get tab container
    const tabContainer = document.getElementById('video-tab');
    if (!tabContainer) {
      console.error('Video Tab: Container element not found!');
      return;
    }

    // Create the HTML content
    this.createTabContent(tabContainer);

    // Now that content is created, get all the necessary elements
    this.getElements();

    // Setup event listeners
    this.setupEventListeners();

    // Generate an initial random seed on load
    this.generateRandomSeed();

    // Register this module with the main UI for updates
    FluxUI.tabModules.video = this;
  },

  // Get all DOM elements after content is created
  getElements: function () {
    // Model
    this.elements.modelSelector = document.getElementById(
      'video-model-selector'
    );

    // Prompt
    this.elements.promptInput = document.getElementById('video-prompt-input');

    // Image upload
    this.elements.imageInput = document.getElementById('video-image-input');
    this.elements.imageName = document.getElementById('video-image-name');
    this.elements.imageUploadLabel = document.getElementById(
      'video-image-upload-label'
    );
    this.elements.imagePreviewContainer = document.getElementById(
      'video-image-preview-container'
    );
    this.elements.imagePreview = document.getElementById('video-image-preview');
    this.elements.imageClear = document.getElementById('video-image-clear');

    // Aspect Ratio
    this.elements.aspectRatioSelector = document.getElementById(
      'video-aspect-ratio-selector'
    );

    // Duration
    this.elements.duration5sRadio =
      document.getElementById('video-duration-5s');
    this.elements.duration10sRadio =
      document.getElementById('video-duration-10s');

    // Parameters
    this.elements.seedInput = document.getElementById('video-seed-input');
    this.elements.randomSeedBtn = document.getElementById(
      'video-random-seed-btn'
    );
    this.elements.randomizeSeedCheckbox = document.getElementById(
      'video-randomize-seed-checkbox'
    );

    // Advanced options
    this.elements.advancedToggle = document.getElementById(
      'video-advanced-toggle'
    );
    this.elements.advancedOptions = document.getElementById(
      'video-advanced-options'
    );
    this.elements.advancedIcon = document.getElementById('video-advanced-icon');

    // Preview
    this.elements.previewContainer = document.getElementById(
      'video-preview-container'
    );
    this.elements.previewVideo = document.getElementById('video-preview-video');
    this.elements.generationPlaceholder = document.getElementById(
      'video-generation-placeholder'
    );
    this.elements.loadingIndicator = document.getElementById(
      'video-loading-indicator'
    );
    this.elements.loadingText = document.getElementById('video-loading-text');

    // Action buttons
    this.elements.actionButtons = document.getElementById(
      'video-action-buttons'
    );
    this.elements.copyParamsBtn = document.getElementById(
      'video-copy-params-btn'
    );
    this.elements.openVideoBtn = document.getElementById(
      'video-open-video-btn'
    );
    this.elements.downloadVideoBtn = document.getElementById(
      'video-download-video-btn'
    );
    this.elements.copyVideoUrlBtn = document.getElementById(
      'video-copy-video-url-btn'
    );

    // Generate button
    this.elements.generateBtn = document.getElementById('video-generate-btn');
    this.elements.tokenCostDisplay =
      document.getElementById('video-token-cost');

    // Verify critical elements
    let missingElements = [];
    ['modelSelector', 'promptInput', 'generateBtn'].forEach((elem) => {
      if (!this.elements[elem]) {
        missingElements.push(elem);
      }
    });

    if (missingElements.length > 0) {
      console.error('Video Tab: Critical elements not found:', missingElements);
    }
  },

  // Create the tab content HTML
  createTabContent: function (container) {
    container.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <!-- Parameters Column -->
                <div class="lg:col-span-1 bg-white rounded-lg shadow p-6">
                    <h2 class="text-lg font-medium mb-4">Video Generation Settings</h2>

                    <!-- Model Selection -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Model</label>
                        <select id="video-model-selector" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="lightricks/ltx-2-fast" selected>LTX-2 Fast</option>
                            <option value="kwaivgi/kling-v2.5-turbo-pro">Kling v2.5 Turbo Pro</option>
                        </select>
                    </div>

                    <!-- Image Upload (Required) -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Reference Image <span class="text-red-500">*</span></label>
                        <div class="flex flex-col space-y-2">
                            <label id="video-image-upload-label" class="flex items-center justify-center w-full h-20 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer hover:bg-gray-50">
                                <div class="flex flex-col items-center">
                                    <p class="text-sm text-gray-500">Click to upload an image</p>
                                    <p id="video-image-name" class="text-xs text-gray-400 mt-1">No file selected</p>
                                </div>
                                <input id="video-image-input" type="file" class="hidden" accept="image/png, image/jpeg, image/jpg" />
                            </label>
                            <div id="video-image-preview-container" class="hidden relative">
                                <img id="video-image-preview" class="w-full rounded-lg border border-gray-300" alt="Selected image">
                                <button id="video-image-clear" class="absolute top-2 right-2 p-1 bg-white bg-opacity-80 rounded-full hover:bg-opacity-100 hover:bg-red-50 shadow hover:shadow-lg transition-all duration-200" title="Clear image">
                                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-600 hover:text-red-600 transition-colors duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Prompt (Optional) -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Prompt (Optional)</label>
                        <textarea id="video-prompt-input" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                  placeholder="create photorealistic animated render of this urban street scene with accurate shading and lighting"></textarea>
                    </div>

                    <!-- Aspect Ratio -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-1">Aspect Ratio</label>
                        <select id="video-aspect-ratio-selector" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                            <option value="16:9" selected>16:9 (Landscape)</option>
                            <option value="9:16">9:16 (Portrait)</option>
                            <option value="1:1">1:1 (Square)</option>
                            <option value="4:3">4:3</option>
                            <option value="3:4">3:4</option>
                        </select>
                    </div>

                    <!-- Duration -->
                    <div class="mb-4">
                        <label class="block text-sm font-medium text-gray-700 mb-2">Duration</label>
                        <div class="space-y-2">
                            <div class="flex items-center">
                                <input type="radio" id="video-duration-5s" name="video-duration" value="5" checked class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                <label for="video-duration-5s" class="ml-2 block text-sm text-gray-700">5 seconds (10 tokens)</label>
                            </div>
                            <div class="flex items-center">
                                <input type="radio" id="video-duration-10s" name="video-duration" value="10" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300">
                                <label for="video-duration-10s" class="ml-2 block text-sm text-gray-700">10 seconds (20 tokens)</label>
                            </div>
                        </div>
                    </div>

                    <!-- Advanced Options -->
                    <div class="mb-4">
                        <div class="flex justify-between items-center cursor-pointer" id="video-advanced-toggle">
                            <span class="text-sm font-medium text-gray-700">Advanced Options</span>
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" id="video-advanced-icon">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>

                        <div class="mt-2 hidden" id="video-advanced-options">
                            <!-- Seed -->
                            <div class="mb-3 param-group">
                                <label class="block text-sm font-medium text-gray-700 mb-1">Seed</label>
                                <div class="flex">
                                    <input type="number" id="video-seed-input" placeholder="Random" class="w-full px-3 py-2 border border-gray-300 rounded-l-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                                    <button id="video-random-seed-btn" class="px-3 py-2 bg-gray-100 border border-gray-300 border-l-0 rounded-r-md hover:bg-gray-200">
                                        🎲
                                    </button>
                                </div>
                                <!-- Randomize Seed Checkbox -->
                                <div class="mt-2 flex items-center">
                                    <input type="checkbox" id="video-randomize-seed-checkbox" class="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded">
                                    <label for="video-randomize-seed-checkbox" class="ml-2 block text-sm text-gray-700">Randomize seed before each generation</label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Generate Button -->
                    <button id="video-generate-btn" class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 flex items-center justify-center gap-2">
                        <span>Generate Video</span>
                        <span class="inline-flex items-center rounded" style="background: rgba(0, 0, 0, 0.15); padding: 6px 8px; gap: 2px;">
                            <img src="/ui_assets/token-image.png" alt="Token" class="w-5 h-5" />
                            <span class="text-sm" style="opacity: 0.9; margin-right: 1px;">×</span>
                            <span id="video-token-cost" class="text-sm font-medium">10</span>
                        </span>
                    </button>
                </div>

                <!-- Preview Column -->
                <div class="lg:col-span-2 bg-white rounded-lg shadow">
                    <div class="p-6 border-b border-gray-200">
                        <h2 class="text-lg font-medium">Preview</h2>
                    </div>
                    <div class="p-6 flex flex-col items-center justify-center min-h-[500px]" id="video-preview-container">
                        <div id="video-generation-placeholder" class="text-center text-gray-400">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                            <p>Your generated video will appear here</p>
                        </div>
                        <video id="video-preview-video" class="max-w-full max-h-[500px] hidden rounded-lg shadow-lg" controls></video>
                        <div id="video-loading-indicator" class="hidden flex flex-col items-center">
                            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
                            <p class="text-gray-600" id="video-loading-text">Generating your video... This may take a few minutes.</p>
                        </div>
                    </div>
                    <div class="px-6 pb-6">
                        <div class="flex flex-wrap justify-center gap-2 mt-4" id="video-action-buttons">
                            <button id="video-copy-params-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Copy Parameters
                            </button>
                            <button id="video-open-video-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Open Video
                            </button>
                            <button id="video-download-video-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Download Video
                            </button>
                            <button id="video-copy-video-url-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 hidden">
                                Copy Video URL
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        `;
  },

  // Setup event listeners
  setupEventListeners: function () {
    if (!this.elements.generateBtn) {
      console.error(
        'Video Tab: Cannot set up event listeners, elements not found'
      );
      return;
    }

    // Image upload
    this.elements.imageInput.addEventListener(
      'change',
      this.handleImageUpload.bind(this)
    );

    // Setup drag and drop for image
    ImageUploadUtils.setupDragAndDrop(
      this.elements.imageUploadLabel,
      this.elements.imageInput,
      (dataUrl, fileName) => {
        this.elements.imageName.textContent = fileName;
        // Store base64 data (without the data URL prefix)
        this.imageData = dataUrl.split(',')[1];
        // Show preview
        this.showImagePreview(dataUrl);
      }
    );

    // Clear image button
    if (this.elements.imageClear) {
      this.elements.imageClear.addEventListener(
        'click',
        this.clearImage.bind(this)
      );
    }

    // Duration radio buttons - update token cost display
    this.elements.duration5sRadio.addEventListener('change', () => {
      this.updateTokenCostDisplay();
    });
    this.elements.duration10sRadio.addEventListener('change', () => {
      this.updateTokenCostDisplay();
    });

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
      this.generateVideo.bind(this)
    );

    // Keyboard shortcut for prompt input (Cmd+Enter on Mac, Ctrl+Enter on PC)
    this.elements.promptInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        this.elements.generateBtn.click();
      }
    });

    // Setup action buttons
    if (this.elements.openVideoBtn) {
      this.elements.openVideoBtn.addEventListener(
        'click',
        this.openVideo.bind(this)
      );
    }

    if (this.elements.downloadVideoBtn) {
      this.elements.downloadVideoBtn.addEventListener(
        'click',
        this.downloadVideo.bind(this)
      );
    }

    if (this.elements.copyVideoUrlBtn) {
      this.elements.copyVideoUrlBtn.addEventListener(
        'click',
        this.copyVideoUrl.bind(this)
      );
    }

    if (this.elements.copyParamsBtn) {
      this.elements.copyParamsBtn.addEventListener(
        'click',
        this.copyParams.bind(this)
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

  // Update token cost display based on selected duration
  updateTokenCostDisplay: function () {
    const duration = this.getSelectedDuration();
    const tokenCost = duration === 10 ? 20 : 10;
    if (this.elements.tokenCostDisplay) {
      this.elements.tokenCostDisplay.textContent = tokenCost;
    }
  },

  // Get selected duration
  getSelectedDuration: function () {
    if (this.elements.duration10sRadio.checked) {
      return 10;
    }
    return 5; // Default to 5 seconds
  },

  // Generate a random seed
  generateRandomSeed: function () {
    this.elements.seedInput.value = Math.floor(Math.random() * 1000000);
  },

  // Generate a video
  generateVideo: function () {
    // Check if user is authenticated
    if (!window.authState || !window.authState.isAuthenticated) {
      useImageGenStore.getState().setModal('signin');
      return;
    }

    // Check if user has tokens
    const hasTokens = window.authState.tokenProfile?.genToken > 0;
    if (!hasTokens) {
      // Show purchase modal
      window.dispatchEvent(
        new CustomEvent('openPurchaseModal', {
          detail: { tokenType: 'genToken' }
        })
      );
      return;
    }

    // Build parameters
    const params = this.buildRequestParams();

    if (!params) {
      return;
    }

    // Store current parameters for later use
    this.currentParams = params;

    // Show loading state
    this.toggleLoading(true);

    // Make the API request using Firebase callable function
    // Set timeout to 9 minutes (540000ms) to match server-side timeout
    const generateReplicateVideo = httpsCallable(
      functions,
      'generateReplicateVideo',
      {
        timeout: 540000 // 9 minutes in milliseconds
      }
    );

    generateReplicateVideo(params)
      .then((result) => {
        if (result.data.success && result.data.video_url) {
          // Display the video
          this.displayVideo(result.data.video_url);

          // Dispatch custom event to refresh token count in UI
          window.dispatchEvent(new CustomEvent('tokenCountChanged'));

          this.toggleLoading(false);
          FluxUI.showNotification('Video generated successfully!', 'success');
        } else {
          throw new Error(result.data.message || 'Failed to generate video');
        }
      })
      .catch((error) => {
        console.error('Video generation error:', error);
        FluxUI.showNotification(
          error.message || 'Failed to generate video',
          'error'
        );
        this.toggleLoading(false);
      });
  },

  // Build request parameters
  buildRequestParams: function () {
    const params = {};

    // Add model name
    params.model_name = this.elements.modelSelector.value;

    // Check if image is uploaded (required)
    if (!this.imageData) {
      FluxUI.showNotification('Please upload a reference image', 'error');
      return null;
    }
    params.input_image = this.imageData;

    // Add prompt (optional with default)
    const prompt = this.elements.promptInput.value.trim();
    if (prompt) {
      params.prompt = prompt;
    } else {
      // Use default prompt
      params.prompt =
        'create photorealistic animated render of this urban street scene with accurate shading and lighting';
    }

    // Add aspect ratio
    params.aspect_ratio = this.elements.aspectRatioSelector.value;

    // Add duration (5 or 10 seconds)
    params.duration_seconds = this.getSelectedDuration();

    // Check if seed should be randomized before generation
    if (this.elements.randomizeSeedCheckbox.checked) {
      this.generateRandomSeed();
    }

    // Add seed if provided
    if (this.elements.seedInput.value) {
      params.seed = parseInt(this.elements.seedInput.value);
    }

    return params;
  },

  // Display the generated video
  displayVideo: function (videoUrl) {
    // Store the URL
    this.currentVideoUrl = videoUrl;

    // Show video
    this.elements.previewVideo.src = videoUrl;
    this.elements.previewVideo.classList.remove('hidden');
    this.elements.generationPlaceholder.classList.add('hidden');

    // Show action buttons
    this.elements.copyParamsBtn.classList.remove('hidden');
    this.elements.openVideoBtn.classList.remove('hidden');
    this.elements.downloadVideoBtn.classList.remove('hidden');
    this.elements.copyVideoUrlBtn.classList.remove('hidden');
  },

  // Toggle loading state
  toggleLoading: function (isLoading) {
    if (isLoading) {
      this.elements.loadingIndicator.classList.remove('hidden');
      this.elements.generationPlaceholder.classList.add('hidden');
      this.elements.previewVideo.classList.add('hidden');
      this.elements.generateBtn.disabled = true;
      this.elements.generateBtn.classList.add(
        'opacity-50',
        'cursor-not-allowed'
      );

      // Hide action buttons
      this.elements.copyParamsBtn.classList.add('hidden');
      this.elements.openVideoBtn.classList.add('hidden');
      this.elements.downloadVideoBtn.classList.add('hidden');
      this.elements.copyVideoUrlBtn.classList.add('hidden');
    } else {
      this.elements.loadingIndicator.classList.add('hidden');
      this.elements.generateBtn.disabled = false;
      this.elements.generateBtn.classList.remove(
        'opacity-50',
        'cursor-not-allowed'
      );
    }
  },

  // Open the video in a new tab
  openVideo: function () {
    if (!this.currentVideoUrl) {
      FluxUI.showNotification('No video to open', 'error');
      return;
    }
    window.open(this.currentVideoUrl, '_blank');
    FluxUI.showNotification('Video opened in new tab!', 'success');
  },

  // Download the video
  downloadVideo: function () {
    if (!this.currentVideoUrl) {
      FluxUI.showNotification('No video to download', 'error');
      return;
    }

    // Create download link
    const downloadLink = document.createElement('a');
    downloadLink.href = this.currentVideoUrl;

    // Generate a filename based on the timestamp
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19);
    const filename = `3dstreet-video-${timestamp}.mp4`;

    downloadLink.download = filename;

    // Append to body, click and remove
    document.body.appendChild(downloadLink);
    downloadLink.click();

    setTimeout(() => {
      document.body.removeChild(downloadLink);
    }, 100);

    FluxUI.showNotification('Video download started!', 'success');
  },

  // Copy the video URL to clipboard
  copyVideoUrl: function () {
    if (!this.currentVideoUrl) {
      FluxUI.showNotification('No video URL to copy', 'error');
      return;
    }
    navigator.clipboard
      .writeText(this.currentVideoUrl)
      .then(() => {
        FluxUI.showNotification('Video URL copied to clipboard!', 'success');
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

    // Format params as JSON string with indentation
    const paramsString = JSON.stringify(this.currentParams, null, 2);
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

  // Handle image file upload
  handleImageUpload: function (e) {
    const file = e.target.files[0];
    if (!file) return;

    this.elements.imageName.textContent = file.name;

    const reader = new FileReader();
    reader.onload = (event) => {
      // Store base64 data (without the data URL prefix)
      this.imageData = event.target.result.split(',')[1];

      // Show preview
      this.showImagePreview(event.target.result);
    };
    reader.readAsDataURL(file);
  },

  // Show image preview
  showImagePreview: function (imageDataUrl) {
    if (
      !this.elements.imagePreview ||
      !this.elements.imagePreviewContainer ||
      !this.elements.imageUploadLabel
    ) {
      return;
    }

    this.elements.imagePreview.src = imageDataUrl;
    this.elements.imagePreviewContainer.classList.remove('hidden');
    this.elements.imageUploadLabel.classList.add('hidden');
  },

  // Clear image
  clearImage: function () {
    this.imageData = null;
    this.elements.imageName.textContent = 'No file selected';
    this.elements.imagePreview.src = '';
    this.elements.imagePreviewContainer.classList.add('hidden');
    this.elements.imageUploadLabel.classList.remove('hidden');
    this.elements.imageInput.value = '';
  }
};

export default VideoTab;
