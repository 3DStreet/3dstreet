/**
 * manifest-codec
 * ==============
 *
 * Encode/decode a Traffic Replay manifest for safe storage inside an A-Frame
 * component string property (`street-traffic-replay="manifestData: ..."`).
 *
 * Why this exists: A-Frame serializes a multi-property component as a single
 * `key: value; key: value` string and, on load, splits that whole string on
 * `;` (and each declaration on the first `:`) BEFORE any per-property parsing
 * runs. A raw JSON manifest whose string fields contain a `;` (the converter's
 * own `meta.description` does) therefore gets silently truncated at the first
 * `;` on reload, leaving invalid JSON and an empty replay. Base64 uses only
 * `[A-Za-z0-9+/=]` — no `;` — so it round-trips through the serializer intact.
 *
 * `encodeManifest` writes a `b64:`-prefixed value; `decodeManifest` accepts
 * that, a bare base64 blob, or a legacy raw-JSON value (backward compatible
 * with any scene saved before this fix), returning the parsed object or null.
 */

const B64_PREFIX = 'b64:';

function base64FromUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  if (typeof btoa === 'function') {
    // Chunk the byte->binary-string conversion so String.fromCharCode.apply
    // can't overflow the call stack on large manifests.
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString('base64'); // node (tests)
}

function utf8FromBase64(b64) {
  if (typeof atob === 'function') {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, 'base64').toString('utf8'); // node (tests)
}

/**
 * @param {object|string} manifest - a manifest object, or its JSON string.
 * @returns {string} a serializer-safe value for `manifestData`.
 */
export function encodeManifest(manifest) {
  const json =
    typeof manifest === 'string' ? manifest : JSON.stringify(manifest);
  return B64_PREFIX + base64FromUtf8(json);
}

/**
 * @param {string} value - the stored `manifestData` (b64-prefixed, bare
 *   base64, or legacy raw JSON).
 * @returns {object|null} the parsed manifest, or null if unusable.
 */
export function decodeManifest(value) {
  if (typeof value !== 'string' || !value) return null;
  const trimmed = value.trim();
  let json;
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    json = trimmed; // legacy raw-JSON value (pre-fix scenes)
  } else {
    try {
      json = utf8FromBase64(
        trimmed.startsWith(B64_PREFIX)
          ? trimmed.slice(B64_PREFIX.length)
          : trimmed
      );
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
