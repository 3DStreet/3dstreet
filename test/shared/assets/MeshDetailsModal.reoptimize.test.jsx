/**
 * Regression guard for the cross-asset navigation race in the Reoptimize
 * action: a run started on asset A must not write A's optimization stats,
 * progress or outcome onto asset B when the user navigates mid-run.
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
vi.mock('@shared/asset-upload', () => ({
  reoptimizeAsset: (...a) => reoptimizeAsset(...a)
}));

const { default: MeshDetailsModal } =
  await import('../../../src/shared/assets/components/MeshDetailsModal.jsx');

function renderModal(assetId) {
  return render(
    <MeshDetailsModal assetId={assetId} ownerUid={OWNER} onClose={() => {}} />
  );
}

describe('MeshDetailsModal — reoptimize across asset navigation', () => {
  beforeEach(() => {
    reoptimizeCalls = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('cancels the run and drops its result when the user navigates away', async () => {
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

    // The in-flight download/upload is actually cancelled, not just ignored.
    expect(run.opts.signal.aborted).toBe(true);

    // A finishing late must not touch B.
    await act(async () => {
      run.resolveRun({
        ok: true,
        newUrl: 'https://example.test/a-opt.glb',
        newPath: `users/${OWNER}/assets/meshes/a-optimized-2.glb`,
        bytesAfter: 1_000,
        bytesBefore: 10_000_000,
        metadata: { optimizationSkipped: false }
      });
    });

    expect(screen.queryByText(/Reoptimized/i)).toBeNull();
    expect(screen.queryByText(/Downloading|Optimizing|Uploading/i)).toBeNull();
  });

  it('clears a previous asset in-progress status on navigation', async () => {
    const { rerender } = renderModal(ASSET_A.assetId);
    const button = await screen.findByRole('button', {
      name: /retry optimization/i
    });
    await act(async () => {
      button.click();
    });
    await waitFor(() => expect(reoptimizeCalls).toHaveLength(1));

    // Report a stage, as the real module does while downloading.
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

    // A stage reported after the switch is dropped rather than shown under B.
    await act(async () => {
      reoptimizeCalls[0].opts.onStatus('uploading');
    });
    expect(screen.queryByText(/Uploading/i)).toBeNull();
  });
});
