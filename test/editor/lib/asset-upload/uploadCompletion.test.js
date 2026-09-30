import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auth } from '@shared/services/firebase.js';
import { assetsService } from '@shared/assets';
import { uploadAndPlaceAsset } from '@/editor/lib/asset-upload/uploadAndPlaceAsset.js';
import { groupMessage } from '@/editor/lib/groups/groupMessages.js';

// An upload finishes after the item it was placed as has left the scene (its
// creation undone, or deleted). The upload itself went through: the asset is in
// the user's library. The item must not come back, and the user must not be
// told the upload landed in the scene.

let streetContainer;
let executed;
let notify;
let finishUpload;

beforeEach(() => {
  streetContainer = document.createElement('a-entity');
  streetContainer.id = 'street-container';
  document.body.append(streetContainer);
  executed = [];

  // Placeholder creation as the editor does it: an element with an id, handed
  // to the caller's callback.
  const execute = vi.fn((type, payload, _name, callback) => {
    executed.push([type, payload]);
    if (type === 'entitycreate') {
      const el = document.createElement('a-entity');
      el.id = 'upload-placeholder';
      streetContainer.append(el);
      callback?.(el);
    }
  });
  notify = {
    successMessage: vi.fn(),
    errorMessage: vi.fn(),
    warningMessage: vi.fn(),
    infoMessage: vi.fn()
  };
  vi.stubGlobal('AFRAME', { INSPECTOR: { execute } });
  window.STREET = { notify };

  auth.currentUser = { uid: 'user-1' };
  vi.spyOn(assetsService, 'addAsset').mockImplementation(
    () =>
      new Promise((resolve) => {
        finishUpload = () => resolve('asset-1');
      })
  );
  vi.spyOn(assetsService, 'getAsset').mockResolvedValue({
    storageUrl: 'https://storage.example/asset-1.spz'
  });
});

afterEach(() => {
  streetContainer.remove();
  delete auth.currentUser;
  delete window.STREET;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function untilUploadStarts() {
  await vi.waitFor(() => {
    if (!finishUpload) throw new Error('upload not started');
  });
}

describe('an upload that finishes after its item has left the scene', () => {
  it('does not bring the item back, tells the user the asset is in the library, and shows no success toast (fails if completion writes to the stale element)', async () => {
    finishUpload = null;
    const file = new File(['splat bytes'], 'garden.spz');
    const pending = uploadAndPlaceAsset(file, '1 0 2');
    await untilUploadStarts();

    // The placeholder goes away while the bytes are still uploading.
    document.getElementById('upload-placeholder').remove();
    finishUpload();
    const result = await pending;

    expect(document.getElementById('upload-placeholder')).toBe(null);
    expect(executed.map(([type]) => type)).toEqual(['entitycreate']);
    expect(notify.successMessage).not.toHaveBeenCalled();
    expect(notify.infoMessage).toHaveBeenCalledWith(
      groupMessage('uploadFinishedItemGone')
    );
    expect(result).toEqual({ entity: null, assetId: 'asset-1', kind: 'splat' });
  });

  it('finishes on the element that now carries the id when the item was moved (replaced) meanwhile', async () => {
    finishUpload = null;
    const file = new File(['splat bytes'], 'garden.spz');
    const pending = uploadAndPlaceAsset(file, '1 0 2');
    await untilUploadStarts();

    // A move in the layer panel replaces the element and keeps the id.
    document.getElementById('upload-placeholder').remove();
    const moved = document.createElement('a-entity');
    moved.id = 'upload-placeholder';
    streetContainer.append(moved);
    finishUpload();
    const result = await pending;

    const [type, updates] = executed[1];
    expect(type).toBe('multi');
    expect(updates.map(([, payload]) => payload.entity)).toEqual([
      moved,
      moved,
      moved,
      moved
    ]);
    expect(notify.successMessage).toHaveBeenCalledWith('Uploaded garden.spz');
    expect(result.entity).toBe(moved);
  });
});
