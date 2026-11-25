/**
 * How the signed-in user can save the open scene (#1267, docs/team-scenes.md).
 * The one place that answers "is this my scene to save?": personal scenes go
 * by authorship, team scenes by the user's team role and the edit lock.
 */
import useStore from '@/store';
import { canEditTeamItem } from '@shared/utils/teamPermissions';

const EDITOR_ROLES = ['owner', 'admin', 'member'];

/** The user's role in a team, from currentUser.orgs, or null. */
export const teamRoleOf = (currentUser, orgId) =>
  (currentUser?.orgs || []).find((org) => org.orgId === orgId)?.role || null;

export const isTeamEditorRole = (role) => EDITOR_ROLES.includes(role);
export const isTeamManagerRole = (role) => role === 'owner' || role === 'admin';

/** Is the team suspended (read-only), for a member of it? */
export const isTeamInactive = (currentUser, orgId) => {
  const org = (currentUser?.orgs || []).find((o) => o.orgId === orgId);
  return !!org && org.status !== 'active';
};

/**
 * Can the user edit this team scene in place? A seat of the team, and, when
 * the team lets members edit only their own scenes, its author (owners and
 * admins edit all). `authorId` is the scene's author.
 */
export const canEditTeamScene = (currentUser, orgId, authorId) =>
  canEditTeamItem(
    (currentUser?.orgs || []).find((org) => org.orgId === orgId),
    authorId,
    currentUser?.uid
  );

/**
 * Where a brand-new scene goes when nothing else says (the team switcher,
 * docs/settings.md): the user's active team, in no project, when they can
 * edit there; else null (a personal scene).
 */
export const activeTeamTarget = (currentUser) => {
  const orgId = currentUser?.activeOrgId;
  const org = (currentUser?.orgs || []).find((o) => o.orgId === orgId);
  return org && org.status === 'active' && isTeamEditorRole(org.role)
    ? { orgId, projectId: null }
    : null;
};

/**
 * 'new'         no cloud scene yet: the first save creates one
 * 'own'         a personal scene the user wrote: saves in place
 * 'team'        a team scene, and this tab holds the edit lock: saves in place
 * 'team-locked' a team scene the user may edit, but someone else holds the
 *               lock (or this tab hasn't got it yet): nothing is saved
 * 'team-viewer' a team scene the user may only view: nothing is saved
 * 'team-inactive' a scene of a suspended team: nothing is saved
 * 'copy'        someone else's scene: saving makes a personal copy (a copy in
 *               the team for its members: another member's scene when the
 *               team lets members edit only their own)
 */
export function sceneSaveMode(currentUser) {
  if (!STREET.utils.getCurrentSceneId()) return 'new';
  const { sceneOrgId, editLock } = useStore.getState();
  if (sceneOrgId) {
    const role = teamRoleOf(currentUser, sceneOrgId);
    if (!role) return 'copy';
    if (isTeamInactive(currentUser, sceneOrgId)) return 'team-inactive';
    if (!isTeamEditorRole(role)) return 'team-viewer';
    if (
      !canEditTeamScene(currentUser, sceneOrgId, STREET.utils.getAuthorId())
    ) {
      return 'copy';
    }
    return editLock.status === 'mine' ? 'team' : 'team-locked';
  }
  return currentUser && STREET.utils.getAuthorId() === currentUser.uid
    ? 'own'
    : 'copy';
}

/** Saving overwrites the open scene (rather than creating a scene). */
export const canSaveInPlace = (currentUser) =>
  ['own', 'team'].includes(sceneSaveMode(currentUser));
