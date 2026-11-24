/**
 * The workspace the user works in (the team switcher, docs/settings.md):
 * their active team, or Personal. The plan badge and the profile menu show
 * its plan, so the user sees whose plan they work under.
 */

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
 * { team, plan }: the active team (when it's still active) and its plan, or
 * team null and the user's own plan (null = Free).
 */
export const workspaceOf = (user) => {
  const team =
    (user?.orgs || []).find(
      (org) => org.orgId === user?.activeOrgId && org.status === 'active'
    ) || null;
  return team
    ? { team, plan: team.plan || null }
    : { team: null, plan: personalPlanOf(user) };
};

/**
 * The plan badge's text: "PRO · UO Urban Design 410" for a team, the user's
 * own plan under Personal ('FREE' without one).
 */
export const workspaceLabel = (user) => {
  const { team, plan } = workspaceOf(user);
  return team ? `${plan || 'PRO'} · ${team.name}` : plan || 'FREE';
};
