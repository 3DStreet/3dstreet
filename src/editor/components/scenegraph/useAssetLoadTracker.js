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

const noopSubscribe = () => () => {};

/** Scene-wide asset load summary; re-renders on tracker changes. */
export function useAssetLoadSummary() {
  const tracker = getAssetLoadTracker();
  const subscribe = useCallback(
    (listener) => (tracker ? tracker.subscribe(listener) : noopSubscribe()),
    [tracker]
  );
  const getSnapshot = useCallback(
    () => (tracker ? tracker.getSummary() : EMPTY_ASSET_LOAD_SUMMARY),
    [tracker]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Load state of one entity: a deterministic entry ({status, startedAt,
 * settledAt}), a stream record ({streaming: true, active}), or null when the
 * entity loads nothing the tracker knows about.
 */
export function useEntityLoadState(entity) {
  const tracker = getAssetLoadTracker();
  const subscribe = useCallback(
    (listener) => (tracker ? tracker.subscribe(listener) : noopSubscribe()),
    [tracker]
  );
  const getSnapshot = useCallback(
    () => (tracker && entity ? tracker.get(entity) : null),
    [tracker, entity]
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
