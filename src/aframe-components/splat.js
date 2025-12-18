/* global AFRAME */
import { SplatMesh, SparkRenderer } from '@sparkjsdev/spark';

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

    // Create new splat mesh
    try {
      this.splatMesh = new SplatMesh({ url: src });
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
 * This system is automatically initialized when any entity uses the splat component.
 */
AFRAME.registerSystem('splat', {
  init: function () {
    // Wait for the renderer to be available
    if (this.el.renderer) {
      this.initSparkRenderer();
    } else {
      this.el.addEventListener('renderstart', () => {
        this.initSparkRenderer();
      });
    }
  },

  initSparkRenderer: function () {
    if (this.sparkRenderer) {
      return;
    }
    this.sparkRenderer = new SparkRenderer({ renderer: this.el.renderer });
    this.el.object3D.add(this.sparkRenderer);
  }
});
