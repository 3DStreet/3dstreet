/* global ImageBitmap */

// Refcounted registry for cross-model texture Source sharing. Acquired at load time by
// gltf-model-plus' GLTFSharedTextureSourceExtension: when several models embed the same image
// (matched by the server-baked images[].extras.imageHash → texture.userData.imageHash), every
// texture is pointed at one canonical THREE.Source before it is ever uploaded.
//
// three.js already refcounts the GPU WebGLTexture per Source (WebGLTextures usedTimes), so the
// GPU upload is shared and freed safely on the last texture.dispose(). What three does NOT
// refcount is the decoded CPU-side ImageBitmap that a Source wraps — application code closes it
// manually (disposeUtils, batch teardown, material swaps). This registry refcounts that bitmap
// so it is closed exactly when the last texture referencing the canonical Source is disposed:
//   - not earlier: closing a bitmap still backing a live texture breaks rendering / re-upload,
//   - not never: leaking one decoded bitmap per image for the scene lifetime defeats the point.
//
// The registry lives on the sceneEl (passed to acquireSharedSource) so it is scoped to the
// scene. Each entry carries a back-reference to its own Map, so releaseSharedSource is fully
// self-contained from the bitmap alone — disposal sites in other modules don't need the sceneEl.

/**
 * Registry key for a texture's Source. The server-baked `imageHash` when present, which lets
 * textures across different GLBs share one decoded Source. Otherwise a per-Source synthetic key
 * so a non-hashed ImageBitmap is refcounted all the same: cloneGltfScene shares the decoded
 * Source with every instance, and its bitmap must be closed only at the last reference — not by
 * whichever clone (or the pristine template) is disposed first, which would wash the still-live
 * clones white. Returns null for sources that need no refcounting (compressed KTX2/Basis have no
 * ImageBitmap to close).
 */
export function sharedSourceKey(source, imageHash) {
  if (imageHash) return imageHash;
  if (source?.data instanceof ImageBitmap) return `uuid:${source.uuid}`;
  return null;
}

/**
 * Register `source` as the canonical Source for `hash` (first caller wins) and increment its
 * reference count. Returns the registry entry: `entry.source` is the canonical Source the caller
 * should assign to its texture, and `entry.source === source` iff this call created the entry — so
 * the caller can tell first-load from reuse (and seed per-entry metadata / redirect) without a
 * second registry lookup. On creation, tags the canonical's ImageBitmap with `_sharedSource` (a
 * fast boolean for close sites) and `_sharedEntry` (the registry entry, for releaseSharedSource).
 */
export function acquireSharedSource(registry, hash, source) {
  let entry = registry.get(hash);
  if (!entry) {
    entry = { source, hash, refCount: 0, registry };
    registry.set(hash, entry);
    const img = source?.data;
    if (img instanceof ImageBitmap) {
      img._sharedSource = true;
      img._sharedEntry = entry;
    }
  }
  entry.refCount++;
  return entry;
}

/**
 * Account for the disposal of one texture that references a shared canonical `image`. Decrements
 * the refcount; on the final reference it closes the ImageBitmap, drops the registry entry, and
 * clears the tags. Returns true if `image` was a shared source (so the caller must NOT close it
 * itself), false otherwise (caller should close as usual).
 */
export function releaseSharedSource(image) {
  if (!image?._sharedSource) return false;
  const entry = image._sharedEntry;
  if (!entry) return true; // tagged shared but no entry: skip close defensively, don't leak-break
  if (--entry.refCount <= 0) {
    entry.registry.delete(entry.hash);
    delete image._sharedSource;
    delete image._sharedEntry;
    image.close && image.close();
  }
  return true;
}
