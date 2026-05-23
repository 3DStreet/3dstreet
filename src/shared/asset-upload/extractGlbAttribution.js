/**
 * Best-effort GLB attribution extraction.
 *
 * Reads the JSON chunk of a GLB binary (no third-party deps — gltf-transform
 * is loaded lazily for the optimization pass and we don't want to pull it in
 * just to peek at metadata). Pulls common fields from `asset.copyright`,
 * `asset.generator`, `asset.extras.*`, and the `KHR_xmp_json_ld` extension.
 *
 * Sketchfab is the most prolific source of user-uploaded GLBs and populates
 * `asset.extras` with { author, license, source, title } on every export.
 * Poly Pizza and a few Khronos sample assets use similar shapes; the
 * `KHR_xmp_json_ld` path covers the Dublin Core / structured-licensing case.
 *
 * Returned shape:
 *
 *   {
 *     title,           // extras.title || xmp.dc:title || ''  — used as the
 *                      // default Display name on upload; NOT persisted in
 *                      // the stored attribution object (callers strip it).
 *     author,          // extras.author || extras.creator || copyright || xmp.dc:creator || ''
 *     license,         // extras.license || extras.rights || xmp model3d:spdxLicense || ''
 *     source,          // extras.source || extras.url || ''  (URL)
 *     sourceName,      // 'Sketchfab' | 'Poly Pizza' | <inferred> | ''
 *     generator,       // raw asset.generator string — useful as a diagnostic
 *     attribution,     // composed display string (license / author / source)
 *     attributionUrl,  // mirror of `source` (catalog.json compatible)
 *     hasMetadata      // true if any of the above were populated
 *   }
 *
 * The Display name is the canonical "title" surface in the UI, so we do NOT
 * persist `title` as part of the attribution object — the upload pipeline
 * uses the extracted title (if any) to seed the asset doc's `name` field
 * and then drops it.
 */

const GLB_MAGIC = 0x46546c67; // 'glTF' little-endian
const CHUNK_JSON = 0x4e4f534a; // 'JSON' little-endian

function readGlbJsonChunk(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 20) throw new Error('GLB too short');
  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) throw new Error('Not a GLB file');

  const jsonChunkLen = view.getUint32(12, true);
  const jsonChunkType = view.getUint32(16, true);
  if (jsonChunkType !== CHUNK_JSON) throw new Error('First chunk is not JSON');
  if (jsonChunkLen > view.byteLength - 20) {
    throw new Error('JSON chunk length out of bounds');
  }
  const jsonBytes = new Uint8Array(buffer, 20, jsonChunkLen);
  return JSON.parse(new TextDecoder().decode(jsonBytes));
}

