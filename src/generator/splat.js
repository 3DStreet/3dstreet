/**
 * 3DStreet AI Generator - Splat Tab
 *
 * Turns a source into a 3D Gaussian Splat (.ply) via a model picker, mirroring
 * how the image generator offers multiple models:
 *   - "Image → Splat (SHARP)"   — single image in, via kfarr/sharp-ml
 *   - "Video → Splat (vid2scene)" — a short phone video in, via the vid2scene
 *     pipeline packaged as a Replicate Cog (frame extraction → GLOMAP SfM →
 *     gsplat training → .ply). See docs/vid2scene-video-to-splat.md.
 *
 * Both routes go through the same generateReplicateSplat Cloud Function and the
 * same async, browser-independent flow: generateReplicateSplat creates a
 * generation job (with a Replicate webhook) and returns its jobId immediately.
 * When the job finishes, the webhook saves the .ply to the user's gallery
 * server-side, so it lands even if this tab was closed. This UI polls
 * getGenerationJobStatus only to reflect progress and show the result while open.
 *
 * The one structural difference between the two: an image is small enough to
 * base64 through the callable, but a video is not — so video mode uploads the
 * file straight to Firebase Storage (resumable, with progress) and passes the
 * storage PATH to the function, which briefly makes it fetchable for Replicate
 * and cleans it up when the job finishes.
 *
 * The saved asset is an ASSET_TYPES.SPLAT / SPLAT_OUTPUT, which can be dragged
 * into a scene from the editor's Assets panel just like a mesh.
 */

import FluxUI from './main.js';
import ImageUploadUtils from './image-upload-utils.js';
import useImageGenStore from './store.js';
import { httpsCallable } from 'firebase/functions';
import { functions, auth, storage } from '@shared/services/firebase.js';
import { ref as storageRef, uploadBytesResumable } from 'firebase/storage';
import posthog from 'posthog-js';

// Shared notice for all vid2scene tiers.
const VID2SCENE_NOTICE =
  'Research preview. Splats are generated with the open-source <a href="https://github.com/samuelm2/vid2scene" target="_blank" rel="noopener" class="underline hover:text-gray-600">vid2scene</a> pipeline (Apache-2.0). For best results, capture a slow, steady orbit around a static subject in good lighting. Token charges cover our inference-provider costs.';

// Client-side model catalog for the Splat tab. The authoritative token charge
// and model config live server-side (public/functions/replicate-models.js);
// these values drive only the dropdown, button label, and the client pre-check.
const SPLAT_MODELS = {
  'sharp-ml': {
    label: 'Image → Splat (SHARP)',
    inputKind: 'image',
    tokenCost: 1,
    etaText: 'about 5 minutes',
    blurb:
      'Model: SHARP (Apple) · single image · outputs a .ply splat. Generation usually takes about 5 minutes.',
    notice:
      'Research preview. Splats are generated with Apple\'s SHARP model. By generating a splat you accept the terms of the <a href="https://github.com/apple/ml-sharp/blob/main/LICENSE_MODEL" target="_blank" rel="noopener" class="underline hover:text-gray-600">Apple Machine Learning Research Model License</a> and agree this output is provided for research purposes only. Token charges cover our inference-provider costs; this is not a primary commercial service.'
  },
  // vid2scene quality tiers — same pipeline, different frames/steps/gaussians
  // budgets (the knobs live on the server-side model config). The three tiers
  // share ONE dropdown entry (`tierGroup`); the active tier is picked with the
  // Basic/High/Max buttons below the source video and is what's submitted as
  // model_id. `vid2scene` (High) is the tier the dropdown entry lands on.
  // `videoHint` is the recommended source length, derived from each tier's
  // frame budget (300/600/900 frames ≈ 10/20/30 s of unique frames at 30 fps;
  // beyond ~2.5x that, subsampling gets sparse and quality drops).
  'vid2scene-basic': {
    label: 'Video → Splat (vid2scene Basic)',
    tierGroup: 'vid2scene',
    tier: 'Basic',
    videoHint: '~10–25s video',
    inputKind: 'video',
    tokenCost: 10,
    etaText: '20–25 minutes',
    blurb:
      'Model: vid2scene Basic · best for a ~10–25 second orbit of a single object · preview-grade detail, usually ready in ~20–25 minutes.',
    notice: VID2SCENE_NOTICE
  },
  vid2scene: {
    label: 'Video → Splat (vid2scene High)',
    groupLabel: 'Video → Splat (vid2scene)',
    tierGroup: 'vid2scene',
    tier: 'High',
    videoHint: '~25–50s video',
    inputKind: 'video',
    tokenCost: 20,
    etaText: 'about 45 minutes',
    blurb:
      'Model: vid2scene High · best for a ~25–50 second orbit of a larger subject or small scene · the recommended balance of detail and time, usually ~45 minutes.',
    notice: VID2SCENE_NOTICE
  },
  'vid2scene-max': {
    label: 'Video → Splat (vid2scene Max)',
    tierGroup: 'vid2scene',
    tier: 'Max',
    videoHint: '~50–90s video',
    inputKind: 'video',
    tokenCost: 40,
    etaText: 'an hour or more',
    blurb:
      'Model: vid2scene Max · best for a ~50–90 second sweep of a large scene · maximum detail (4x the gaussians, large file), can take an hour or more.',
    notice: VID2SCENE_NOTICE
  }
};

