/**
 * Progressive-LOD streaming for large user-uploaded GLBs (#1990).
 *
 * Large uploads are processed by Needle Cloud into a progressive GLB (tiny low-LOD
 * core, mesh/texture LODs streamed on demand) and served from Needle's CDN. That CDN
 * URL becomes the asset's `optimizedSourceUrl`, so it flows into `gltf-model` src
 * through the ordinary served-URL path and gets persisted verbatim in scene JSON.
 * Saved scenes carry nothing else about the asset, so the ONLY runtime signal that a
 * model streams is its URL: `isProgressiveModelUrl` is the single predicate every
 * runtime exclusion keys off (loader hook, batching, clone-template cache).
 *
 * The needle library is imported lazily: merely evaluating its module has side
 * effects (a decoder-reachability fetch, eager DRACO/KTX2 loader construction, a
 * `Needle` global), so it must not run in sessions with no progressive model.
 */

/** Hostnames whose GLBs are Needle-processed progressive models. */
export const PROGRESSIVE_MODEL_HOSTS = ['cloud.needle.tools'];

/**
 * True when a gltf-model src points at a progressive-streaming model.
 * Accepts the raw URL or A-Frame's `url(...)` wrapped form; anything unparsable
 * (blob:, relative catalog paths, empty) is not progressive.
 */
export function isProgressiveModelUrl(src) {
  if (typeof src !== 'string') return false;
  const url = src
    .trim()
    .replace(/^url\((.*)\)$/s, '$1')
    .trim();
  if (!/^https?:\/\//i.test(url)) return false;
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch (e) {
    return false;
  }
  return PROGRESSIVE_MODEL_HOSTS.includes(hostname);
}

let libraryPromise = null;
const hookedLoaders = new WeakSet();

/**
 * Hook needle's progressive extension onto a GLTFLoader (idempotent per loader).
 * Resolves once the loader is ready to load a progressive URL; never rejects — a
 * failed hook logs and resolves so the caller's load proceeds and surfaces its own
 * model-error (which the asset-fallback system turns into a storageUrl retry).
 *
 * `useNeedleProgressive` only fills decoders the loader still lacks, so a caller's
 * DRACO/meshopt/KTX2 setup wins. In practice the KTX2 transcoder comes from the
 * library's default (Needle's CDN): A-Frame configures none, and needle output is
 * always KHR_texture_basisu. Same availability domain as the models themselves.
 */
export function hookProgressiveLoader(loader, renderer) {
  if (!loader || hookedLoaders.has(loader)) return Promise.resolve();
  if (!renderer) {
    console.warn(
      '[progressive-models] renderer unavailable; loader not hooked, model will load unstreamed if at all'
    );
    return Promise.resolve();
  }
  if (!libraryPromise) {
    libraryPromise = import('@needle-tools/gltf-progressive');
  }
  return libraryPromise
    .then(({ useNeedleProgressive }) => {
      if (hookedLoaders.has(loader)) return;
      useNeedleProgressive(loader, renderer);
      hookedLoaders.add(loader);
    })
    .catch((err) => {
      console.warn('[progressive-models] failed to hook loader:', err);
    });
}
