/**
 * "Copy to my library" is the non-owner path to an asset they can optimize
 * and keep: it must show only for a signed-in viewer who does not own the
 * asset, and hand the source doc to copyAssetToLibrary.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const OWNER = 'user-owner';
const VIEWER = 'user-viewer';

const ASSET = {
  assetId: 'asset-a',
  userId: OWNER,
  type: 'mesh',
  name: 'Asset A',
  size: 10_000_000,
  storageUrl: 'https://example.test/a.glb',
  filename: 'a.glb',
  originalFilename: 'a.glb'
};

const authState = { currentUser: { uid: VIEWER } };
vi.mock('@shared/services/firebase.js', () => ({
  auth: authState,
  functions: {}
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async () => ({ data: {} })
}));
vi.mock('../../../src/shared/assets/services/assetsService.js', () => ({
  default: {
    getAsset: async () => ASSET,
    getAssetJobs: async () => [],
    updateAsset: vi.fn(),
    events: { addEventListener: vi.fn(), removeEventListener: vi.fn() }
  }
}));

const COPY_DOC = {
  assetId: 'new',
  userId: VIEWER,
  storageUrl: 'https://example.test/new.glb'
};
const copyAssetToLibrary = vi.fn(async () => ({
  ok: true,
  assetId: 'new',
  ownerUid: VIEWER,
  asset: COPY_DOC
}));
vi.mock('@shared/asset-upload', () => ({
  copyAssetToLibrary: (...a) => copyAssetToLibrary(...a),
  reoptimizeAsset: vi.fn(),
  removeOptimizedVariant: vi.fn()
}));

const { _resetCopyRuns } =
  await import('../../../src/shared/assets/copyRuns.js');
const { default: MeshDetailsModal } =
  await import('../../../src/shared/assets/components/MeshDetailsModal.jsx');

function renderModal(extra = {}) {
  return render(
    <MeshDetailsModal
      assetId={ASSET.assetId}
      ownerUid={OWNER}
      onClose={() => {}}
      {...extra}
    />
  );
}

describe('MeshDetailsModal — copy to my library', () => {
  afterEach(() => {
    vi.clearAllMocks();
    _resetCopyRuns();
    authState.currentUser = { uid: VIEWER };
  });

  it('shows a finished copy again when the modal is reopened', async () => {
    const { unmount } = renderModal();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Copy to my library' })
    );
    await screen.findByText(/Copied to your library/);
    unmount();
    renderModal();
    await screen.findByText(/Copied to your library/);
  });

  it('offers the copy to a signed-in non-owner and calls copyAssetToLibrary with the doc', async () => {
    renderModal();
    const button = await screen.findByRole('button', {
      name: 'Copy to my library'
    });
    fireEvent.click(button);
    await waitFor(() => expect(copyAssetToLibrary).toHaveBeenCalledTimes(1));
    expect(copyAssetToLibrary.mock.calls[0][0]).toMatchObject({
      assetId: ASSET.assetId,
      userId: OWNER
    });
    await screen.findByText(/Copied to your library/);
  });

  it('hands the new doc to onCopied and says the scene now uses the copy', async () => {
    const onCopied = vi.fn(() => 2);
    renderModal({ onCopied });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Copy to my library' })
    );
    await waitFor(() => expect(onCopied).toHaveBeenCalledWith(COPY_DOC));
    await screen.findByText(/This scene now uses your copy/);
  });

  it('surfaces a failed copy as an error line', async () => {
    copyAssetToLibrary.mockResolvedValueOnce({
      ok: false,
      error: 'Storage full'
    });
    renderModal();
    fireEvent.click(
      await screen.findByRole('button', { name: 'Copy to my library' })
    );
    await screen.findByText('Storage full');
  });

  it('does not offer the copy to the owner', async () => {
    authState.currentUser = { uid: OWNER };
    renderModal();
    await screen.findByText(ASSET.assetId);
    expect(
      screen.queryByRole('button', { name: 'Copy to my library' })
    ).toBeNull();
  });

  it('does not offer the copy when signed out', async () => {
    authState.currentUser = null;
    renderModal();
    await screen.findByText(ASSET.assetId);
    expect(
      screen.queryByRole('button', { name: 'Copy to my library' })
    ).toBeNull();
  });
});