const DEFAULT_SPLAT_MODEL = 'sharp-ml';

// Per-file ceiling for the uploaded source video (client-side guard; the
// Storage rules backstop is far higher). Keep videos short — a 10–30s orbit is
// plenty and keeps reconstruction time and cost reasonable.
const VIDEO_MAX_BYTES = 200 * 1024 * 1024; // 200 MB

const SplatTab = {
  elements: {},
  currentModelId: DEFAULT_SPLAT_MODEL,
  sourceImageData: null, // full data URL of the uploaded source image
  sourceVideoFile: null, // File object for the uploaded source video
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
    this.selectModel(this.currentModelId);

    FluxUI.tabModules.splat = this;
  },

  modelOptionsHtml() {
    // One option per model "group": tiered models collapse into a single
    // dropdown entry (the entry whose id === its tierGroup); the tier itself
    // is picked with the quality buttons.
    return Object.entries(SPLAT_MODELS)
      .filter(([id, m]) => !m.tierGroup || id === m.tierGroup)
      .map(
        ([id, m]) =>
          `<option value="${id}"${id === DEFAULT_SPLAT_MODEL ? ' selected' : ''}>${m.groupLabel || m.label}</option>`
      )
      .join('');
  },

  qualityButtonsHtml() {
    // Colors live on .splat-tier-btn[.selected] in styles/styles.css (with
    // .dark variants) — Tailwind-utility colors here would miss the dark theme.
    return Object.entries(SPLAT_MODELS)
      .filter(([, m]) => m.tierGroup)
      .map(
        ([id, m]) => `
          <button type="button" data-tier-id="${id}"
            class="splat-tier-btn border rounded-lg px-1 py-2 text-sm text-center transition-colors">
            <span class="block font-medium">${m.tier}</span>
            <span class="block text-xs mt-0.5">${m.tokenCost} tokens</span>
          </button>`
      )
      .join('');
  },

  createTabContent(container) {
    container.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Parameters Column -->
        <div class="lg:col-span-1 bg-white rounded-lg shadow p-6">
          <h2 class="text-lg font-medium mb-1">Create a Splat</h2>
          <p class="text-sm text-gray-500 mb-4">
            Turn a photo or a short video into a 3D Gaussian Splat you can place in your scene.
          </p>

          <!-- Model selector -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1" for="splat-model-select">Model</label>
            <select id="splat-model-select"
              class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-indigo-500 focus:border-indigo-500">
              ${this.modelOptionsHtml()}
            </select>
          </div>

          <!-- Source Image (image models) -->
          <div id="splat-image-block" class="mb-4">
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

          <!-- Source Video (video models) -->
          <div id="splat-video-block" class="mb-4 hidden">
            <label class="block text-sm font-medium text-gray-700 mb-1">
              Source Video <span class="text-red-500">*</span>
            </label>
            <label id="splat-video-upload-label"
              class="flex items-center justify-center w-full h-20 border-2 border-gray-300 border-dashed rounded-lg cursor-pointer hover:bg-gray-50">
              <div class="flex flex-col items-center">
                <p class="text-sm text-gray-500">Click to choose a video to upload</p>
                <p id="splat-video-name" class="text-xs text-gray-400 mt-1">No file selected</p>
              </div>
              <input id="splat-video-input" type="file" class="hidden" accept="video/mp4, video/quicktime, video/webm, video/*" />
            </label>
            <div id="splat-video-selected" class="hidden relative mt-2 flex items-center justify-between bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <span id="splat-video-selected-name" class="text-sm text-gray-700 truncate"></span>
              <button id="splat-video-clear"
                class="ml-2 p-1 rounded-full hover:bg-red-50 shadow-sm" title="Clear video">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-gray-600 hover:text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          <!-- Quality tier (tiered models, e.g. vid2scene) — three budgets of
               the same pipeline; the active button decides the model_id. -->
          <div id="splat-quality-block" class="mb-4 hidden">
            <label class="block text-sm font-medium text-gray-700 mb-1">Quality</label>
            <div id="splat-quality-buttons" class="grid grid-cols-3 gap-2">
              ${this.qualityButtonsHtml()}
            </div>
          </div>

          <p id="splat-model-blurb" class="text-xs text-gray-400 mb-4"></p>

          <!-- Generate Button -->
          <button id="splat-generate-btn"
            class="w-full flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white font-medium py-2 px-4 rounded-lg transition-colors">
            <svg id="splat-generate-spinner" class="hidden animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
            <span id="splat-generate-text">Generate Splat</span>
          </button>

          <!-- Email when done. Default on: splats take minutes, so most users
               navigate away. The email is suppressed server-side if the tab is
               still open when it finishes (see generation-job-reconcile.js). -->
          <label class="flex items-center gap-2 mt-3 text-sm text-gray-600 cursor-pointer select-none">
            <input id="splat-notify-email" type="checkbox" checked
              class="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500" />
            Email me when my splat is ready
          </label>

          <!-- Research preview / license notice (model-aware) -->
          <p id="splat-model-notice" class="text-[11px] leading-relaxed text-gray-400 mt-3"></p>
        </div>

        <!-- Preview Column -->
        <div class="lg:col-span-2 bg-white rounded-lg shadow p-6">
          <h2 class="text-lg font-medium mb-4">Result</h2>

          <div id="splat-preview-container"
            class="relative flex items-center justify-center bg-gray-800 rounded-lg border border-gray-700"
            style="min-height: 320px;">

            <!-- Placeholder -->
            <div id="splat-placeholder" class="text-center text-gray-300 p-8">
              <svg class="mx-auto h-12 w-12 mb-3" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="7" cy="8" r="1.6" /><circle cx="13" cy="6" r="1.2" />
                <circle cx="17" cy="10" r="1.8" /><circle cx="9" cy="13" r="1.3" />
                <circle cx="15" cy="15" r="1.5" /><circle cx="6" cy="17" r="1.2" />
                <circle cx="12" cy="18" r="1.7" /><circle cx="18" cy="17" r="1.1" />
              </svg>
              <p id="splat-placeholder-text" class="text-sm">Choose a source, then generate a splat.</p>
            </div>

            <!-- Loading -->
            <div id="splat-loading-indicator" class="hidden text-center text-gray-300 p-8">
              <svg class="mx-auto animate-spin h-10 w-10 text-indigo-400 mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              <p id="splat-loading-text" class="text-sm">Uploading…</p>
              <p id="splat-loading-subtext" class="text-xs text-gray-400 mt-1 hidden">This can take a few minutes. You can close this tab; your splat saves to your gallery when it's done.</p>
            </div>

            <!-- Result -->
            <div id="splat-result" class="hidden w-full p-4">
              <iframe id="splat-viewer-frame"
                class="w-full rounded-lg border border-gray-200 bg-gray-800"
                style="height: 360px;"
                title="Splat preview"
                allow="fullscreen"></iframe>
              <p class="text-xs text-gray-500 mt-2 mb-3 text-center">
                Drag to orbit · scroll to zoom. Saved to your gallery — open it in
                the editor and drag it into a scene.
              </p>
              <div class="flex items-center justify-center gap-3">
                <a id="splat-open-btn" href="#" target="_blank" rel="noopener"
                  class="inline-flex items-center px-3 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white font-medium">
                  Open in 3DStreet
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
      modelSelect: byId('splat-model-select'),
      modelBlurb: byId('splat-model-blurb'),
      modelNotice: byId('splat-model-notice'),
      imageBlock: byId('splat-image-block'),
      videoBlock: byId('splat-video-block'),
      qualityBlock: byId('splat-quality-block'),
      qualityButtons: byId('splat-quality-buttons'),
      // image inputs
      sourceUploadLabel: byId('splat-source-upload-label'),
      sourceInput: byId('splat-source-input'),
      sourceName: byId('splat-source-name'),
      sourcePreviewContainer: byId('splat-source-preview-container'),
      sourcePreview: byId('splat-source-preview'),
      sourceClear: byId('splat-source-clear'),
      // video inputs
      videoUploadLabel: byId('splat-video-upload-label'),
      videoInput: byId('splat-video-input'),
      videoName: byId('splat-video-name'),
      videoSelected: byId('splat-video-selected'),
      videoSelectedName: byId('splat-video-selected-name'),
      videoClear: byId('splat-video-clear'),
      // shared
      generateBtn: byId('splat-generate-btn'),
      generateSpinner: byId('splat-generate-spinner'),
      generateText: byId('splat-generate-text'),
      notifyEmail: byId('splat-notify-email'),
      previewContainer: byId('splat-preview-container'),
      placeholder: byId('splat-placeholder'),
      placeholderText: byId('splat-placeholder-text'),
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

    els.modelSelect.addEventListener('change', (e) =>
      this.selectModel(e.target.value)
    );

    els.qualityButtons.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tier-id]');
      if (btn) this.selectModel(btn.dataset.tierId);
    });

    // Image input
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

    // Video input
    els.videoInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      this.setSourceVideo(file);
    });

    els.videoClear.addEventListener('click', (e) => {
      e.preventDefault();
      this.clearSourceVideo();
    });

    els.generateBtn.addEventListener('click', () => this.generateSplat());

    els.downloadBtn.addEventListener('click', () => {
      if (this.currentSplatUrl) this.downloadSplat();
    });
  },

  currentModel() {
    return (
      SPLAT_MODELS[this.currentModelId] || SPLAT_MODELS[DEFAULT_SPLAT_MODEL]
    );
  },

  // Switch the active model: toggles which source input is shown and updates the
  // labels/notice/button. Selecting a model does not clear the other source so a
  // user can flip back and forth, but generateSplat only reads the active one.
  selectModel(modelId) {
    if (!SPLAT_MODELS[modelId]) modelId = DEFAULT_SPLAT_MODEL;
    this.currentModelId = modelId;
    const model = this.currentModel();
    const els = this.elements;

    const isVideo = model.inputKind === 'video';
    els.imageBlock.classList.toggle('hidden', isVideo);
    els.videoBlock.classList.toggle('hidden', !isVideo);

    // Tiered model → show the quality row and highlight the active tier.
    els.qualityBlock.classList.toggle('hidden', !model.tierGroup);
    els.qualityButtons.querySelectorAll('[data-tier-id]').forEach((btn) => {
      btn.classList.toggle('selected', btn.dataset.tierId === modelId);
    });

    els.modelBlurb.textContent = model.blurb;
    els.modelNotice.innerHTML = model.notice;
    // The dropdown carries one entry per group, valued at the group's default
    // tier id — keep it on that entry while tier buttons change the model.
    const selectValue = model.tierGroup || modelId;
    if (els.modelSelect.value !== selectValue) {
      els.modelSelect.value = selectValue;
    }

    this.updateGenerateLabel();
  },

  updateGenerateLabel() {
    const cost = this.currentModel().tokenCost;
    const label = `Generate Splat (${cost} token${cost === 1 ? '' : 's'})`;
    if (this.elements.generateText) {
      this.elements.generateText.textContent = label;
    }
  },

  setSourceImage(dataUrl, fileName = 'image') {
    this.sourceImageData = dataUrl;
    this.elements.sourceName.textContent = fileName;
    this.elements.sourcePreview.src = dataUrl;
    this.elements.sourceUploadLabel.classList.add('hidden');
    this.elements.sourcePreviewContainer.classList.remove('hidden');
  },

  clearSourceImage() {
    this.sourceImageData = null;
    this.elements.sourceInput.value = '';
    this.elements.sourceName.textContent = 'No file selected';
    this.elements.sourcePreview.src = '';
    this.elements.sourcePreviewContainer.classList.add('hidden');
    this.elements.sourceUploadLabel.classList.remove('hidden');
  },

  setSourceVideo(file) {
    if (file.size > VIDEO_MAX_BYTES) {
      FluxUI.showNotification(
        `Video is too large (max ${Math.round(VIDEO_MAX_BYTES / (1024 * 1024))} MB). Trim it to a short orbit and try again.`,
        'error'
      );
      this.clearSourceVideo();
      return;
    }
    this.sourceVideoFile = file;
    this.elements.videoSelectedName.textContent = file.name;
    this.elements.videoUploadLabel.classList.add('hidden');
    this.elements.videoSelected.classList.remove('hidden');
  },

  clearSourceVideo() {
    this.sourceVideoFile = null;
    this.elements.videoInput.value = '';
    this.elements.videoName.textContent = 'No file selected';
    this.elements.videoSelectedName.textContent = '';
    this.elements.videoSelected.classList.add('hidden');
    this.elements.videoUploadLabel.classList.remove('hidden');
  },

  validate() {
    if (!window.authState || !window.authState.isAuthenticated) {
      useImageGenStore.getState().setModal('signin');
      return false;
    }
    const cost = this.currentModel().tokenCost;
    const tokens = window.authState.tokenProfile?.genToken || 0;
    if (tokens < cost) {
      window.dispatchEvent(
        new CustomEvent('openPurchaseModal', {
          detail: { tokenType: 'genToken' }
        })
      );
      return false;
    }
    if (this.currentModel().inputKind === 'video') {
      if (!this.sourceVideoFile) {
        FluxUI.showNotification('Please choose a source video first.', 'error');
        return false;
      }
    } else if (!this.sourceImageData) {
      FluxUI.showNotification('Please upload a source image first.', 'error');
      return false;
    }
    return true;
  },

  toggleLoading(isLoading) {
    const els = this.elements;
    els.generateBtn.disabled = isLoading;
    els.generateSpinner.classList.toggle('hidden', !isLoading);
    if (isLoading) {
      els.generateText.textContent = 'Generating…';
      els.placeholder.classList.add('hidden');
      els.result.classList.add('hidden');
      els.loadingIndicator.classList.remove('hidden');
      // Start in the "uploading" phase: the source is still being sent to the
      // server, so the tab can't be closed yet and a generation timer would be
      // misleading. generateSplat() flips to 'processing' once the job is
      // actually submitted.
      this.setLoadingPhase('uploading');
    } else {
      els.loadingIndicator.classList.add('hidden');
      this.stopTimer();
      this.updateGenerateLabel();
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
      if (els.loadingText) els.loadingText.textContent = 'Uploading…';
      if (els.loadingSubtext) els.loadingSubtext.classList.add('hidden');
      if (els.generateText) els.generateText.textContent = 'Uploading…';
    } else if (phase === 'processing') {
      if (els.loadingSubtext) {
        // Honest, model-aware expectation — "a few minutes" undersells a
        // ~45-minute vid2scene High run.
        const eta = this.currentModel().etaText || 'a few minutes';
        els.loadingSubtext.textContent = `This usually takes ${eta}. You can close this tab; your splat saves to your gallery when it's done.`;
        els.loadingSubtext.classList.remove('hidden');
      }
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

  // Poll cadence and overall ceiling for the status loop. Cold boots + video
  // reconstruction can run several minutes; 20 min is generous headroom before
  // we give up locally (the job still finishes server-side regardless).
  POLL_INTERVAL_MS: 3000,
  POLL_MAX_MS: 20 * 60 * 1000,

  // Upload the chosen video straight to Firebase Storage (resumable, with a
  // progress label) and return the storage PATH. The Cloud Function makes this
  // path briefly fetchable for Replicate and deletes it when the job finishes.
  async uploadSourceVideo() {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new Error('Not signed in');
    const file = this.sourceVideoFile;
    const ext = (file.name.split('.').pop() || 'mp4').toLowerCase();
    const path = `users/${uid}/assets/splat-sources/${crypto.randomUUID()}.${ext}`;
    const task = uploadBytesResumable(storageRef(storage, path), file, {
      contentType: file.type || 'video/mp4'
    });
    await new Promise((resolve, reject) => {
      task.on(
        'state_changed',
        (snap) => {
          const pct = Math.round(
            (snap.bytesTransferred / snap.totalBytes) * 100
          );
          if (this.elements.loadingText) {
            this.elements.loadingText.textContent = `Uploading video… ${pct}%`;
          }
        },
        reject,
        resolve
      );
    });
    return path;
  },

  async generateSplat() {
    if (!this.validate()) return;

    this.stopPolling();
    this.toggleLoading(true);

    try {
      const model = this.currentModel();
      const generateReplicateSplat = httpsCallable(
        functions,
        'generateReplicateSplat'
      );

      const payload = {
        model_id: this.currentModelId,
        source: 'generator',
        // Opt-in completion email, recorded on the job doc. The server only
        // sends it if this tab isn't around to ack the result (i.e. closed).
        notify: { email: !!this.elements.notifyEmail?.checked }
      };

      if (model.inputKind === 'video') {
        // Videos are too large to base64 through the callable, so upload to
        // Storage first and pass the path.
        payload.input_video = await this.uploadSourceVideo();
      } else {
        payload.input_image = this.sourceImageData;
      }

      const result = await generateReplicateSplat(payload);

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
        this.showResult(data.splat_url, data.assetId);
        this.toggleLoading(false);
        window.dispatchEvent(new Event('assets:refresh'));
        FluxUI.showNotification('Splat generated!', 'success');
        posthog.capture('splat_generated', { model: this.currentModelId });
        return;
      }

      if (data.status === 'failed' || data.status === 'canceled') {
        // The server refunds on failure; refresh the displayed balance.
        window.dispatchEvent(new CustomEvent('tokenCountChanged'));
        this.failGeneration(
          data.error
            ? `Splat generation failed: ${data.error}`
            : 'Splat generation failed. Your tokens were refunded.'
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

  showResult(splatUrl, assetId) {
    this.elements.placeholder.classList.add('hidden');
    this.elements.result.classList.remove('hidden');
    // "Open in 3DStreet" deep-links to the editor with the asset's detail modal
    // already open (#asset:OWNER/ID — same shape as the completion email CTA),
    // where the user gets the live viewer + a "Place in scene" button. Falls
    // back to the raw .ply if we somehow lack an assetId/uid.
    const uid = auth.currentUser?.uid;
    this.elements.openBtn.href =
      assetId && uid
        ? `${window.location.origin}/?utm_source=generator&utm_medium=splat_result&utm_campaign=open_in_editor#asset:${uid}/${assetId}`
        : splatUrl;
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
      const slug =
        this.currentModel().inputKind === 'video' ? 'vid2scene' : 'sharp';
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${slug}-splat-${stamp}.ply`;
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
