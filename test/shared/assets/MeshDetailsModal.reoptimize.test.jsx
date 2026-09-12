/**
 * Regression guard for the cross-asset navigation race in the Reoptimize
 * action: a run started on asset A must not write A's optimization stats,
 * progress or outcome onto asset B when the user navigates mid-run — while
 * still running to completion, because the download/optimize/upload is
 * expensive and A's doc update is worth having either way.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';

const OWNER = 'user-abc';

const ASSET_A = {
  assetId: 'asset-a',
  userId: OWNER,
  type: 'mesh',
  name: 'Asset A',
  size: 10_000_000,
  storageUrl: 'https://example.test/a.glb',
  filename: 'a.glb',
  originalFilename: 'a.glb',
  optimizationMetadata: { optimizationSkipped: true, reason: 'timeout' }
};
const ASSET_B = {
  ...ASSET_A,
  assetId: 'asset-b',
  name: 'Asset B',
  size: 2_000_000,
  storageUrl: 'https://example.test/b.glb'
};

vi.mock('@shared/services/firebase.js', () => ({
  auth: { currentUser: { uid: OWNER } },
  functions: {}
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async () => ({ data: {} })
}));

const getAsset = vi.fn(async (assetId) =>
  assetId === ASSET_A.assetId ? ASSET_A : ASSET_B
);
vi.mock('../../../src/shared/assets/services/assetsService.js', () => ({
  default: {
    getAsset: (...a) => getAsset(...a),
    getAssetJobs: async () => [],
    updateAsset: vi.fn(),
    events: { addEventListener: vi.fn(), removeEventListener: vi.fn() }
  }
}));

let reoptimizeCalls = [];
const reoptimizeAsset = vi.fn((asset, opts) => {
  let resolveRun;
  const promise = new Promise((resolve) => (resolveRun = resolve));
  reoptimizeCalls.push({ asset, opts, resolveRun });
  return promise;
});
const removeOptimizedVariant = vi.fn(async () => ({ previousPath: null }));
vi.mock('@shared/asset-upload', () => ({
  reoptimizeAsset: (...a) => reoptimizeAsset(...a),
  removeOptimizedVariant: (...a) => removeOptimizedVariant(...a)
}));

const { _resetReoptimizeRuns } =
  await import('../../../src/shared/assets/reoptimizeRuns.js');

const { default: MeshDetailsModal } =
  await import('../../../src/shared/assets/components/MeshDetailsModal.jsx');

const RESULT_A = {
  ok: true,
  newUrl: 'https://example.test/a-opt.glb',
  newPath: `users/${OWNER}/assets/meshes/a-optimized-2.glb`,
  bytesAfter: 1_000,
  bytesBefore: 10_000_000,
  metadata: { optimizationSkipped: false }
};

function renderModal(assetId) {
  return render(
    <MeshDetailsModal assetId={assetId} ownerUid={OWNER} onClose={() => {}} />
  );
}

describe('MeshDetailsModal — reoptimize across asset navigation', () => {
  beforeEach(() => {
    reoptimizeCalls = [];
    _resetReoptimizeRuns();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('keeps running after the user navigates away, without touching the new asset', async () => {
    const { rerender } = renderModal(ASSET_A.assetId);
    const button = await screen.findByRole('button', {
      name: /retry optimization/i
    });

    await act(async () => {
      button.click();
    });
    await waitFor(() => expect(reoptimizeCalls).toHaveLength(1));
    const run = reoptimizeCalls[0];
    expect(run.asset.assetId).toBe(ASSET_A.assetId);
    // The work is deliberately NOT cancellable from here: no signal is
    // handed over, so navigating away cannot abort the transfer.
    expect(run.opts.signal).toBeUndefined();

    // Navigate to B while A's run is still pending.
    await act(async () => {
      rerender(
        <MeshDetailsModal
          assetId={ASSET_B.assetId}
          ownerUid={OWNER}
          onClose={() => {}}
        />
      );
    });
    await waitFor(() =>
      expect(getAsset).toHaveBeenCalledWith(ASSET_B.assetId, OWNER)
    );

    // A finishing late must leave B's row alone.
    await act(async () => {
      run.resolveRun(RESULT_A);
    });

    expect(screen.queryByText(/Reoptimized/i)).toBeNull();
    expect(screen.queryByText(/Downloading|Optimizing|Uploading/i)).toBeNull();
    // B's Size row still shows B's own size, with no optimized variant —
    // A's result must not have been merged into the displayed doc.
    const sizeRow = screen.getByText('Size:').parentElement;
    expect(sizeRow.textContent).toContain('2.0 MB');
    expect(sizeRow.textContent).not.toContain('→');
  });

  it("shows the finished run's outcome again on returning to that asset", async () => {
    const { rerender } = renderModal(ASSET_A.assetId);
    const button = await screen.findByRole('button', {
      name: /retry optimization/i
    });
    await act(async () => {
      button.click();
    });
    await waitFor(() => expect(reoptimizeCalls).toHaveLength(1));

    await act(async () => {
      rerender(
        <MeshDetailsModal
          assetId={ASSET_B.assetId}
          ownerUid={OWNER}
          onClose={() => {}}
        />
      );
    });
    await act(async () => {
      reoptimizeCalls[0].resolveRun(RESULT_A);
    });
    expect(screen.queryByText(/Reoptimized/i)).toBeNull();

    // Back to A: its outcome is still there, because the status is keyed by
    // asset rather than reset on navigation.
    await act(async () => {
      rerender(
        <MeshDetailsModal
          assetId={ASSET_A.assetId}
          ownerUid={OWNER}
          onClose={() => {}}
        />
      );
    });
    await waitFor(() => expect(screen.getByText(/Reoptimized/i)).toBeTruthy());
  });

  it('scopes in-progress status to the asset it belongs to', async () => {
    const { rerender } = renderModal(ASSET_A.assetId);
    const button = await screen.findByRole('button', {
      name: /retry optimization/i
    });
    await act(async () => {
      button.click();
    });
    await waitFor(() => expect(reoptimizeCalls).toHaveLength(1));

    await act(async () => {
      reoptimizeCalls[0].opts.onStatus('downloading');
    });
    expect(screen.getByText(/Downloading/i)).toBeTruthy();

    await act(async () => {
      rerender(
        <MeshDetailsModal
          assetId={ASSET_B.assetId}
          ownerUid={OWNER}
          onClose={() => {}}
        />
      );
    });
    expect(screen.queryByText(/Downloading/i)).toBeNull();

    // A stage reported after the switch belongs to A, so it must not appear
    // while B is on screen.
    await act(async () => {
      reoptimizeCalls[0].opts.onStatus('uploading');
    });
    expect(screen.queryByText(/Uploading/i)).toBeNull();
  });

  it('shows a run that outlived a closed modal when the modal is reopened', async () => {
    const { unmount } = renderModal(ASSET_A.assetId);
    const button = await screen.findByRole('button', {
      name: /retry optimization/i
    });
    await act(async () => {
      button.click();
    });
    await waitFor(() => expect(reoptimizeCalls).toHaveLength(1));
    await act(async () => {
      reoptimizeCalls[0].opts.onStatus('optimizing');
    });

    // Close the modal entirely. The run is not cancelled...
    unmount();

    // ...so a fresh instance must show it still in progress, with the
    // button disabled, rather than the stale doc as if nothing were running.
    renderModal(ASSET_A.assetId);
    expect(await screen.findByText(/Optimizing/i)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: /retry optimization/i }).disabled
    ).toBe(true);

    // And its outcome lands in the reopened modal, Size row included.
    await act(async () => {
      reoptimizeCalls[0].resolveRun(RESULT_A);
    });
    expect(await screen.findByText(/Reoptimized/i)).toBeTruthy();
    const sizeRow = screen.getByText('Size:').parentElement;
    expect(sizeRow.textContent).toContain('→');
    expect(sizeRow.textContent).toContain('1 KB');
  });

  it('does not start a second run for an asset that already has one in flight', async () => {
    renderModal(ASSET_A.assetId);
    const button = await screen.findByRole('button', {
      name: /retry optimization/i
    });
    await act(async () => {
      button.click();
      button.click();
    });
    await waitFor(() => expect(reoptimizeCalls).toHaveLength(1));
  });

  it('removes the optimized variant and falls back to the original', async () => {
    const optimizedA = {
      ...ASSET_A,
      optimizedSourceUrl: RESULT_A.newUrl,
      optimizedSourcePath: RESULT_A.newPath,
      optimizedSourceSize: RESULT_A.bytesAfter,
      optimizationMetadata: RESULT_A.metadata
    };
    getAsset.mockImplementationOnce(async () => optimizedA);
    renderModal(ASSET_A.assetId);
    const remove = await screen.findByRole('button', {
      name: /remove optimized/i
    });
    expect(screen.getByText('Size:').parentElement.textContent).toContain('→');

    await act(async () => {
      remove.click();
    });
    await waitFor(() => expect(removeOptimizedVariant).toHaveBeenCalled());
    expect(removeOptimizedVariant.mock.calls[0][0].assetId).toBe(
      ASSET_A.assetId
    );
    expect(await screen.findByText(/Optimized version removed/i)).toBeTruthy();
    const sizeRow = screen.getByText('Size:').parentElement;
    expect(sizeRow.textContent).not.toContain('→');
    expect(
      screen.queryByRole('button', { name: /remove optimized/i })
    ).toBeNull();
    // The reversal is itself reversible: Optimize is offered again.
    expect(screen.getByRole('button', { name: /^optimize$/i })).toBeTruthy();
  });
});
