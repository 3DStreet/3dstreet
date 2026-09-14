/**
 * Client-side GLB optimization, runs in a Web Worker.
 *
 * Main-thread shim: spawns the worker, transfers the bytes in zero-copy,
 * and races the result against a wall-clock timeout. On timeout / abort /
 * worker error we `worker.terminate()` and return the original File so the
 * upload still proceeds, server-side compression catches what we gave up
 * on. The pipeline itself, and the message protocol, are documented in
 * optimizeGlb.worker.js.
 *
 * Why a worker:
 *   - gltf-transform's transform() is a single main-thread monolith. With
 *     it running, the thumbnail iframe's model-viewer can't render and
 *     the editor UI stutters. A worker frees both.
 *   - terminate() is the only way to actually stop the work mid-flight,
 *     making the timeout a real bail instead of just "stop waiting."
 *
 * Metadata shape is preserved from the pre-worker version so callers
 * (uploadAsset.js, uploadAndPlaceAsset.js) don't change:
 *   { blob, metadata: { optimizationSkipped, reason?, inputBytes,
 *                       outputBytes, hadDraco?, hadWebP? } }
 */

/**
 * Wall-clock budget for everything that happens worker-side, because the
 * timer starts with the postMessage below and only the result stops it:
 *
 *   1. worker bundle + the lazy dep chunks (@gltf-transform/core,
 *      /extensions, /functions, draco3dgltf, meshoptimizer/simplifier)
 *   2. WASM instantiation — Draco decoder + encoder, meshopt simplifier.
 *      Each optimizeGlb() call spawns a fresh Worker, so this is paid on
 *      every upload, not once per session
 *   3. readBinary() parsing the GLB into a gltf-transform Document
 *   4. all 12 transform steps (simplify and textureCompress dominate on
 *      dense/heavily-textured models; draco scales with the post-simplify
 *      triangle count)
 *   5. writeBinary() and the transfer back
 *
 * Reading the File into an ArrayBuffer happens before the timer starts and
 * is not counted. Raised 15s → 30s: a real 113 MB photogrammetry GLB
 * measured 9.4s on a fast machine, which left far too little headroom —
 * a slower CPU or a cold dep/WASM load pushed past 15s and silently fell
 * back to the unoptimized original.
 */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * @param {File|Blob} file - Source GLB.
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=30000] - Worker is terminated if it
 *   hasn't returned in this many ms; original file is used instead.
 * @param {AbortSignal} [opts.signal] - Same: terminates and falls back.
 * @returns {Promise<{ blob: Blob, metadata: object }>}
 */
export async function optimizeGlb(
  file,
  { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = {}
) {
  const arrayBuffer = await file.arrayBuffer();
  const inputBytes = arrayBuffer.byteLength;

  const worker = new Worker(
    new URL('./optimizeGlb.worker.js', import.meta.url),
    { type: 'module' }
  );
  const startedAt = performance.now();

  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let abortHandler = null;

    const elapsed = () => Math.round(performance.now() - startedAt);

    const teardown = (_reason) => {
      if (timer) clearTimeout(timer);
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
      worker.terminate();
    };

    const fallbackToOriginal = (reason) => {
      if (settled) return;
      settled = true;
      teardown(reason);
      resolve({
        blob: file,
        metadata: {
          optimizationSkipped: true,
          reason,
          inputBytes,
          outputBytes: inputBytes
        }
      });
    };

    worker.addEventListener('message', (e) => {
      if (settled) return;
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'error') {
        console.warn('[optimizeGlb] worker error, using original', d.message);
        fallbackToOriginal('worker_error');
        return;
      }
      if (d.type !== 'result') return;
      settled = true;
      teardown('result');
      if (d.skipped) {
        console.log(
          `[optimizeGlb] worker skipped (${d.reason}) in ${elapsed()}ms, using original`
        );
        resolve({
          blob: file,
          metadata: {
            optimizationSkipped: true,
            reason: d.reason,
            inputBytes,
            outputBytes: d.outputBytes,
            hadDraco: d.hadDraco,
            hadWebP: d.hadWebP
          }
        });
        return;
      }
      const inMb = (inputBytes / 1_000_000).toFixed(1);
      const outMb = (d.outputBytes / 1_000_000).toFixed(1);
      console.log(
        `[optimizeGlb] optimized in ${elapsed()}ms: ${inMb} MB → ${outMb} MB`
      );
      resolve({
        blob: new Blob([d.bytes], { type: 'model/gltf-binary' }),
        metadata: {
          optimizationSkipped: false,
          inputBytes,
          outputBytes: d.outputBytes,
          hadDraco: d.hadDraco,
          hadWebP: d.hadWebP
        }
      });
    });

    worker.addEventListener('error', (e) => {
      console.warn('[optimizeGlb] worker crashed, using original', e.message);
      fallbackToOriginal('worker_error');
    });

    timer = setTimeout(() => {
      console.warn(
        `[optimizeGlb] timeout reached at ${elapsed()}ms, killing worker`
      );
      fallbackToOriginal('timeout');
    }, timeoutMs);

    if (signal) {
      if (signal.aborted) {
        fallbackToOriginal('aborted');
        return;
      }
      abortHandler = () => {
        console.log(
          `[optimizeGlb] abort signal at ${elapsed()}ms, killing worker`
        );
        fallbackToOriginal('aborted');
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    worker.postMessage({ type: 'optimize', bytes: arrayBuffer }, [arrayBuffer]);
  });
}
