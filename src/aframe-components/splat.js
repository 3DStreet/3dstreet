/* global AFRAME */

// Spark library is loaded dynamically to reduce initial bundle size (~500KB)
let SplatMesh = null;
let SparkRenderer = null;
let sparkLoadPromise = null;

/**
 * Dynamically loads the Spark library for Gaussian Splat rendering.
 * Only loaded when first splat component is used.
 */
async function loadSparkLibrary() {
  if (SplatMesh && SparkRenderer) {
    return { SplatMesh, SparkRenderer };
  }

  if (!sparkLoadPromise) {
    sparkLoadPromise = import(
      /* webpackChunkName: "spark-splat" */ '@sparkjsdev/spark'
    ).then((module) => {
      SplatMesh = module.SplatMesh;
      SparkRenderer = module.SparkRenderer;
      console.log('[splat] Spark library loaded');
      return { SplatMesh, SparkRenderer };
    });
  }

  return sparkLoadPromise;
}

/**
 * Normalizes a URL by adding http/https protocol if missing.
 * @param {string} url - The URL to normalize
 * @returns {string} - The normalized URL with protocol
 */
function normalizeUrl(url) {
  if (!url) return url;

  // blob:/data: URLs are already fully-qualified and opaque (the part after
  // the scheme is not a host). Never rewrite them — prepending a protocol
  // mangles the local-preview blob URL used for drag-and-drop uploads.
  if (/^(blob|data):/i.test(url)) return url;

  // If URL starts with localhost or an IP without protocol, add http://
  if (
    /^localhost[:/]/.test(url) ||
    /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}[:/]/.test(url)
  ) {
    return 'http://' + url;
  }

  // If URL has no protocol but starts with a domain-like pattern, add https://
  if (!url.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)) {
    return 'https://' + url;
  }

  return url;
}

/**
 * Splat component for loading Gaussian Splat files using the Spark library.
 * Supports .splat, .ply, .spz, and .rad file formats.
 * RAD files stream progressively via HTTP range requests (best for large scenes).
 *
 * Note: The hosting server must have CORS headers configured to allow
 * cross-origin requests. GitHub raw URLs do not work due to CORS restrictions.
 *
 * Usage: <a-entity splat="src: https://example.com/model.splat"></a-entity>
 */
