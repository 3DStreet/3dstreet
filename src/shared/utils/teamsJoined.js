/**
 * Tell the user they joined a team by email domain at sign-in (docs/orgs.md):
 * `checkUserProStatus` reports it once, and each app shows its own toast.
 */
import { formatSharedMessage } from '../i18n/sharedMessages';

const TEAMS_JOINED_EVENT = '3dstreet-teams-joined';

export const announceJoinedTeams = ({ joinedOrgIds, orgs, activeOrgId }) => {
  const joined = orgs.filter((org) => joinedOrgIds.includes(org.orgId));
  if (!joined.length) return;
  window.dispatchEvent(
    new CustomEvent(TEAMS_JOINED_EVENT, { detail: { joined, activeOrgId } })
  );
};

/** Call `notify(message)` for each team joined. Returns the unsubscriber. */
export const onTeamsJoined = (notify) => {
  const listener = ({ detail: { joined, activeOrgId } }) =>
    joined.forEach((org) =>
      notify(
        formatSharedMessage(
          org.orgId === activeOrgId && org.role !== 'viewer'
            ? 'teamJoinedActive'
            : 'teamJoined',
          { team: org.name }
        )
      )
    );
  window.addEventListener(TEAMS_JOINED_EVENT, listener);
  return () => window.removeEventListener(TEAMS_JOINED_EVENT, listener);
};
