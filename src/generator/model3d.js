/**
 * 3D Model Tab (shell)
 *
 * Adds the "3D Model" medium alongside Image, Video and Splat. This first pass
 * ships the tab's input UI — model selection (Hunyuan3D / TRELLIS), an optional
 * reference image, an optional text prompt — plus the empty-image nudge dialog.
 *
 * Generation is intentionally not wired here: the fal 3D endpoints and the
 * decimation-on-ingest pass land in a follow-up. Submitting today surfaces a
 * "coming soon" notice so the flow is honest while the UI is reviewable.
 *
 * Named "3D Model" (not "Model") to avoid confusion with the AI Model selector
 * used elsewhere in the app.
 */

import FluxUI from './main.js';
import ImageUploadUtils from './image-upload-utils.js';

// Recommended-not-required amber for the reference image indicator (#1767).
const AMBER = '#F5A623';

// Selectable text/image -> mesh models (both GLB output via fal).
const MODEL3D_MODELS = [
  { id: 'hunyuan-3d', name: 'Hunyuan3D (latest)' },
  { id: 'trellis', name: 'TRELLIS (latest)' }
];

const Model3DTab = {
  imageData: null,

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
            Generate a 3D mesh (GLB) from a reference image and/or text prompt.
            Best for placemaking objects and props — shelters, kiosks, benches,
            bollards, wayfinding, vehicles.
          </p>

          <!-- Model Selection -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1" for="model3d-model-select">Model</label>
            <select id="model3d-model-select" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
              ${modelOptions}
            </select>
          </div>

          <!-- Reference Image (recommended, not required) -->
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
                A reference image gives the AI real-world structure to match. Text-only works too, but results are rougher.
              </p>
            </div>
          </div>

          <!-- Prompt (optional) -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1" for="model3d-prompt-input">Prompt (Optional)</label>
            <textarea id="model3d-prompt-input" rows="3" class="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      placeholder="Describe the object to generate..."></textarea>
          </div>

          <!-- Generate Button -->
          <button id="model3d-generate-btn" class="w-full px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 flex items-center justify-center gap-2">
            <span id="model3d-generate-text">Generate 3D Model</span>
          </button>
        </div>

        <!-- Preview Column -->
        <div class="lg:col-span-2 bg-white rounded-lg shadow">
          <div class="p-6 border-b border-gray-200">
            <h2 class="text-lg font-medium">Preview</h2>
          </div>
          <div class="p-6 flex flex-col items-center justify-center min-h-[500px]">
            <div class="text-center text-gray-400">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
              </svg>
              <p>Your generated 3D model (GLB) will appear here</p>
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
      generateBtn: document.getElementById('model3d-generate-btn')
    };
  },

  setupEventListeners() {
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
    // Empty-image nudge: encourage a reference image, but allow text-only.
    if (!this.imageData) {
      this.showImageNudge();
      return;
    }

    this.startGeneration();
  },

  /**
   * Placeholder for the real generation call (fal 3D endpoint + GLB ingest),
   * which lands in a follow-up. For now, keep the flow honest.
   */
  startGeneration() {
    FluxUI.showNotification('3D model generation is coming soon.', 'warning');
  },

  /**
   * Empty-image nudge dialog (#1767): recommend a reference image without
   * disparaging text-only generation, with a proceed-anyway escape hatch.
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
          producing far more accurate, usable models. Text-only generation works,
          but results are rougher and best for quick placeholders.
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
