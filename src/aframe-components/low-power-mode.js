import useStore from '../store.js';

/**
 * low-power-mode
 *
 * A scene-level component that trades visual fidelity for frame rate. Intended
 * for live demos, screen recording, and video calls on thermally-limited /
 * fanless machines where a heavy scene (Google 3D Tiles + Gaussian splats +
 * managed-street geometry) overwhelms the GPU when it also has to encode video
 * and drive an external display.
 *
 * State lives in the Zustand store (`lowPowerMode`, persisted to localStorage)
 * and is toggled from the View menu. This component is the single consumer.
 *
 * Current lever (the big one):
 *  - Render pixel ratio is capped at 1. On a Retina display the default is 2,
 *    which is 4x the fragments. Capping to 1 roughly quarters the per-frame
 *    fragment workload and benefits EVERYTHING (tiles, splats, geometry) in one
 *    shot. This alone is usually the difference between stutter and smooth.
 *
 * Extension hooks (see applyState) for the next layer of tuning:
 *  - Google 3D Tiles: raise TilesRenderer.errorTarget (16 -> ~40) for coarser,
 *    cheaper tiles.
 *  - Gaussian splats: lower the SparkRenderer paged-splat budget.
 */
AFRAME.registerComponent('low-power-mode', {
  init: function () {
    this.applyState = this.applyState.bind(this);
    this.enabled = useStore.getState().lowPowerMode;

    // Renderer may not exist yet at scene-component init time.
    if (this.el.renderer) {
      this.applyState();
    } else {
      this.el.addEventListener('renderstart', this.applyState, { once: true });
    }

    this.unsubscribe = useStore.subscribe((state) => {
      if (state.lowPowerMode !== this.enabled) {
        this.enabled = state.lowPowerMode;
        this.applyState();
      }
    });
  },

  applyState: function () {
    const renderer = this.el.renderer;
    if (!renderer) return;

    // --- Pixel ratio (global) ---
    const targetRatio = this.enabled ? 1 : window.devicePixelRatio;
    renderer.setPixelRatio(targetRatio);
    // Force the drawing buffer to re-size at the new ratio. A-Frame's own
    // resize path (size()) preserves whatever pixelRatio is currently set, so
    // this sticks across window resizes. updateStyle=false keeps CSS layout.
    const canvas = renderer.domElement;
    renderer.setSize(
      canvas.clientWidth || canvas.width,
      canvas.clientHeight || canvas.height,
      false
    );

    // --- Extension hook: Google 3D Tiles error target ---
    // const tiles = this.el.querySelector('[street-geo]')?.components?.['street-geo'];
    // if (tiles?.googleTiles) tiles.googleTiles.errorTarget = this.enabled ? 40 : 16;

    // --- Extension hook: splat paged budget ---
    // (apply to the shared SparkRenderer once exposed)
  },

  remove: function () {
    if (this.unsubscribe) this.unsubscribe();
    this.el.removeEventListener('renderstart', this.applyState);
  }
});
