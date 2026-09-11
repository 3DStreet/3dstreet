import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reoptimizeAsset } from '../../../src/shared/asset-upload/reoptimizeAsset.js';

const uploadToStorage = vi.fn();
const updateAsset = vi.fn();
const getStoragePath = vi.fn(
  (uid, type, filename) => `users/${uid}/assets/meshes/${filename}`
);

vi.mock('@shared/assets', () => ({
  assetsService: {
    uploadToStorage: (...args) => uploadToStorage(...args),
    updateAsset: (...args) => updateAsset(...args),
    getStoragePath: (...args) => getStoragePath(...args)
  }
}));

const optimizeGlb = vi.fn();
vi.mock('../../../src/shared/asset-upload/optimizeGlb.js', () => ({
  optimizeGlb: (...args) => optimizeGlb(...args)
}));

const ASSET = {
  assetId: 'asset-1',
  userId: 'user-abc',
  type: 'mesh',
  size: 10_000,
  storageUrl: 'https://example.test/original.glb',
  optimizedSourcePath: 'users/user-abc/assets/meshes/asset-1-optimized.glb',
  optimizedSourceSize: 5_000
};

function optimizedBlob(size) {
  const blob = new Blob(['x'], { type: 'model/gltf-binary' });
  Object.defineProperty(blob, 'size', { value: size });
  return blob;
}

describe('reoptimizeAsset', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob(['original'])
      }))
    );
    uploadToStorage.mockResolvedValue('https://example.test/opt-new.glb');
    updateAsset.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('uploads to a NEW path so the doc swap is atomic and the old file orphans', async () => {
    optimizeGlb.mockResolvedValue({
      blob: optimizedBlob(3_000),
      metadata: { optimizationSkipped: false }
    });

    const result = await reoptimizeAsset(ASSET);

    expect(result.ok).toBe(true);
    const [, newPath] = uploadToStorage.mock.calls[0];
    expect(newPath).not.toBe(ASSET.optimizedSourcePath);
    expect(newPath).toMatch(/^users\/user-abc\/assets\/meshes\/.*\.glb$/);
    // The previous object is reported so callers can reason about what the
    // orphan GC will reclaim; nothing deletes it client-side.
    expect(result.previousPath).toBe(ASSET.optimizedSourcePath);
  });

  it('tags the upload as a platform artifact, like addAsset does', async () => {
    optimizeGlb.mockResolvedValue({
      blob: optimizedBlob(3_000),
      metadata: { optimizationSkipped: false }
    });
    await reoptimizeAsset(ASSET);
    expect(uploadToStorage.mock.calls[0][4]).toEqual({
      assetRole: 'optimized',
      assetId: 'asset-1'
    });
  });

  it('repoints all three optimized fields on the doc', async () => {
    optimizeGlb.mockResolvedValue({
      blob: optimizedBlob(3_000),
      metadata: { optimizationSkipped: false, inputBytes: 10_000 }
    });
    await reoptimizeAsset(ASSET);
    const [assetId, uid, updates] = updateAsset.mock.calls[0];
    expect(assetId).toBe('asset-1');
    expect(uid).toBe('user-abc');
    expect(updates.optimizedSourceUrl).toBe('https://example.test/opt-new.glb');
    expect(updates.optimizedSourceSize).toBe(3_000);
    expect(updates.optimizedSourcePath).toBe(uploadToStorage.mock.calls[0][1]);
    // The original is never touched — it is the quota-counted file.
    expect(updates).not.toHaveProperty('storagePath');
    expect(updates).not.toHaveProperty('size');
  });

  it('leaves the asset alone when the pipeline skipped', async () => {
    optimizeGlb.mockResolvedValue({
      blob: optimizedBlob(9_000),
      metadata: { optimizationSkipped: true, reason: 'timeout' }
    });
    const result = await reoptimizeAsset(ASSET);
    expect(result).toMatchObject({ ok: false, reason: 'timeout' });
    expect(uploadToStorage).not.toHaveBeenCalled();
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it('refuses a result that is not smaller than the variant already served', async () => {
    optimizeGlb.mockResolvedValue({
      blob: optimizedBlob(5_000), // equal to optimizedSourceSize
      metadata: { optimizationSkipped: false }
    });
    const result = await reoptimizeAsset(ASSET);
    expect(result).toMatchObject({
      ok: false,
      reason: 'not_smaller_than_current',
      bytesBefore: 5_000,
      bytesAfter: 5_000
    });
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it('accepts any win for an asset that has no optimized variant yet', async () => {
    // The case that matters most: optimization was skipped at upload time, so
    // the asset has been serving the raw original ever since.
    optimizeGlb.mockResolvedValue({
      blob: optimizedBlob(8_000),
      metadata: { optimizationSkipped: false }
    });
    const bare = {
      ...ASSET,
      optimizedSourcePath: undefined,
      optimizedSourceSize: undefined
    };
    const result = await reoptimizeAsset(bare);
    expect(result.ok).toBe(true);
    expect(result.previousPath).toBeNull();
    expect(result.bytesBefore).toBe(10_000); // falls back to the original size
  });

  it('reports stages so the UI can show progress', async () => {
    optimizeGlb.mockResolvedValue({
      blob: optimizedBlob(3_000),
      metadata: { optimizationSkipped: false }
    });
    const stages = [];
    await reoptimizeAsset(ASSET, { onStatus: (s) => stages.push(s) });
    expect(stages).toEqual(['downloading', 'optimizing', 'uploading']);
  });

  it('throws when the original cannot be downloaded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, statusText: 'Not Found' }))
    );
    await expect(reoptimizeAsset(ASSET)).rejects.toThrow(
      'Could not download the original.'
    );
    await expect(reoptimizeAsset(ASSET)).rejects.toHaveProperty(
      'cause.message',
      'HTTP 404 Not Found'
    );
    expect(updateAsset).not.toHaveBeenCalled();
  });

  it('reports a blocked read plainly, keeping the detail in `cause`', async () => {
    // What a missing bucket CORS config looks like from JS: the GET returns
    // 200 but fetch() rejects opaquely.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      })
    );
    // The user-facing sentence stays plain; the cause carries the detail.
    await expect(reoptimizeAsset(ASSET)).rejects.toThrow(
      'Could not download the original.'
    );
    await expect(reoptimizeAsset(ASSET)).rejects.toHaveProperty(
      'cause.message',
      'Failed to fetch'
    );
  });

  it('propagates an abort instead of blaming CORS', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      })
    );
    await expect(reoptimizeAsset(ASSET)).rejects.toThrow('aborted');
  });

  it('requires an identifiable asset', async () => {
    await expect(reoptimizeAsset({ storageUrl: 'x' })).rejects.toThrow(
      'assetId'
    );
  });
});
