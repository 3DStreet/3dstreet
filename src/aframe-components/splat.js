/* global AFRAME */

// Import direct from the constants module (not the @shared/assets barrel, which
// would pull React/Firebase into this early-loaded A-Frame bundle).
import { SPLAT_EXTENSIONS } from '@shared/assets/constants.js';

// Spark library is loaded dynamically to reduce initial bundle size (~500KB)
let SplatMesh = null;
let SparkRenderer = null;
// PagedSplats is needed for local .rad previews: we construct it ourselves from
// in-memory bytes (see loadSplat) because SplatMesh's paged===true path can't be
// told a fileType.
let PagedSplats = null;
// Spark's own extension→SplatFileType mapper. We use it for blob: previews
// (which have no extension to sniff) so the hint we pass is a real SplatFileType
// enum value, not the bare extension — these differ for some formats (notably
// ".sog" → "pcsogszip"), which is why passing the raw extension broke .sog.
let getSplatFileTypeFromPath = null;
let sparkLoadPromise = null;

/**
 * Dynamically loads the Spark library for Gaussian Splat rendering.
 * Only loaded when first splat component is used.
 */
async function loadSparkLibrary() {
  if (SplatMesh && SparkRenderer) {
    return { SplatMesh, SparkRenderer, PagedSplats, getSplatFileTypeFromPath };
  }

  if (!sparkLoadPromise) {
    sparkLoadPromise = import(
      /* webpackChunkName: "spark-splat" */ '@sparkjsdev/spark'
    ).then((module) => {
      SplatMesh = module.SplatMesh;
      SparkRenderer = module.SparkRenderer;
      PagedSplats = module.PagedSplats;
      getSplatFileTypeFromPath = module.getSplatFileTypeFromPath;
      console.log('[splat] Spark library loaded');
      return {
        SplatMesh,
        SparkRenderer,
        PagedSplats,
        getSplatFileTypeFromPath
      };
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
    src: { type: 'string', default: '' },
    // Optional format hint (e.g. 'splat', 'ply') used only when `src` is a
    // blob: URL with no extension to identify — see loadSplat. Ignored when the
    // src already carries a recognizable extension (cloud URLs).
    format: { type: 'string', default: '' }
  },

  init: function () {
    this.splatMesh = null;
    // True only after a load has fully rendered (its `initialized` resolved).
    // The blob→cloud no-reload guard keys off this — not the mere existence of
    // a SplatMesh object — so a FAILED local preview still reloads the cloud
    // copy in place instead of staying stuck blank.
    this.rendered = false;
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
    // uploadAndPlaceAsset). If the blob splat already RENDERED, re-fetching and
    // re-decoding the (often huge) cloud copy is pure waste, so keep the loaded
    // mesh; only the saved src changed. Gate on `rendered` rather than "a
    // SplatMesh object exists": a blob preview that failed to render (e.g. a
    // headerless .splat whose blob: URL has no extension) must fall through and
    // load the cloud copy. A later swap to a different format (e.g. the
    // streaming .rad) comes from a non-blob oldData.src, so it still reloads.
    if (this.rendered && /^blob:/i.test(oldData.src || '')) {
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
    // A new load supersedes any prior rendered state.
    this.rendered = false;

    // Show the indicator immediately. Spark's onProgress only reports the
    // network fetch (THREE.FileLoader); the multi-second decode/LOD pass that
    // follows emits nothing, so the default state is an indeterminate
    // "Processing splat…". The fetch % is layered on top when available.
    this.showIndicator('Processing splat…');
    this.el.emit('splat-loading', { src }, false);

    try {
      // Dynamically load the Spark library (only loads once, ~500KB)
      const {
        SplatMesh: LoadedSplatMesh,
        PagedSplats: LoadedPagedSplats,
        getSplatFileTypeFromPath: sparkGetFileType
      } = await loadSparkLibrary();
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
      // Resolve the splat format. Spark identifies it from the URL extension or
      // magic bytes on its own, so for a URL that carries a recognizable
      // extension (cloud URLs) we pass NO fileType and let Spark map it —
      // critically, its SplatFileType enum does NOT always equal the extension
      // (".sog" → "pcsogszip"), so passing the bare extension as fileType breaks
      // those formats. This mirrors the standalone splat-viewer.html, which
      // never passes fileType for cloud URLs.
      //
      // A blob: preview is the only case Spark can't sniff: the URL has no
      // extension AND .splat is headerless. There we map the upload's `format`
      // hint to a real SplatFileType via Spark's own getSplatFileTypeFromPath
      // (so ".sog" → "pcsogszip" etc.), falling back to the raw hint.
      const noQuery = src.split(/[?#]/)[0];
      const lastSeg = noQuery.slice(noQuery.lastIndexOf('/') + 1);
      const urlExt = lastSeg.includes('.')
        ? lastSeg.split('.').pop().toLowerCase()
        : '';
      const hasSniffableExt = SPLAT_EXTENSIONS.includes(urlExt);
      // The effective extension (for paged/RAD detection): the URL's when
      // present, else the upload format hint for blob: previews.
      const ext = hasSniffableExt
        ? urlExt
        : (this.data.format || '').toLowerCase();
      const isRad = ext === 'rad';
      // Only hint fileType when Spark can't sniff it (blob: preview).
      let fileType;
      if (!hasSniffableExt && ext) {
        fileType = sparkGetFileType ? sparkGetFileType(`x.${ext}`) || ext : ext;
      }

      // Local .rad preview (blob: URL): SplatMesh's `paged: true` path builds
      // PagedSplats with only `{ rootUrl }`, dropping our fileType, and a blob:
      // URL has no extension to sniff, so PagedSplats throws "Unable to determine
      // file type" before any fetch. (Cloud .rad URLs are fine: the .rad
      // extension is detectable and range requests work.) Build PagedSplats
      // ourselves from the blob's bytes: type comes from the magic bytes and the
      // single-file RAD is read in-memory (no range requests on a blob), so the
      // local preview renders immediately. Multi-chunk RAD isn't produced by our
      // pipeline, so the in-memory path always applies here.
      let pagedInstance = null;
      if (isRad && /^blob:/i.test(src) && LoadedPagedSplats) {
        const fileBytes = new Uint8Array(
          await (await fetch(src)).arrayBuffer()
        );
        if (loadId !== this.loadId) return;
        pagedInstance = new LoadedPagedSplats({ fileBytes, fileType: 'rad' });
      }

      const splatMesh = new LoadedSplatMesh({
        url: src,
        // fileType is honored by the non-paged loader; for paged it lives on the
        // PagedSplats instance instead (SplatMesh ignores it there).
        ...(fileType && !pagedInstance ? { fileType } : {}),
        ...(pagedInstance
          ? { paged: pagedInstance }
          : isRad
            ? { paged: true }
            : {}),
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
      this.rendered = true;
      this.hideIndicator();
      this.el.emit('splat-loaded', { src }, false);
    } catch (error) {
      if (loadId !== this.loadId) return;
      console.error('[splat] Failed to load splat:', error);
      // A blob: src is ALWAYS a transient local preview that uploadAndPlaceAsset
      // swaps for the uploaded cloud URL on success. Some formats can't be
      // previewed from a blob: URL (e.g. .sog → Spark's pcsogszip loader), but
      // the very same file loads fine from its cloud URL (which carries a real
      // extension). So for a blob failure, don't flash a scary error — keep the
      // "Processing…" indicator up; the cloud reload that follows renders it.
      // (On upload failure the blob stays, but that surfaces via the upload UI.)
      if (/^blob:/i.test(src)) {
        this.el.emit('splat-error', { src, error, preview: true }, false);
        return;
      }
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
