/**
 * Owner keys of cloud assets (#1267 Phase 4, src/shared/assets/assetOwner.js).
 */
import { describe, it, expect } from 'vitest';
import {
  teamAssetOwner,
  teamIdOfOwner,
  assetOwnerSegments
} from '@shared/assets/assetOwner.js';

describe('asset owner keys', () => {
  it('maps a uid to the user and org:<id> to the team', () => {
    expect(assetOwnerSegments('uid-1')).toEqual(['users', 'uid-1']);
    expect(teamAssetOwner('o1')).toBe('org:o1');
    expect(assetOwnerSegments('org:o1')).toEqual(['orgs', 'o1']);
    expect(teamIdOfOwner('org:o1')).toBe('o1');
    expect(teamIdOfOwner('uid-1')).toBe(null);
    expect(teamIdOfOwner(undefined)).toBe(null);
  });
});
