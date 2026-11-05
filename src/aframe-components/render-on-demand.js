/* global AFRAME */

/**
 * render-on-demand system (#2047): skip the editor viewport's draw while
 * nothing on screen is changing.
 *
 * Inert until activate() is called; the `splat` system activates it when the
 * first splat creates the SparkRenderer, because a streamed splat is what
 * makes an idle redraw expensive. Frames are only skipped while at least one
 * holder retains it (each `splat` component, retain() / release()), so a
 * scene whose splats were all deleted draws every frame again. Policy (when a frame must draw, which modes
 * qualify) lives in src/tested/render-on-demand.js.
 *
 * Mechanism: the A-Frame animation loop is re-registered through a thin
 * wrapper that marks "inside the loop", and renderer.render returns early for
 * the loop's scene draw when the policy says the frame can be skipped. A-Frame
 * still runs tick/tock every frame, so tile streamers, navigation tweens and
 * every other tick keep working; only the GPU draw (and Spark's sort / LoD
 * work, which runs from onBeforeRender) goes idle. Direct renderer.render
 * calls outside the loop (screenshots, thumbnails) always draw.
 *
 * A frame draws when:
 *  - the active camera, its pose or projection, or the canvas size changed;
 *  - the user touched the page (pointer, wheel, keys) or the scene changed
 *    (component / child / object3D / model / texture events), then
 *    continuously for SETTLE_MS;
 *  - SparkRenderer asked for one via onDirty (requestFrame);
 *  - HEARTBEAT_MS passed since the last draw (the safety net for a change
 *    that raised no signal).
 * Outside the editor (viewer, Play, WebXR) every frame draws.
 *
 * Diagnose with STREET.splatDebug.snapshot().renderOnDemand; A/B with
 * STREET.splatDebug.setRenderOnDemand(false).
 */

import {
  drawReason,
  isSkipEligible,
  matrixChanged
} from '../tested/render-on-demand.js';

// Captured on the scene element: capture listeners see non-bubbling events
// (componentchanged, object3dset, ...) from every descendant entity.
const SCENE_EVENTS = [
  'componentchanged',
  'componentinitialized',
  'componentremoved',
  'child-attached',
  'child-detached',
  'object3dset',
  'object3dremove',
  'model-loaded',
  'materialtextureloaded',
  'texture-loaded',
  'camera-set-active',
  'mode-changed',
  'play-mode-start',
  'play-mode-stop'
];

const INPUT_EVENTS = [
  'pointerdown',
  'pointermove',
  'pointerup',
  'wheel',
  'keydown',
  'keyup'
];

