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
 * This module holds the pure policy (which knobs, which values) so it stays
 * unit-testable (test/core/splat-streaming.test.js). The `splat` system in
 * src/aframe-components/splat.js applies the result to the live SparkRenderer
 * and its SplatPager; none of these need a reload.
 *
 * Measured on the #2047 scene (static camera, Spark 2.2.0, desktop budget):
 *   default budget            117 of 139 chunks, 352 MB
 *   lodSplatScale 0.5          85 chunks,         256 MB
 *   lodSplatScale 0.25         58 chunks,         176 MB
 * Capping the budget helps sub-linearly (the chunk is the unit of fetch), so
 * pacing the fetchers and pausing while hidden matter as much as the budget.
 * `lodRenderScale` is deliberately NOT a lever: it has no bandwidth effect
 * while the budget binds, and values above ~1.5 make distant splats vanish.
 */

/**
 * The two streaming profiles. `standard` is Spark's own defaults (so applying
 * it is a no-op on a fresh renderer); `dataSaver` is the "I'm on a call"
 * profile: half the LOD budget, one chunk in flight at a time, and a pause
 * between chunk fetches so the peak rate is bounded instead of link-saturating.
 */
export const STREAMING_PROFILES = Object.freeze({
  standard: Object.freeze({
    lodSplatScale: 1,
    numFetchers: 3,
    fetchPauseMs: 0
  }),
  dataSaver: Object.freeze({
    lodSplatScale: 0.5,
    numFetchers: 1,
    fetchPauseMs: 250
  })
});

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
 * Resolve the settings to apply to the SparkRenderer / SplatPager.
 * @param {object} [options]
 * @param {boolean} [options.dataSaver=false] - Low Power / data-saver toggle
 * @param {number} [options.largestRadSplats=0] - RadMeta.count of the largest
 *   paged splat currently in the scene (0 / undefined when none)
 * @returns {{ lodSplatScale: number, numFetchers: number, fetchPauseMs: number }}
 */
export function resolveStreamingSettings({
  dataSaver = false,
  largestRadSplats = 0
} = {}) {
  const profile = dataSaver
    ? STREAMING_PROFILES.dataSaver
    : STREAMING_PROFILES.standard;
  return {
    lodSplatScale:
      profile.lodSplatScale * budgetScaleForSplatCount(largestRadSplats),
    numFetchers: profile.numFetchers,
    fetchPauseMs: profile.fetchPauseMs
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
