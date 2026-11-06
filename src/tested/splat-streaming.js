/**
 * Streaming policy for paged (.rad) Gaussian splats (#2047).
 *
 * Spark's SparkRenderer LOD is a fixed splat budget per platform (2.5M on
 * desktop), not a bandwidth or frame-rate governor: every LOD traversal picks
 * the budget's worth of splats for the current view and queues every ~3 MB
 * chunk that holds any of them, fetched by 3 parallel fetchers with no pacing.
 * At street level inside a big scan the default budget touches ~84% of a
 * 417 MB file, saturating the link and several cores for minutes. That is the
 * usability problem on a screen share or video call.
 *
 * This module holds the pure policy so it stays unit-testable
 * (test/core/splat-streaming.test.js). The `splat` system in
 * src/aframe-components/splat.js applies the result to the live SparkRenderer;
 * nothing here needs a reload.
 *
 * Measured on the #2047 scene (static camera, Spark 2.2.0, desktop budget):
 *   default budget            117 of 139 chunks, 352 MB
 *   lodSplatScale 0.5          85 chunks,         256 MB
 *   lodSplatScale 0.25         58 chunks,         176 MB
 * Capping the budget helps sub-linearly (the chunk is the unit of fetch), so
 * pausing while hidden matters as much as the budget. `lodRenderScale` is
 * deliberately NOT a lever: it has no bandwidth effect while the budget binds,
 * and values above ~1.5 make distant splats vanish.
 */

/**
 * A .rad whose total splat count (input splats + LOD nodes, `RadMeta.count`)
 * exceeds this is a "huge scan": the full desktop budget (2.5M) is where the
 * "downloads 84% of the file" behaviour comes from, so its LOD budget is
 * scaled by HUGE_SCAN_BUDGET_SCALE. 5M leaves typical single-object splats
 * (a few hundred thousand to ~2M splats) at full detail.
 */
export const HUGE_SCAN_SPLATS = 5_000_000;
export const HUGE_SCAN_BUDGET_SCALE = 0.5;

/**
 * LOD budget multiplier for the largest paged splat in the scene: 1 for
 * anything up to HUGE_SCAN_SPLATS, HUGE_SCAN_BUDGET_SCALE above it. A single
 * step (not a curve) keeps the behaviour predictable and matches the one
 * measured setting; refine once more scans have been measured.
 * @param {number} splatCount - total splats in the .rad (RadMeta.count)
 * @returns {number}
 */
export function budgetScaleForSplatCount(splatCount) {
  if (!Number.isFinite(splatCount) || splatCount <= HUGE_SCAN_SPLATS) return 1;
  return HUGE_SCAN_BUDGET_SCALE;
}

/**
 * Resolve the settings to apply to the SparkRenderer.
 * @param {object} [options]
 * @param {number} [options.largestRadSplats=0] - RadMeta.count of the largest
 *   paged splat currently in the scene (0 / undefined when none)
 * @returns {{ lodSplatScale: number }}
 */
export function resolveStreamingSettings({ largestRadSplats = 0 } = {}) {
  return {
    lodSplatScale: budgetScaleForSplatCount(largestRadSplats)
  };
}

/**
 * Whether chunk fetching should run for the given document visibility state.
 * Hidden (tab switched to the call app, window minimized) means: let in-flight
 * fetches finish, then let the queue wait; nothing renders anyway.
 * @param {string} visibilityState - document.visibilityState
 * @returns {boolean}
 */
export function shouldFetchForVisibility(visibilityState) {
  return visibilityState !== 'hidden';
}

/*
 * Motion profile (#2047). On the M2 Air test machine one draw of the default
 * budget at a retina canvas costs ~160 ms, so camera motion ran at ~9 fps no
 * matter what streaming did. While the camera moves the splat system trades
 * refinement for frame rate, and restores everything once the camera has been
 * still for MOTION_SETTLE_MS; with on-demand rendering the settled frame is
 * the full-quality one.
 *  - draw splat quads to MOTION_MAX_STD_DEV standard deviations (Spark's
 *    default is sqrt(8); sqrt(5) is ~37% fewer pixels per splat and Spark
 *    calls it perceptually very similar),
 *  - re-sort at most every MOTION_MIN_SORT_INTERVAL_MS (each sort reads the
 *    splat depths back from the GPU and sorts them in a worker).
 * Chunk fetching is deliberately left running while moving (holding it was
 * considered and deferred: new areas would stay coarse until the camera
 * stops). The pixel ratio is deliberately left alone: lowering it resizes the
 * canvas, which clears it and reallocates its buffers, so motion started and
 * stopped with a black blink and a freeze on 2x screens.
 */

/** The camera counts as moving until it has been still this long, in ms. */
export const MOTION_SETTLE_MS = 250;
/** Splat quad extent in standard deviations while moving. */
export const MOTION_MAX_STD_DEV = Math.sqrt(5);
/** Minimum time between splat sorts while moving, in ms. */
export const MOTION_MIN_SORT_INTERVAL_MS = 80;

/**
 * Whether the camera is still "moving" for the motion profile.
 * @param {number} now - performance.now()
 * @param {number} lastCameraMove - time the camera pose last changed
 *   (-Infinity if never)
 * @returns {boolean}
 */
export function isCameraMoving(now, lastCameraMove) {
  return now - lastCameraMove < MOTION_SETTLE_MS;
}

/**
 * The SparkRenderer settings for the motion profile.
 * @param {object} rest - the values in force when the camera is still
 * @param {number} rest.maxStdDev - SparkRenderer.maxStdDev at rest
 * @param {number} rest.minSortIntervalMs - SparkRenderer.minSortIntervalMs
 *   at rest
 * @returns {{ maxStdDev: number, minSortIntervalMs: number }}
 */
export function resolveMotionSettings({ maxStdDev, minSortIntervalMs }) {
  return {
    // Never raise either: a scene already tuned below the motion values keeps
    // its own.
    maxStdDev: Math.min(maxStdDev, MOTION_MAX_STD_DEV),
    minSortIntervalMs: Math.max(minSortIntervalMs, MOTION_MIN_SORT_INTERVAL_MS)
  };
}

/**
 * Whether the motion profile may apply at all. It needs a splat in the scene
 * (the profile exists for the splat draw cost) and stays out of Play, where
 * the camera moves continuously and the scene animates, and out of WebXR.
 * @param {object} state
 * @param {boolean} state.hasSplats
 * @param {boolean} state.playing - play-mode system isPlaying
 * @param {boolean} state.xrPresenting - renderer.xr.isPresenting
 * @returns {boolean}
 */
export function isMotionProfileEligible({ hasSplats, playing, xrPresenting }) {
  return !!hasSplats && !playing && !xrPresenting;
}
