import { useCallback, useSyncExternalStore } from 'react';
import { EMPTY_ASSET_LOAD_SUMMARY } from '@/asset-load-tracker';

/**
 * The scene's AssetLoadTracker (asset-load-status system), or null before
 * the scene exists.
 */
export function getAssetLoadTracker() {
  const sceneEl =
    typeof AFRAME !== 'undefined' && AFRAME.scenes && AFRAME.scenes[0];
  return (
    (sceneEl &&
      sceneEl.systems &&
      sceneEl.systems['asset-load-status'] &&
      sceneEl.systems['asset-load-status'].tracker) ||
    null
  );
}

/**
 * Subscribe to the scene's tracker. When the scene (or its systems) does not
 * exist yet, wait for the scene element's `loaded` and attach then, so a
 * hook that rendered early still picks the tracker up; the snapshot getters
 * below re-resolve the tracker on every read for the same reason.
 */
function subscribeToTracker(listener) {
  let unsubscribe = null;
  const attach = () => {
    const tracker = getAssetLoadTracker();
    if (!tracker) return false;
    unsubscribe = tracker.subscribe(listener);
    return true;
  };
  if (attach()) return () => unsubscribe();
  const sceneEl =
    typeof document !== 'undefined' ? document.querySelector('a-scene') : null;
  const onLoaded = () => {
    if (attach()) listener();
  };
  if (sceneEl) sceneEl.addEventListener('loaded', onLoaded, { once: true });
  return () => {
    if (sceneEl) sceneEl.removeEventListener('loaded', onLoaded);
    if (unsubscribe) unsubscribe();
  };
}

/** Scene-wide asset load summary; re-renders on tracker changes. */
export function useAssetLoadSummary() {
  const getSnapshot = useCallback(() => {
    const tracker = getAssetLoadTracker();
    return tracker ? tracker.getSummary() : EMPTY_ASSET_LOAD_SUMMARY;
  }, []);
  return useSyncExternalStore(subscribeToTracker, getSnapshot, getSnapshot);
}

/**
 * Load state of one entity: a deterministic entry ({status, startedAt,
 * settledAt}), a stream record ({streaming: true, active}), or null when the
 * entity loads nothing the tracker knows about.
 */
export function useEntityLoadState(entity) {
  const getSnapshot = useCallback(() => {
    const tracker = getAssetLoadTracker();
    return tracker && entity ? tracker.get(entity) : null;
  }, [entity]);
  return useSyncExternalStore(subscribeToTracker, getSnapshot, getSnapshot);
}
