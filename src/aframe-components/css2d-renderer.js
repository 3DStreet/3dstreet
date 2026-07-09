// A-Frame component for CSS2D rendering
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

AFRAME.registerComponent('css2d-renderer', {
  init: function () {
    // Create CSS2D renderer
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0px';
    this.labelRenderer.domElement.style.pointerEvents = 'none'; // Let mouse events pass through
    this.labelRenderer.domElement.style.zIndex = '1'; // Ensure labels stay behind UI elements
    document.body.appendChild(this.labelRenderer.domElement);

    // Bind methods
    this.render = this.render.bind(this);
    this.onResize = this.onResize.bind(this);

    // Track the canvas rect, not just the window: the viewer-aspect
    // system letterboxes the canvas to a fixed aspect ratio, and label
    // positions only line up if this overlay matches the canvas exactly.
    // rendererresize fires after every a-scene.resize() (which window
    // resizes route through); keep the window listener as a fallback.
    window.addEventListener('resize', this.onResize);
    this.el.sceneEl.addEventListener('rendererresize', this.onResize);
    this.onResize();

    // Start render loop
    this.render();
  },

  render: function () {
    requestAnimationFrame(this.render);

    // Only render if we have a scene and camera
    if (this.el.sceneEl.camera) {
      this.labelRenderer.render(
        this.el.sceneEl.object3D,
        this.el.sceneEl.camera
      );
    }
  },

  onResize: function () {
    const canvas = this.el.sceneEl.canvas;
    if (canvas) {
      const rect = canvas.getBoundingClientRect();
      this.labelRenderer.setSize(rect.width, rect.height);
      this.labelRenderer.domElement.style.left = rect.left + 'px';
      this.labelRenderer.domElement.style.top = rect.top + 'px';
    } else {
      // Canvas not injected yet (component init runs before
      // render-target-loaded) — fall back to the window.
      this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
    }
  },

  remove: function () {
    // Clean up
    window.removeEventListener('resize', this.onResize);
    this.el.sceneEl.removeEventListener('rendererresize', this.onResize);
    if (this.labelRenderer && this.labelRenderer.domElement) {
      document.body.removeChild(this.labelRenderer.domElement);
    }
  }
});
