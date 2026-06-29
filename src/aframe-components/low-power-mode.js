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
 * Three levers, all applied at runtime (no scene reload):
 *  1. Render pixel ratio capped at 1. On a Retina display the default is 2,
 *     which is 4x the fragments. Capping to 1 roughly quarters the per-frame
 *     fragment workload and benefits EVERYTHING (tiles, splats, geometry).
 *  2. Google 3D Tiles errorTarget raised (16 -> 40) so the TilesRenderer
 *     picks coarser, cheaper LODs. Read every update() tick, so it takes
 *     effect on the next frame.
 *  3. SparkRenderer splat cost (see SPLAT_LEVERS): lodSplatScale halves the LOD
 *     splat-count target (the fix for Spark filling toward 2.5M splats on
 *     desktop as pages load), and maxStdDev shrinks each quad to cut fill-rate.
 *
 * One further SparkRenderer knob, lodRenderScale, is powerful but dangerous:
 * it raises the sub-pixel cull threshold and at 2.0 made whole splats vanish at
 * distance. It is exposed console-only via splat() so a safe value (try
 * 1.1..1.5) can be dialed in by eye before considering promoting it:
 *   STREET.lowPower.status()         // dump current + captured-default values
 *   STREET.lowPower.pixelRatio(1)    // 1 = capped, or pass window.devicePixelRatio
 *   STREET.lowPower.errorTarget(40)  // higher = coarser/cheaper tiles
 *   STREET.lowPower.splat('lodSplatScale', 0.3)  // set any SparkRenderer prop live
 *   STREET.lowPower.reset()          // restore everything to captured defaults
 */

// Low-power lever targets.
const LOW_POWER_ERROR_TARGET = 40;
const DEFAULT_ERROR_TARGET = 16; // TilesRenderer default

// SparkRenderer props the master toggle applies. `low` is the low-power value;
// a function form computes it from the captured full-quality default.
//
// The big one is lodSplatScale: Spark targets a fixed splat budget per platform
// (2.5M on desktop) and fills toward it as pages load, NOT reacting to FPS — so
// lowering this multiplier is the only way to stop it loading "all the highest
// LOD" on a fanless GPU. maxStdDev trims fill-rate on top. Both are safe (they
// render fewer / smaller, never cull a whole splat). The dangerous knob,
// lodRenderScale, is intentionally NOT here (see header note) — it raises the
// sub-pixel cull threshold and at 2.0 made entire splats vanish at distance.
const SPLAT_LEVERS = {
  // Half the per-frame LOD splat-count target (desktop 2.5M -> 1.25M). Read
  // live each frame in driveLod; the single biggest splat lever.
  lodSplatScale: { low: 0.5 },
  // sqrt(4); default sqrt(8). Shrinks each splat quad -> ~halves fragment area.
  maxStdDev: { low: 2.0 },
  // paged-splat allocation ceiling; half the captured default (only bites at
  // pager-creation time, so mainly helps when low-power is on before load).
  maxPagedSplats: { low: (def) => Math.floor(def * 0.5) }
};

// Props surfaced in status() even when the toggle doesn't drive them, so you
// can watch what console experiments are doing.
const SPLAT_STATUS_PROPS = [
  'maxStdDev',
  'lodRenderScale',
  'lodSplatScale',
  'maxPagedSplats'
];

// --- Live accessors for the two sub-renderers (may not exist yet) ---

// The Google 3D Tiles TilesRenderer lives on the auto-created #google3d child
// of [street-geo], as `.tiles` on its google-maps-aerial component.
function getTilesRenderer(sceneEl) {
  const aerialEl = sceneEl.querySelector('#google3d');
  return aerialEl?.components?.['google-maps-aerial']?.tiles || null;
}

// The shared SparkRenderer is lazily created by the splat system on first load.
function getSparkRenderer(sceneEl) {
  return sceneEl.systems?.splat?.sparkRenderer || null;
}

