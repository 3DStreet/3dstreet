/**
 * Scene JSON <-> URL-hash payload for the `#deflate-3dstreet-json:` loader
 * (json-utils_1.1.js) and Visitor Build's "Open in 3DStreet" handoff
 * (src/editor/lib/sceneHandoff.js, docs/visitor-build.md).
 *
 * Native raw-deflate (CompressionStream) + base64url. It replaces JSONCrush
 * for handoffs: JSONCrush searches the whole string for repeated substrings
 * on every pass, so it is super-linear and main-thread bound (seconds for a
 * 20 KB scene, tens of seconds for a real one), where deflate takes about
 * a millisecond and yields a smaller payload. Async, as the stream API is.
 * No dependencies: CompressionStream is in every browser 3DStreet supports
 * and in Node 18+.
 */

export const DEFLATE_HASH_PREFIX = 'deflate-3dstreet-json:';

async function pipe(bytes, transform) {
  const stream = new Response(bytes).body.pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Self-contained base64url (RFC 4648 §5, unpadded). Not btoa/atob: those
// take "binary strings" and are replaced by stricter implementations in
// some environments (jsdom-global in the core test suite), and the payload
// is bytes anyway.
const ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const LOOKUP = new Int16Array(128).fill(-1);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

function toBase64Url(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out +=
      ALPHABET[(n >> 18) & 63] +
      ALPHABET[(n >> 12) & 63] +
      ALPHABET[(n >> 6) & 63] +
      ALPHABET[n & 63];
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i] << 16;
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out +=
      ALPHABET[(n >> 18) & 63] +
      ALPHABET[(n >> 12) & 63] +
      ALPHABET[(n >> 6) & 63];
  }
  return out;
}

function fromBase64Url(text) {
  const clean = text.replace(/=+$/, '');
  if (clean.length % 4 === 1) throw new Error('Invalid base64url length');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const v = code < 128 ? LOOKUP[code] : -1;
    if (v < 0) throw new Error('Invalid base64url character');
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[o++] = (value >> bits) & 0xff;
    }
  }
  return bytes;
}

/** JSON string -> URL-safe payload (no prefix). */
export async function encodeSceneHash(jsonString) {
  const bytes = new TextEncoder().encode(jsonString);
  return toBase64Url(await pipe(bytes, new CompressionStream('deflate-raw')));
}

/** URL-safe payload (no prefix) -> JSON string. Throws on corrupt input. */
export async function decodeSceneHash(payload) {
  const bytes = fromBase64Url(payload.trim());
  const inflated = await pipe(bytes, new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(inflated);
}
