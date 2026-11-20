/**
 * How the signed-in user can save the open scene (#1267, docs/team-scenes.md).
 * The one place that answers "is this my scene to save?": personal scenes go
 * by authorship, team scenes by the user's team role and the edit lock.
 */
import useStore from '@/store';

const EDITOR_ROLES = ['owner', 'admin', 'member'];

/** The user's role in a team, from currentUser.orgs, or null. */
export const teamRoleOf = (currentUser, orgId) =>
  (currentUser?.orgs || []).find((org) => org.orgId === orgId)?.role || null;

export const isTeamEditorRole = (role) => EDITOR_ROLES.includes(role);
export const isTeamManagerRole = (role) => role === 'owner' || role === 'admin';

/**
 * 'new'         no cloud scene yet: the first save creates one
 * 'own'         a personal scene the user wrote: saves in place
 * 'team'        a team scene, and this tab holds the edit lock: saves in place
 * 'team-locked' a team scene the user may edit, but someone else holds the
 *               lock (or this tab hasn't got it yet): nothing is saved
 * 'team-viewer' a team scene the user may only view: nothing is saved
 * 'copy'        someone else's scene: saving makes a personal copy
 */
export function sceneSaveMode(currentUser) {
  if (!STREET.utils.getCurrentSceneId()) return 'new';
  const { sceneOrgId, editLock } = useStore.getState();
  if (sceneOrgId) {
    const role = teamRoleOf(currentUser, sceneOrgId);
    if (!role) return 'copy';
    if (!isTeamEditorRole(role)) return 'team-viewer';
    return editLock.status === 'mine' ? 'team' : 'team-locked';
  }
  return currentUser && STREET.utils.getAuthorId() === currentUser.uid
    ? 'own'
    : 'copy';
}

/** Saving overwrites the open scene (rather than creating a scene). */
export const canSaveInPlace = (currentUser) =>
  ['own', 'team'].includes(sceneSaveMode(currentUser));
