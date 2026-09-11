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

  it('attempts capture regardless of size', () => {
    // No size bail-out: a large GLB gets the same iframe as a small one.
    captureGlbThumbnail(fakeGlb(113 * 1000 * 1000));
    expect(document.querySelector('iframe')).not.toBeNull();
  });

  it('posts the Blob itself, never a blob: URL', () => {
    // The URL hop is what failed under memory pressure ("TypeError: Failed
    // to fetch"), so the payload shape is the fix and worth pinning.
    const createObjectURL = vi.fn(() => 'blob:should-not-be-used');
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL: vi.fn() });
    const glb = fakeGlb(1024);
    captureGlbThumbnail(glb);
    const iframe = document.querySelector('iframe');
    const postMessage = vi.fn();
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage },
      configurable: true
    });
    window.dispatchEvent(
      new MessageEvent('message', {
        source: iframe.contentWindow,
        data: { type: '3dstreet:screenshot-ready' }
      })
    );
    expect(postMessage).toHaveBeenCalledWith(
      { type: '3dstreet:load-blob', blob: glb },
      '*'
    );
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});
