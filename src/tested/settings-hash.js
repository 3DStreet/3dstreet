/**
 * Deep links into Settings (src/shared/settings, docs/settings.md):
 *   #/modal/settings/profile            Profile
 *   #/modal/settings/billing            Usage and billing · Personal
 *   #/modal/settings/billing/<orgId>    Usage and billing · a team
 *   #/modal/settings/team/<orgId>       Manage a team
 *   #/modal/profile                     the old profile link: Profile
 * Used by the editor and the generator, by emails and by the Stripe portal's
 * return URL.
 */

const PREFIX = '#/modal/settings';

/** The Settings section a hash opens ({ id, orgId? }), or null. */
export function parseSettingsHash(hash = '') {
  if (hash === '#/modal/profile' || hash.startsWith('#/modal/profile?')) {
    return { id: 'profile' };
  }
  if (hash !== PREFIX && !hash.startsWith(`${PREFIX}/`)) return null;
  const [id, orgId] = hash
    .slice(PREFIX.length + 1)
    .split(/[?&]/)[0]
    .split('/')
    .map(decodeURIComponent);
  if (id === 'team' && orgId) return { id: 'team', orgId };
  if (id === 'billing') return orgId ? { id, orgId } : { id };
  // Anything else (including the former account and teams sections) opens
  // Profile.
  return { id: 'profile' };
}

/** The hash of a Settings section. */
export function settingsHash(section = { id: 'profile' }) {
  const { id = 'profile', orgId } = section;
  if ((id === 'team' || id === 'billing') && orgId) {
    return `${PREFIX}/${id}/${encodeURIComponent(orgId)}`;
  }
  return `${PREFIX}/${id === 'team' ? 'profile' : id}`;
}
