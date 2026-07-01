/**
 * 3D Model Tab
 *
 * The "3D Model" medium alongside Image, Video and Splat: text/image → 3D mesh
 * (GLB) via fal. Two selectable models, both image-to-3D:
 *   - Hunyuan3D (fal-ai/hunyuan3d/v2)
 *   - TRELLIS   (fal-ai/trellis-2)
 *
 * Both endpoints are image-to-3D only (no text prompt input), so a reference
 * image is required to generate; the optional prompt is used only to name the
 * saved asset. Generation is a single synchronous callable (generateFalMesh):
 * the Cloud Function submits to fal, polls to completion, downloads the GLB and
 * saves it as a first-class `mesh` asset, then charges tokens.
 *
 * Named "3D Model" (not "Model") to avoid confusion with the AI Model selector
 * used elsewhere in the app.
 */

import FluxUI from './main.js';
import ImageUploadUtils from './image-upload-utils.js';
import useImageGenStore from './store.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@shared/services/firebase.js';
import posthog from 'posthog-js';

// Recommended-not-required amber for the reference image indicator (#1767).
const AMBER = '#F5A623';

// Selectable image -> mesh models (both GLB output via fal). tokenCost mirrors
// the backend source of truth (public/functions/replicate-models.js); the
// backend enforces the real charge. estimatedTime drives the progress bar only.
const MODEL3D_MODELS = [
  {
    id: 'hunyuan-3d',
    name: 'Hunyuan3D (latest)',
    tokenCost: 3,
    estimatedTime: 30
  },
  { id: 'trellis', name: 'TRELLIS (latest)', tokenCost: 6, estimatedTime: 60 }
];

