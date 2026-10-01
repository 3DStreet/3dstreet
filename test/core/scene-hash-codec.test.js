/* global describe, it */
import assert from 'assert';
import {
  encodeSceneHash,
  decodeSceneHash,
  DEFLATE_HASH_PREFIX
} from '../../src/tested/scene-hash-codec.js';

describe('scene-hash-codec', () => {
  it('round-trips scene JSON, including non-ASCII text', async () => {
    const json = JSON.stringify({
      title: 'Esquina Comunitaria — ñandú 🌳',
      data: [
        { components: { position: '1 0 2', 'build-area': 'palette: tree3' } }
      ],
      memory: { forkedFrom: 'abc' }
    });
    const payload = await encodeSceneHash(json);
    assert.strictEqual(await decodeSceneHash(payload), json);
  });

  it('produces a URL-safe payload with no padding', async () => {
    const payload = await encodeSceneHash(
      '{"a":"' + 'x?/+='.repeat(500) + '"}'
    );
    assert.match(payload, /^[A-Za-z0-9_-]+$/);
  });

  it('compresses a large, repetitive scene quickly and well', async () => {
    const segment = {
      components: {
        'street-segment': 'type: drive-lane; width: 3',
        position: '0 0 0'
      }
    };
    const json = JSON.stringify({
      data: Array.from({ length: 4000 }, () => segment)
    });
    const t0 = Date.now();
    const payload = await encodeSceneHash(json);
    assert.ok(Date.now() - t0 < 1000, 'encode takes well under a second');
    assert.ok(payload.length < json.length / 20, 'payload is much smaller');
    assert.strictEqual(await decodeSceneHash(payload), json);
  });

  it('rejects a corrupt payload', async () => {
    await assert.rejects(() => decodeSceneHash('not-deflate-data'));
  });

  it('exports the hash prefix the loader dispatches on', () => {
    assert.strictEqual(DEFLATE_HASH_PREFIX, 'deflate-3dstreet-json:');
  });
});
