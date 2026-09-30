/**
 * On-demand rendering policy for the editor viewport (#2047).
 *
 * A-Frame redraws the whole scene every animation frame. With a streamed
 * Gaussian splat in the scene that is millions of splats re-sorted and
 * re-drawn 60 times a second even when nothing on screen changes, which pegs
 * the GPU (and the CPU feeding it) during a screen share. Spark's own
 * recommendation is on-demand rendering: draw only when the view changed, or
 * when SparkRenderer's `onDirty` says a sort, LoD update or streamed chunk is
 * ready to show. Its sort / LoD / upload work runs from `onBeforeRender`, so
 * skipping the draw idles Spark as well.
 *
 * Only the draw is skipped: A-Frame's loop (and every component tick: tile
 * streamers, navigation tweens) keeps running. Change detection in a scene
 * this size cannot be exhaustive, so the policy is deliberately forgiving:
 *  - any invalidation draws continuously for SETTLE_MS, which covers control
 *    damping, async texture uploads and follow-up work an event implies;
 *  - an idle viewport still redraws every HEARTBEAT_MS, so anything that
 *    changed without a signal shows up within half a second rather than
 *    never.
 *
 * The A-Frame side lives in src/aframe-components/render-on-demand.js; this
 * module is the pure decision so it stays unit-testable
 * (test/core/render-on-demand.test.js).
 */

/** Continuous drawing after the last invalidation, in ms. */
export const SETTLE_MS = 500;

/** Longest an idle, eligible viewport goes without a draw, in ms. */
export const HEARTBEAT_MS = 500;

/**
 * Whether frames may be skipped at all. Only the editor qualifies: it pauses
 * the scene (no animation mixers, traffic or other tick-driven motion outside
 * [data-no-pause] helpers), whereas viewer mode and Play run the live scene
 * and WebXR must present every frame.
 * @param {object} state
 * @param {boolean} state.enabled - master switch (debug toggle)
 * @param {boolean} state.inspectorOpened - AFRAME.INSPECTOR.opened
 * @param {boolean} state.playing - play-mode system isPlaying
 * @param {boolean} state.xrPresenting - renderer.xr.isPresenting
 * @returns {boolean}
 */
export function isSkipEligible({
  enabled,
  inspectorOpened,
  playing,
  xrPresenting
}) {
  return !!enabled && !!inspectorOpened && !playing && !xrPresenting;
}

/**
 * Why this animation frame must draw, or null when it can be skipped.
 * @param {object} state
 * @param {number} state.now - performance.now()
 * @param {boolean} state.eligible - result of isSkipEligible
 * @param {number} state.lastInvalidation - time of the last invalidation
 *   (-Infinity if none)
 * @param {number} state.lastDraw - time of the last loop draw (-Infinity if
 *   none)
 * @param {boolean} [state.frameRequested=false] - a one-frame request is
 *   pending (SparkRenderer onDirty: one draw lets Spark take its next step)
 * @returns {'ineligible'|'requested'|'settling'|'heartbeat'|null}
 */
export function drawReason({
  now,
  eligible,
  lastInvalidation,
  lastDraw,
  frameRequested = false
}) {
  if (!eligible) return 'ineligible';
  if (frameRequested) return 'requested';
  if (now - lastInvalidation < SETTLE_MS) return 'settling';
  if (now - lastDraw >= HEARTBEAT_MS) return 'heartbeat';
  return null;
}

/**
 * Whether this animation frame must draw (see drawReason).
 * @param {object} state - as drawReason
 * @returns {boolean}
 */
export function shouldDrawFrame(state) {
  return drawReason(state) !== null;
}

/**
 * Whether two 16-element matrices (Matrix4.elements) differ. Exact compare on
 * purpose: a camera that is truly still produces bit-identical matrices, and
 * any real movement must draw.
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @returns {boolean}
 */
export function matrixChanged(a, b) {
  if (!a || !b || a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return true;
  }
  return false;
}
