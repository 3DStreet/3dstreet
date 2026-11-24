/**
 * What a team member may edit (docs/orgs.md, "What members can edit"):
 * mirrors canEditTeamItem in public/functions/org-utils.js and
 * firestore.rules. `org` is the user's entry in currentUser.orgs
 * ({ role, memberEditScope, ... }).
 */
const MANAGER_ROLES = ['owner', 'admin'];

/** 'all' (the default) or 'own'. */
export const memberEditScopeOf = (org) =>
  org?.memberEditScope === 'own' ? 'own' : 'all';

/**
 * Can this user edit a team scene or library asset that `creatorUid`
 * created or added? Owners and admins edit everything; members everything,
 * or only their own when the team says so; viewers nothing.
 */
export const canEditTeamItem = (org, creatorUid, uid) =>
  !!org &&
  (MANAGER_ROLES.includes(org.role) ||
    (org.role === 'member' &&
      (memberEditScopeOf(org) === 'all' || (!!uid && creatorUid === uid))));
