/* global describe, it */

/**
 * Basemap provider registry (#1962 step B).
 *
 * The contract under test: provider/style pairs resolve to keyed URL
 * templates with attribution; a missing key either falls back to the OSM
 * dev tiles (only when the caller allows it — dev builds) or resolves to
 * nothing, so production can never silently point traffic at the OSMF
 * server against its usage policy.
 */

import assert from 'assert';
import {
  BASEMAP_PROVIDERS,
  BASEMAP_STYLES,
  DEFAULT_BASEMAP_PROVIDER,
  DEFAULT_BASEMAP_STYLE,
  resolveBasemapSource
} from '../../src/tested/basemap-providers.js';

describe('resolveBasemapSource', () => {
  it('resolves the default provider/style with a key injected', () => {
    const source = resolveBasemapSource({ keys: { maptiler: 'abc123' } });
    assert.ok(source);
    assert.strictEqual(source.isDevFallback, false);
    assert.strictEqual(source.providerName, 'MapTiler');
    assert.ok(source.urlTemplate.includes('key=abc123'));
    // XYZ placeholders survive key injection for the tile loader
    assert.ok(source.urlTemplate.includes('{z}/{x}/{y}'));
    assert.ok(source.attribution.includes('OpenStreetMap'));
    assert.ok(Number.isFinite(source.maxLevel));
  });

  it('URI-encodes the injected key', () => {
    const source = resolveBasemapSource({ keys: { maptiler: 'a&b=c' } });
    assert.ok(source.urlTemplate.includes('key=a%26b%3Dc'));
    assert.ok(!source.urlTemplate.includes('a&b=c'));
  });

  it('resolves every registered provider/style pair', () => {
    for (const provider of Object.keys(BASEMAP_PROVIDERS)) {
      for (const style of BASEMAP_STYLES) {
        const source = resolveBasemapSource({
          provider,
          style,
          keys: { [provider]: 'k' }
        });
        assert.ok(source, `${provider}/${style} should resolve`);
        assert.ok(
          !source.urlTemplate.includes('{key}'),
          `${provider}/${style} should have its key placeholder filled`
        );
      }
    }
  });

  it('falls back to OSM dev tiles without a key only when allowed', () => {
    const source = resolveBasemapSource({ keys: {}, allowDevFallback: true });
    assert.ok(source);
    assert.strictEqual(source.isDevFallback, true);
    assert.ok(source.urlTemplate.includes('tile.openstreetmap.org'));
    assert.ok(!source.urlTemplate.includes('{key}'));
  });

  it('resolves to nothing without a key when fallback is not allowed', () => {
    // The production path: no key must mean no layer, never OSMF traffic.
    assert.strictEqual(resolveBasemapSource({ keys: {} }), null);
    assert.strictEqual(
      resolveBasemapSource({ keys: { mapbox: 'k' }, provider: 'maptiler' }),
      null
    );
  });

  it('resolves to nothing for unknown providers and styles', () => {
    assert.strictEqual(
      resolveBasemapSource({ provider: 'nope', keys: { nope: 'k' } }),
      null
    );
    assert.strictEqual(
      resolveBasemapSource({ style: 'nope', keys: { maptiler: 'k' } }),
      null
    );
  });

  it('keeps defaults pointing at a registered pair', () => {
    assert.ok(BASEMAP_PROVIDERS[DEFAULT_BASEMAP_PROVIDER]);
    assert.ok(
      BASEMAP_PROVIDERS[DEFAULT_BASEMAP_PROVIDER].styles[DEFAULT_BASEMAP_STYLE]
    );
    assert.ok(BASEMAP_STYLES.includes(DEFAULT_BASEMAP_STYLE));
  });
});
