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
    sparkLoadPromise = import('@sparkjsdev/spark').then((module) => {
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
 * Supports .splat, .ply, and .spz file formats.
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
  },

  update: function (oldData) {
    let src = this.data.src;

    // Only load if src has changed and is not empty
    if (src === oldData.src || !src) {
      return;
    }

    // Normalize URL (add protocol if missing)
    src = normalizeUrl(src);

    // Remove existing splat mesh if any
    if (this.splatMesh) {
      this.el.removeObject3D('mesh');
      this.splatMesh = null;
    }

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
    try {
      // Dynamically load the Spark library (only loads once, ~500KB)
      const { SplatMesh: LoadedSplatMesh } = await loadSparkLibrary();

      // Initialize the SparkRenderer if not already done
      this.system.initSparkRenderer();

      // Create new splat mesh
      this.splatMesh = new LoadedSplatMesh({ url: src });
      // Spark uses a different quaternion convention, rotate to match A-Frame
      this.splatMesh.quaternion.set(1, 0, 0, 0);

      // Set the splat mesh directly on the entity (like gltf-model does)
      this.el.setObject3D('mesh', this.splatMesh);
    } catch (error) {
      console.error('[splat] Failed to create splat mesh:', error);
    }
  },

  remove: function () {
    if (this.splatMesh) {
      this.el.removeObject3D('mesh');
      this.splatMesh = null;
    }
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
    return this.splatMesh.getBoundingBox(centersOnly);
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
        renderer: this.el.renderer
      });
      this.el.object3D.add(this.sparkRenderer);
    } catch (error) {
      console.error('[splat] Failed to initialize SparkRenderer:', error);
    }
  }
});
