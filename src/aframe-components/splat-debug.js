/* global AFRAME */

/**
 * Splat LOD-thrash diagnostic — console-activated, in-session only.
 *
 * Background: RAD-format splats render through a single SparkRenderer created
 * with `enableLod: true` (see splat.js). That renderer derives a per-frame LOD
 * target (maxSplats / pixelScaleLimit) from the camera + render size and calls
 * the Spark WASM `traverse_lod_trees` to pick which splats/pages to show, then
 * streams pages in/out. "LOD thrash" is when that target oscillates between two
 * or three levels even with a stationary camera — the splat visibly pulses and
 * page range-requests never stop.
 *
 * This module does NOT touch the render path. It only READS live SparkRenderer
 * state on an interval and reports when LOD level keeps changing while the
 * camera is still. It is inert until you call STREET.splatDebug.start().
 *
 * Usage (browser console):
 *   STREET.splatDebug.start()     // watch + auto-warn on thrash
 *   STREET.splatDebug.start({ intervalMs: 200, verbose: true })
 *   STREET.splatDebug.snapshot()  // one-shot dump of current LOD state
 *   STREET.splatDebug.stop()
 */

// Number of distinct numSplats values seen for one mesh (within the rolling
// window) that, with a static camera, we treat as thrash.
const THRASH_LEVELS = 2;
// Rolling window of samples kept per mesh.
const WINDOW = 12;
// Min ms between repeated thrash warnings (so the console isn't flooded).
const WARN_THROTTLE_MS = 4000;

function getScene() {
  return (
    document.querySelector('a-scene') ||
    (AFRAME.scenes && AFRAME.scenes[0]) ||
    null
  );
}

function getSparkRenderer() {
  const scene = getScene();
  const sr =
    scene && scene.systems && scene.systems.splat
      ? scene.systems.splat.sparkRenderer
      : null;
  return sr || null;
}

// Pull the per-mesh chosen splat counts out of the SparkRenderer's lodInstances
// map. That integer IS the current LOD level (low/med/high == small/large
// numSplats), so watching it change is the most direct thrash signal.
function readLodInstances(sr) {
  const out = [];
  if (
    !sr ||
    !sr.lodInstances ||
    typeof sr.lodInstances.forEach !== 'function'
  ) {
    return out;
  }
  sr.lodInstances.forEach((value, mesh) => {
    out.push({
      key: mesh && mesh.uuid ? mesh.uuid.slice(0, 8) : 'unknown',
      numSplats: value ? value.numSplats : undefined,
      indices: value && value.indices ? value.indices.length : undefined
    });
  });
  return out;
}

function summarizeLod(lod) {
  if (!lod) return null;
  return {
    maxSplats: lod.maxSplats,
    pixelScaleLimit:
      typeof lod.pixelScaleLimit === 'number'
        ? Number(lod.pixelScaleLimit.toFixed(3))
        : lod.pixelScaleLimit,
    timestamp: lod.timestamp
  };
}