AFRAME.registerSystem('render-on-demand', {
  init: function () {
    this.enabled = true;
    this.holders = 0;
    this.active = false;
    this.installed = false;
    this.inLoop = false;
    this.frameRequested = false;
    this.lastInvalidation = -Infinity;
    this.lastDraw = -Infinity;
    this.lastEligible = null;
    this.lastCamera = null;
    this.lastMatrixWorld = null;
    this.lastProjection = null;
    this.lastWidth = 0;
    this.lastHeight = 0;
    // Loop draws by reason (see drawReason) and skipped frames.
    this.stats = {
      skipped: 0,
      ineligible: 0,
      requested: 0,
      settling: 0,
      heartbeat: 0
    };

    this.invalidate = this.invalidate.bind(this);
    this.requestFrame = this.requestFrame.bind(this);
    this.onVisibilityChange = () => {
      if (document.visibilityState === 'visible') this.invalidate();
    };
  },

  /** Start skipping idle draws (idempotent). */
  activate: function () {
    if (this.active) return;
    this.active = true;
    if (this.sceneEl.renderStarted) {
      this.install();
    } else {
      this.sceneEl.addEventListener('renderstart', () => this.install(), {
        once: true
      });
    }
  },

  install: function () {
    const sceneEl = this.sceneEl;
    const renderer = sceneEl.renderer;
    if (this.installed || !renderer) return;
    this.installed = true;
    const system = this;

    // Same callback A-Frame registered (scene.render), wrapped so the render
    // override below can tell the loop's draw from a screenshot's.
    renderer.setAnimationLoop(function (time, frame) {
      system.inLoop = true;
      try {
        sceneEl.render(time, frame);
      } finally {
        system.inLoop = false;
      }
    });

    const originalRender = renderer.render;
    renderer.render = function (scene, camera) {
      if (system.inLoop && scene === sceneEl.object3D) {
        const reason = system.frameDrawReason(camera);
        if (!reason) {
          system.stats.skipped++;
          return;
        }
        system.frameRequested = false;
        system.lastDraw = performance.now();
        system.stats[reason]++;
      }
      return originalRender.apply(this, arguments);
    };

    for (const name of SCENE_EVENTS) {
      sceneEl.addEventListener(name, this.invalidate, true);
    }
    for (const name of INPUT_EVENTS) {
      window.addEventListener(name, this.invalidate, {
        capture: true,
        passive: true
      });
    }
    window.addEventListener('resize', this.invalidate);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.invalidate();
  },

  /** Something changed: draw continuously for the settle window. */
  invalidate: function () {
    this.lastInvalidation = performance.now();
  },

  /** Draw one more frame (SparkRenderer onDirty; may fire often). */
  requestFrame: function () {
    this.frameRequested = true;
  },

  /** A splat entered the scene: idle draws may be skipped. */
  retain: function () {
    this.holders++;
    this.invalidate();
  },

  /** A splat left the scene. */
  release: function () {
    this.holders = Math.max(0, this.holders - 1);
    this.invalidate();
  },

  setEnabled: function (enabled) {
    this.enabled = !!enabled;
    this.invalidate();
  },

  /**
   * Called from the loop's draw, after this frame's ticks moved things.
   * Returns why the frame must draw, or null to skip it.
   */
  frameDrawReason: function (camera) {
    const renderer = this.sceneEl.renderer;
    const inspector = AFRAME.INSPECTOR;
    const playMode = this.sceneEl.systems['play-mode'];
    const eligible = isSkipEligible({
      enabled: this.enabled && this.holders > 0,
      inspectorOpened: !!(inspector && inspector.opened),
      playing: !!(playMode && playMode.isPlaying),
      xrPresenting: !!(renderer.xr && renderer.xr.isPresenting)
    });
    if (eligible !== this.lastEligible) {
      this.lastEligible = eligible;
      this.invalidate();
    }
    if (!eligible) return 'ineligible';

    if (camera) {
      if (camera !== this.lastCamera) {
        this.lastCamera = camera;
        this.lastMatrixWorld = null;
        this.lastProjection = null;
      }
      camera.updateWorldMatrix(true, false);
      const world = camera.matrixWorld.elements;
      const projection = camera.projectionMatrix.elements;
      if (
        matrixChanged(world, this.lastMatrixWorld) ||
        matrixChanged(projection, this.lastProjection)
      ) {
        this.lastMatrixWorld = world.slice();
        this.lastProjection = projection.slice();
        this.invalidate();
      }
    }

    const canvas = renderer.domElement;
    if (
      canvas &&
      (canvas.width !== this.lastWidth || canvas.height !== this.lastHeight)
    ) {
      this.lastWidth = canvas.width;
      this.lastHeight = canvas.height;
      this.invalidate();
    }

    return drawReason({
      now: performance.now(),
      eligible,
      lastInvalidation: this.lastInvalidation,
      lastDraw: this.lastDraw,
      frameRequested: this.frameRequested
    });
  },

  /** For STREET.splatDebug.snapshot(). */
  getState: function () {
    return {
      active: this.active,
      installed: this.installed,
      enabled: this.enabled,
      holders: this.holders,
      eligible: this.lastEligible,
      frames: { ...this.stats },
      msSinceInvalidation: Math.round(
        performance.now() - this.lastInvalidation
      ),
      msSinceDraw: Math.round(performance.now() - this.lastDraw)
    };
  }
});
