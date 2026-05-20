import { describe, it, expect, beforeEach } from 'vitest';
import useCurrentUploadStore from '../../../src/shared/assets/state/currentUploadStore.js';
import assetsService from '../../../src/shared/assets/services/assetsService.js';

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

  describe('awaitArrival', () => {
    it('transitions to finishing when the asset has not yet been seen', () => {
      const { start, awaitArrival } = useCurrentUploadStore.getState();
      start({ filename: 'a.glb', sizeBytes: 1, kind: 'glb' });
      awaitArrival('unseen-asset-id');
      const { upload } = useCurrentUploadStore.getState();
      expect(upload).toMatchObject({
        status: 'finishing',
        progress: 100,
        awaitingAssetId: 'unseen-asset-id'
      });
    });

    it('resolves immediately when the target asset was just dispatched', () => {
      const { start, awaitArrival } = useCurrentUploadStore.getState();
      start({ filename: 'a.glb', sizeBytes: 1, kind: 'glb' });

      // Simulate assetsService dispatching assetAdded *during* the addAsset
      // call — the listener registered at module load sets the
      // lastAddedAssetId / lastAddedAt globals.
      assetsService.events.dispatchEvent(
        new CustomEvent('assetAdded', {
          detail: { assetId: 'just-added', userId: 'u1', asset: {} }
        })
      );

      awaitArrival('just-added');
      // Card is cleared instantly; we never enter 'finishing'.
      expect(useCurrentUploadStore.getState().upload).toBeNull();
    });

    it('is a no-op when no upload is active', () => {
      useCurrentUploadStore.getState().awaitArrival('whatever');
      expect(useCurrentUploadStore.getState().upload).toBeNull();
    });
  });

  describe('clearIfNotAwaiting', () => {
    it('clears in-flight (non-finishing) state', () => {
      const { start, clearIfNotAwaiting } = useCurrentUploadStore.getState();
      start({ filename: 'a.glb', sizeBytes: 1, kind: 'glb' });
      clearIfNotAwaiting();
      expect(useCurrentUploadStore.getState().upload).toBeNull();
    });

    it('preserves the card while in finishing state', () => {
      const { start, awaitArrival, clearIfNotAwaiting } =
        useCurrentUploadStore.getState();
      start({ filename: 'a.glb', sizeBytes: 1, kind: 'glb' });
      awaitArrival('pending-id');
      expect(useCurrentUploadStore.getState().upload.status).toBe('finishing');
      clearIfNotAwaiting();
      // Still up — the round-trip arrival listener owns the dismissal.
      expect(useCurrentUploadStore.getState().upload?.status).toBe('finishing');
    });

    it('is a no-op when no upload is active', () => {
      useCurrentUploadStore.getState().clearIfNotAwaiting();
      expect(useCurrentUploadStore.getState().upload).toBeNull();
    });
  });

  describe('assetAdded listener auto-clears the awaiting card', () => {
    it('clears upload when the awaited asset arrives', () => {
      const { start, awaitArrival } = useCurrentUploadStore.getState();
      start({ filename: 'a.glb', sizeBytes: 1, kind: 'glb' });
      awaitArrival('ignored-test-target');
      expect(useCurrentUploadStore.getState().upload?.status).toBe('finishing');

      assetsService.events.dispatchEvent(
        new CustomEvent('assetAdded', {
          detail: { assetId: 'ignored-test-target', userId: 'u1', asset: {} }
        })
      );

      expect(useCurrentUploadStore.getState().upload).toBeNull();
    });

    it('ignores arrivals for a different asset id', () => {
      const { start, awaitArrival } = useCurrentUploadStore.getState();
      start({ filename: 'a.glb', sizeBytes: 1, kind: 'glb' });
      // Use a fresh id so the module-level lastAddedAssetId from prior tests
      // can't accidentally satisfy the awaitArrival fast-path.
      const targetId = `target-${Math.random()}`;
      const otherId = `other-${Math.random()}`;
      awaitArrival(targetId);

      assetsService.events.dispatchEvent(
        new CustomEvent('assetAdded', {
          detail: { assetId: otherId, userId: 'u1', asset: {} }
        })
      );

      expect(useCurrentUploadStore.getState().upload?.status).toBe('finishing');
      expect(useCurrentUploadStore.getState().upload?.awaitingAssetId).toBe(
        targetId
      );
    });
  });
});
