/**
 * A team scene uses only its team's assets (#1267 Phase 4).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/store', () => ({
  default: { getState: () => ({ sceneOrgId: 'org1' }) }
}));

const { assetAllowedInScene, sceneTeamId } =
  await import('@/editor/lib/asset-upload/teamSceneAssets.js');

describe('teamSceneAssets', () => {
  it("allows only the open team scene's library", () => {
    expect(sceneTeamId()).toBe('org1');
    expect(assetAllowedInScene('org:org1')).toBe(true);
    expect(assetAllowedInScene('user-uid')).toBe(false);
    expect(assetAllowedInScene('org:org2')).toBe(false);
  });

  it('allows anything in a personal scene', () => {
    expect(assetAllowedInScene('user-uid', null)).toBe(true);
    expect(assetAllowedInScene('org:org1', null)).toBe(true);
  });
});
