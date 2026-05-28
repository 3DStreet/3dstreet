/**
 * 3DStreet AI Generator - Splat Tab
 *
 * v1: single image → 3D Gaussian Splat (.ply) via the SHARP model on Replicate
 * (kfarr/sharp-ml), called through the generateReplicateSplat Cloud Function.
 *
 * SHARP runs in ~4 minutes, so this reuses the same synchronous
 * "await the callable" pattern as image generation — no async job queue.
 * Photogrammetry-style inputs (zip of images / video → Teleport) are a
 * planned v2 and intentionally not built here.
 *
 * The resulting .ply is saved to the user's gallery as an ASSET_TYPES.SPLAT /
 * SPLAT_OUTPUT asset, after which it can be dragged into a scene from the
 * editor's Assets panel just like a mesh.
 */

import FluxUI from './main.js';
import ImageUploadUtils from './image-upload-utils.js';
import useImageGenStore from './store.js';
import {
  assetsService as galleryService,
  ASSET_TYPES,
  ASSET_CATEGORIES
} from '@shared/assets';
import { httpsCallable } from 'firebase/functions';
import { functions, auth } from '@shared/services/firebase.js';
import posthog from 'posthog-js';

// Fixed cost for the v1 SHARP single-image model. The authoritative charge
// happens server-side (REPLICATE_MODELS['sharp-ml'].tokenCost); this is only
// for the button label and the client-side pre-check.
const SPLAT_TOKEN_COST = 1;

