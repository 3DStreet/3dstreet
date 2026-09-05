/**
 * Pre-upload sniff for `.gltf` (JSON) files.
 *
 * A `.gltf` is plain JSON that may reference sibling files (`scene.bin`,
 * `textures/*.png`) by relative URI — the standard shape of a Sketchfab
 * "glTF" download. Browsers hand us a single File on drop/pick, so those
 * siblings are unreachable: the model can't render locally and uploading
 * the JSON alone would store a permanently broken asset (#1951).
 *
 * This module classifies a `.gltf` before any placeholder entity or upload
 * happens:
 *
 *   'self-contained' — every buffer/image is embedded (`data:` URI) or
 *                      packed in a bufferView. Safe to upload; the optimize
 *                      worker converts it to GLB when it can.
 *   'external-refs'  — references sibling files. Rejected with conversion
 *                      instructions.
 *   'binary'         — GLB bytes with a `.gltf` name. Treated as a GLB.
 *   'invalid'        — not parseable as glTF JSON or GLB.
 *
 * `.glb` files never come through here — callers gate on isGltfJsonFile().
 */

import { formatSharedMessage } from '../i18n/sharedMessages';

const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian

export function isGltfJsonFile(file) {
  return (file?.name || '').toLowerCase().endsWith('.gltf');
}

function isDataUri(uri) {
  return /^data:/i.test(uri.trim());
}

/**
 * Classify parsed glTF JSON. Exported for tests.
 * @returns {{ selfContained: boolean, externalRefs: string[] }}
 */
export function analyzeGltfJson(json) {
  const externalRefs = [];
  for (const buffer of json?.buffers ?? []) {
    // A buffer with no uri is GLB-only (BIN chunk); in a standalone .gltf
    // it's unresolvable, same as an external file.
    if (typeof buffer?.uri !== 'string') {
      externalRefs.push('(binary buffer)');
    } else if (!isDataUri(buffer.uri)) {
      externalRefs.push(buffer.uri);
    }
  }
  for (const image of json?.images ?? []) {
    // Images may pack pixels into a bufferView instead of a uri — fine.
    if (typeof image?.uri === 'string' && !isDataUri(image.uri)) {
      externalRefs.push(image.uri);
    }
  }
  return { selfContained: externalRefs.length === 0, externalRefs };
}

/**
 * Classify a `.gltf` File/Blob.
 * @param {File | Blob} file
 * @returns {Promise<{ status: 'self-contained'|'external-refs'|'binary'|'invalid', externalRefs: string[] }>}
 */
export async function analyzeGltfFile(file) {
  let buffer;
  try {
    buffer = await file.arrayBuffer();
  } catch (err) {
    console.warn('[asset-upload] could not read .gltf file', err);
    return { status: 'invalid', externalRefs: [] };
  }
  const view = new DataView(buffer);
  if (view.byteLength >= 4 && view.getUint32(0, true) === GLB_MAGIC) {
    return { status: 'binary', externalRefs: [] };
  }
  let json;
  try {
    json = JSON.parse(new TextDecoder().decode(buffer));
  } catch {
    return { status: 'invalid', externalRefs: [] };
  }
  if (!json || typeof json !== 'object' || !json.asset) {
    return { status: 'invalid', externalRefs: [] };
  }
  const { selfContained, externalRefs } = analyzeGltfJson(json);
  return {
    status: selfContained ? 'self-contained' : 'external-refs',
    externalRefs
  };
}

/**
 * User-facing rejection message for a `.gltf` that can't be uploaded.
 * Shared by the editor drop flow and the scene-free upload flow so both
 * surfaces give the same conversion instructions. Localized via the
 * hand-maintained shared message table (no react-intl context here).
 */
export function gltfRejectionMessage(filename, analysis) {
  const id =
    analysis?.status === 'external-refs' ? 'gltfExternalRefs' : 'gltfInvalid';
  return formatSharedMessage(id, { filename });
}
