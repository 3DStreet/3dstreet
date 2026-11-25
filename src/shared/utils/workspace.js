/**
 * The workspace the user works in (the team switcher, docs/settings.md):
 * their active team, or Personal. The plan badge and the profile menu show
 * its plan, so the user sees whose plan they work under.
 */
import { formatSharedMessage } from '../i18n/sharedMessages';

/** The user's own plan, not a team's: 'MAX' | 'PRO' | 'PRO TEAM' | null. */
export const personalPlanOf = (user) => {
  if (user?.plan === 'MAX') return 'MAX';
  if (user?.plan === 'PRO' || user?.isProPass) return 'PRO';
  // Pro from an email domain (the ALLOWED_PRO_TEAM_DOMAINS secret), not an
  // org seat: it follows the user everywhere.
  if (user?.isProTeam && user?.teamDomain && !user?.teamName) return 'PRO TEAM';
  return null;
};

/**
 * { team, plan }: the active team and its plan (null when it's suspended), or
 * team null and the user's own plan (null = Free).
 */
export const workspaceOf = (user) => {
  const team =
    (user?.orgs || []).find((org) => org.orgId === user?.activeOrgId) || null;
  return team
    ? { team, plan: team.status === 'active' ? team.plan || null : null }
    : { team: null, plan: personalPlanOf(user) };
};

/**
 * The plan badge's text: "PRO · UO Urban Design 410" for a team, the user's
 * own plan under Personal ('FREE' without one).
 */
export const workspaceLabel = (user) => {
  const { team, plan } = workspaceOf(user);
  if (!team) return plan || 'FREE';
  const label =
    team.status === 'active'
      ? plan || 'PRO'
      : formatSharedMessage('teamInactiveLabel').toUpperCase();
  return `${label} · ${team.name}`;
};
