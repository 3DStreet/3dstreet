/**
 * 3DStreet AI Generator - Splat Tab
 *
 * v1: single image → 3D Gaussian Splat (.ply) via the SHARP model on Replicate
 * (kfarr/sharp-ml), called through the generateReplicateSplat Cloud Function.
 *
 * SHARP can sit in a cold-boot queue for several minutes, so the flow is
 * asynchronous and browser-independent: generateReplicateSplat creates a
 * generation job (with a Replicate webhook) and returns its jobId immediately.
 * When the job finishes, the webhook saves the .ply to the user's gallery
 * server-side, so it lands even if this tab was closed. This UI polls
 * getGenerationJobStatus only to reflect progress and show the result while open.
 * Photogrammetry-style inputs (zip of images / video → Teleport) are a
 * planned v2 and intentionally not built here.
 *
 * The saved asset is an ASSET_TYPES.SPLAT / SPLAT_OUTPUT, which can be dragged
 * into a scene from the editor's Assets panel just like a mesh.
 */

import FluxUI from './main.js';
import ImageUploadUtils from './image-upload-utils.js';
import useImageGenStore from './store.js';
import { httpsCallable } from 'firebase/functions';
import { functions } from '@shared/services/firebase.js';
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
  pollTimeout: null, // setTimeout handle for the status poll loop
  pollDeadline: 0, // wall-clock ms after which we stop polling

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

          <!-- Research preview / license notice -->
          <p class="text-[11px] leading-relaxed text-gray-400 mt-3">
            Research preview. Splats are generated with Apple's SHARP model. By
            generating a splat you accept the terms of the
            <a href="https://github.com/apple/ml-sharp/blob/main/LICENSE_MODEL"
              target="_blank" rel="noopener"
              class="underline hover:text-gray-600">Apple Machine Learning Research Model License</a>
            and agree this output is provided for research purposes only. Token
            charges cover our inference-provider costs; this is not a primary
            commercial service.
          </p>
        </div>

        <!-- Preview Column -->
        <div class="lg:col-span-2 bg-white rounded-lg shadow p-6">
          <h2 class="text-lg font-medium mb-4">Result</h2>

          <div id="splat-preview-container"
            class="relative flex items-center justify-center bg-[#393939] rounded-lg border border-gray-700"
            style="min-height: 320px;">

            <!-- Placeholder -->
            <div id="splat-placeholder" class="text-center text-gray-300 p-8">
              <svg class="mx-auto h-12 w-12 mb-3" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="7" cy="8" r="1.6" /><circle cx="13" cy="6" r="1.2" />
                <circle cx="17" cy="10" r="1.8" /><circle cx="9" cy="13" r="1.3" />
                <circle cx="15" cy="15" r="1.5" /><circle cx="6" cy="17" r="1.2" />
                <circle cx="12" cy="18" r="1.7" /><circle cx="18" cy="17" r="1.1" />
              </svg>
              <p class="text-sm">Upload a source image, then generate a splat.</p>
            </div>

            <!-- Loading -->
            <div id="splat-loading-indicator" class="hidden text-center text-gray-300 p-8">
              <svg class="mx-auto animate-spin h-10 w-10 text-indigo-400 mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <p id="splat-loading-text" class="text-sm">Uploading image…</p>
              <p id="splat-loading-subtext" class="text-xs text-gray-400 mt-1 hidden">This can take a few minutes. You can close this tab; your splat saves to your gallery when it's done.</p>
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
      loadingSubtext: byId('splat-loading-subtext'),
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
      // Start in the "uploading" phase: the source image is still being sent to
      // the server, so the tab can't be closed yet and a generation timer would
      // be misleading. generateSplat() flips to 'processing' once the job is
      // actually submitted.
      this.setLoadingPhase('uploading');
    } else {
      els.loadingIndicator.classList.add('hidden');
      this.stopTimer();
    }
  },

  // Switch the loading panel between the upload-in-flight phase and the
  // server-processing phase. Only the latter shows the "you can close this tab"
  // reassurance (true only once the upload is done and the job is queued) and
  // the generation timer.
  setLoadingPhase(phase) {
    const els = this.elements;
    if (phase === 'uploading') {
      this.stopTimer();
      if (els.loadingText) els.loadingText.textContent = 'Uploading image…';
      if (els.loadingSubtext) els.loadingSubtext.classList.add('hidden');
      if (els.generateText) els.generateText.textContent = 'Uploading…';
    } else if (phase === 'processing') {
      if (els.loadingSubtext) els.loadingSubtext.classList.remove('hidden');
      if (els.generateText) els.generateText.textContent = 'Generating…';
      this.startTimer();
    }
  },

  startTimer() {
    this.startTime = Date.now();
    this.stopTimer();
    const tick = () => {
      const seconds = Math.floor((Date.now() - this.startTime) / 1000);
      const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
      const ss = String(seconds % 60).padStart(2, '0');
      if (this.elements.loadingText) {
        this.elements.loadingText.textContent = `Generating splat… ${mm}:${ss}`;
      }
    };
    tick(); // set the label immediately so it doesn't lag a second behind
    this.timerInterval = setInterval(tick, 1000);
  },

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  },

  // Poll cadence and overall ceiling for the status loop. SHARP cold boots can
  // run several minutes; 15 min is generous headroom before we give up locally.
  POLL_INTERVAL_MS: 3000,
  POLL_MAX_MS: 15 * 60 * 1000,

  async generateSplat() {
    if (!this.validate()) return;

    this.stopPolling();
    this.toggleLoading(true);

    try {
      const generateReplicateSplat = httpsCallable(
        functions,
        'generateReplicateSplat'
      );

      const result = await generateReplicateSplat({
        input_image: this.sourceData,
        model_id: 'sharp-ml',
        source: 'generator'
      });

      if (!result.data || !result.data.success || !result.data.jobId) {
        throw new Error('Could not start splat generation');
      }

      // The token was charged on submit; reflect that immediately.
      window.dispatchEvent(new CustomEvent('tokenCountChanged'));

      // Upload is done and the job is queued server-side — now it's safe to tell
      // the user they can close the tab, and to start the generation timer.
      this.setLoadingPhase('processing');

      // The job now shows as a pending card in the assets gallery, driven by a
      // live Firestore listener on the job doc (written before this returns) —
      // so it persists across reloads and tabs without any client state here.
      this.pollDeadline = Date.now() + this.POLL_MAX_MS;
      this.pollSplatStatus(result.data.jobId);
    } catch (error) {
      console.error('Error starting splat generation:', error);
      this.failGeneration(this.errorMessage(error));
    }
  },

  // Poll getGenerationJobStatus until the job is terminal. Re-schedules itself
  // with setTimeout (not setInterval) so a slow request can't overlap the next
  // tick. Any non-terminal status (queued|running|saving) just keeps polling.
  async pollSplatStatus(jobId) {
    const getGenerationJobStatus = httpsCallable(
      functions,
      'getGenerationJobStatus'
    );

    try {
      const { data } = await getGenerationJobStatus({ jobId });

      if (data.status === 'succeeded' && data.splat_url) {
        // The splat was saved to the gallery server-side (works even if this
        // tab had been closed). Just reflect it in the UI and refresh the
        // gallery island so the new asset shows up. The pending-job card clears
        // itself once the job doc leaves the non-terminal set (its listener also
        // refreshes the grid), so the card hands its slot to the real asset.
        this.currentSplatUrl = data.splat_url;
        this.showResult(data.splat_url);
        this.toggleLoading(false);
        window.dispatchEvent(new Event('assets:refresh'));
        FluxUI.showNotification('Splat generated!', 'success');
        posthog.capture('splat_generated', { model: 'sharp-ml' });
        return;
      }

      if (data.status === 'failed' || data.status === 'canceled') {
        // The server refunds on failure; refresh the displayed balance.
        window.dispatchEvent(new CustomEvent('tokenCountChanged'));
        this.failGeneration(
          data.error
            ? `Splat generation failed: ${data.error}`
            : 'Splat generation failed. Your token was refunded.'
        );
        return;
      }

      // Still queued/running/saving — the gallery's pending card reflects the
      // live status from Firestore; just keep polling until the deadline.
      if (Date.now() > this.pollDeadline) {
        this.failGeneration(
          'Splat generation is taking longer than expected. Check your gallery shortly.'
        );
        return;
      }
      this.pollTimeout = setTimeout(
        () => this.pollSplatStatus(jobId),
        this.POLL_INTERVAL_MS
      );
    } catch (error) {
      console.error('Error polling splat status:', error);
      // Transient poll error — retry until the deadline rather than failing hard.
      if (Date.now() > this.pollDeadline) {
        this.failGeneration(this.errorMessage(error));
        return;
      }
      this.pollTimeout = setTimeout(
        () => this.pollSplatStatus(jobId),
        this.POLL_INTERVAL_MS
      );
    }
  },

  stopPolling() {
    if (this.pollTimeout) {
      clearTimeout(this.pollTimeout);
      this.pollTimeout = null;
    }
  },

  // Reset to the idle placeholder state and surface an error toast. The
  // gallery's pending-job card clears on its own when the job doc reaches a
  // terminal state (server marks failed + refunds); a local poll timeout just
  // stops our polling — the job may still finish server-side and surface later.
  failGeneration(message) {
    this.stopPolling();
    this.toggleLoading(false);
    this.elements.placeholder.classList.remove('hidden');
    FluxUI.showNotification(message, 'error');
  },

  errorMessage(error) {
    if (error.code === 'unauthenticated') {
      return 'Please sign in to generate splats';
    }
    if (error.code === 'resource-exhausted') {
      return 'No tokens available. Please purchase more tokens.';
    }
    if (error.message) {
      return `Failed to generate splat: ${error.message}`;
    }
    return 'Failed to generate splat';
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
