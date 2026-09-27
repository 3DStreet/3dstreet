/**
 * The GLB container's magic number, shared by everything in the upload
 * path that has to tell binary GLB from self-contained .gltf JSON:
 * optimizeGlb.worker.js, extractGlbAttribution.js, analyzeGltf.js.
 *
 * Deliberately dependency-free — optimizeGlb.worker.js imports it, and
 * the worker bundle shouldn't drag main-thread modules along for a
 * four-byte check.
 */

/** First four bytes of every GLB: 'glTF', little-endian. */
export const GLB_MAGIC = 0x46546c67;

/**
 * @param {DataView} view - Positioned at the start of the file.
 * @returns {boolean} true when the buffer opens with the GLB magic. A
 *   buffer too short to hold it is simply not a GLB, not an error.
 */
export function hasGlbMagic(view) {
  return view.byteLength >= 4 && view.getUint32(0, true) === GLB_MAGIC;
}
