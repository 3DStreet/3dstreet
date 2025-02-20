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

    // Add event listener for window resize
    window.addEventListener('resize', this.onResize);

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
    this.labelRenderer.setSize(window.innerWidth, window.innerHeight);
  },

  remove: function () {
    // Clean up
    window.removeEventListener('resize', this.onResize);
    if (this.labelRenderer && this.labelRenderer.domElement) {
      document.body.removeChild(this.labelRenderer.domElement);
    }
  }
});
