/* global describe, it */

/**
 * Progressive-streaming model predicate (#1990).
 *
 * Saved scenes persist only the gltf-model URL for a user asset, so the URL is the
 * single runtime signal that a model streams progressively. Every runtime exclusion
 * (loader hook, batching, clone-template cache) keys off this predicate, so it must
 * accept exactly the Needle CDN forms and nothing else.
 */

import assert from 'assert';
import {
  isProgressiveModelUrl,
  PROGRESSIVE_MODEL_HOSTS
} from '../../src/tested/progressive-models.js';

const NEEDLE_URL =
  'https://cloud.needle.tools/-/assets/Z23hhzB1ZHhKeJ-product/file';

describe('isProgressiveModelUrl', () => {
  it('matches a Needle CDN served URL, raw or url()-wrapped', () => {
    assert.strictEqual(isProgressiveModelUrl(NEEDLE_URL), true);
    assert.strictEqual(isProgressiveModelUrl(`url(${NEEDLE_URL})`), true);
    assert.strictEqual(isProgressiveModelUrl(`  url( ${NEEDLE_URL} ) `), true);
    assert.strictEqual(
      isProgressiveModelUrl(
        NEEDLE_URL.replace('https://cloud', 'HTTPS://CLOUD')
      ),
      true
    );
  });

  it('rejects Firebase Storage, catalog, blob and relative sources', () => {
    assert.strictEqual(
      isProgressiveModelUrl(
        'https://firebasestorage.googleapis.com/v0/b/x/o/users%2Fu%2Fa.glb?alt=media&token=t'
      ),
      false
    );
    assert.strictEqual(
      isProgressiveModelUrl(
        'https://assets.3dstreet.app/sets/vehicles/gltf-exports/draco/car.glb'
      ),
      false
    );
    assert.strictEqual(
      isProgressiveModelUrl('blob:https://3dstreet.app/abc'),
      false
    );
    assert.strictEqual(isProgressiveModelUrl('#gltf-part-src'), false);
    assert.strictEqual(isProgressiveModelUrl('models/thing.glb'), false);
  });

  it('rejects look-alike hosts and non-strings', () => {
    assert.strictEqual(
      isProgressiveModelUrl(
        'https://cloud.needle.tools.evil.com/-/assets/x/file'
      ),
      false
    );
    assert.strictEqual(
      isProgressiveModelUrl('https://evil.com/?u=https://cloud.needle.tools/x'),
      false
    );
    assert.strictEqual(isProgressiveModelUrl(''), false);
    assert.strictEqual(isProgressiveModelUrl(null), false);
    assert.strictEqual(isProgressiveModelUrl(undefined), false);
    assert.strictEqual(isProgressiveModelUrl({ src: NEEDLE_URL }), false);
  });

  it('keys purely off the host allowlist', () => {
    for (const host of PROGRESSIVE_MODEL_HOSTS) {
      assert.strictEqual(
        isProgressiveModelUrl(`https://${host}/anything`),
        true
      );
    }
  });
});
