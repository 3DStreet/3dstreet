/**
 * The modal's chrome is localized through the shared message table rather
 * than react-intl, because it also renders in the generator and bollardbuddy
 * islands where no IntlProvider is mounted. These check the wiring end to
 * end — that the labels actually resolve through the active locale, not just
 * that entries exist in the table.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const OWNER = 'user-abc';

const ASSET = {
  assetId: 'asset-1',
  userId: OWNER,
  type: 'mesh',
  name: 'Chair',
  size: 2_000_000,
  storageUrl: 'https://example.test/a.glb',
  originalFilename: 'chair.glb',
  optimizationMetadata: { optimizationSkipped: true, reason: 'timeout' }
};

vi.mock('@shared/services/firebase.js', () => ({
  auth: { currentUser: { uid: OWNER } },
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

const { default: MeshDetailsModal } =
  await import('../../../src/shared/assets/components/MeshDetailsModal.jsx');

function renderModal() {
  return render(
    <MeshDetailsModal
      assetId={ASSET.assetId}
      ownerUid={OWNER}
      onClose={() => {}}
    />
  );
}

describe('MeshDetailsModal localization', () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it('renders field labels and buttons in English by default', async () => {
    renderModal();
    expect(await screen.findByText('Display name')).toBeTruthy();
    expect(screen.getByText('Size:')).toBeTruthy();
    expect(screen.getByText('Owner:')).toBeTruthy();
    expect(screen.getByText('Attribution')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('renders them in French when that locale is active', async () => {
    localStorage.setItem('locale', 'fr');
    renderModal();
    expect(await screen.findByText('Nom affiché')).toBeTruthy();
    expect(screen.getByText('Taille :')).toBeTruthy();
    expect(screen.getByText('Propriétaire :')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Modifier' })).toBeTruthy();
    // The type prefix in the title is localized too.
    await waitFor(() =>
      expect(screen.getByText(/Modèle · Chair/)).toBeTruthy()
    );
  });

  it('localizes the owner value, not just its label', async () => {
    localStorage.setItem('locale', 'es');
    renderModal();
    expect(await screen.findByText('Propietario:')).toBeTruthy();
    expect(screen.getByText('tú')).toBeTruthy();
  });
});
