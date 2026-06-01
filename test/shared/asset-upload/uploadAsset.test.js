import { vi, describe, it, expect } from 'vitest';
import {
  getAssetKind,
  isAcceptedAssetFile,
  MAX_FILE_BYTES
} from '../../../src/shared/asset-upload/uploadAsset.js';

vi.mock('@shared/assets', () => ({
  assetsService: {
    events: { addEventListener: vi.fn(), removeEventListener: vi.fn() },
    addAsset: vi.fn(),
    getAsset: vi.fn()
  },
  ASSET_TYPES: { MESH: 'mesh', IMAGE: 'image' },
  ASSET_CATEGORIES: { UPLOAD: 'upload' }
}));

vi.mock('@shared/assets/state/currentUploadStore.js', () => ({
  default: {
    getState: vi.fn(() => ({
      isBusy: () => false,
      start: vi.fn(),
      getSignal: () => null,
      update: vi.fn(),
      clear: vi.fn(),
      clearIfNotAwaiting: vi.fn(),
      awaitArrival: vi.fn()
    }))
  }
}));

describe('getAssetKind', () => {
  it('returns glb for .glb files', () =>
    expect(getAssetKind({ name: 'model.glb' })).toBe('glb'));
  it('returns glb for .gltf files', () =>
    expect(getAssetKind({ name: 'scene.gltf' })).toBe('glb'));
  it('is case-insensitive', () =>
    expect(getAssetKind({ name: 'MODEL.GLB' })).toBe('glb'));
  it('recognizes all image extensions', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'avif']) {
      expect(getAssetKind({ name: `photo.${ext}` })).toBe('image');
    }
  });
  it('returns null for unsupported types', () => {
    expect(getAssetKind({ name: 'model.fbx' })).toBeNull();
    expect(getAssetKind({ name: 'document.pdf' })).toBeNull();
    expect(getAssetKind({ name: 'mesh.obj' })).toBeNull();
  });
});

describe('isAcceptedAssetFile', () => {
  it('accepts glb and image files', () => {
    expect(isAcceptedAssetFile({ name: 'model.glb' })).toBe(true);
    expect(isAcceptedAssetFile({ name: 'photo.png' })).toBe(true);
  });
  it('rejects unsupported extensions', () => {
    expect(isAcceptedAssetFile({ name: 'scene.fbx' })).toBe(false);
    expect(isAcceptedAssetFile({ name: 'data.json' })).toBe(false);
  });
});

describe('size cap', () => {
  // Single type-agnostic client ceiling = the top plan's per-file cap (MAX,
  // 5 GB, decimal). Per-plan caps (FREE/PRO) are soft-enforced server-side by
  // getUploadQuota (MAX_FILE_BYTES_BY_PLAN), not here.
  it('absolute per-file ceiling is 5 GB (decimal)', () =>
    expect(MAX_FILE_BYTES).toBe(5_000_000_000));
});
