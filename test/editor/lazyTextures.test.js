import { describe, it, expect, vi } from 'vitest';
import {
  getAssetImageSrc,
  startAssetImageLoad,
  isImageReady,
  waitForImage,
  installLazyTextureSource
} from '@/lazy-textures';

// jsdom never fetches images: `complete` is true and naturalWidth 0 until a
// test fires the events itself, so "ready" is simulated by patching the
// natural size.
function lazyImg(id, url) {
  const img = document.createElement('img');
  img.id = id;
  img.setAttribute('data-src', url);
  img.setAttribute('crossorigin', 'anonymous');
  return img;
}

function markLoaded(img) {
  Object.defineProperty(img, 'complete', { value: true, configurable: true });
  Object.defineProperty(img, 'naturalWidth', {
    value: 512,
    configurable: true
  });
  img.dispatchEvent(new Event('load'));
}

function markPending(img) {
  Object.defineProperty(img, 'complete', { value: false, configurable: true });
  Object.defineProperty(img, 'naturalWidth', { value: 0, configurable: true });
}

// Minimal stand-in for A-Frame's material system: the real one resolves an
// <img> source synchronously from loadTextureSource.
class FakeMaterialSystem {
  constructor() {
    this.sourceCache = {};
    this.el = { emit: vi.fn() };
  }
  hash(src) {
    return src.id || src.src || src;
  }
  loadTextureSource(src, cb) {
    cb({ original: true, data: src });
  }
}
class FakeSource {
  constructor(data) {
    this.data = data;
  }
}

describe('lazy texture helpers', () => {
  it('getAssetImageSrc prefers src, falls back to data-src', () => {
    const img = lazyImg('t', 'https://cdn/t.jpg');
    expect(getAssetImageSrc(img)).toBe('https://cdn/t.jpg');
    img.setAttribute('src', 'https://cdn/other.jpg');
    expect(getAssetImageSrc(img)).toBe('https://cdn/other.jpg');
    expect(getAssetImageSrc(null)).toBeNull();
    expect(getAssetImageSrc(document.createElement('img'))).toBeNull();
  });

  it('startAssetImageLoad copies data-src to src once', () => {
    const img = lazyImg('t', 'https://cdn/t.jpg');
    startAssetImageLoad(img);
    expect(img.getAttribute('src')).toBe('https://cdn/t.jpg');
    img.setAttribute('data-src', 'https://cdn/changed.jpg');
    startAssetImageLoad(img);
    expect(img.getAttribute('src')).toBe('https://cdn/t.jpg');
    expect(startAssetImageLoad(null)).toBeNull();
  });

  it('waitForImage resolves on load and rejects on error', async () => {
    const img = lazyImg('t', 'https://cdn/t.jpg');
    startAssetImageLoad(img);
    markPending(img);
    const p = waitForImage(img);
    markLoaded(img);
    await expect(p).resolves.toBe(img);
    expect(isImageReady(img)).toBe(true);

    const bad = lazyImg('bad', 'https://cdn/bad.jpg');
    startAssetImageLoad(bad);
    markPending(bad);
    const pb = waitForImage(bad);
    bad.dispatchEvent(new Event('error'));
    await expect(pb).rejects.toThrow(/bad\.jpg/);
  });
});

describe('installLazyTextureSource', () => {
  it('is idempotent and returns false without a class', () => {
    expect(installLazyTextureSource(undefined, FakeSource)).toBe(false);
    class S extends FakeMaterialSystem {}
    expect(installLazyTextureSource(S, FakeSource)).toBe(true);
    expect(installLazyTextureSource(S, FakeSource)).toBe(false);
  });

  it('starts a lazy image, waits for it, caches by id and emits scene events', async () => {
    class S extends FakeMaterialSystem {}
    installLazyTextureSource(S, FakeSource);
    const system = new S();
    const img = lazyImg('seamless-road', 'https://cdn/road.jpg');
    document.body.appendChild(img);
    // Simulate the browser: setting src starts a fetch that is not complete.
    markPending(img);

    const cb1 = vi.fn();
    const cb2 = vi.fn();
    system.loadTextureSource(img, cb1);
    system.loadTextureSource(img, cb2);
    expect(img.getAttribute('src')).toBe('https://cdn/road.jpg');
    expect(cb1).not.toHaveBeenCalled();
    expect(Object.keys(system.sourceCache)).toEqual(['seamless-road']);
    expect(system.el.emit).toHaveBeenCalledWith(
      'texture-loading',
      { id: 'seamless-road', src: 'https://cdn/road.jpg' },
      false
    );

    markLoaded(img);
    await Promise.resolve();
    await Promise.resolve();
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);
    const source = cb1.mock.calls[0][0];
    expect(source).toBeInstanceOf(FakeSource);
    expect(source.data).toBe(img);
    expect(cb2.mock.calls[0][0]).toBe(source);
    expect(system.el.emit).toHaveBeenLastCalledWith(
      'texture-loaded',
      { id: 'seamless-road', src: 'https://cdn/road.jpg' },
      false
    );
    img.remove();
  });

  it('delegates ready images and non-image sources to the original path', () => {
    class S extends FakeMaterialSystem {}
    installLazyTextureSource(S, FakeSource);
    const system = new S();
    const img = lazyImg('ready', 'https://cdn/ready.jpg');
    startAssetImageLoad(img);
    markLoaded(img);
    const cb = vi.fn();
    system.loadTextureSource(img, cb);
    expect(cb).toHaveBeenCalledWith({ original: true, data: img });

    const cbUrl = vi.fn();
    system.loadTextureSource('https://cdn/plain.jpg', cbUrl);
    expect(cbUrl).toHaveBeenCalledWith({
      original: true,
      data: 'https://cdn/plain.jpg'
    });
  });

  it('calls back null and emits texture-error when the image fails', async () => {
    class S extends FakeMaterialSystem {}
    installLazyTextureSource(S, FakeSource);
    const system = new S();
    const img = lazyImg('broken', 'https://cdn/404.jpg');
    markPending(img);
    const cb = vi.fn();
    system.loadTextureSource(img, cb);
    img.dispatchEvent(new Event('error'));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(cb).toHaveBeenCalledWith(null);
    expect(system.el.emit).toHaveBeenLastCalledWith(
      'texture-error',
      { id: 'broken', src: 'https://cdn/404.jpg' },
      false
    );
    // The failure is not cached: the next reference tries again.
    expect(system.sourceCache[system.hash(img)]).toBeUndefined();
    const cb2 = vi.fn();
    system.loadTextureSource(img, cb2);
    expect(system.el.emit).toHaveBeenLastCalledWith(
      'texture-loading',
      { id: 'broken', src: 'https://cdn/404.jpg' },
      false
    );
  });
});
