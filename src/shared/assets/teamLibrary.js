/**
 * Team asset library (#1267 Phase 4, docs/team-assets.md), client side:
 * the callables (public/functions/team-assets.js) and the teams a user can
 * add assets to.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from '@shared/services/firebase.js';

const call = async (name, data) =>
  (await httpsCallable(functions, name)(data)).data;

/** Copy one of the user's assets into a team's library. */
export const addAssetToTeam = (orgId, assetId) =>
  call('orgAddAsset', { orgId, assetId });

/** Replace a team asset's file with one of the user's assets. */
export const replaceTeamAssetFile = (orgId, assetId, sourceAssetId) =>
  call('orgReplaceAssetFile', { orgId, assetId, sourceAssetId });

/** Remove an asset from a team's library. */
export const removeTeamAsset = (orgId, assetId) =>
  call('orgRemoveAsset', { orgId, assetId });

const SEAT_ROLES = ['owner', 'admin', 'member'];
const MANAGER_ROLES = ['owner', 'admin'];

/** Active teams of the user (currentUser.orgs) whose library they can read. */
export const libraryTeams = (orgs) =>
  (orgs || []).filter((org) => org.status === 'active');

/** Active teams where the user can add assets (a seat). */
export const teamsUserCanAddTo = (orgs) =>
  libraryTeams(orgs).filter((org) => SEAT_ROLES.includes(org.role));

/** Can this user remove a team asset (managers, or the member who added it)? */
export const canRemoveTeamAsset = (org, asset, uid) =>
  !!org &&
  (MANAGER_ROLES.includes(org.role) ||
    (org.role === 'member' && asset?.addedBy === uid));

/** Shared message key for a refused team library call. */
export const teamLibraryErrorKey = (error) => {
  const reason = error?.details?.reason;
  return (
    {
      'not-editor': 'teamLibraryNotEditor',
      'not-manager': 'teamLibraryNotManager',
      'own-only': 'teamLibraryOwnOnly',
      'asset-not-found': 'teamLibraryAssetNotFound',
      'asset-converting': 'teamLibraryConverting',
      'asset-type-mismatch': 'teamLibraryTypeMismatch',
      'team-storage-full': 'teamLibraryStorageFull',
      'org-suspended': 'teamLibrarySuspended'
    }[reason] || 'teamLibraryFailed'
  );
};

const GB = 1000 * 1000 * 1000;
const STORAGE_PER_SEAT = { PRO: 5 * GB, MAX: 25 * GB };

/**
 * A team library's storage limit: the one staff set (a site license always
 * has one), else the plan's personal limit per seat.
 * Mirrors teamStorageLimit in public/functions/team-assets-utils.js (drift
 * test: test/shared/assets/teamLibrary-sync.test.js).
 */
export const teamLibraryLimit = ({ plan, seats, storageLimitGb }) =>
  storageLimitGb
    ? storageLimitGb * GB
    : (STORAGE_PER_SEAT[plan] || STORAGE_PER_SEAT.PRO) *
      Math.max(1, Number(seats) || 1);
