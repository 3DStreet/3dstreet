import { vi, describe, it, expect, afterEach } from 'vitest';
import { captureGlbThumbnail } from '../../../src/shared/asset-upload/captureThumbnail.js';

vi.mock('@shared/assets', () => ({
  assetsService: { uploadToStorage: vi.fn(), updateAsset: vi.fn() },
  STORAGE_PATHS: { assetFile: vi.fn() }
}));

function fakeGlb(size) {
  const blob = new Blob([new Uint8Array(8)], { type: 'model/gltf-binary' });
  Object.defineProperty(blob, 'size', { value: size });
  return blob;
}

/**
 * Start a capture against a stubbed iframe. Every test must drive the
 * returned promise to settlement (`send` a screenshot-blob or -error),
 * otherwise the 5s ready timer and 15s capture timer outlive the test and
 * reject with nobody listening.
 */
function startCapture(glbBlob) {
  const promise = captureGlbThumbnail(glbBlob);
  const iframe = document.querySelector('iframe');
  const postMessage = vi.fn();
  Object.defineProperty(iframe, 'contentWindow', {
    value: { postMessage },
    configurable: true
  });
  const send = (data) =>
    window.dispatchEvent(
      new MessageEvent('message', { source: iframe.contentWindow, data })
    );
  return { promise, iframe, postMessage, send };
}

describe('captureGlbThumbnail', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('rejects non-Blob input', async () => {
    await expect(captureGlbThumbnail('not-a-blob')).rejects.toThrow(
      'expected Blob'
    );
  });

  it('resolves with the captured JPEG and tears the iframe down', async () => {
    const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });
    const { promise, iframe, send } = startCapture(fakeGlb(1024));
    send({ type: '3dstreet:screenshot-ready' });
    send({ type: '3dstreet:screenshot-blob', blob: jpeg });
    await expect(promise).resolves.toBe(jpeg);
    expect(iframe.parentNode).toBeNull();
  });

  it('rejects when the iframe reports an error', async () => {
    const { promise, send } = startCapture(fakeGlb(1024));
    send({ type: '3dstreet:screenshot-ready' });
    send({ type: '3dstreet:screenshot-error', error: 'model load failed' });
    await expect(promise).rejects.toThrow('model load failed');
  });

  it('attempts capture regardless of size', async () => {
    // No size bail-out: a large GLB gets the same iframe as a small one.
    const jpeg = new Blob(['jpeg'], { type: 'image/jpeg' });
    const { promise, iframe, send } = startCapture(fakeGlb(113 * 1000 * 1000));
    expect(iframe).not.toBeNull();
    send({ type: '3dstreet:screenshot-ready' });
    send({ type: '3dstreet:screenshot-blob', blob: jpeg });
    await promise;
  });

  it('posts the Blob itself, never a blob: URL', async () => {
    // The URL hop is what failed under memory pressure ("TypeError: Failed
    // to fetch"), so the payload shape is the fix and worth pinning.
    const createObjectURL = vi.fn(() => 'blob:should-not-be-used');
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const glb = fakeGlb(1024);
    const { promise, postMessage, send } = startCapture(glb);
    send({ type: '3dstreet:screenshot-ready' });
    expect(postMessage).toHaveBeenCalledWith(
      { type: '3dstreet:load-blob', blob: glb },
      '*'
    );
    expect(createObjectURL).not.toHaveBeenCalled();
    send({
      type: '3dstreet:screenshot-blob',
      blob: new Blob(['jpeg'], { type: 'image/jpeg' })
    });
    await promise;
  });
});
