import posthog from 'posthog-js';

const TEAM_EMAIL = 'team@3dstreet.com';

/** An email to 3DStreet about teams: buying one, or more for one. */
export const teamContactHref = (subject = '3DStreet for my team') =>
  `mailto:${TEAM_EMAIL}?subject=${encodeURIComponent(subject)}`;

export const captureTeamContact = (source) =>
  posthog.capture('team_contact_clicked', { source });
