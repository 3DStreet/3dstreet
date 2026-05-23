import { describe, it, expect } from 'vitest';
import {
  extractGlbAttribution,
  normalizeAttributionFromGltfJson,
  buildAbbreviatedAttribution
} from '../../../src/shared/asset-upload/extractGlbAttribution.js';

// Build a minimal valid GLB binary with a JSON-only chunk so we can drive
// the binary parser in extractGlbAttribution without shipping fixture files.
// GLB layout: 12-byte header (magic, version, length) + JSON chunk
// (4-byte length, 4-byte type, JSON bytes padded to 4-byte alignment).
function buildGlb(jsonObj) {
  const json = JSON.stringify(jsonObj);
  const encoder = new TextEncoder();
  let jsonBytes = encoder.encode(json);
  const pad = (4 - (jsonBytes.length % 4)) % 4;
  if (pad > 0) {
    const padded = new Uint8Array(jsonBytes.length + pad);
    padded.set(jsonBytes);
    // Pad with spaces (0x20) — the GLB spec requires JSON chunk padding to
    // be valid JSON whitespace.
    for (let i = jsonBytes.length; i < padded.length; i++) padded[i] = 0x20;
    jsonBytes = padded;
  }
  const totalLength = 12 + 8 + jsonBytes.length;
  const buffer = new ArrayBuffer(totalLength);
  const view = new DataView(buffer);
  // Header
  view.setUint32(0, 0x46546c67, true); // 'glTF'
  view.setUint32(4, 2, true); // version
  view.setUint32(8, totalLength, true);
  // JSON chunk
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true); // 'JSON'
  new Uint8Array(buffer, 20).set(jsonBytes);
  return buffer;
}

describe('normalizeAttributionFromGltfJson', () => {
  it('returns empty fields with hasMetadata=false for empty asset', () => {
    const out = normalizeAttributionFromGltfJson({ asset: {} });
    expect(out.hasMetadata).toBe(false);
    expect(out.title).toBe('');
    expect(out.author).toBe('');
    expect(out.license).toBe('');
    expect(out.source).toBe('');
    expect(out.attribution).toBe('');
  });

  it('pulls Sketchfab-style extras', () => {
    const out = normalizeAttributionFromGltfJson({
      asset: {
        generator: 'Sketchfab-to-glTF 2024',
        copyright: 'Comrade1280',
        extras: {
          author: 'Comrade1280',
          license: 'CC-BY-4.0',
          source:
            'https://sketchfab.com/3d-models/generic-passenger-car-pack-abc',
          title: 'Generic passenger car pack'
        }
      }
    });
    expect(out.hasMetadata).toBe(true);
    expect(out.title).toBe('Generic passenger car pack');
    expect(out.author).toBe('Comrade1280');
    expect(out.license).toBe('CC-BY-4.0');
    expect(out.source).toBe(
      'https://sketchfab.com/3d-models/generic-passenger-car-pack-abc'
    );
    expect(out.sourceName).toBe('Sketchfab');
    expect(out.attributionUrl).toBe(out.source);
    expect(out.attribution).toBe(
      "CC-BY-4.0: 'Generic passenger car pack' by Comrade1280"
    );
  });

  it('falls back to copyright when extras.author is missing', () => {
    const out = normalizeAttributionFromGltfJson({
      asset: { copyright: 'Solo Artist' }
    });
    expect(out.author).toBe('Solo Artist');
    expect(out.hasMetadata).toBe(true);
  });

  it('infers source name from generator when source URL is absent', () => {
    const out = normalizeAttributionFromGltfJson({
      asset: { generator: 'Blender 4.0', extras: { author: 'Someone' } }
    });
    expect(out.sourceName).toBe('Blender');
  });

  it('reads KHR_xmp_json_ld packets via asset reference', () => {
    const out = normalizeAttributionFromGltfJson({
      extensions: {
        KHR_xmp_json_ld: {
          packets: [
            {
              'dc:creator': ['Jane Doe'],
              'dc:title': 'My Model',
              'dc:rights': 'All rights reserved',
              'dc:source': 'https://example.com/model'
            }
          ]
        }
      },
      asset: {
        extensions: { KHR_xmp_json_ld: { packet: 0 } }
      }
    });
    expect(out.title).toBe('My Model');
    expect(out.author).toBe('Jane Doe');
    expect(out.license).toBe('All rights reserved');
    expect(out.source).toBe('https://example.com/model');
  });

  it('prefers extras over xmp when both are present', () => {
    const out = normalizeAttributionFromGltfJson({
      extensions: {
        KHR_xmp_json_ld: { packets: [{ 'dc:title': 'xmp title' }] }
      },
      asset: {
        extras: { title: 'extras title' },
        extensions: { KHR_xmp_json_ld: { packet: 0 } }
      }
    });
    expect(out.title).toBe('extras title');
  });
});

describe('extractGlbAttribution (binary)', () => {
  it('extracts from a synthesized GLB buffer', async () => {
    const buf = buildGlb({
      asset: {
        generator: 'Sketchfab-to-glTF 2024',
        extras: { author: 'Test Author', title: 'Test Model' }
      }
    });
    const out = await extractGlbAttribution(buf);
    expect(out.hasMetadata).toBe(true);
    expect(out.author).toBe('Test Author');
    expect(out.title).toBe('Test Model');
    expect(out.sourceName).toBe('Sketchfab');
  });

  it('returns an empty result (no throw) for an invalid GLB', async () => {
    const buf = new ArrayBuffer(4);
    const out = await extractGlbAttribution(buf);
    expect(out.hasMetadata).toBe(false);
    expect(out.attribution).toBe('');
  });

  it('accepts a Uint8Array', async () => {
    const buf = buildGlb({ asset: { extras: { author: 'Bytes Author' } } });
    const out = await extractGlbAttribution(new Uint8Array(buf));
    expect(out.author).toBe('Bytes Author');
  });

  it('accepts a Blob-like object with arrayBuffer()', async () => {
    const buf = buildGlb({ asset: { extras: { title: 'Blob Title' } } });
    const blobLike = { arrayBuffer: async () => buf };
    const out = await extractGlbAttribution(blobLike);
    expect(out.title).toBe('Blob Title');
  });
});

describe('buildAbbreviatedAttribution', () => {
  it('combines title and author when both present', () => {
    expect(buildAbbreviatedAttribution({ title: 'Foo', author: 'Bar' })).toBe(
      'Foo by Bar'
    );
  });
  it('prefers license · author when title is missing', () => {
    expect(
      buildAbbreviatedAttribution({ license: 'CC-BY-4.0', author: 'Bar' })
    ).toBe('CC-BY-4.0 · Bar');
  });
  it('falls back to attribution composite string', () => {
    expect(
      buildAbbreviatedAttribution({
        attribution: 'CC-BY-4.0: by Bar'
      })
    ).toBe('CC-BY-4.0: by Bar');
  });
  it('returns empty string for null input', () => {
    expect(buildAbbreviatedAttribution(null)).toBe('');
  });
});