function firstNonEmpty(...candidates) {
  for (const c of candidates) {
    if (c == null) continue;
    if (Array.isArray(c)) {
      const found = c.find((v) => typeof v === 'string' && v.trim());
      if (found) return found.trim();
      continue;
    }
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return '';
}

function inferSourceName(source, generator) {
  const url = (source || '').toLowerCase();
  if (url.includes('sketchfab.com')) return 'Sketchfab';
  if (url.includes('poly.pizza')) return 'Poly Pizza';
  if (url.includes('polyhaven.com')) return 'Poly Haven';
  if (url.includes('fab.com')) return 'Fab';
  if (url.includes('turbosquid.com')) return 'TurboSquid';
  const gen = (generator || '').toLowerCase();
  if (gen.includes('sketchfab')) return 'Sketchfab';
  if (gen.includes('blender')) return 'Blender';
  if (gen.includes('maya')) return 'Maya';
  return '';
}

function extractFromXmp(json) {
  // KHR_xmp_json_ld stores packets at the root and references them per-asset.
  // The asset.extensions.KHR_xmp_json_ld.packet index points into the root
  // array. Fall back to packet[0] if the asset doesn't reference one.
  const rootExt = json.extensions?.KHR_xmp_json_ld;
  if (!rootExt?.packets || !Array.isArray(rootExt.packets)) return {};
  const ref = json.asset?.extensions?.KHR_xmp_json_ld?.packet;
  const packet = rootExt.packets[ref ?? 0];
  if (!packet || typeof packet !== 'object') return {};
  return {
    title: packet['dc:title'],
    author: packet['dc:creator'] || packet['dc:contributor'],
    license:
      packet['model3d:spdxLicense'] ||
      packet['xmpRights:UsageTerms'] ||
      packet['dc:rights'],
    source: packet['dc:source'] || packet['xmpRights:WebStatement']
  };
}

/**
 * Build the read-only display string shown in the mesh details modal.
 * Title is intentionally NOT included — it's surfaced via the Display name
 * field above the attribution block.
 *
 * Examples:
 *   { author: 'Bar', license: 'CC-BY-4.0' } -> "by Bar · CC-BY-4.0"
 *   { author: 'Bar' }                       -> "by Bar"
 *   { license: 'CC-BY-4.0' }                -> "CC-BY-4.0"
 */
export function composeAttributionString({ author, license }) {
  const parts = [];
  if (author) parts.push(`by ${author}`);
  if (license) parts.push(license);
  return parts.join(' · ');
}

/**
 * Normalize a raw GLB JSON header into our standard attribution shape.
 * Exported for tests so the parser can be exercised without a real GLB buffer.
 */
export function normalizeAttributionFromGltfJson(json) {
  const asset = json?.asset ?? {};
  const extras = asset.extras ?? {};
  const xmp = extractFromXmp(json || {});

  const title = firstNonEmpty(extras.title, extras.name, xmp.title);
  const author = firstNonEmpty(
    extras.author,
    extras.creator,
    extras.artist,
    xmp.author,
    // asset.copyright is often just an author name on Sketchfab exports.
    asset.copyright
  );
  const license = firstNonEmpty(
    extras.license,
    extras.licence,
    extras.rights,
    xmp.license
  );
  const source = firstNonEmpty(
    extras.source,
    extras.url,
    extras.sourceUrl,
    xmp.source
  );
  const generator = firstNonEmpty(asset.generator);
  const sourceName = inferSourceName(source, generator);

  const hasMetadata = !!(title || author || license || source);
  const attribution = composeAttributionString({ author, license });

  return {
    title,
    author,
    license,
    source,
    sourceName,
    generator,
    attribution,
    attributionUrl: source,
    hasMetadata
  };
}

/**
 * Extract attribution metadata from a GLB file/blob/ArrayBuffer.
 * Best-effort: returns a normalized object even on failure (with
 * hasMetadata=false) so a malformed or unparseable header never blocks an
 * otherwise-valid upload. Parse errors are logged for visibility.
 *
 * @param {File | Blob | ArrayBuffer | Uint8Array} input
 * @returns {Promise<ReturnType<typeof normalizeAttributionFromGltfJson>>}
 */
export async function extractGlbAttribution(input) {
  try {
    let buffer;
    if (input instanceof ArrayBuffer) {
      buffer = input;
    } else if (input instanceof Uint8Array) {
      buffer = input.buffer.slice(
        input.byteOffset,
        input.byteOffset + input.byteLength
      );
    } else if (input && typeof input.arrayBuffer === 'function') {
      buffer = await input.arrayBuffer();
    } else {
      throw new Error('Unsupported input type for GLB attribution extraction');
    }
    const json = readGlbJsonChunk(buffer);
    return normalizeAttributionFromGltfJson(json);
  } catch (err) {
    console.warn('[asset-upload] GLB attribution extraction failed', err);
    return {
      title: '',
      author: '',
      license: '',
      source: '',
      sourceName: '',
      generator: '',
      attribution: '',
      attributionUrl: '',
      hasMetadata: false
    };
  }
}

/**
 * Strip `title` and `hasMetadata` from the extracted attribution before
 * persisting — `title` becomes the asset doc's Display name, `hasMetadata`
 * is a parse-time flag. Returns null when there's nothing worth saving so
 * callers can conditionally omit the field from the doc.
 */
export function buildStoredAttribution(extracted) {
  if (!extracted?.hasMetadata) return null;
  const { author, license, source, sourceName, generator, attributionUrl } =
    extracted;
  if (!author && !license && !source && !sourceName) return null;
  return {
    author: author || '',
    license: license || '',
    source: source || '',
    sourceName: sourceName || '',
    generator: generator || '',
    attribution: extracted.attribution || '',
    attributionUrl: attributionUrl || source || ''
  };
}
