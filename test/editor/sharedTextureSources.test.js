// Unit tests for src/sharedTextureSources.js — the refcounted registry that backs
// batch-models' cross-model texture Source dedup. The module references the `ImageBitmap`
// global (instanceof check in acquireSharedSource); jsdom does not implement it, so we install
// a minimal stub whose .close() we can assert on.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  acquireSharedSource,
  releaseSharedSource,
  sharedSourceKey
} from '../../src/sharedTextureSources.js';
import { disposeNode } from '../../src/disposeUtils.js';

class FakeImageBitmap {
  closed = false;
  close() {
    this.closed = true;
  }
}

// A THREE.Source-like object: just needs a `.data` holding the (fake) ImageBitmap.
const makeSource = () => ({ data: new FakeImageBitmap() });

beforeEach(() => {
  globalThis.ImageBitmap = FakeImageBitmap;
});
afterEach(() => {
  delete globalThis.ImageBitmap;
});

describe('sharedTextureSources', () => {
  it('registers the first source as canonical and tags its bitmap', () => {
    const registry = new Map();
    const a = makeSource();
    const canonical = acquireSharedSource(registry, 'h1', a);

    expect(canonical).toBe(a);
    expect(registry.get('h1').refCount).toBe(1);
    expect(a.data._sharedSource).toBe(true);
    expect(a.data._sharedEntry).toBe(registry.get('h1'));
  });

  it('returns the canonical source for subsequent acquires of the same hash', () => {
    const registry = new Map();
    const a = makeSource();
    const b = makeSource();
    acquireSharedSource(registry, 'h1', a);
    const canonical = acquireSharedSource(registry, 'h1', b);

    expect(canonical).toBe(a); // first one wins
    expect(canonical).not.toBe(b);
    expect(registry.get('h1').refCount).toBe(2);
  });

  it('closes the bitmap only when the final reference is released', () => {
    const registry = new Map();
    const a = makeSource();
    const b = makeSource();
    acquireSharedSource(registry, 'h1', a); // refCount 1
    acquireSharedSource(registry, 'h1', b); // refCount 2

    // First release: still shared, must not close, entry stays.
    expect(releaseSharedSource(a.data)).toBe(true);
    expect(a.data.closed).toBe(false);
    expect(registry.has('h1')).toBe(true);
    expect(registry.get('h1').refCount).toBe(1);

    // Second (final) release: closes the canonical bitmap, drops entry + tags.
    expect(releaseSharedSource(a.data)).toBe(true);
    expect(a.data.closed).toBe(true);
    expect(registry.has('h1')).toBe(false);
    expect(a.data._sharedSource).toBeUndefined();
  });

  it('re-registers a fresh canonical after the hash was fully released', () => {
    const registry = new Map();
    const a = makeSource();
    acquireSharedSource(registry, 'h1', a);
    releaseSharedSource(a.data); // fully released, entry removed

    const c = makeSource();
    const canonical = acquireSharedSource(registry, 'h1', c);
    expect(canonical).toBe(c); // a is gone from the registry, c becomes the new canonical
    expect(registry.get('h1').refCount).toBe(1);
  });

  it('returns false for a non-shared image so the caller closes it itself', () => {
    const plain = new FakeImageBitmap();
    expect(releaseSharedSource(plain)).toBe(false);
    expect(plain.closed).toBe(false);
  });

  it('isolates counts per hash', () => {
    const registry = new Map();
    const a = makeSource();
    const b = makeSource();
    acquireSharedSource(registry, 'h1', a);
    acquireSharedSource(registry, 'h2', b);

    releaseSharedSource(a.data);
    expect(a.data.closed).toBe(true);
    expect(b.data.closed).toBe(false);
    expect(registry.has('h1')).toBe(false);
    expect(registry.has('h2')).toBe(true);
  });
});

describe('sharedSourceKey', () => {
  it('uses the server imageHash when present (cross-GLB dedup)', () => {
    const source = { uuid: 's1', data: new FakeImageBitmap() };
    expect(sharedSourceKey(source, 'webp:abcdef')).toBe('webp:abcdef');
  });

  it('synthesizes a per-Source key for a non-hashed ImageBitmap', () => {
    const source = { uuid: 's1', data: new FakeImageBitmap() };
    expect(sharedSourceKey(source, undefined)).toBe('uuid:s1');
  });

  it('returns null for a non-hashed source with no ImageBitmap (e.g. compressed)', () => {
    expect(sharedSourceKey({ uuid: 's1', data: {} }, undefined)).toBeNull();
    expect(sharedSourceKey({ uuid: 's1', data: null }, undefined)).toBeNull();
  });
});

// Regression for the "washed clone" bug: a non-hashed texture Source shared by a clone must
// survive the pristine template's disposal (newScene) and be closed only when its LAST reference
// is disposed. Before non-hashed sources were refcounted (sharedSourceKey), the template's
// disposeNode closed the ImageBitmap out from under the live clone → white material.
describe('non-hashed shared Source survives clone/template disposal', () => {
  // A minimal mesh whose single material holds one texture pointing at `source`.
  const meshWithTextureSource = (source) => ({
    isMesh: true,
    geometry: { dispose() {}, userData: {} },
    material: {
      map: { isTexture: true, source, dispose() {} },
      dispose() {},
      userData: {}
    },
    userData: {}
  });

  it('closes the decoded bitmap only at the last reference', () => {
    const registry = new Map();
    const bitmap = new FakeImageBitmap();
    const source = { uuid: 's1', data: bitmap };

    // loadImageSource: register the non-hashed Source (the fix).
    const key = sharedSourceKey(source, undefined);
    expect(key).toBe('uuid:s1');
    acquireSharedSource(registry, key, source); // template holds ref 1
    source._sharedSourceHash = key;

    // cloneGltfScene: an instance clones the texture, sharing the SAME Source, and re-acquires.
    acquireSharedSource(registry, source._sharedSourceHash, source); // clone -> ref 2
    expect(registry.get(key).refCount).toBe(2);

    // Pristine template disposed on newScene: must NOT close the shared bitmap.
    disposeNode(meshWithTextureSource(source));
    expect(bitmap.closed).toBe(false);
    expect(registry.get(key).refCount).toBe(1);

    // The clone is finally removed: last reference gone -> bitmap closed, entry dropped.
    disposeNode(meshWithTextureSource(source));
    expect(bitmap.closed).toBe(true);
    expect(registry.has(key)).toBe(false);
  });
});
