/**
 * clone-visibility
 * ================
 *
 * Shared, refcounted hide/restore for the static auto-generated clones
 * (street-generated-* children) that play-mode features replace with
 * moving actors. Both `street-traffic` (synthetic flow) and
 * `street-traffic-replay` (sensor-data replay) hide the same clones on
 * play-start; with independent bookkeeping the second hider records
 * "was already invisible" and re-hides on restore, leaving static
 * vehicles/pedestrians permanently gone after Stop. A single registry
 * keyed on the element makes hide/restore order-independent: the first
 * hide records the true pre-play visibility, later hides just bump the
 * refcount, and the element is restored when the last holder releases.
 *
 * Hiding goes through setAttribute('visible', ...) — NOT a raw
 * object3D.visible write — because batched clones only re-sync their
 * BatchedMesh slot visibility off the `visible` componentchanged
 * event. A raw object3D mutation fires nothing, leaving the batched
 * geometry on screen as a frozen, non-colliding duplicate.
 */

// el -> { count, wasVisible }
const hiddenState = new Map();

/**
 * Authored props that occupy a lane without being traffic — a parked
 * food trailer, a parklet, outdoor-dining tables, or construction
 * cones / jersey barriers / barricades on a closed lane (Streetmix
 * maps `food-truck`, `parklet`, `outdoor-dining`, and `temporary`
 * segments to drive-lane typed segments). They are scenery, not the
 * moving cast: never hidden, never animated.
 */
const STATIC_CAST_MIXINS = new Set([
  'food-trailer-rig',
  'parklet',
  'outdoor_dining'
]);

export function isStaticCastMixin(mixin) {
  return STATIC_CAST_MIXINS.has(mixin) || mixin.startsWith('temporary-');
}

/**
 * Which of a segment's generated children carry the "moving cast" that
 * play-mode features hide (returns a `(dataParentComponent, el)`
 * predicate), or null when the lane type has no moving cast (medians,
 * parking, grass — their props must stay visible).
 *
 * Note this deliberately matches only clone/pedestrian components:
 * street-generated-stencil children (bike symbols, sharrows, turn
 * arrows, BUS/TAXI words) are painted road markings, and
 * street-generated-rail children are the rails themselves — not
 * actors, and must stay visible during play.
 */
export function movingCastFilter(segType) {
  if (segType === 'sidewalk') {
    // Hide only the static pedestrian clones — keep sidewalk trees,
    // poles, benches (those come from street-generated-clones).
    return (compName) => compName.startsWith('street-generated-pedestrians');
  }
  if (
    segType === 'drive-lane' ||
    segType === 'bus-lane' ||
    segType === 'bike-lane' ||
    segType === 'rail'
  ) {
    return (compName, el) =>
      (compName.startsWith('street-generated-clones') ||
        compName.startsWith('street-generated-pedestrians')) &&
      !isStaticCastMixin(el?.getAttribute('mixin') || '');
  }
  return null;
}

/**
 * Hide every generated child of `segEl` whose data-parent-component
 * passes `filter`. Returns the elements hidden ON BEHALF OF THIS
 * CALLER — pass that array to releaseClones() on teardown.
 *
 * `onHeld(el, compName)` (optional) is called for each held element
 * before it is hidden, so callers can snapshot the clone (pose, mixin)
 * in the same DOM walk instead of re-querying.
 */
export function hideSegmentClones(segEl, filter, onHeld) {
  const held = [];
  segEl.querySelectorAll('[data-parent-component]').forEach((el) => {
    const compName = el.getAttribute('data-parent-component') || '';
    if (!filter(compName, el)) return;
    if (onHeld) onHeld(el, compName);
    const state = hiddenState.get(el);
    if (state) {
      state.count++;
    } else {
      hiddenState.set(el, {
        count: 1,
        wasVisible: el.object3D?.visible ?? true
      });
      el.setAttribute('visible', false);
    }
    held.push(el);
  });
  return held;
}

/**
 * Release this caller's hold on each element; restore the pre-play
 * visibility once the last holder lets go. Clears the array.
 */
export function releaseClones(held) {
  for (const el of held) {
    const state = hiddenState.get(el);
    if (!state) continue;
    if (--state.count > 0) continue;
    hiddenState.delete(el);
    if (el.parentNode) el.setAttribute('visible', state.wasVisible);
  }
  held.length = 0;
}
