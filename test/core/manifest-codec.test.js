/* global describe, it */

import assert from 'assert';
import {
  encodeManifest,
  decodeManifest
} from '../../src/aframe-components/play/manifest-codec.js';

// A-Frame serializes a component as `key: value; key: value` and splits on
// `;` / `:` on load, so a manifest stored raw gets truncated at the first `;`
// in any string field. encodeManifest must produce a value that survives that.
describe('manifest-codec', function () {
  const manifest = {
    meta: {
      // The real converter emits a description containing a semicolon — the
      // exact character that broke raw-JSON storage.
      description: 'mode, direction, speed and duration; timestamps relative.',
      countsByMode: { person: 2, bicycle: 1 }
    },
    agents: [
      { t: 0, mode: 'person', dir: 'inbound', speed: 3, dur: 5 },
      { t: 1.5, mode: 'bicycle', dir: 'outbound', speed: 10, dur: 8 }
    ]
  };

  it('round-trips a manifest through encode/decode', function () {
    const decoded = decodeManifest(encodeManifest(manifest));
    assert.deepStrictEqual(decoded, manifest);
  });

  it('produces a value free of the A-Frame delimiters `;` and `:`', function () {
    const encoded = encodeManifest(manifest);
    // The `b64:` prefix carries the only colon; the payload after it must be
    // delimiter-free so it survives component-string parsing.
    const payload = encoded.replace(/^b64:/, '');
    assert.ok(!payload.includes(';'), 'payload must not contain ";"');
    assert.ok(!payload.includes(':'), 'payload must not contain ":"');
  });

  it('simulates the serializer split and recovers the full manifest', function () {
    // Mimic `manifestData: <value>; target: x; timeScale: 1` being split on
    // `;` then each declaration on its first `:` (what A-Frame does on load).
    const flat = `manifestData: ${encodeManifest(manifest)}; target: s1; timeScale: 1`;
    const decls = flat.split(';').map((d) => d.trim());
    const bag = {};
    for (const d of decls) {
      const i = d.indexOf(':');
      bag[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
    assert.deepStrictEqual(decodeManifest(bag.manifestData), manifest);
    assert.strictEqual(bag.target, 's1');
  });

  it('accepts legacy raw-JSON values (backward compatible)', function () {
    assert.deepStrictEqual(decodeManifest(JSON.stringify(manifest)), manifest);
  });

  it('returns null for empty or unparseable input', function () {
    assert.strictEqual(decodeManifest(''), null);
    assert.strictEqual(decodeManifest(null), null);
    assert.strictEqual(decodeManifest('not-base64-@@@'), null);
  });

  it('preserves non-ASCII characters', function () {
    const m = { meta: { note: 'café — naïve — 日本語' }, agents: [] };
    assert.deepStrictEqual(decodeManifest(encodeManifest(m)), m);
  });
});
