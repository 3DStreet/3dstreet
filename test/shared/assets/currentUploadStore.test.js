import { describe, it, expect, beforeEach } from 'vitest';
import useCurrentUploadStore from '../../../src/shared/assets/state/currentUploadStore.js';

// Reset between tests — the store is a module-level singleton.
beforeEach(() => {
  useCurrentUploadStore.getState().clear();
});

describe('currentUploadStore', () => {
  describe('isBusy / start / clear', () => {
    it('isBusy is false initially', () => {
      expect(useCurrentUploadStore.getState().isBusy()).toBe(false);
    });

    it('start() populates upload and flips isBusy', () => {
      const { start, isBusy } = useCurrentUploadStore.getState();
      start({ filename: 'a.glb', sizeBytes: 1234, kind: 'glb' });
      expect(isBusy()).toBe(true);
      const { upload } = useCurrentUploadStore.getState();
      expect(upload).toMatchObject({
        status: 'validating',
        progress: 0,
        filename: 'a.glb',
        sizeBytes: 1234,
        kind: 'glb',
        awaitingAssetId: null
      });
    });

    it('clear() wipes upload state', () => {
      const { start, clear } = useCurrentUploadStore.getState();
      start({ filename: 'a.glb', sizeBytes: 1, kind: 'glb' });
      clear();
      expect(useCurrentUploadStore.getState().upload).toBeNull();
      expect(useCurrentUploadStore.getState().isBusy()).toBe(false);
    });

    it('update() merges partial state', () => {
      const { start, update } = useCurrentUploadStore.getState();
      start({ filename: 'a.glb', sizeBytes: 1, kind: 'glb' });
      update({ status: 'uploading', progress: 42 });
      const { upload } = useCurrentUploadStore.getState();
      expect(upload.status).toBe('uploading');
      expect(upload.progress).toBe(42);
      // unrelated fields preserved
      expect(upload.filename).toBe('a.glb');
    });

    it('update() is a no-op when no upload is active', () => {
      useCurrentUploadStore.getState().update({ progress: 99 });
      expect(useCurrentUploadStore.getState().upload).toBeNull();
    });
  });

  describe('getSignal / cancel', () => {
    it('getSignal returns null when no upload is active', () => {
      expect(useCurrentUploadStore.getState().getSignal()).toBeNull();
    });

    it('getSignal returns an unaborted AbortSignal after start()', () => {
      useCurrentUploadStore
        .getState()
        .start({ filename: 'a.glb', sizeBytes: 1, kind: 'glb' });
      const signal = useCurrentUploadStore.getState().getSignal();
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    });

    it('cancel() aborts the signal and clears upload', () => {
      useCurrentUploadStore
        .getState()
        .start({ filename: 'a.glb', sizeBytes: 1, kind: 'glb' });
      const signal = useCurrentUploadStore.getState().getSignal();
      useCurrentUploadStore.getState().cancel();
      expect(signal.aborted).toBe(true);
      expect(useCurrentUploadStore.getState().upload).toBeNull();
    });
  });

  describe('markAwaiting', () => {
    it('transitions to finishing and stashes the asset id', () => {
      const { start, markAwaiting } = useCurrentUploadStore.getState();
      start({ filename: 'a.glb', sizeBytes: 1, kind: 'glb' });
      markAwaiting('new-asset-id');
      const { upload } = useCurrentUploadStore.getState();
      expect(upload).toMatchObject({
        status: 'finishing',
        progress: 100,
        awaitingAssetId: 'new-asset-id'
      });
    });

    it('preserves unrelated upload fields', () => {
      const { start, markAwaiting } = useCurrentUploadStore.getState();
      start({ filename: 'a.glb', sizeBytes: 4242, kind: 'glb' });
      markAwaiting('new-asset-id');
      const { upload } = useCurrentUploadStore.getState();
      expect(upload.filename).toBe('a.glb');
      expect(upload.sizeBytes).toBe(4242);
      expect(upload.kind).toBe('glb');
    });

    it('is a no-op when no upload is active', () => {
      useCurrentUploadStore.getState().markAwaiting('whatever');
      expect(useCurrentUploadStore.getState().upload).toBeNull();
    });
  });
});
