/**
 * Splat Generator - Splat Tab
 * 3D Gaussian Splat generation using Varjo Teleport API
 */

import FluxUI from './main.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@shared/services/firebase.js';
import useImageGenStore from './store.js';

// Splat tab module
const SplatTab = {
  // Tab state
  currentCapture: null, // { assetId, eid, state }
  selectedInputType: 'video', // 'video' or 'bulk-images'
  inputFile: null,
  estimatedTokens: 0,

  // Timer state
  renderStartTime: null,
  elapsedTime: 0,
  timerInterval: null,
  pollingInterval: null,

  // State machine
  currentState: 'idle', // idle, ready, initializing, uploading, finalizing, processing, downloading, complete, error

  // DOM Elements
  elements: {},

  // Initialize the tab
  init: function () {
    // Get tab container
    const tabContainer = document.getElementById('splat-tab');
    if (!tabContainer) {
      console.error('Splat Tab: Container element not found!');
      return;
    }

    // Create the HTML content
    this.createTabContent(tabContainer);

    // Get all necessary elements
    this.getElements();

    // Setup event listeners
    this.setupEventListeners();

    // Register this module with the main UI for updates
    FluxUI.tabModules.splat = this;

    // Check for pending capture from localStorage (in case user navigated away)
    this.checkForPendingCapture();
  },

  // Get all DOM elements after content is created
  getElements: function () {
    // Input type
    this.elements.inputTypeSelector =
      document.getElementById('splat-input-type');
    this.elements.inputHelp = document.getElementById('splat-input-help');

    // File upload
    this.elements.fileInput = document.getElementById('splat-file-input');
    this.elements.fileName = document.getElementById('splat-file-name');
    this.elements.fileSize = document.getElementById('splat-file-size');
    this.elements.fileUploadLabel = document.getElementById(
      'splat-file-upload-label'
    );

    // Token cost
    this.elements.tokenEstimate = document.getElementById(
      'splat-token-estimate'
    );
    this.elements.tokenCost = document.getElementById('splat-token-cost');

    // Generate button
    this.elements.generateBtn = document.getElementById('splat-generate-btn');
    this.elements.generateSpinner = document.getElementById(
      'splat-generate-spinner'
    );
    this.elements.generateText = document.getElementById('splat-generate-text');

    // Preview area
    this.elements.placeholder = document.getElementById('splat-placeholder');
    this.elements.loadingIndicator = document.getElementById(
      'splat-loading-indicator'
    );
    this.elements.progressBar = document.getElementById('splat-progress-bar');
    this.elements.loadingText = document.getElementById('splat-loading-text');
    this.elements.timerText = document.getElementById('splat-timer-text');
    this.elements.result = document.getElementById('splat-result');
    this.elements.viewerIframe = document.getElementById('splat-viewer-iframe');

    // Action buttons
    this.elements.actionButtons = document.getElementById(
      'splat-action-buttons'
    );
    this.elements.downloadBtn = document.getElementById('splat-download-btn');
    this.elements.openViewerBtn = document.getElementById(
      'splat-open-viewer-btn'
    );
    this.elements.addToSceneBtn = document.getElementById(
      'splat-add-to-scene-btn'
    );
  },

  // Create the tab content HTML
  createTabContent: function (container) {
    container.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Settings Column -->
        <div class="lg:col-span-1 bg-white rounded-lg shadow p-6">
          <h2 class="text-lg font-medium mb-1">3D Splat Generation</h2>
          <p class="text-sm text-gray-500 mb-4">Create Gaussian Splat 3D models from video or images using Varjo Teleport.</p>

          <!-- Input Type Selection -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">Input Type</label>
            <select id="splat-input-type" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              <option value="video" selected>Video (MP4)</option>
              <option value="bulk-images">Images (ZIP)</option>
            </select>
            <p id="splat-input-help" class="text-xs text-gray-400 mt-1">Upload a video file walking around an object or scene.</p>
          </div>

          <!-- File Upload -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">Source File <span class="text-red-500">*</span></label>
            <div class="flex flex-col space-y-2">
              <label id="splat-file-upload-label" class="flex items-center justify-center w-full h-24 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer hover:bg-gray-50">
                <div class="flex flex-col items-center">
                  <svg class="h-8 w-8 text-gray-400 mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p class="text-sm text-gray-500">Click or drag to upload</p>
                  <p id="splat-file-name" class="text-xs text-gray-400 mt-1">No file selected</p>
                </div>
                <input id="splat-file-input" type="file" class="hidden" accept=".mp4,.mov,.zip" />
              </label>
            </div>
            <p id="splat-file-size" class="text-xs text-gray-400 mt-1"></p>
          </div>

          <!-- Token Cost Display -->
          <div id="splat-token-estimate" class="mb-4 p-3 bg-gray-50 rounded-lg hidden">
            <div class="flex items-center justify-between">
              <span class="text-sm text-gray-600">Estimated cost:</span>
              <span class="flex items-center">
                <img src="/ui_assets/token-image.png" alt="Token" class="w-5 h-5 mr-1" />
                <span id="splat-token-cost" class="font-medium">20</span> tokens
              </span>
            </div>
          </div>

          <!-- Generate Button -->
          <button id="splat-generate-btn" class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2" disabled>
            <svg id="splat-generate-spinner" class="hidden animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span id="splat-generate-text">Generate 3D Splat</span>
          </button>
        </div>

        <!-- Preview Column -->
        <div class="lg:col-span-2 bg-white rounded-lg shadow">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-medium">Preview</h2>
          </div>
          <div class="p-6 flex flex-col items-center justify-center min-h-[500px]" id="splat-preview-container">
            <!-- Placeholder -->
            <div id="splat-placeholder" class="text-center text-gray-400">
              <svg class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2-1-2 1M4 7l2-1M4 7l2 1M4 7v2.5M12 21l-2-1m2 1l2-1m-2 1v-2.5M6 18l-2-1v-2.5M18 18l2-1v-2.5" />
              </svg>
              <p>Your 3D splat will appear here</p>
              <p class="text-sm mt-2">Processing typically takes 5-30 minutes</p>
            </div>

            <!-- Loading/Progress State -->
            <div id="splat-loading-indicator" class="hidden flex flex-col items-center w-full max-w-md">
              <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
              <div class="w-full">
                <div class="bg-gray-200 rounded-full h-2 mb-2">
                  <div id="splat-progress-bar" class="bg-indigo-600 h-2 rounded-full transition-all duration-300" style="width: 0%"></div>
                </div>
                <p id="splat-loading-text" class="text-center text-sm text-gray-600">Initializing...</p>
                <p id="splat-timer-text" class="text-center text-xs text-gray-400 mt-1">0:00</p>
              </div>
            </div>

            <!-- Result Preview (iframe to Varjo viewer) -->
            <div id="splat-result" class="hidden w-full">
              <iframe id="splat-viewer-iframe" class="w-full h-96 rounded-lg border border-gray-200" allowfullscreen></iframe>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="px-6 pb-6">
            <div id="splat-action-buttons" class="flex flex-wrap justify-center gap-2 mt-4 hidden">
              <button id="splat-download-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50">
                Download PLY
              </button>
              <button id="splat-open-viewer-btn" class="px-3 py-1.5 border border-gray-300 bg-white text-gray-600 rounded-md text-sm hover:bg-gray-50">
                Open in Viewer
              </button>
              <button id="splat-add-to-scene-btn" class="px-3 py-1.5 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700">
                Add to 3DStreet Scene
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  // Setup event listeners
  setupEventListeners: function () {
    // Input type change
    this.elements.inputTypeSelector.addEventListener('change', (e) => {
      this.selectedInputType = e.target.value;
      this.updateInputHelp();
      this.updateFileAccept();
      this.clearFile();
    });

    // File input change
    this.elements.fileInput.addEventListener('change', (e) => {
      this.handleFileSelect(e.target.files[0]);
    });

    // Drag and drop
    this.elements.fileUploadLabel.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.elements.fileUploadLabel.classList.add(
        'border-indigo-500',
        'bg-indigo-50'
      );
    });

    this.elements.fileUploadLabel.addEventListener('dragleave', (e) => {
      e.preventDefault();
      this.elements.fileUploadLabel.classList.remove(
        'border-indigo-500',
        'bg-indigo-50'
      );
    });

    this.elements.fileUploadLabel.addEventListener('drop', (e) => {
      e.preventDefault();
      this.elements.fileUploadLabel.classList.remove(
        'border-indigo-500',
        'bg-indigo-50'
      );
      const file = e.dataTransfer.files[0];
      if (file) {
        this.handleFileSelect(file);
      }
    });

    // Generate button
    this.elements.generateBtn.addEventListener('click', () => {
      this.generateSplat();
    });

    // Action buttons
    this.elements.downloadBtn.addEventListener('click', () => {
      this.downloadPly();
    });

    this.elements.openViewerBtn.addEventListener('click', () => {
      this.openViewer();
    });

    this.elements.addToSceneBtn.addEventListener('click', () => {
      this.addToScene();
    });
  },

  // Update input help text
  updateInputHelp: function () {
    if (this.selectedInputType === 'video') {
      this.elements.inputHelp.textContent =
        'Upload a video file walking around an object or scene.';
    } else {
      this.elements.inputHelp.textContent =
        'Upload a ZIP containing sequential images of the scene.';
    }
  },

  // Update file input accept attribute
  updateFileAccept: function () {
    if (this.selectedInputType === 'video') {
      this.elements.fileInput.accept = '.mp4,.mov';
    } else {
      this.elements.fileInput.accept = '.zip';
    }
  },

  // Clear file selection
  clearFile: function () {
    this.inputFile = null;
    this.elements.fileInput.value = '';
    this.elements.fileName.textContent = 'No file selected';
    this.elements.fileSize.textContent = '';
    this.elements.tokenEstimate.classList.add('hidden');
    this.elements.generateBtn.disabled = true;
    this.setState('idle');
  },

  // Handle file selection
  handleFileSelect: function (file) {
    if (!file) return;

    // Validate file type
    const ext = file.name.split('.').pop().toLowerCase();
    const validExts =
      this.selectedInputType === 'video' ? ['mp4', 'mov'] : ['zip'];
    if (!validExts.includes(ext)) {
      FluxUI.showNotification(
        `Invalid file type. Please select a ${validExts.join(' or ')} file.`,
        'error'
      );
      return;
    }

    // Validate file size (max 1GB for video, 500MB for images)
    const maxSize =
      this.selectedInputType === 'video'
        ? 1024 * 1024 * 1024
        : 500 * 1024 * 1024;
    if (file.size > maxSize) {
      const maxMB = Math.round(maxSize / (1024 * 1024));
      FluxUI.showNotification(
        `File too large. Maximum size is ${maxMB}MB.`,
        'error'
      );
      return;
    }

    this.inputFile = file;
    this.elements.fileName.textContent = file.name;
    this.elements.fileSize.textContent = `Size: ${this.formatBytes(file.size)}`;

    // Calculate and display token cost
    this.updateTokenCost();

    // Enable generate button
    this.elements.generateBtn.disabled = false;
    this.setState('ready');
  },

  // Calculate and update token cost display
  updateTokenCost: function () {
    if (!this.inputFile) return;

    const mb = this.inputFile.size / (1024 * 1024);

    if (this.selectedInputType === 'video') {
      if (mb < 100) this.estimatedTokens = 20;
      else if (mb < 500) this.estimatedTokens = 40;
      else this.estimatedTokens = 60;
    } else {
      // bulk-images (ZIP) - estimate image count from file size
      const estimatedImages = Math.ceil(
        this.inputFile.size / (5 * 1024 * 1024)
      );
      if (estimatedImages < 50) this.estimatedTokens = 15;
      else if (estimatedImages < 200) this.estimatedTokens = 30;
      else this.estimatedTokens = 50;
    }

    this.elements.tokenCost.textContent = this.estimatedTokens;
    this.elements.tokenEstimate.classList.remove('hidden');
  },

  // Format bytes to human readable string
  formatBytes: function (bytes) {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    if (bytes < 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  },

  // Set UI state
  setState: function (state) {
    this.currentState = state;

    // Reset all state-dependent UI
    this.elements.placeholder.classList.add('hidden');
    this.elements.loadingIndicator.classList.add('hidden');
    this.elements.result.classList.add('hidden');
    this.elements.actionButtons.classList.add('hidden');
    this.elements.generateSpinner.classList.add('hidden');

    switch (state) {
      case 'idle':
        this.elements.placeholder.classList.remove('hidden');
        this.elements.generateText.textContent = 'Generate 3D Splat';
        break;

      case 'ready':
        this.elements.placeholder.classList.remove('hidden');
        this.elements.generateText.textContent = 'Generate 3D Splat';
        break;

      case 'initializing':
        this.elements.loadingIndicator.classList.remove('hidden');
        this.elements.loadingText.textContent = 'Initializing capture...';
        this.elements.generateBtn.disabled = true;
        this.elements.generateSpinner.classList.remove('hidden');
        this.elements.generateText.textContent = 'Processing...';
        this.elements.progressBar.style.width = '5%';
        break;

      case 'uploading':
        this.elements.loadingIndicator.classList.remove('hidden');
        this.elements.loadingText.textContent = 'Uploading file...';
        break;

      case 'finalizing':
        this.elements.loadingIndicator.classList.remove('hidden');
        this.elements.loadingText.textContent = 'Finalizing upload...';
        this.elements.progressBar.style.width = '30%';
        break;

      case 'processing':
        this.elements.loadingIndicator.classList.remove('hidden');
        this.elements.loadingText.textContent =
          'Processing... This may take 5-30 minutes.';
        this.elements.progressBar.style.width = '40%';
        break;

      case 'downloading':
        this.elements.loadingIndicator.classList.remove('hidden');
        this.elements.loadingText.textContent = 'Downloading result...';
        this.elements.progressBar.style.width = '90%';
        break;

      case 'complete':
        this.elements.result.classList.remove('hidden');
        this.elements.actionButtons.classList.remove('hidden');
        this.elements.generateBtn.disabled = false;
        this.elements.generateText.textContent = 'Generate Another';
        this.elements.progressBar.style.width = '100%';
        break;

      case 'error':
        this.elements.placeholder.classList.remove('hidden');
        this.elements.generateBtn.disabled = false;
        this.elements.generateText.textContent = 'Try Again';
        break;
    }
  },

  // Main generation flow
  generateSplat: async function () {
    // Check if user is authenticated
    if (!window.authState || !window.authState.isAuthenticated) {
      useImageGenStore.getState().setModal('signin');
      return;
    }

    // Check if user has tokens
    const hasTokens =
      window.authState.tokenProfile?.genToken >= this.estimatedTokens;
    if (!hasTokens) {
      window.dispatchEvent(
        new CustomEvent('openPurchaseModal', {
          detail: { tokenType: 'genToken' }
        })
      );
      return;
    }

    if (!this.inputFile) {
      FluxUI.showNotification('Please select a file first', 'error');
      return;
    }

    try {
      // Step 1: Initialize capture
      this.setState('initializing');
      this.startTimer();

      const initVarjoCapture = httpsCallable(functions, 'initVarjoCapture');
      const initResult = await initVarjoCapture({
        name: this.inputFile.name,
        bytesize: this.inputFile.size,
        input_data_format:
          this.selectedInputType === 'video' ? 'video' : 'bulk-images'
      });

      if (!initResult.data.success) {
        throw new Error(
          initResult.data.message || 'Failed to initialize capture'
        );
      }

      const { assetId, capture, upload_urls: uploadUrls } = initResult.data;
      this.currentCapture = {
        assetId,
        eid: capture.eid,
        chunkSize: capture.chunk_size
      };

      // Save to localStorage in case user navigates away
      localStorage.setItem(
        'pendingSplatCapture',
        JSON.stringify({
          assetId,
          eid: capture.eid,
          timestamp: Date.now()
        })
      );

      // Step 2: Upload file chunks directly to Varjo
      this.setState('uploading');
      const parts = await this.uploadToVarjo(uploadUrls, capture.chunk_size);

      // Step 3: Finalize upload
      this.setState('finalizing');
      const finalizeVarjoUpload = httpsCallable(
        functions,
        'finalizeVarjoUpload'
      );
      const finalizeResult = await finalizeVarjoUpload({
        assetId,
        eid: capture.eid,
        parts
      });

      if (!finalizeResult.data.success) {
        throw new Error(
          finalizeResult.data.message || 'Failed to finalize upload'
        );
      }

      // Dispatch token count change event
      window.dispatchEvent(new CustomEvent('tokenCountChanged'));

      // Step 4: Show processing state
      // User can close browser - webhook will handle completion and send email
      this.setState('processing');

      // Optional: Start polling to show progress if user stays on page
      // User will also receive email notification when complete
      this.startPolling(assetId);

      FluxUI.showNotification(
        "Upload complete! Processing started. You can close this page - we'll email you when your splat is ready.",
        'success'
      );
    } catch (error) {
      console.error('Splat generation error:', error);
      this.stopTimer();
      this.stopPolling();
      this.setState('error');

      let message = 'Failed to generate splat';
      if (error.code === 'unauthenticated') {
        message = 'Please sign in to generate splats';
      } else if (error.code === 'resource-exhausted') {
        message = 'Insufficient tokens. Please purchase more tokens.';
      } else if (error.message) {
        message = error.message;
      }

      FluxUI.showNotification(message, 'error');
    }
  },

  // Upload file chunks directly to Varjo presigned URLs
  uploadToVarjo: async function (uploadUrls, chunkSize) {
    const parts = [];
    const totalParts = uploadUrls.length;

    for (let i = 0; i < totalParts; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, this.inputFile.size);
      const chunk = this.inputFile.slice(start, end);

      // Update progress
      const progress = Math.round(((i + 1) / totalParts) * 25) + 5; // 5-30%
      this.elements.progressBar.style.width = `${progress}%`;
      this.elements.loadingText.textContent = `Uploading part ${i + 1}/${totalParts}...`;

      // Upload chunk with retry
      let retries = 3;
      let response;
      while (retries > 0) {
        try {
          response = await fetch(uploadUrls[i].url, {
            method: 'PUT',
            body: chunk
          });

          if (response.ok) break;
        } catch (e) {
          console.error(`Upload error for part ${i + 1}:`, e);
        }
        retries--;
        if (retries === 0) {
          throw new Error(`Upload failed for part ${i + 1}`);
        }
        await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait 1s before retry
      }

      // Extract ETag from response headers
      const etag = response.headers.get('etag')?.replace(/"/g, '') || '';
      parts.push({ number: i + 1, etag });
    }

    return parts;
  },

  // Start polling for completion (optional - webhook handles main completion)
  // User can close browser and rely on email notification instead
  startPolling: function (assetId) {
    let pollCount = 0;
    const maxPolls = 360; // 30 minutes at 5-second intervals

    this.pollingInterval = setInterval(async () => {
      pollCount++;

      if (pollCount > maxPolls) {
        this.stopPolling();
        FluxUI.showNotification(
          "Processing is taking longer than expected. You'll receive an email when complete.",
          'warning'
        );
        return;
      }

      try {
        const checkVarjoStatus = httpsCallable(functions, 'checkVarjoStatus');
        const result = await checkVarjoStatus({ assetId });

        if (result.data.state === 'ready') {
          this.stopPolling();
          this.stopTimer();
          // Server has already saved the file - use storageUrl from response
          this.displayResult(result.data.storageUrl, result.data.viewerUrl);
        } else if (result.data.state === 'error') {
          this.stopPolling();
          this.stopTimer();
          this.setState('error');
          FluxUI.showNotification(
            `Processing failed: ${result.data.message || 'Unknown error'}`,
            'error'
          );
          localStorage.removeItem('pendingSplatCapture');
        } else {
          // Update progress indicator
          const progress = Math.min(40 + pollCount * 0.15, 85); // 40-85%
          this.elements.progressBar.style.width = `${progress}%`;
        }
      } catch (error) {
        console.error('Status check error:', error);
        // Don't stop polling on transient errors
      }
    }, 5000); // Poll every 5 seconds
  },

  // Stop polling
  stopPolling: function () {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  },

  // Display result when splat is ready
  // Note: The file is saved to Firebase Storage server-side via webhook
  displayResult: function (storageUrl, viewerUrl) {
    this.currentCapture.storageUrl = storageUrl;
    this.currentCapture.viewerUrl = viewerUrl;

    // Show viewer iframe if URL is available
    if (viewerUrl) {
      this.elements.viewerIframe.src = viewerUrl;
    }

    this.setState('complete');

    // Clear pending capture from localStorage
    localStorage.removeItem('pendingSplatCapture');

    FluxUI.showNotification(
      '3D Splat generation complete! Your splat has been saved to your gallery.',
      'success'
    );
  },

  // Download PLY file from Firebase Storage
  downloadPly: function () {
    const downloadUrl = this.currentCapture?.storageUrl;
    if (!downloadUrl) {
      FluxUI.showNotification('No file to download', 'error');
      return;
    }

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `${this.inputFile?.name || 'splat'}.ply`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    FluxUI.showNotification('Download started!', 'success');
  },

  // Open in Varjo viewer
  openViewer: function () {
    if (!this.currentCapture?.viewerUrl) {
      FluxUI.showNotification('No viewer URL available', 'error');
      return;
    }

    window.open(this.currentCapture.viewerUrl, '_blank');
  },

  // Add to 3DStreet scene
  addToScene: function () {
    const splatUrl = this.currentCapture?.storageUrl;
    if (!splatUrl) {
      FluxUI.showNotification('No splat file available', 'error');
      return;
    }

    // Check if we're in the editor context
    if (window.AFRAME && window.AFRAME.INSPECTOR) {
      // Create entity directly
      const definition = {
        class: 'splat-model',
        'data-layer-name': 'Splat Model',
        'data-no-pause': '',
        components: {
          gaussian_splatting: `src: ${splatUrl}`
        }
      };

      const entity = window.AFRAME.INSPECTOR.execute(
        'entitycreate',
        definition
      );
      if (entity) {
        entity.play();
      }

      FluxUI.showNotification('Splat added to scene!', 'success');
    } else {
      // Open editor with the splat URL as a parameter
      const editorUrl = `${window.location.origin}/#splat=${encodeURIComponent(splatUrl)}`;
      window.open(editorUrl, '_blank');
      FluxUI.showNotification(
        'Opening editor to add splat to scene...',
        'success'
      );
    }
  },

  // Check for pending capture from localStorage
  checkForPendingCapture: function () {
    try {
      const pendingJson = localStorage.getItem('pendingSplatCapture');
      if (!pendingJson) return;

      const pending = JSON.parse(pendingJson);

      // Check if capture is recent (within 1 hour)
      if (Date.now() - pending.timestamp > 60 * 60 * 1000) {
        localStorage.removeItem('pendingSplatCapture');
        return;
      }

      // Restore capture state and resume polling
      this.currentCapture = {
        assetId: pending.assetId,
        eid: pending.eid
      };

      this.setState('processing');
      this.startTimer();
      this.startPolling(pending.assetId);

      FluxUI.showNotification(
        'Resuming previous splat generation...',
        'success'
      );
    } catch (error) {
      console.error('Failed to restore pending capture:', error);
      localStorage.removeItem('pendingSplatCapture');
    }
  },

  // Start timer
  startTimer: function () {
    this.renderStartTime = Date.now();
    this.elapsedTime = 0;
    this.updateTimerDisplay();

    this.timerInterval = setInterval(() => {
      this.elapsedTime = Math.round((Date.now() - this.renderStartTime) / 1000);
      this.updateTimerDisplay();
    }, 1000);
  },

  // Stop timer
  stopTimer: function () {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    this.renderStartTime = null;
  },

  // Update timer display
  updateTimerDisplay: function () {
    const minutes = Math.floor(this.elapsedTime / 60);
    const seconds = this.elapsedTime % 60;
    this.elements.timerText.textContent = `${minutes}:${seconds
      .toString()
      .padStart(2, '0')}`;
  }
};

export default SplatTab;
