/**
 * A team scene uses only its team's assets (#1267 Phase 4,
 * docs/team-assets.md). Personal assets belong to one member: in a team
 * scene they would break for the others (they can't read the member's asset)
 * and leave with the member. So placing, swapping or replacing an asset in a
 * team scene requires an asset of that team's library; members add theirs
 * to the library first ("Add to team library").
 */
import useStore from '@/store';
import { teamAssetOwner } from '@shared/assets';
import { formatSharedMessage } from '@shared/i18n/sharedMessages';

/** The open scene's team, or null for a personal scene. */
export const sceneTeamId = () => useStore.getState().sceneOrgId || null;

/** May an asset with this owner key go into the scene of team `orgId`? */
export const assetAllowedInScene = (owner, orgId = sceneTeamId()) =>
  !orgId || owner === teamAssetOwner(orgId);

/** The refusal shown when a personal asset is put into a team scene. */
export const teamSceneAssetMessage = () =>
  formatSharedMessage('teamSceneNeedsTeamAsset');