const splatDebug = {
  _timer: null,
  _history: null, // key -> array of recent numSplats
  _lastCamMatrix: null,
  _lastWarnAt: 0,
  _staticFrames: 0,

  /**
   * Start watching. Options:
   *   intervalMs (default 250) — sampling cadence
   *   verbose    (default false) — log every sample, not just thrash warnings
   */
  start(options) {
    const opts = options || {};
    const intervalMs = opts.intervalMs || 250;
    this._verbose = !!opts.verbose;

    if (this._timer) {
      console.log('[splat-debug] already running; call stop() first to reset.');
      return;
    }
    const sr = getSparkRenderer();
    if (!sr) {
      console.warn(
        '[splat-debug] No SparkRenderer yet. Load a splat into the scene first, then start().'
      );
      return;
    }

    this._history = {};
    this._lastCamMatrix = null;
    this._staticFrames = 0;
    this._lastWarnAt = 0;

    console.log(
      `[splat-debug] watching (every ${intervalMs}ms). Move/hold the camera; ` +
        'a warning prints if LOD oscillates while the camera is static. ' +
        'STREET.splatDebug.stop() to end.'
    );

    this._timer = setInterval(() => this._tick(), intervalMs);
  },

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
      console.log('[splat-debug] stopped.');
    } else {
      console.log('[splat-debug] not running.');
    }
  },

  /**
   * One-shot dump of the current LOD state — no watching, no history.
   */
  snapshot() {
    const sr = getSparkRenderer();
    if (!sr) {
      console.warn('[splat-debug] No SparkRenderer (no splat loaded yet).');
      return null;
    }
    const snap = {
      instances: readLodInstances(sr),
      currentLod: summarizeLod(sr.currentLod),
      lastLod: summarizeLod(sr.lastLod),
      lodDirty: sr.lodDirty,
      lodUpdatesPending: sr.lodUpdates ? sr.lodUpdates.length : undefined,
      lastPixelLimit: sr.lastPixelLimit,
      lastTraverseTime: sr.lastTraverseTime,
      sorting: sr.sorting,
      sortDirty: sr.sortDirty,
      lodSplatScale: sr.lodSplatScale,
      maxPagedSplats: sr.maxPagedSplats
    };
    console.log('[splat-debug] snapshot', snap);
    return snap;
  },

  _cameraMoved() {
    const scene = getScene();
    const cam = scene && scene.camera;
    if (!cam) return true; // can't tell -> assume moved (suppresses warnings)
    cam.updateMatrixWorld();
    const current = cam.matrixWorld;
    if (!this._lastCamMatrix) {
      this._lastCamMatrix = current.clone();
      return true;
    }
    const moved = !current.equals(this._lastCamMatrix);
    this._lastCamMatrix = current.clone();
    return moved;
  },

  _tick() {
    const sr = getSparkRenderer();
    if (!sr) return;

    const moved = this._cameraMoved();
    if (moved) {
      this._staticFrames = 0;
    } else {
      this._staticFrames++;
    }

    const instances = readLodInstances(sr);
    const thrashing = [];

    for (const inst of instances) {
      const hist = (this._history[inst.key] = this._history[inst.key] || []);
      hist.push(inst.numSplats);
      if (hist.length > WINDOW) hist.shift();
      // Only judge thrash on a static camera with a filled-ish window.
      const distinct = new Set(hist.filter((n) => n != null));
      if (!moved && hist.length >= 4 && distinct.size >= THRASH_LEVELS) {
        thrashing.push({
          mesh: inst.key,
          levels: Array.from(distinct).sort((a, b) => a - b),
          current: inst.numSplats
        });
      }
    }

    if (this._verbose) {
      console.log(
        `[splat-debug] camMoved=${moved} staticFrames=${this._staticFrames} ` +
          `lodDirty=${sr.lodDirty} updates=${sr.lodUpdates ? sr.lodUpdates.length : '?'} ` +
          `curLod=${sr.currentLod ? sr.currentLod.maxSplats : '?'}/` +
          `${sr.currentLod && typeof sr.currentLod.pixelScaleLimit === 'number' ? sr.currentLod.pixelScaleLimit.toFixed(2) : '?'}`,
        instances.map((i) => `${i.key}:${i.numSplats}`).join('  ')
      );
    }

    if (thrashing.length) {
      const now = typeof performance !== 'undefined' ? performance.now() : 0;
      if (now - this._lastWarnAt >= WARN_THROTTLE_MS) {
        this._lastWarnAt = now;
        console.warn(
          '[splat-debug] LOD THRASH detected (camera static, LOD level oscillating):',
          {
            meshes: thrashing,
            staticFrames: this._staticFrames,
            lodDirty: sr.lodDirty,
            lodUpdatesPending: sr.lodUpdates ? sr.lodUpdates.length : undefined,
            currentLod: summarizeLod(sr.currentLod),
            lastLod: summarizeLod(sr.lastLod),
            lodSplatScale: sr.lodSplatScale,
            maxPagedSplats: sr.maxPagedSplats,
            hint:
              'Try toggling SparkRenderer options to localize: enableLodFetching=false ' +
              '(page cache-thrash), enableDriveLod=false (traversal loop), or bump ' +
              'maxPagedSplats / lodSplatScale (budget boundary).'
          }
        );
      }
    }
  }
};

// Expose on the global STREET namespace (defined in json-utils_1.1.js).
// Guarded so import order can't throw if STREET isn't set up yet.
if (typeof window !== 'undefined') {
  window.STREET = window.STREET || {};
  window.STREET.splatDebug = splatDebug;
}

export default splatDebug;