const Model3DTab = {
  imageData: null,
  selectedModel: 'hunyuan-3d',
  timerInterval: null,
  startTime: null,

  elements: {},

  init() {
    const container = document.getElementById('model3d-tab');
    if (!container) {
      console.error('3D Model Tab: container element not found');
      return;
    }

    this.createTabContent(container);
    this.getElements();
    this.setupEventListeners();
    this.updateTokenCost();
  },

  getModelConfig(id = this.selectedModel) {
    return MODEL3D_MODELS.find((m) => m.id === id) || MODEL3D_MODELS[0];
  },

  createTabContent(container) {
    const modelOptions = MODEL3D_MODELS.map(
      (model) => `<option value="${model.id}">${model.name}</option>`
    ).join('');

    container.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Parameters Column -->
        <div class="lg:col-span-1 bg-white rounded-lg shadow p-6">
          <h2 class="text-lg font-medium mb-1">3D Model Settings</h2>
          <p class="text-sm text-gray-500 mb-4">
            Generate a 3D mesh (GLB) from a reference image. Best for placemaking
            objects and props — shelters, kiosks, benches, bollards, wayfinding,
            vehicles.
          </p>

          <!-- Model Selection -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1" for="model3d-model-select">Model</label>
            <select id="model3d-model-select" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              ${modelOptions}
            </select>
          </div>

          <!-- Reference Image (required in practice; amber signals recommended) -->
          <div class="mb-4 param-group">
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Reference Image <span style="color: ${AMBER};" title="Recommended for better results">*</span>
            </label>
            <div class="flex flex-col space-y-2">
              <label id="model3d-image-upload-label" class="flex items-center justify-center w-full h-20 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer hover:bg-gray-50">
                <div class="flex flex-col items-center">
                  <p class="text-sm text-gray-500">Click to upload an image</p>
                  <p id="model3d-image-name" class="text-xs text-gray-400 mt-1">No file selected</p>
                </div>
                <input id="model3d-image-input" type="file" class="hidden" accept="image/png, image/jpeg, image/jpg" />
              </label>
              <div id="model3d-image-preview-container" class="hidden relative">
                <img id="model3d-image-preview" class="w-full rounded-lg border border-gray-300" alt="Reference image">
                <button id="model3d-image-clear" class="absolute top-2 right-2 p-1 bg-white bg-opacity-80 rounded-full hover:bg-opacity-100 hover:bg-red-50 shadow hover:shadow-lg transition-all duration-200" title="Clear image">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-600 hover:text-red-600 transition-colors duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              <p class="text-xs text-gray-500">
                A reference image gives the AI real-world structure to match. These models generate from an image.
              </p>
            </div>
          </div>

          <!-- Prompt (optional; used to name the saved asset) -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1" for="model3d-prompt-input">Name (Optional)</label>
            <textarea id="model3d-prompt-input" rows="2" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Name this model (e.g. bus shelter)..."></textarea>
          </div>

          <!-- Generate Button -->
          <button id="model3d-generate-btn" class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 flex items-center justify-center gap-2">
            <svg id="model3d-generate-spinner" class="hidden animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span id="model3d-generate-text">Generate 3D Model</span>
            <span class="inline-flex items-center rounded" style="background: rgba(0, 0, 0, 0.15); padding: 6px 8px; gap: 4px;">
              <img src="/ui_assets/token-image.png" alt="Token" class="w-5 h-5" />
              <span id="model3d-token-cost" class="text-sm font-medium">3</span>
            </span>
          </button>
        </div>

        <!-- Preview Column -->
        <div class="lg:col-span-2 bg-white rounded-lg shadow">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-medium">Preview</h2>
          </div>
          <div class="p-6 flex flex-col items-center justify-center min-h-[500px]" id="model3d-preview-container">
            <div id="model3d-placeholder" class="text-center text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
              </svg>
              <p>Your generated 3D model (GLB) will appear here</p>
            </div>
            <div id="model3d-loading" class="hidden flex flex-col items-center w-full max-w-md">
              <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
              <div class="generator-rendering-content">
                <div class="generator-progress-container">
                  <div class="generator-progress-bar" id="model3d-progress-bar" style="width: 0%;"></div>
                  <div class="generator-progress-stripes"></div>
                </div>
                <span class="generator-progress-text" id="model3d-loading-text">Generating your 3D model...</span>
              </div>
            </div>
            <div id="model3d-result" class="hidden text-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p id="model3d-result-name" class="font-medium mb-1"></p>
              <p class="text-sm text-gray-500 mb-4">Saved to your gallery.</p>
              <a id="model3d-result-open" href="#" target="_blank" rel="noopener" class="inline-block px-4 py-2 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700">
                Open model (GLB)
              </a>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  getElements() {
    this.elements = {
      modelSelect: document.getElementById('model3d-model-select'),
      imageInput: document.getElementById('model3d-image-input'),
      imageName: document.getElementById('model3d-image-name'),
      imageUploadLabel: document.getElementById('model3d-image-upload-label'),
      imagePreviewContainer: document.getElementById(
        'model3d-image-preview-container'
      ),
      imagePreview: document.getElementById('model3d-image-preview'),
      imageClear: document.getElementById('model3d-image-clear'),
      promptInput: document.getElementById('model3d-prompt-input'),
      generateBtn: document.getElementById('model3d-generate-btn'),
      generateSpinner: document.getElementById('model3d-generate-spinner'),
      generateText: document.getElementById('model3d-generate-text'),
      tokenCost: document.getElementById('model3d-token-cost'),
      placeholder: document.getElementById('model3d-placeholder'),
      loading: document.getElementById('model3d-loading'),
      loadingText: document.getElementById('model3d-loading-text'),
      progressBar: document.getElementById('model3d-progress-bar'),
      result: document.getElementById('model3d-result'),
      resultName: document.getElementById('model3d-result-name'),
      resultOpen: document.getElementById('model3d-result-open')
    };
  },

  setupEventListeners() {
    this.elements.modelSelect.addEventListener('change', (e) => {
      this.selectedModel = e.target.value;
      this.updateTokenCost();
    });

    this.elements.imageInput.addEventListener(
      'change',
      this.handleImageUpload.bind(this)
    );

    ImageUploadUtils.setupDragAndDrop(
      this.elements.imageUploadLabel,
      this.elements.imageInput,
      (dataUrl, fileName) => {
        this.setImage(dataUrl, fileName);
      }
    );

    this.elements.imageClear.addEventListener(
      'click',
      this.clearImage.bind(this)
    );

    this.elements.generateBtn.addEventListener(
      'click',
      this.handleGenerate.bind(this)
    );
  },

  updateTokenCost() {
    this.elements.tokenCost.textContent = this.getModelConfig().tokenCost;
  },

  handleImageUpload(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      this.setImage(event.target.result, file.name);
    };
    reader.readAsDataURL(file);
  },

  setImage(dataUrl, fileName) {
    this.imageData = dataUrl;
    this.elements.imageName.textContent = fileName;
    this.elements.imagePreview.src = dataUrl;
    this.elements.imageUploadLabel.classList.add('hidden');
    this.elements.imagePreviewContainer.classList.remove('hidden');
  },

  clearImage() {
    this.imageData = null;
    this.elements.imageInput.value = '';
    this.elements.imageName.textContent = 'No file selected';
    this.elements.imagePreview.src = '';
    this.elements.imagePreviewContainer.classList.add('hidden');
    this.elements.imageUploadLabel.classList.remove('hidden');
  },

  handleGenerate() {
    // Empty-image nudge (#1767): encourage a reference image before generating.
    if (!this.imageData) {
      this.showImageNudge();
      return;
    }

    this.startGeneration();
  },

  /**
   * Validate auth, tokens, and the reference image before calling the backend.
   */
  validate() {
    if (!window.authState || !window.authState.isAuthenticated) {
      useImageGenStore.getState().setModal('signin');
      return false;
    }

    const cost = this.getModelConfig().tokenCost;
    const tokens = window.authState.tokenProfile?.genToken || 0;
    if (tokens < cost) {
      window.dispatchEvent(
        new CustomEvent('openPurchaseModal', {
          detail: { tokenType: 'genToken' }
        })
      );
      return false;
    }

    // These endpoints are image-to-3D only.
    if (!this.imageData) {
      FluxUI.showNotification(
        'Add a reference image to generate a 3D model with this model.',
        'warning'
      );
      return false;
    }

    return true;
  },

  async startGeneration() {
    if (!this.validate()) return;

    const model = this.selectedModel;
    const modelConfig = this.getModelConfig(model);

    this.toggleLoading(true);
    this.startTimer();

    try {
      const generateFalMesh = httpsCallable(functions, 'generateFalMesh', {
        timeout: 300000
      });

      const result = await generateFalMesh({
        model_id: model,
        input_image: this.imageData,
        prompt: this.elements.promptInput.value.trim(),
        scene_id: null,
        source: 'generator'
      });

      if (!result.data.success) {
        throw new Error('Failed to generate 3D model');
      }

      this.stopTimer();
      this.toggleLoading(false);
      this.showResult(result.data);

      // Surface the new mesh in the gallery island and refresh the token count.
      window.dispatchEvent(new Event('assets:refresh'));
      window.dispatchEvent(new CustomEvent('tokenCountChanged'));

      posthog.capture('ai_render_used', {
        token_type: 'gen',
        model,
        source: 'generator',
        generation_type: 'mesh',
        is_pro_user: window.authState?.currentUser?.isPro || false
      });

      const remaining = result.data.remainingTokens;
      FluxUI.showNotification(
        remaining !== undefined
          ? `3D model generated! ${remaining} gen tokens remaining. (${modelConfig.name})`
          : `3D model generated! (${modelConfig.name})`,
        'success'
      );
    } catch (error) {
      console.error('Error generating 3D model:', error);
      this.stopTimer();
      this.toggleLoading(false);

      let message = 'Failed to generate 3D model';
      if (error.code === 'unauthenticated') {
        message = 'Please sign in to generate 3D models';
      } else if (error.code === 'resource-exhausted') {
        message =
          'No tokens available. Please purchase more tokens or upgrade to Pro.';
      } else if (error.message) {
        message = error.message;
      }
      FluxUI.showNotification(message, 'error');
    }
  },

  showResult(data) {
    this.elements.placeholder.classList.add('hidden');
    this.elements.loading.classList.add('hidden');
    this.elements.resultName.textContent = data.name || 'Generated 3D Model';
    if (data.model_url) {
      this.elements.resultOpen.href = data.model_url;
      this.elements.resultOpen.classList.remove('hidden');
    } else {
      this.elements.resultOpen.classList.add('hidden');
    }
    this.elements.result.classList.remove('hidden');
  },

  toggleLoading(isLoading) {
    if (isLoading) {
      this.elements.placeholder.classList.add('hidden');
      this.elements.result.classList.add('hidden');
      this.elements.loading.classList.remove('hidden');
      this.elements.generateBtn.disabled = true;
      this.elements.generateBtn.classList.add(
        'opacity-50',
        'cursor-not-allowed'
      );
      this.elements.generateSpinner.classList.remove('hidden');
      this.elements.generateText.textContent = 'Generating...';
    } else {
      this.elements.loading.classList.add('hidden');
      this.elements.generateBtn.disabled = false;
      this.elements.generateBtn.classList.remove(
        'opacity-50',
        'cursor-not-allowed'
      );
      this.elements.generateSpinner.classList.add('hidden');
      this.elements.generateText.textContent = 'Generate 3D Model';
    }
  },

  startTimer() {
    this.startTime = Date.now();
    const estimated = this.getModelConfig().estimatedTime || 45;
    this.timerInterval = setInterval(() => {
      const elapsed = Math.round((Date.now() - this.startTime) / 1000);
      const progress = Math.min((elapsed / estimated) * 100, 100);
      if (this.elements.progressBar) {
        this.elements.progressBar.style.width = `${progress}%`;
      }
      this.elements.loadingText.textContent = `${elapsed}s/${estimated}s`;
    }, 1000);
  },

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.elements.progressBar) {
      this.elements.progressBar.style.width = '0%';
    }
  },

  /**
   * Empty-image nudge dialog (#1767): recommend a reference image, with a
   * proceed-anyway escape hatch. These models are image-to-3D, so proceeding
   * without an image surfaces a clear "add an image" notice.
   */
  showImageNudge() {
    const existing = document.getElementById('model3d-nudge-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'model3d-nudge-modal';
    modal.className = 'modal';
    modal.innerHTML = `
      <div class="modal-content p-6">
        <h3 class="text-lg font-semibold mb-2">Add a reference image for better results</h3>
        <p class="text-sm text-gray-500 mb-6">
          A photo or reference image gives the AI real-world structure to match —
          producing far more accurate, usable models. These 3D models generate
          from an image.
        </p>
        <div class="flex justify-end gap-3">
          <button id="model3d-nudge-generate" class="px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-md text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            Generate anyway
          </button>
          <button id="model3d-nudge-add" class="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
            Add image
          </button>
        </div>
      </div>
    `;

    const close = () => modal.remove();

    modal.addEventListener('click', (e) => {
      if (e.target === modal) close();
    });

    modal.querySelector('#model3d-nudge-add').addEventListener('click', () => {
      close();
      this.elements.imageInput.click();
    });

    modal
      .querySelector('#model3d-nudge-generate')
      .addEventListener('click', () => {
        close();
        this.startGeneration();
      });

    document.body.appendChild(modal);
  }
};

export default Model3DTab;
