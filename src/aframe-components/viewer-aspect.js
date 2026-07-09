/* global AFRAME */

/**
 * viewer-aspect
 * =============
 *
 * Fixed-aspect (letterboxed) presentation for the Viewer. When the
 * store's `viewerAspectRatio` is a fixed ratio (e.g. '16:9', '9:16')
 * and the inspector is closed, the canvas is sized to the largest
 * centered rect of that ratio that fits the window — black bars fill
 * the rest — so the framing (and any recorded/captured output, which
 * reads the canvas buffer) is identical across devices. 'fill', the
 * default, leaves everything to A-Frame's normal full-window sizing.
 *
 * How it stays consistent with A-Frame: a-scene.resize() is the single
 * authority for canvas sizing and always emits `rendererresize` after
 * running. This system never fights it — it listens for that event and
 * immediately overlays the letterbox rect (renderer size + camera
 * aspect + canvas CSS) while the letterbox is active, or clears its
 * inline styles when it isn't. State changes (aspect picked in the UI,
 * inspector toggled, VR exited) just call sceneEl.resize() and let the
 * event handler converge. Window resizes already flow through
 * a-scene's own resize handler, so they re-letterbox for free.
 */
import useStore from '../store.js';
import {
  parseAspectRatio,
  fitRectToContainer,
  constrainSizeTo
} from './viewer-aspect-utils.js';

AFRAME.registerSystem('viewer-aspect', {
  init: function () {
    this.applied = false;
    this.savedBodyBackground = null;
    this.onRendererResize = this.onRendererResize.bind(this);
    this.sync = this.sync.bind(this);

    this.sceneEl.addEventListener('rendererresize', this.onRendererResize);
    // Camera swaps (editor⇄viewer handoff and any future camera-set-
    // active) never resize on their own in A-Frame; resync so the newly
    // active camera picks up the current (letterboxed or full) aspect.
    this.sceneEl.addEventListener('camera-set-active', this.sync);
    // XR drives its own framebuffer sizing; drop the letterbox while
    // presenting (a-scene.resize() early-returns in VR, so clear the
    // styles directly) and restore it on exit.
    this.sceneEl.addEventListener('enter-vr', () => this.clearLetterbox());
    this.sceneEl.addEventListener('exit-vr', this.sync);

    this.unsubscribers = [
      useStore.subscribe((state) => state.viewerAspectRatio, this.sync),
      useStore.subscribe((state) => state.isInspectorEnabled, this.sync)
    ];
  },

  remove: function () {
    this.sceneEl.removeEventListener('rendererresize', this.onRendererResize);
    this.sceneEl.removeEventListener('camera-set-active', this.sync);
    this.unsubscribers.forEach((unsubscribe) => unsubscribe());
    this.clearLetterbox();
  },

  getRatio: function () {
    return parseAspectRatio(useStore.getState().viewerAspectRatio);
  },

  isActive: function () {
    return (
      !useStore.getState().isInspectorEnabled &&
      this.getRatio() !== null &&
      !this.sceneEl.is('vr-mode')
    );
  },

  /**
   * Recompute canvas sizing after a state change. a-scene.resize()
   * restores the full-window size, updates the active camera, and emits
   * rendererresize — where onRendererResize re-applies (or clears) the
   * letterbox. Routing everything through the event keeps one code path
   * and lets other canvas-rect consumers (css2d-renderer) follow along.
   */
  sync: function () {
    if (!this.isActive() && this.applied) this.clearLetterbox();
    this.sceneEl.resize();
  },

  onRendererResize: function () {
    // Never call sceneEl.resize() from here — infinite loop.
    if (this.isActive()) {
      this.applyLetterbox();
    } else {
      this.clearLetterbox();
    }
  },

  applyLetterbox: function () {
    const sceneEl = this.sceneEl;
    const canvas = sceneEl.canvas;
    const camera = sceneEl.camera;
    const renderer = sceneEl.renderer;
    if (!canvas || !renderer) return;

    const ratio = this.getRatio();
    const rect = fitRectToContainer(
      ratio,
      document.body.offsetWidth,
      document.body.offsetHeight
    );
    // A-Frame's html.a-fullscreen .a-canvas rules are !important, so
    // plain inline styles lose — inline !important wins over both.
    // (left+width beat the rule's right:0 via CSS over-constraint.)
    canvas.style.setProperty('width', rect.width + 'px', 'important');
    canvas.style.setProperty('height', rect.height + 'px', 'important');
    canvas.style.setProperty('left', rect.left + 'px', 'important');
    canvas.style.setProperty('top', rect.top + 'px', 'important');
    if (!this.applied) {
      this.savedBodyBackground = document.body.style.backgroundColor;
      document.body.style.backgroundColor = '#000';
      this.applied = true;
    }

    const size = constrainSizeTo(
      { width: rect.width, height: rect.height },
      sceneEl.maxCanvasSize,
      window.devicePixelRatio
    );
    renderer.setSize(size.width, size.height, false);
    if (camera && camera.isPerspectiveCamera) {
      // The exact requested ratio, not the px-rounded rect's — output
      // framing must be deterministic across devices.
      camera.aspect = ratio;
      camera.updateProjectionMatrix();
    }
  },

  clearLetterbox: function () {
    if (!this.applied) return;
    const canvas = this.sceneEl.canvas;
    if (canvas) {
      canvas.style.removeProperty('width');
      canvas.style.removeProperty('height');
      canvas.style.removeProperty('left');
      canvas.style.removeProperty('top');
    }
    document.body.style.backgroundColor = this.savedBodyBackground || '';
    this.applied = false;
  }
});