const SplatTab = {
  elements: {},
  sourceData: null, // full data URL of the uploaded source image
  currentSplatUrl: '',
  timerInterval: null,
  startTime: null,

  init() {
    const container = document.getElementById('splat-tab');
    if (!container) {
      console.error('Splat Tab: container element not found!');
      return;
    }

    this.createTabContent(container);
    this.getElements();
    this.setupEventListeners();

    FluxUI.tabModules.splat = this;
  },

  createTabContent(container) {
    container.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Parameters Column -->
        <div class="lg:col-span-1 bg-white rounded-lg shadow p-6">
          <h2 class="text-lg font-medium mb-1">Image to Splat</h2>
          <p class="text-sm text-gray-500 mb-4">
            Turn a single photo into a 3D Gaussian Splat you can place in your scene.
          </p>

          <!-- Source Image -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Source Image <span class="text-red-500">*</span>
            </label>
            <label id="splat-source-upload-label"
              class="flex items-center justify-center w-full h-20 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer hover:bg-gray-50">
              <div class="flex flex-col items-center">
                <p class="text-sm text-gray-500">Click or drop an image to upload</p>
                <p id="splat-source-name" class="text-xs text-gray-400 mt-1">No file selected</p>
              </div>
              <input id="splat-source-input" type="file" class="hidden" accept="image/png, image/jpeg, image/jpg, image/webp" />
            </label>
            <div id="splat-source-preview-container" class="hidden relative mt-2">
              <img id="splat-source-preview" class="w-full rounded-lg border border-gray-300" alt="Selected image">
              <button id="splat-source-clear"
                class="absolute top-2 right-2 p-1 bg-white bg-opacity-80 rounded-full hover:bg-opacity-100 hover:bg-red-50 shadow"
                title="Clear image">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-600 hover:text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <p class="text-xs text-gray-400 mb-4">
            Model: SHARP (Apple) · single image · outputs a .ply splat.
            Generation usually takes a few minutes.
          </p>

          <!-- Generate Button -->
          <button id="splat-generate-btn"
            class="w-full flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">
            <svg id="splat-generate-spinner" class="hidden animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span id="splat-generate-text">Generate Splat (${SPLAT_TOKEN_COST} token)</span>
          </button>
        </div>

        <!-- Preview Column -->
        <div class="lg:col-span-2 bg-white rounded-lg shadow p-6">
          <h2 class="text-lg font-medium mb-4">Result</h2>

          <div id="splat-preview-container"
            class="relative flex items-center justify-center bg-gray-50 rounded-lg border border-gray-200"
            style="min-height: 320px;">

            <!-- Placeholder -->
            <div id="splat-placeholder" class="text-center text-gray-400 p-8">
              <svg class="mx-auto h-12 w-12 mb-3" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="7" cy="8" r="1.6" /><circle cx="13" cy="6" r="1.2" />
                <circle cx="17" cy="10" r="1.8" /><circle cx="9" cy="13" r="1.3" />
                <circle cx="15" cy="15" r="1.5" /><circle cx="6" cy="17" r="1.2" />
                <circle cx="12" cy="18" r="1.7" /><circle cx="18" cy="17" r="1.1" />
              </svg>
              <p class="text-sm">Upload a source image, then generate a splat.</p>
            </div>

            <!-- Loading -->
            <div id="splat-loading-indicator" class="hidden text-center text-gray-500 p-8">
              <svg class="mx-auto animate-spin h-10 w-10 text-indigo-600 mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <p id="splat-loading-text" class="text-sm">Generating splat…</p>
              <p class="text-xs text-gray-400 mt-1">This can take a few minutes — keep this tab open.</p>
            </div>

            <!-- Result -->
            <div id="splat-result" class="hidden w-full p-4">
              <iframe id="splat-viewer-frame"
                class="w-full rounded-lg border border-gray-200 bg-[#393939]"
                style="height: 360px;"
                title="Splat preview"
                allow="fullscreen"></iframe>
              <p class="text-xs text-gray-500 mt-2 mb-3 text-center">
                Drag to orbit · scroll to zoom. Saved to your gallery — open it in
                the editor and drag it into a scene.
              </p>
              <div class="flex items-center justify-center gap-3">
                <a id="splat-open-btn" href="#" target="_blank" rel="noopener"
                  class="inline-flex items-center px-3 py-2 text-sm rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700">
                  Open .ply
                </a>
                <button id="splat-download-btn"
                  class="inline-flex items-center px-3 py-2 text-sm rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700">
                  Download
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  getElements() {
    const byId = (id) => document.getElementById(id);
    this.elements = {
      sourceUploadLabel: byId('splat-source-upload-label'),
      sourceInput: byId('splat-source-input'),
      sourceName: byId('splat-source-name'),
      sourcePreviewContainer: byId('splat-source-preview-container'),
      sourcePreview: byId('splat-source-preview'),
      sourceClear: byId('splat-source-clear'),
      generateBtn: byId('splat-generate-btn'),
      generateSpinner: byId('splat-generate-spinner'),
      generateText: byId('splat-generate-text'),
      previewContainer: byId('splat-preview-container'),
      placeholder: byId('splat-placeholder'),
      loadingIndicator: byId('splat-loading-indicator'),
      loadingText: byId('splat-loading-text'),
      result: byId('splat-result'),
      viewerFrame: byId('splat-viewer-frame'),
      openBtn: byId('splat-open-btn'),
      downloadBtn: byId('splat-download-btn')
    };
  },

  setupEventListeners() {
    const els = this.elements;

    els.sourceInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) =>
        this.setSourceImage(event.target.result, file.name);
      reader.readAsDataURL(file);
    });

    ImageUploadUtils.setupDragAndDrop(
      els.sourceUploadLabel,
      els.sourceInput,
      (dataUrl, fileName) => this.setSourceImage(dataUrl, fileName)
    );

    els.sourceClear.addEventListener('click', (e) => {
      e.preventDefault();
      this.clearSourceImage();
    });

    els.generateBtn.addEventListener('click', () => this.generateSplat());

    els.downloadBtn.addEventListener('click', () => {
      if (this.currentSplatUrl) this.downloadSplat();
    });
  },

  setSourceImage(dataUrl, fileName = 'image') {
    this.sourceData = dataUrl;
    this.elements.sourceName.textContent = fileName;
    this.elements.sourcePreview.src = dataUrl;
    this.elements.sourceUploadLabel.classList.add('hidden');
    this.elements.sourcePreviewContainer.classList.remove('hidden');
  },

  clearSourceImage() {
    this.sourceData = null;
    this.elements.sourceInput.value = '';
    this.elements.sourceName.textContent = 'No file selected';
    this.elements.sourcePreview.src = '';
    this.elements.sourcePreviewContainer.classList.add('hidden');
    this.elements.sourceUploadLabel.classList.remove('hidden');
  },

  validate() {
    if (!window.authState || !window.authState.isAuthenticated) {
      useImageGenStore.getState().setModal('signin');
      return false;
    }
    const tokens = window.authState.tokenProfile?.genToken || 0;
    if (tokens < SPLAT_TOKEN_COST) {
      window.dispatchEvent(
        new CustomEvent('openPurchaseModal', {
          detail: { tokenType: 'genToken' }
        })
      );
      return false;
    }
    if (!this.sourceData) {
      FluxUI.showNotification('Please upload a source image first.', 'error');
      return false;
    }
    return true;
  },

  toggleLoading(isLoading) {
    const els = this.elements;
    els.generateBtn.disabled = isLoading;
    els.generateSpinner.classList.toggle('hidden', !isLoading);
    els.generateText.textContent = isLoading
      ? 'Generating…'
      : `Generate Splat (${SPLAT_TOKEN_COST} token)`;

    if (isLoading) {
      els.placeholder.classList.add('hidden');
      els.result.classList.add('hidden');
      els.loadingIndicator.classList.remove('hidden');
      this.startTimer();
    } else {
      els.loadingIndicator.classList.add('hidden');
      this.stopTimer();
    }
  },

  startTimer() {
    this.startTime = Date.now();
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      const seconds = Math.floor((Date.now() - this.startTime) / 1000);
      const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
      const ss = String(seconds % 60).padStart(2, '0');
      if (this.elements.loadingText) {
        this.elements.loadingText.textContent = `Generating splat… ${mm}:${ss}`;
      }
    }, 1000);
  },

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  },

  async generateSplat() {
    if (!this.validate()) return;

    this.toggleLoading(true);

    try {
      const generateReplicateSplat = httpsCallable(
        functions,
        'generateReplicateSplat',
        { timeout: 540000 } // 9 minutes — matches the Cloud Function timeout
      );

      const result = await generateReplicateSplat({
        input_image: this.sourceData,
        model_id: 'sharp-ml',
        source: 'generator'
      });

      if (result.data && result.data.success && result.data.splat_url) {
        this.currentSplatUrl = result.data.splat_url;
        await this.saveToGallery(result.data.splat_url);
        this.showResult(result.data.splat_url);
        this.toggleLoading(false);

        FluxUI.showNotification(
          `Splat generated! ${result.data.remainingTokens} gen tokens remaining.`,
          'success'
        );

        posthog.capture('splat_generated', {
          model: 'sharp-ml',
          remaining_tokens: result.data.remainingTokens
        });
        if (result.data.remainingTokens === 0) {
          posthog.capture('token_limit_reached', { context: 'splat' });
        }

        window.dispatchEvent(new CustomEvent('tokenCountChanged'));
      } else {
        throw new Error('No splat returned');
      }
    } catch (error) {
      console.error('Error generating splat:', error);
      this.toggleLoading(false);
      this.elements.placeholder.classList.remove('hidden');

      let message = 'Failed to generate splat';
      if (error.code === 'unauthenticated') {
        message = 'Please sign in to generate splats';
      } else if (error.code === 'resource-exhausted') {
        message = 'No tokens available. Please purchase more tokens.';
      } else if (error.message) {
        message = `Failed to generate splat: ${error.message}`;
      }
      FluxUI.showNotification(message, 'error');
    }
  },

  /**
   * Fetch the generated .ply and persist it to the user's gallery as a
   * SPLAT_OUTPUT asset. We re-wrap as application/octet-stream so the upload
   * carries a content type the Storage rules accept for splats.
   */
  async saveToGallery(splatUrl) {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    try {
      const response = await fetch(splatUrl);
      const arrayBuffer = await response.arrayBuffer();
      const blob = new Blob([arrayBuffer], {
        type: 'application/octet-stream'
      });

      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const metadata = {
        model: 'sharp-ml',
        model_name: 'SHARP (Image to Splat)',
        sourceType: 'image',
        timestamp: new Date().toISOString(),
        // originalFilename drives the stored file extension (.ply for SHARP).
        originalFilename: `sharp-splat-${stamp}.ply`,
        name: `SHARP Splat ${stamp}`
      };

      await galleryService.init();
      await galleryService.addAsset(
        blob,
        metadata,
        ASSET_TYPES.SPLAT,
        ASSET_CATEGORIES.SPLAT_OUTPUT,
        currentUser.uid
      );
    } catch (e) {
      console.error('Failed to save splat to gallery:', e);
      FluxUI.showNotification(
        'Splat generated, but saving to your gallery failed.',
        'warning'
      );
    }
  },

  showResult(splatUrl) {
    this.elements.placeholder.classList.add('hidden');
    this.elements.result.classList.remove('hidden');
    this.elements.openBtn.href = splatUrl;
    // Live Spark preview in a sandboxed iframe (same pattern as the mesh
    // model-viewer). Points at the freshly generated splat URL.
    this.elements.viewerFrame.src = `/splat-viewer.html?src=${encodeURIComponent(splatUrl)}`;
  },

  async downloadSplat() {
    try {
      const response = await fetch(this.currentSplatUrl);
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `sharp-splat-${stamp}.ply`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
    } catch (e) {
      console.error('Splat download failed, opening in new tab:', e);
      window.open(this.currentSplatUrl, '_blank');
    }
  }
};

export default SplatTab;
