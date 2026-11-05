import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const { getAssetsPage } = vi.hoisted(() => ({ getAssetsPage: vi.fn() }));

vi.mock('@shared/services/firebase.js', () => ({
  auth: { currentUser: { uid: 'user-1' } },
  db: {}
}));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: () => () => {} }));
vi.mock('@shared/contexts', async () => {
  const { createContext } = await import('react');
  return { AuthContext: createContext(null) };
});
vi.mock('../../../src/shared/assets/services/assetsService.js', () => ({
  default: { getAssetsPage }
}));
vi.mock('../../../src/shared/assets/hooks/useAssets.js', () => ({
  assetToDisplayItem: (asset) => ({ id: asset.assetId })
}));

import useAssetsOfType from '../../../src/shared/assets/hooks/useAssetsOfType.js';

describe('useAssetsOfType', () => {
  beforeEach(() => {
    getAssetsPage.mockReset();
  });

  it('reports ready only after every page of the type has loaded', async () => {
    getAssetsPage
      .mockResolvedValueOnce({
        assets: [{ assetId: 'a' }],
        lastDoc: 'cursor-1',
        hasMore: true
      })
      .mockResolvedValueOnce({
        assets: [{ assetId: 'b' }],
        lastDoc: 'cursor-2',
        hasMore: false
      });

    const { result } = renderHook(() => useAssetsOfType('splat'));
    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.items.map((i) => i.id)).toEqual(['a', 'b']);
    expect(getAssetsPage).toHaveBeenCalledTimes(2);
    expect(getAssetsPage.mock.calls[0][1].filters).toEqual({ type: 'splat' });
    expect(getAssetsPage.mock.calls[1][1].cursor).toBe('cursor-1');
  });

  it('reports a failed load rather than an empty library', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    getAssetsPage.mockRejectedValue(new Error('index not ready'));

    const { result } = renderHook(() => useAssetsOfType('image'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.loadFailed).toBe(true);
    expect(result.current.items).toEqual([]);
  });
});