AFRAME.registerComponent('splat', {
  schema: {
    src: { type: 'string', default: '' }
  },

  init: function () {
    this.splatMesh = null;
    // In-scene loading/processing indicator (THREE.Sprite, not a child
    // entity — runtime-only, never serialized into the saved scene).
    this.indicator = null;
    this.indicatorTimer = null;
    // Monotonic id so a stale load (src changed mid-load) can't hide or
    // error the indicator belonging to a newer load.
    this.loadId = 0;
  },

  update: function (oldData) {
    let src = this.data.src;

    // Only load if src has changed and is not empty
    if (src === oldData.src || !src) {
      return;
    }

    // Post-upload identity swap: the entity's src flips from the local blob:
    // URL to the just-uploaded cloud URL of the SAME file (see
    // uploadAndPlaceAsset). The blob splat is already rendered, so re-fetching
    // and re-decoding the (often huge) cloud copy is pure waste — it was
    // re-running the whole processing pass. Keep the loaded mesh; only the
    // saved src changed. A later swap to a different format (e.g. the streaming
    // .rad) comes from a non-blob oldData.src, so it still reloads as intended.
    if (this.splatMesh && /^blob:/i.test(oldData.src || '')) {
      return;
    }

    // Normalize URL (add protocol if missing)
    src = normalizeUrl(src);

    // Remove existing splat mesh and any leftover indicator if any
    if (this.splatMesh) {
      this.el.removeObject3D('mesh');
      this.splatMesh = null;
    }
    this.hideIndicator();

    // Warn about common CORS issues
    if (
      src.includes('github.com') ||
      src.includes('raw.githubusercontent.com')
    ) {
      console.warn(
        '[splat] GitHub URLs may not work due to CORS restrictions. ' +
          'Consider hosting your splat file on a CORS-enabled server or CDN.'
      );
    }

    // Load Spark library dynamically, then create the splat mesh
    this.loadSplat(src);
  },

  loadSplat: async function (src) {
    // Tag this load so a newer load (src changed before this one finishes)
    // can detect it has been superseded and skip its own cleanup/error.
    const loadId = ++this.loadId;

    // Show the indicator immediately. Spark's onProgress only reports the
    // network fetch (THREE.FileLoader); the multi-second decode/LOD pass that
    // follows emits nothing, so the default state is an indeterminate
    // "Processing splat…". The fetch % is layered on top when available.
    this.showIndicator('Processing splat…');
    this.el.emit('splat-loading', { src }, false);

    try {
      // Dynamically load the Spark library (only loads once, ~500KB)
      const { SplatMesh: LoadedSplatMesh } = await loadSparkLibrary();
      if (loadId !== this.loadId) return;

      // Initialize the SparkRenderer if not already done
      this.system.initSparkRenderer();

      // Create new splat mesh.
      // RAD files have pre-built LOD and stream via HTTP range requests (paged).
      // Every other format renders at full detail: we deliberately do NOT build
      // LOD on the fly. For large splats that pass costs many seconds and the
      // result is ephemeral (rebuilt every load) and non-serializable — the
      // cloud RAD pipeline bakes a streamable LOD variant instead, which the
      // scene prefers (optimizedSourceUrl) on the next load.
      const isRad = new URL(src).pathname.toLowerCase().endsWith('.rad');
      const splatMesh = new LoadedSplatMesh({
        url: src,
        ...(isRad ? { paged: true } : {}),
        // Fetch progress only. Once bytes are in (loaded === total) the
        // silent processing phase begins, so flip back to indeterminate.
        onProgress: (event) => {
          if (loadId !== this.loadId) return;
          if (event && event.lengthComputable && event.total > 0) {
            const pct = Math.round((event.loaded / event.total) * 100);
            this.setIndicatorText(
              pct >= 100 ? 'Processing splat…' : `Loading splat… ${pct}%`
            );
          }
        }
      });
      this.splatMesh = splatMesh;
      // Spark uses a different quaternion convention, rotate to match A-Frame
      this.splatMesh.quaternion.set(1, 0, 0, 0);

      // Disable raycasting on the splat mesh to prevent errors when
      // the internal raycast buffer isn't ready yet
      this.splatMesh.raycast = function () {};

      // Set the splat mesh directly on the entity (like gltf-model does)
      this.el.setObject3D('mesh', this.splatMesh);

      // mesh only renders once Spark finishes decoding/building LOD. Wait for
      // that promise so the indicator covers the processing gap, not just fetch.
      await splatMesh.initialized;
      if (loadId !== this.loadId) return;
      this.hideIndicator();
      this.el.emit('splat-loaded', { src }, false);
    } catch (error) {
      if (loadId !== this.loadId) return;
      console.error('[splat] Failed to load splat:', error);
      this.showIndicatorError('Failed to load splat');
      this.el.emit('splat-error', { src, error }, false);
      // Auto-clear, but only if no newer load has taken over in the meantime.
      setTimeout(() => {
        if (loadId === this.loadId) this.hideIndicator();
      }, 5000);
    }
  },

  remove: function () {
    if (this.splatMesh) {
      this.el.removeObject3D('mesh');
      this.splatMesh = null;
    }
    this.hideIndicator();
  },

  /**
   * Draw the indicator label onto its canvas. Called on create and on every
   * text/animation update. `dots` drives the animated ellipsis so the user
   * sees activity during the progress-event-less processing phase.
   */
  drawIndicator: function (text, color, dots) {
    const ctx = this.indicator.ctx;
    const canvas = ctx.canvas;
    const label = dots != null ? text.replace(/…$/, '.'.repeat(dots)) : text;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(20, 20, 24, 0.82)';
    const r = 28;
    const w = canvas.width;
    const h = canvas.height;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(w, 0, w, h, r);
    ctx.arcTo(w, h, 0, h, r);
    ctx.arcTo(0, h, 0, 0, r);
    ctx.arcTo(0, 0, w, 0, r);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = '600 52px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, h / 2 + 2);
    this.indicator.texture.needsUpdate = true;
  },

  /**
   * Create (or reuse) the in-scene sprite indicator. THREE.Sprite always
   * faces the camera (no billboard tick) and lives on object3D only, so the
   * scene serializer never persists it.
   */
  showIndicator: function (text) {
    const THREE = AFRAME.THREE;
    if (this.indicatorTimer) {
      clearInterval(this.indicatorTimer);
      this.indicatorTimer = null;
    }
    if (!this.indicator) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({
        map: texture,
        // Draw on top even though the splat mesh isn't rendered yet.
        depthTest: false,
        depthWrite: false,
        transparent: true,
        // Constant screen-space size: three.js cancels the perspective divide
        // so the badge doesn't grow/shrink with zoom or distance. Scale then
        // reads ~ fraction of viewport height (0.1 ≈ 10% tall), 4:1 aspect.
        sizeAttenuation: false
      });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(0.4, 0.1, 1);
      sprite.renderOrder = 999;
      this.indicator = { sprite, material, texture, ctx, text };
      this.el.object3D.add(sprite);
    }
    this.indicator.text = text;
    let dots = 0;
    this.drawIndicator(text, '#ffffff', dots);
    // Animate the ellipsis so the indeterminate processing phase reads as live.
    this.indicatorTimer = setInterval(() => {
      dots = (dots + 1) % 4;
      this.drawIndicator(this.indicator.text, '#ffffff', dots);
    }, 400);
  },

  setIndicatorText: function (text) {
    if (this.indicator) this.indicator.text = text;
  },

  /**
   * Swap the indicator to an error label (no animation). The caller is
   * responsible for scheduling an auto-hide (guarded by loadId).
   */
  showIndicatorError: function (text) {
    if (!this.indicator) this.showIndicator(text);
    if (this.indicatorTimer) {
      clearInterval(this.indicatorTimer);
      this.indicatorTimer = null;
    }
    this.indicator.text = text;
    this.drawIndicator(text, '#ff6b6b', null);
  },

  hideIndicator: function () {
    if (this.indicatorTimer) {
      clearInterval(this.indicatorTimer);
      this.indicatorTimer = null;
    }
    if (!this.indicator) return;
    this.el.object3D.remove(this.indicator.sprite);
    this.indicator.material.dispose();
    this.indicator.texture.dispose();
    this.indicator = null;
  },

  /**
   * Get the bounding box of the splat mesh.
   * Uses Spark's getBoundingBox method for accurate bounds.
   * @param {boolean} centersOnly - If true, only considers splat centers (faster, default: true)
   * @returns {THREE.Box3|null} The bounding box or null if not loaded
   */
  getBoundingBox: function (centersOnly = true) {
    if (!this.splatMesh) {
      return null;
    }
    try {
      return this.splatMesh.getBoundingBox(centersOnly);
    } catch (e) {
      return null;
    }
  }
});

/**
 * Splat system that initializes the SparkRenderer for Gaussian Splat visualization.
 * The SparkRenderer is lazily initialized only when the first splat is loaded.
 */
AFRAME.registerSystem('splat', {
  init: function () {
    this.sparkRenderer = null;
    this.rendererReady = false;

    // Track when renderer is available
    if (this.el.renderer) {
      this.rendererReady = true;
    } else {
      this.el.addEventListener('renderstart', () => {
        this.rendererReady = true;
        // If SparkRenderer was requested before renderer was ready, init it now
        if (this._pendingInit) {
          this.initSparkRenderer();
        }
      });
    }
  },

  initSparkRenderer: async function () {
    if (this.sparkRenderer) {
      return;
    }

    if (!this.rendererReady) {
      // Mark that we need to init once renderer is ready
      this._pendingInit = true;
      return;
    }

    try {
      // Load Spark library dynamically
      const { SparkRenderer: LoadedSparkRenderer } = await loadSparkLibrary();
      this.sparkRenderer = new LoadedSparkRenderer({
        renderer: this.el.renderer,
        enableLod: true
      });
      this.el.object3D.add(this.sparkRenderer);
    } catch (error) {
      console.error('[splat] Failed to initialize SparkRenderer:', error);
    }
  }
});
