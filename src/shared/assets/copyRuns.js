/**
 * Module-level registry of in-flight and finished "Copy to my library" runs,
 * keyed by the SOURCE assetId. Same shape and reasons as reoptimizeRuns.js:
 * the copy keeps going after the modal closes (it is a full upload), and
 * work that keeps going has to stay visible, so a reopened modal reads the
 * run's progress and outcome from here instead of from component state.
 *
 * The host's `onCopied` (the editor's entity swap) is also fired from here,
 * on completion, so it does not depend on any React lifecycle.
 *
 * Status shapes:
 *   { stage: 'downloading' | 'validating' | 'optimizing' | 'uploading' | 'thumbnailing' }
 *   { result: <copyAssetToLibrary() return value>, swapped: boolean }   finished
 *   { error: string }                                                    failed
 */

const runs = new Map();
const listeners = new Set();

function publish(assetId, status) {
  runs.set(assetId, status);
  listeners.forEach((cb) => cb());
}

export function getCopyRun(assetId) {
  return runs.get(assetId) ?? null;
}

/** useSyncExternalStore-compatible: fires on any run's status change. */
export function subscribeCopyRuns(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Start a copy of `asset` into the signed-in user's library. A second call
 * while one is in flight for the same source asset is a no-op returning the
 * existing promise. The returned promise never rejects — the outcome is
 * published to the registry instead. `onCopied(newDoc)` runs on success and
 * its truthy return marks the outcome as "swapped into the scene".
 */
export function startCopyRun(asset, { onCopied } = {}) {
  const assetId = asset?.assetId;
  const current = runs.get(assetId);
  if (current?.stage && current.promise) return current.promise;

  const promise = (async () => {
    try {
      const { copyAssetToLibrary } = await import('@shared/asset-upload');
      const result = await copyAssetToLibrary(asset, {
        onStatus: (stage) => publish(assetId, { stage, promise })
      });
      if (result.cancelled) {
        runs.delete(assetId);
        listeners.forEach((cb) => cb());
        return result;
      }
      if (!result.ok) {
        publish(assetId, { error: result.error || '' });
        return result;
      }
      let swapped = false;
      if (onCopied && result.asset) {
        try {
          swapped = !!onCopied(result.asset);
        } catch (err) {
          console.error('[copyRuns] onCopied failed', err);
        }
      }
      publish(assetId, { result, swapped });
      return result;
    } catch (err) {
      console.error('[copyRuns] copy failed', err);
      publish(assetId, { error: err?.message || '' });
      return null;
    }
  })();
  publish(assetId, { stage: 'downloading', promise });
  return promise;
}

/** Test hook. */
export function _resetCopyRuns() {
  runs.clear();
}
