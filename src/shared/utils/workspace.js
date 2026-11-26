/**
 * The workspace the user works in (the team switcher, docs/settings.md):
 * their active team, or Personal. The plan badge and the profile menu show
 * its plan, so the user sees whose plan they work under.
 */
import { formatSharedMessage } from '../i18n/sharedMessages';

/**
 * Pro from an email domain only (the ALLOWED_PRO_TEAM_DOMAINS secret), with no
 * plan or pass of their own. Not a team seat: it follows the user everywhere.
 */
export const isDomainPro = (user) =>
  !!user?.teamDomain && !user.plan && !user.isProPass;

/** The user's own plan, not a team's: 'MAX' | 'PRO' | null. */
export const personalPlanOf = (user) => {
  if (user?.plan === 'MAX') return 'MAX';
  if (user?.plan === 'PRO' || user?.isProPass) return 'PRO';
  return isDomainPro(user) ? 'PRO' : null;
};

/**
 * { team, plan }: the active team and its plan (null when it's suspended, or
 * the user is a viewer and gets no plan from it), or team null and the user's own plan (null = Free).
 */
export const workspaceOf = (user) => {
  const team =
    (user?.orgs || []).find((org) => org.orgId === user?.activeOrgId) || null;
  return team
    ? {
        team,
        plan:
          team.status === 'active' && team.role !== 'viewer'
            ? team.plan || null
            : null
      }
    : { team: null, plan: personalPlanOf(user) };
};

/**
 * The plan badge's text: "PRO · UO Urban Design 410" for a team
 * ("VIEWER · …" for its viewers, "INACTIVE · …" when suspended), the user's
 * own plan under Personal ('FREE' without one).
 */
export const workspaceLabel = (user) => {
  const { team, plan } = workspaceOf(user);
  if (!team) return plan || 'FREE';
  const label =
    team.status !== 'active'
      ? formatSharedMessage('teamInactiveLabel').toUpperCase()
      : team.role === 'viewer'
        ? formatSharedMessage('menuRoleViewer').toUpperCase()
        : plan || 'PRO';
  return `${label} · ${team.name}`;
};
