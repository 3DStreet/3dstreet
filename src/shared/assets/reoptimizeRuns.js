/**
 * Module-level registry of in-flight and finished "Reoptimize" runs, keyed by
 * assetId.
 *
 * A run downloads, re-optimizes and re-uploads a large GLB and then repoints
 * the asset doc. That is deliberately not cancelled when the user closes the
 * details modal or navigates to another asset: the work is expensive and the
 * doc update is worth having either way. But work that keeps going has to
 * stay visible — status held in component state died with the modal, so a
 * reopened modal showed the stale doc while the network tab was still busy.
 * Keeping the status here means any modal instance can subscribe and show
 * the run's progress and outcome, whether or not it started it.
 *
 * Status shapes:
 *   { stage: 'downloading' | 'optimizing' | 'uploading' }
 *   { result: <reoptimizeAsset() return value> }     finished, ok or no-win
 *   { error: string }                               threw
 */

const runs = new Map();
const listeners = new Set();

function publish(assetId, status) {
  runs.set(assetId, status);
  listeners.forEach((cb) => cb());
}

export function getReoptimizeRun(assetId) {
  return runs.get(assetId) ?? null;
}

export function isReoptimizeRunning(assetId) {
  return !!runs.get(assetId)?.stage;
}

/** useSyncExternalStore-compatible: fires on any run's status change. */
export function subscribeReoptimizeRuns(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Start a run for `asset`. A second call while one is in flight for the same
 * assetId is a no-op returning the existing promise. The returned promise
 * never rejects — the outcome is published to the registry instead.
 */
export function startReoptimizeRun(asset, { ownerUid } = {}) {
  const assetId = asset?.assetId;
  const current = runs.get(assetId);
  if (current?.stage && current.promise) return current.promise;

  const promise = (async () => {
    try {
      // Lazy: the pipeline chunk (gltf-transform, meshoptimizer WASM) is only
      // paid for by owners who press the button.
      const { reoptimizeAsset } = await import('@shared/asset-upload');
      const result = await reoptimizeAsset(asset, {
        ownerUid,
        onStatus: (stage) => publish(assetId, { stage, promise })
      });
      publish(assetId, { result });
      return result;
    } catch (err) {
      console.error('[reoptimizeRuns] reoptimize failed', err);
      publish(assetId, { error: err?.message || '' });
      return null;
    }
  })();
  publish(assetId, { stage: 'downloading', promise });
  return promise;
}

/** Forget a finished run's outcome (e.g. after the variant was removed). */
export function clearReoptimizeRun(assetId) {
  if (runs.get(assetId)?.stage) return;
  runs.delete(assetId);
  listeners.forEach((cb) => cb());
}

/** Test hook. */
export function _resetReoptimizeRuns() {
  runs.clear();
}