AFRAME.registerComponent('low-power-mode', {
  init: function () {
    this.applyState = this.applyState.bind(this);
    this.enabled = useStore.getState().lowPowerMode;

    // Captured "full quality" SparkRenderer defaults, keyed by prop and filled
    // the first time we touch each (before we modify it) so reset/restore is
    // exact. The tiles and pixel-ratio defaults are known constants.
    this._splatDefaults = {};

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

    this.exposeDebugHandle();
  },

  applyState: function () {
    this.applyPixelRatio(this.enabled ? 1 : window.devicePixelRatio);
    this.applyErrorTarget(
      this.enabled ? LOW_POWER_ERROR_TARGET : DEFAULT_ERROR_TARGET
    );
    this.applySplatLevers(this.enabled);
  },

  // --- Lever 1: render pixel ratio (global) ---
  applyPixelRatio: function (ratio) {
    const renderer = this.el.renderer;
    if (!renderer) return;
    renderer.setPixelRatio(ratio);
    // Force the drawing buffer to re-size at the new ratio. A-Frame's own
    // resize path (size()) preserves whatever pixelRatio is currently set, so
    // this sticks across window resizes. updateStyle=false keeps CSS layout.
    const canvas = renderer.domElement;
    renderer.setSize(
      canvas.clientWidth || canvas.width,
      canvas.clientHeight || canvas.height,
      false
    );
  },

  // --- Lever 2: Google 3D Tiles errorTarget ---
  applyErrorTarget: function (target) {
    const tiles = getTilesRenderer(this.el);
    if (tiles) tiles.errorTarget = target;
  },

  // --- Lever 3: SparkRenderer cost knobs (see SPLAT_LEVERS) ---
  // Capture a prop's full-quality default once, before we ever modify it.
  captureSplatDefault: function (sr, prop) {
    if (!(prop in this._splatDefaults)) {
      this._splatDefaults[prop] = sr[prop];
    }
    return this._splatDefaults[prop];
  },

  applySplatLevers: function (enabled) {
    const sr = getSparkRenderer(this.el);
    if (!sr) return;
    for (const [prop, lever] of Object.entries(SPLAT_LEVERS)) {
      const def = this.captureSplatDefault(sr, prop);
      sr[prop] = enabled
        ? typeof lever.low === 'function'
          ? lever.low(def)
          : lever.low
        : def;
    }
    sr.setDirty?.();
  },

  // Set a single SparkRenderer prop live (captures its default first so reset
  // restores it). For console attribution testing.
  setSplatProp: function (prop, value) {
    const sr = getSparkRenderer(this.el);
    if (!sr) return null;
    this.captureSplatDefault(sr, prop);
    sr[prop] = value;
    sr.setDirty?.();
    return sr[prop];
  },

  // Console handle for per-lever attribution testing.
  exposeDebugHandle: function () {
    const sceneEl = this.el;
    window.STREET = window.STREET || {};
    window.STREET.lowPower = {
      pixelRatio: (n) => {
        this.applyPixelRatio(n);
        return n;
      },
      errorTarget: (n) => {
        this.applyErrorTarget(n);
        return n;
      },
      // Set any SparkRenderer prop live, e.g. splat('maxStdDev', 2).
      splat: (prop, value) => this.setSplatProp(prop, value),
      reset: () => {
        this.applyPixelRatio(window.devicePixelRatio);
        this.applyErrorTarget(DEFAULT_ERROR_TARGET);
        // Restore every captured splat default.
        const sr = getSparkRenderer(sceneEl);
        if (sr) {
          for (const [prop, def] of Object.entries(this._splatDefaults)) {
            sr[prop] = def;
          }
          sr.setDirty?.();
        }
        return this.status();
      },
      status: () => {
        const tiles = getTilesRenderer(sceneEl);
        const sr = getSparkRenderer(sceneEl);
        const snapshot = {
          enabled: this.enabled,
          pixelRatio: sceneEl.renderer?.getPixelRatio?.() ?? null,
          devicePixelRatio: window.devicePixelRatio,
          errorTarget: tiles ? tiles.errorTarget : '(no tiles loaded)'
        };
        if (sr) {
          for (const prop of SPLAT_STATUS_PROPS) {
            snapshot[prop] = sr[prop];
            snapshot[`${prop} (default)`] =
              prop in this._splatDefaults
                ? this._splatDefaults[prop]
                : '(untouched)';
          }
        } else {
          snapshot.splat = '(no splat loaded)';
        }
        console.table(snapshot);
        return snapshot;
      }
    };
  },

  remove: function () {
    if (this.unsubscribe) this.unsubscribe();
    this.el.removeEventListener('renderstart', this.applyState);
    if (window.STREET) delete window.STREET.lowPower;
  }
});
